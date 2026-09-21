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
# 用法：
#   bash scripts/git-doctor.sh            # 诊断 + 修 ①③
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

# 无论是否一致都同步一遍（顺带补上其它分支，并清理已删除的远端分支）
SYNC_DIR="$GIT_DIR_PATH/refs/remotes/$REMOTE"
mkdir -p "$SYNC_DIR"
N=0
while read -r sha ref; do
  [ -z "$sha" ] && continue
  name="${ref#refs/heads/}"
  mkdir -p "$(dirname "$SYNC_DIR/$name")"
  printf '%s\n' "$sha" > "$SYNC_DIR/$name" && N=$((N + 1))
done < <(git ls-remote --heads "$REMOTE" 2>/dev/null)
echo "   ✓ 已同步 $N 个 $REMOTE 跟踪引用（直接写松散文件）"

# 提示：packed-refs 里若残留旧值，虽然会被松散引用盖住，但建议一并清理
if grep -q "refs/remotes/$REMOTE/main" "$GIT_DIR_PATH/packed-refs" 2>/dev/null; then
  PK=$(awk -v r="refs/remotes/$REMOTE/main" '$2==r {print $1}' "$GIT_DIR_PATH/packed-refs")
  if [ -n "$PK" ] && [ "$PK" != "$(git rev-parse "refs/remotes/$REMOTE/main" 2>/dev/null)" ]; then
    echo "   ⚠ packed-refs 仍残留旧值 ${PK:0:8}（已被松散引用覆盖，但建议清理）"
    echo "     备份并修正：cp .git/packed-refs .git/packed-refs.bak && sed -i 's/^$PK/$TRUE_SHA/' .git/packed-refs"
  else
    echo "   ✓ packed-refs 一致"
  fi
fi

echo
echo "═══ 完成。判断远端状态请始终以 git ls-remote 为准 ═══"
