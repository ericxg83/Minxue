#!/usr/bin/env bash
#
# scripts/git-doctor.sh —— 修复本仓三个 git 环境坑（2026-09-21 实测沉淀）
#
# 背景：2026-09-21 一次提交 + 推送耗时异常（`git commit` 3 分 14 秒），排查后
# 定位到三个互相纠缠的环境问题。本脚本把「诊断 + 修复」固化成一条命令，
# 免得每次重新踩。三者因果链：
#
#   ② 写操作极慢  ──►  超时被杀  ──►  ① 留下 index.lock 死锁  ──►  下次 commit 直接失败
#   ③ 远端跟踪引用写不进去（与 ①② 独立，但会让 `git log origin/main..HEAD` 骗人）
#
# ── ① 陈旧 .git/index.lock ──────────────────────────────────────────────
# 被 SIGTERM 杀掉的 git 命令会留下 0 字节的 .git/index.lock，之后所有写操作报
# "Unable to create index.lock"。git 自己不会清理。本脚本只在「文件存在 + 无 git
# 进程 + 文件年龄 > 60 秒」三个条件同时满足时才删，避免误删正在使用的锁。
#
# ── ② 写操作极慢（pack 爆炸）───────────────────────────────────────────
# 本仓是 blob:none 部分克隆（remote.origin.partialclonefilter=blob:none），
# **每次 fetch 都会新增一个 promisor pack**。长期不合并会累积到数百个
# （实测 654 个 pack / 606 个 promisor），而 gc.autoPackLimit 默认 50 →
# 每次 `git commit` 收尾的 `gc --auto` 都去合并这 654 个 pack，耗时数分钟。
# 一旦被超时杀掉，pack 没合并成、还留下死锁 → 下次 commit 重演。
# 修法：把 gc.autoPackLimit 调小（本仓已设 20）让每次合并都便宜，并手动合并一次。
#
# ── ③ refs/remotes/** 写入静默失效 ─────────────────────────────────────
# 症状：`git update-ref refs/remotes/origin/main <sha>` 返回 rc=0，但引用不变、
# 松散文件根本没被创建；而 `refs/heads/**` 的写入完全正常（GIT_TRACE_REFS 显示
# 两者事务都 `finish: 0`）。沙箱自带 git(2.55) 与系统 git(2.53) 表现一致，
# 故非某个 git 版本的问题。`git fetch` / `git push` 的本地跟踪引用更新同样失效。
# 后果：`git log origin/main..HEAD` 会虚报（实测虚报 11 条 / 反向虚报 518 条），
# 让人误判「要推一堆东西」或「远端落后」。
# 修法：不信本地跟踪引用，改信 `git ls-remote`；用**直接写松散文件**的方式同步
# （松散引用优先于 packed-refs，已验证生效）。
#
# ⚠️ 同步时的两条护栏（2026-09-21 复验补）：
#   1. **只同步「当前分支 + 已有本地跟踪引用」的远端分支**。给一个本地没有对象的远端
#      分支建跟踪引用，会让 `git fsck` 报 `refs/remotes/<remote>/<b>: invalid sha1 pointer`。
#   2. 写入前用 `GIT_NO_LAZY_FETCH=1 git cat-file -e <sha>` 确认对象已在本地；
#      写完之后再反向扫一遍，把指向缺失对象的松散跟踪引用删掉（防止旧版本脚本留下的脏引用）。
#   （本仓是 blob:none 部分克隆，只过滤 blob；commit/tree 对象正常 fetch 时一定落地，
#     所以这两条护栏只会拦到「手工造出来的」引用，不会误删正常跟踪引用。）
#
# 用法：
#   bash scripts/git-doctor.sh            # 诊断 + 修 ①③（含 packed-refs 自动修正，带备份）
#   bash scripts/git-doctor.sh --repack   # 额外做一次 pack 合并（约 1~2 分钟，别中断）
#
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "✗ 不在 git 仓库内"; exit 1; }
cd "$REPO_ROOT" || exit 1
GIT_DIR_PATH="$(git rev-parse --git-dir)"
REMOTE="${GIT_DOCTOR_REMOTE:-origin}"

DO_REPACK=0
[ "${1:-}" = "--repack" ] && DO_REPACK=1

echo "═══ git-doctor @ $REPO_ROOT ═══"

# ── ① 陈旧 index.lock ──────────────────────────────────────────────────
echo
echo "① index.lock"
LOCK="$GIT_DIR_PATH/index.lock"
if [ ! -e "$LOCK" ]; then
  echo "   ✓ 无锁"
else
  if pgrep -x git >/dev/null 2>&1 || pgrep -f "git-remote" >/dev/null 2>&1; then
    echo "   ⚠ 检测到 git 进程仍在运行，不删锁（避免误删）"
  else
    age=$(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || echo 0) ))
    if [ "$age" -gt 60 ]; then
      rm -f "$LOCK" && echo "   ✓ 已删除陈旧锁（年龄 ${age}s，无 git 进程）"
    else
      echo "   ⚠ 锁年龄仅 ${age}s，可能正在使用，跳过"
    fi
  fi
fi

# ── ② pack 健康度 ─────────────────────────────────────────────────────
echo
echo "② pack 健康度"
PACK_DIR="$GIT_DIR_PATH/objects/pack"
PACKS=$(ls "$PACK_DIR"/*.pack 2>/dev/null | wc -l | tr -d ' ')
LIMIT=$(git config --get gc.autoPackLimit || echo 50)
echo "   pack 数 = $PACKS   gc.autoPackLimit = $LIMIT"
if [ "$PACKS" -gt "$LIMIT" ]; then
  echo "   ⚠ pack 数超过阈值 → 每次 git commit 的 gc --auto 都会尝试全量合并（可能数分钟）"
  echo "     建议执行：bash scripts/git-doctor.sh --repack"
else
  echo "   ✓ 正常（未超过阈值，commit 不会触发大规模合并）"
fi
# 孤儿 .idx（有 idx 无 pack）会让 git 报 "failed to load pack"
ORPHAN=0
for f in "$PACK_DIR"/*.idx; do
  [ -e "$f" ] || continue
  [ -e "${f%.idx}.pack" ] || ORPHAN=$((ORPHAN + 1))
done
if [ "$ORPHAN" -gt 0 ]; then
  echo "   ⚠ 发现 $ORPHAN 个孤儿 .idx（无对应 .pack）→ 建议删除"
else
  echo "   ✓ 无孤儿 .idx"
fi
if [ "$DO_REPACK" = "1" ]; then
  echo "   → 开始合并 pack（约 1~2 分钟，请勿中断）..."
  if git repack -a -d; then
    echo "   ✓ 合并完成，现剩 $(ls "$PACK_DIR"/*.pack 2>/dev/null | wc -l | tr -d ' ') 个 pack"
    git multi-pack-index write 2>/dev/null && echo "   ✓ multi-pack-index 已重建"
  else
    echo "   ✗ 合并失败"
  fi
fi

# ── ③ 远端跟踪引用 ─────────────────────────────────────────────────────
echo
echo "③ 远端跟踪引用（$REMOTE）"
TRUE_SHA=$(git ls-remote "$REMOTE" refs/heads/main 2>/dev/null | head -1 | cut -f1)
LOCAL_SHA=$(git rev-parse "refs/remotes/$REMOTE/main" 2>/dev/null || echo "")
echo "   ls-remote（权威）: ${TRUE_SHA:-(取不到)}"
echo "   本地跟踪引用     : ${LOCAL_SHA:-(无)}"
if [ -z "$TRUE_SHA" ]; then
  echo "   ⚠ 取不到远端（网络/代理问题），跳过同步"
elif [ "$TRUE_SHA" = "$LOCAL_SHA" ]; then
  echo "   ✓ 一致"
else
  echo "   ⚠ 不一致 → 直接写松散引用修正（git update-ref 在本环境会静默失效）"
fi

# 同步范围：当前分支（③ 真正要解决的）+ 已有本地跟踪引用的分支。
# 其余远端分支跳过 —— 给本地没有对象的引用建指针只会让 `git fsck` 报
# `invalid sha1 pointer`（2026-09-21 复验踩到）。
SYNC_DIR="$GIT_DIR_PATH/refs/remotes/$REMOTE"
mkdir -p "$SYNC_DIR"
CUR_BRANCH="$(git symbolic-ref --short -q HEAD 2>/dev/null || echo "")"
# ⚠️ 必须用 for-each-ref 而不是 `find`：`git gc`/`pack-refs` 会把松散引用折进 packed-refs，
# 只扫松散文件会漏掉它们（2026-09-21 复验踩到：4 个跟踪引用被误判为"不存在"而不再刷新）。
EXISTING_LIST="$(git for-each-ref --format='%(refname)' "refs/remotes/$REMOTE" 2>/dev/null \
  | sed "s|^refs/remotes/$REMOTE/||")"
N=0
SKIPPED=""
MISSING=""
while read -r sha ref; do
  [ -z "$sha" ] && continue
  name="${ref#refs/heads/}"
  if [ "$name" != "$CUR_BRANCH" ] && ! printf '%s\n' "$EXISTING_LIST" | grep -Fxq "$name"; then
    SKIPPED="$SKIPPED $name"
    continue
  fi
  # 对象不在本地就不建引用（GIT_NO_LAZY_FETCH 支持的版本下生效；不支持时 cat-file 会
  # 顺手把对象拉下来，同样不会留下悬空指针）
  if ! GIT_NO_LAZY_FETCH=1 git cat-file -e "$sha" 2>/dev/null; then
    MISSING="$MISSING $name"
    continue
  fi
  mkdir -p "$(dirname "$SYNC_DIR/$name")"
  printf '%s\n' "$sha" > "$SYNC_DIR/$name" && N=$((N + 1))
done < <(git ls-remote --heads "$REMOTE" 2>/dev/null)
echo "   ✓ 已同步 $N 个 $REMOTE 跟踪引用（直接写松散文件）"
[ -n "$SKIPPED" ] && echo "   · 跳过（非当前分支且无本地跟踪引用，避免悬空指针）：$SKIPPED"
[ -n "$MISSING" ] && echo "   ⚠ 跳过（本地缺对象）：$MISSING   → 需要时先 git fetch $REMOTE <branch>"

# 反向清理：指向缺失对象的松散跟踪引用会让 fsck 报 invalid sha1 pointer。
# 只删「松散文件」——本脚本自己写的引用都是松散文件；packed-refs 里的异常引用只提示
# （改 packed-refs 风险高于收益，且正常 fetch 不会产生这种引用）。
REMOVED=""
PACKED_BAD=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  sha="$(tr -d '\r\n' < "$f")"
  if ! GIT_NO_LAZY_FETCH=1 git cat-file -e "$sha" 2>/dev/null; then
    rm -f "$f" && REMOVED="$REMOVED ${f#"$SYNC_DIR/"}"
  fi
done < <(find "$SYNC_DIR" -type f 2>/dev/null)
[ -n "$REMOVED" ] && echo "   ✓ 已清理悬空跟踪引用（对象缺失）：$REMOVED"

while read -r sha ref; do
  [ -z "$sha" ] && continue
  GIT_NO_LAZY_FETCH=1 git cat-file -e "$sha" 2>/dev/null || PACKED_BAD="$PACKED_BAD $ref"
done < <(git for-each-ref --format='%(objectname) %(refname)' "refs/remotes/$REMOTE" 2>/dev/null)
if [ -n "$PACKED_BAD" ]; then
  echo "   ⚠ 以下跟踪引用指向本地缺失对象（多在 packed-refs 里，需手工处理）：$PACKED_BAD"
  echo "     临时绕过：判断远端状态一律用 git ls-remote；或 git fetch $REMOTE <branch> 补齐对象"
fi

# packed-refs 里若残留旧值：松散引用会盖住它，但留着会误导 `git log origin/main`
if grep -q "refs/remotes/$REMOTE/main" "$GIT_DIR_PATH/packed-refs" 2>/dev/null; then
  PK=$(awk -v r="refs/remotes/$REMOTE/main" '$2==r {print $1}' "$GIT_DIR_PATH/packed-refs")
  NOW="$(git rev-parse "refs/remotes/$REMOTE/main" 2>/dev/null)"
  if [ -n "$PK" ] && [ "$PK" != "$NOW" ]; then
    BAK="$GIT_DIR_PATH/packed-refs.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$GIT_DIR_PATH/packed-refs" "$BAK"
    awk -v r="refs/remotes/$REMOTE/main" -v s="$NOW" \
      '{ if ($2==r && $1 !~ /^\^/) print s" "$2; else print }' \
      "$BAK" > "$GIT_DIR_PATH/packed-refs"
    echo "   ✓ packed-refs 残留旧值 ${PK:0:8} 已修正为 ${NOW:0:8}（备份：$(basename "$BAK")）"
  else
    echo "   ✓ packed-refs 一致"
  fi
fi

echo
echo "═══ 完成。判断远端状态请始终以 git ls-remote 为准 ═══"
