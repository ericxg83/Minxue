/**
 * r269 回归锁：技能引用体检的「豁免判据」必须只豁免系统性误报，真断头路照样判错。
 *
 * ⛔ 修的是什么（实测，非推理）：
 *   `node scripts/check-skill-refs.mjs` 长期输出 **34 处「错误」并 exit 1**，
 *   逐条核对后 32 处是系统性误报 —— 25 处是项目约定永不入库的临时/探针文件名
 *   （巡检纪律原文：「探针放 server/_diag_*.mjs（.gitignore 已排除 server/_*）」，
 *   原 PLACEHOLDER 注释也写着「例：_diag_xxx.mjs」，但正则只匹配字面 `xxx`，
 *   真实探针名一个都罩不住）；1 处日期占位符；5 处作者标注了但用词不在词表里；
 *   1 处同一行就把文件定位在仓库外。
 *   误报的代价：报告退化成「永远 34 红的狼来了」——要么每轮耗时逐条排除，
 *   要么学会整体无视它；而它一旦被接进自动化就是恒定假红。
 *
 * ⛔ 反向自检为什么这样写：禁 spawnSync 调 git（Windows EBUSY）⇒ 把「修复前」的
 *   判据（旧 PLACEHOLDER / 旧 MARKED 七词 / 无临时名规则 / 无仓库外规则）
 *   **内联合成**，喂同一批样本必须判红 —— 证明是新规则在豁免，而不是样本本身没问题。
 *
 * 本测试不依赖本机技能目录（纯函数 + 源码锁），任何机器上结论一致。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MARKED, isEphemeralRef, classifyMissingRef
} from '../scripts/skillRefsKit.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

// ─────────────────────────── ① 该豁免的必须豁免（真跑判据） ───────────────────────────

test('临时/探针文件名不算失效引用（项目约定永不入库）', () => {
  // 这些名字在 git ls-files 里永远找不到（.gitignore 的 _* / tmp/ 规则），
  // 技能文档里留下的是「当时跑了这个探针看到…」的历史记录，不是照抄会失败的路径。
  for (const norm of [
    '_diag_q456_e2e.mjs',
    'server/_diag_round4_compare.mjs',
    'server/_diag_recompute_channels_0924.mjs',
    '_tmp_judge_internals.mjs',
    '_repro_diff.mjs',
    '_bench_gemini37_vision.mjs',
    '_patch_backup_pages.py',
    '_head.js',
    'tmp/prune-lint.json',
    'deliverables/gemini37_first_backup_assessment_20260920.md',
    'logs/patrol-daemon.log'
  ]) {
    const v = classifyMissingRef({ tok: norm, norm, line: `跑了 ${norm} 看结果`, marked: false, markedBaseHas: false })
    assert.equal(v.excuse, true, `${norm} 应被豁免（${v.reason}）`)
    assert.equal(v.kind, 'ephemeral')
    assert.equal(isEphemeralRef(norm), true)
  }
})

test('日期/时间戳占位符不算失效引用（与 xxx / 0NN 同一类别）', () => {
  for (const tok of [
    'server/scripts/backfill-answer-correction-YYYYMMDD.mjs',
    'backfill-answers-YYYY-MM-DD.mjs',
    'probe-<ts>.mjs'
  ]) {
    const v = classifyMissingRef({ tok, norm: tok, line: `跑 ${tok}`, marked: false, markedBaseHas: false })
    assert.equal(v.excuse, true, `${tok} 应被豁免（${v.reason}）`)
    assert.equal(v.kind, 'placeholder')
  }
})

test('行内已标注（含 r269 扩充词表）不算失效引用', () => {
  const cases = [
    // [行文本, 说明]
    ['旧脚本 `backfill-lowconf-wrong-questions.mjs`（强灌低置信题）已于 2026-09-11 删除；替代品 `server/scripts/audit-lowconf-wrong-questions.mjs` 只做稽核', '删除/旧脚本/替代品'],
    ['| `components.json` | **不存在** |', '不存在'],
    ['不执行 shadcn init、不生成 `components.json`、不装 Radix', '不生成'],
    ['该探针是临时件，跑完即删', '临时件（原有词表）'],
    ['脚本已不在仓库，别照抄', '已不在仓库（原有词表）']
  ]
  for (const [line, why] of cases) {
    const v = classifyMissingRef({ tok: 'components.json', norm: 'components.json', line, marked: MARKED.test(line), markedBaseHas: false })
    assert.equal(v.excuse, true, `「${why}」应判已标注：${line.slice(0, 40)}`)
    assert.equal(v.kind, 'marked')
  }
})

test('同一行把文件定位在仓库外 ⇒ 该行**裸名**引用不算本仓失效引用', () => {
  const line = '本机网关在 `C:/Users/Administrator/pi-failover/`（`gateway.py` + `config.json`，端口 8787）'
  const v = classifyMissingRef({ tok: 'gateway.py', norm: 'gateway.py', line, marked: false, markedBaseHas: false })
  assert.equal(v.excuse, true)
  assert.equal(v.kind, 'external')
  // home 缩写同规则
  const line2 = '自定义 provider 走 `~/.pi/agent/models.json` 里的 `gateway.py`'
  assert.equal(classifyMissingRef({ tok: 'gateway.py', norm: 'gateway.py', line: line2, marked: false, markedBaseHas: false }).excuse, true)
})

test('文件级标注（本技能另一行交代过）同样豁免', () => {
  const v = classifyMissingRef({ tok: 'foo.mjs', norm: 'foo.mjs', line: '跑 `foo.mjs`', marked: false, markedBaseHas: true })
  assert.equal(v.excuse, true)
  assert.equal(v.kind, 'marked')
})

// ─────────────────────────── ② 真断头路必须照样判错（防「放宽门禁」） ───────────────────────────

test('⛔ 未标注的真实缺失文件照样判错（占位符/临时名规则不许误伤真名）', () => {
  for (const norm of [
    'server/services/doesNotExistXyz.js',
    'src/components/GradePanel.vue',
    'bench-vision-realpage.mjs',   // 不以 _ 开头，也不是占位符
    'preset_shape_svg.py',
    'image_gen.py',
    'server/routes/examPdfX.js'
  ]) {
    const line = `照抄这行：node ${norm}`
    const v = classifyMissingRef({ tok: norm, norm, line, marked: false, markedBaseHas: false })
    assert.equal(v.excuse, false, `${norm} 是真断头路，必须判错（却判了豁免：${v.reason}）`)
    assert.equal(v.kind, 'error')
  }
})

test('⛔ 真名文件出现在带绝对路径的行上也照样判错（仓库外规则只救裸名）', () => {
  // 行里虽然有 C:/…，但被检查的 token 是**带 / 的仓库相对路径声明** —— 它必须自己站得住，
  // 不能因为同一行顺带提了一句绝对路径就免罪（r269 自测抓到并收窄的漏洞）。
  const line = '本机工具在 `C:/tools/`，仓库里的 `server/services/doesNotExistXyz.js` 并不存在'
  const v = classifyMissingRef({ tok: 'server/services/doesNotExistXyz.js', norm: 'server/services/doesNotExistXyz.js', line, marked: false, markedBaseHas: false })
  assert.equal(v.excuse, false, '带 / 的路径声明不该成为免罪金牌')
})

test('已知局限（钉住行为，别当成意外）：裸名 + 行内有绝对路径 ⇒ 仍会豁免', () => {
  // 仓库外规则是行级启发式，收窄到「只救裸名」后仍有这一层残留：
  // 裸名无法对着仓库解析，行内又出现了绝对路径 ⇒ 判它属于外部上下文。
  // 实测唯一命中就是这种形态（pi-failover 里的 gateway.py）。把它钉住，
  // 将来若收窄成「绝对路径与裸名同句」也能立刻看见这条测试的变化。
  const line = '`C:/tools/x.exe` 能用；`doesNotExistYyz.js` 在那边'
  const v = classifyMissingRef({ tok: 'doesNotExistYyz.js', norm: 'doesNotExistYyz.js', line, marked: false, markedBaseHas: false })
  assert.equal(v.excuse, true, '裸名 + 行内绝对路径 = 现行口径豁免（已知局限）')
  assert.equal(v.kind, 'external')
})

test('⛔ 判据本身不许退化成永真：空行/undefined 行不得崩，也不得豁免', () => {
  for (const line of ['', undefined, null]) {
    const v = classifyMissingRef({ tok: 'server/services/doesNotExistXyz.js', norm: 'server/services/doesNotExistXyz.js', line, marked: false, markedBaseHas: false })
    assert.equal(v.excuse, false)
  }
})

// ─────────────────────────── ③ 反向自检：旧判据套同批样本必须判红 ───────────────────────────

/** 「修复前」的真实判据（r269 之前的 check-skill-refs.mjs 原文） */
const OLD_PLACEHOLDER = /xxx|0nn|placeholder|example/i
const OLD_MARKED = /已不在仓库|临时件|需重写|已下线|要你新建|待新建|运行时生成/
function oldWouldExcuse({ tok, norm, line, marked, markedBaseHas }) {
  if (OLD_PLACEHOLDER.test(tok)) return true
  if (marked || markedBaseHas) return true
  return false // 没有临时名规则、没有仓库外定位规则 ⇒ 其余一律判错
}

test('反向自检：旧判据套本批样本判红（证明是新规则在豁免，不是样本本身没问题）', () => {
  // 每个样本给两个 marked：旧的按旧词表判（喂给「修复前」判据），
  // 新的按新词表判（喂给现行判据）—— 同一条行文，只看认不认得这些词。
  const raw = [
    { tok: '_diag_q456_e2e.mjs', norm: '_diag_q456_e2e.mjs', line: '跑了 `_diag_q456_e2e.mjs` 看到…' },
    { tok: 'tmp/prune-lint.json', norm: 'tmp/prune-lint.json', line: '报告写在 `tmp/prune-lint.json`' },
    { tok: 'backfill-answer-correction-YYYYMMDD.mjs', norm: 'server/scripts/backfill-answer-correction-YYYYMMDD.mjs', line: '跑 `server/scripts/backfill-answer-correction-YYYYMMDD.mjs`' },
    { tok: 'backfill-lowconf-wrong-questions.mjs', norm: 'backfill-lowconf-wrong-questions.mjs', line: '旧脚本 `backfill-lowconf-wrong-questions.mjs`（强灌低置信题）已于 2026-09-11 删除；替代品 `server/scripts/audit-lowconf-wrong-questions.mjs` 只做稽核' },
    { tok: 'gateway.py', norm: 'gateway.py', line: '本机网关在 `C:/Users/Administrator/pi-failover/`（`gateway.py`）' }
  ]
  for (const s of raw) {
    const oldInput = { ...s, marked: OLD_MARKED.test(s.line), markedBaseHas: false }
    const newInput = { ...s, marked: MARKED.test(s.line), markedBaseHas: false }
    assert.equal(oldWouldExcuse(oldInput), false, `旧判据应把 ${s.tok} 判成错误（假红来源）`)
    assert.equal(classifyMissingRef(newInput).excuse, true, `新判据必须豁免 ${s.tok}`)
  }
})

// ─────────────────────────── ④ 接线锁：脚本必须走 kit，且两份正则同源 ───────────────────────────

test('接线锁：check-skill-refs.mjs 必须走 skillRefsKit 的判据（不得在脚本里另写一份）', () => {
  const src = read('scripts/check-skill-refs.mjs')
  assert.match(src, /from '\.\/skillRefsKit\.mjs'/, '必须从 kit 导入判据')
  assert.match(src, /classifyMissingRef\(/, '缺失分支必须调 classifyMissingRef')
  // 豁免不许静默：脚本必须按 kind 记数并印出来
  assert.match(src, /excused\[verdict\.kind\]/, '豁免必须按 kind 计数')
  assert.match(src, /if \(PLACEHOLDER\.test\(tok\)\) \{ excused\.placeholder\+\+; continue \}/,
    '占位符的早退也必须计数（否则豁免总数少算一类，透明变不透明）')
  assert.match(src, /已按约定豁免/, '豁免计数必须印进报告（看不见的豁免 = 新的假绿）')
  // 退出码仍由「真错误」决定（r152 家族口径不动）
  assert.match(src, /process\.exit\(errors === 0 \? 0 : 1\)/, '退出码必须仍由真错误数决定')
})

test('接线锁：文件级标注用的 SCRIPT_RE 必须与 TOKEN_RE 同一份 EXTS（r269 实测漏 .json）', () => {
  const src = read('scripts/check-skill-refs.mjs')
  // 旧写法把 SCRIPT_RE 写死成 mjs|js ⇒ 事实表里标注过的 components.json 仍被判未标注
  assert.doesNotMatch(src, /SCRIPT_RE = \/\\b\[A-Za-z0-9_\]\[A-Za-z0-9_\.\/-\]\*\\\.\(\?:mjs\|js\)\\b\/g/,
    'SCRIPT_RE 不得再写死 mjs|js（与 TOKEN_RE 的 EXTS 漂移）')
  assert.match(src, /SCRIPT_RE = new RegExp\(String\.raw`\\b\[A-Za-z0-9_\]\[A-Za-z0-9_\.\/-\]\*\\\.\(\?:\$\{EXTS\.join\('\|'\)\}\)\\b`/, 'SCRIPT_RE 必须由 EXTS 生成')
})
