// 回归锁：patrol 守护进程的 lint 判据必须只认「本轮」报告（2026-10-07 r236 修，落地提案㊽）
//
// 缺陷（实测，非推测）：
//   scripts/patrol/patrol.mjs 的 E 段跑 `eslint ... -o tmp/prune-lint.json` 后直接读该文件数 errors，
//   **eslint 自己的退出码 / 超时被整个丢掉**，唯一兜底是「parse 失败 ⇒ errCount=-1」。
//   而 tmp/prune-lint.json **跨 tick 持久**（实测 mtime 随每次成功 tick 覆盖）。
//   ⇒ 一旦本 tick eslint **没写出报告**（180s 超时被 kill / 配置错 exit 2 / 二进制缺失），
//     上一 tick 的陈旧报告还在原地 ⇒ 本 tick 照读 ⇒ 报 `lint=0` 判「全绿」。
//   与 r198/r218/r220/r221/r233/r235 同一族：「判据没真读到**本轮**数据 ⇒ 悄悄判合格」。
//
// 本锁分两层：
//   A. 行为锁：真跑 lintReportKit 的纯函数 / 文件读取（造真临时文件，不 spawnSync git，Windows EBUSY）；
//   B. 源码契约：patrol.mjs 必须「跑前删旧报告 + 走 collectLintReport 读本轮报告」。
// 反向自检：内联「修复前的真实形状」样本，判据套上去必须判红（不依赖 git —— 修复合入 HEAD 后
//   从 HEAD 重导旧版会 0 红误报，见 r113q 教训）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  summarizeLintReport,
  collectLintReport,
  lintReportReasonText,
} from '../scripts/patrol/lintReportKit.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const PATROL = 'scripts/patrol/patrol.mjs'
const KIT = 'scripts/patrol/lintReportKit.mjs'
const patrolSrc = () => readFileSync(resolve(ROOT, PATROL), 'utf8')

/** 造一个真临时报告文件，返回路径；调用方负责 rm。 */
let seq = 0
function writeTmpReport(content) {
  const p = join(tmpdir(), `r236-lint-${process.pid}-${seq++}.json`)
  writeFileSync(p, content, 'utf8')
  return p
}
function cleanup(p) {
  try { rmSync(p, { force: true }) } catch { /* 单文件删除，忽略 */ }
}

// ───────────────────── A. 行为锁：纯函数 + 真文件读取 ─────────────────────

test('A1. summarizeLintReport：只数 severity=2 为 error，并单列 no-unused-vars', () => {
  const report = [
    {
      filePath: 'a.js',
      messages: [
        { severity: 2, ruleId: 'no-undef' },
        { severity: 2, ruleId: 'no-unused-vars' },
        { severity: 1, ruleId: 'no-unused-vars' }, // warning 不算 error，但要计入 unusedVars
        { severity: 1, ruleId: 'no-console' },
      ],
    },
    { filePath: 'b.js', messages: [{ severity: 2, ruleId: 'eqeqeq' }] },
  ]
  const r = summarizeLintReport(report)
  assert.equal(r.errCount, 3, 'errors 只应数 severity=2')
  assert.equal(r.unusedVars, 2, 'no-unused-vars 不分 severity 都计数')
})

test('A2. 报告文件不在 ⇒ 判「没读到」（-1 / missing），绝不当 0', () => {
  const missing = join(tmpdir(), `r236-lint-absent-${process.pid}.json`)
  cleanup(missing)
  const r = collectLintReport(missing, Date.now())
  assert.equal(r.errCount, -1, '没读到必须是 -1，不能是 0（0 = 假绿）')
  assert.equal(r.reason, 'missing')
})

test('A3. 报告是本轮写出的 ⇒ 正常读数', () => {
  const p = writeTmpReport(JSON.stringify([
    { filePath: 'a.js', messages: [{ severity: 2, ruleId: 'no-undef' }, { severity: 1, ruleId: 'no-unused-vars' }] },
  ]))
  try {
    const started = statSync(p).mtimeMs - 1 // 本轮开始早于文件写入
    const r = collectLintReport(p, started)
    assert.equal(r.reason, 'ok')
    assert.equal(r.errCount, 1)
    assert.equal(r.unusedVars, 1)
  } finally { cleanup(p) }
})

test('A4. ⛔ 报告比本轮还旧（上一 tick 的残留）⇒ 判「没读到」（stale），不认旧数据', () => {
  const p = writeTmpReport(JSON.stringify([{ filePath: 'a.js', messages: [{ severity: 2, ruleId: 'no-undef' }] }]))
  try {
    const started = statSync(p).mtimeMs + 1000 // 本轮开始晚于文件写入 = 文件是旧的
    const r = collectLintReport(p, started)
    assert.equal(r.errCount, -1, '陈旧报告必须判 -1，否则 eslint 没跑成时会假报 lint=0')
    assert.equal(r.reason, 'stale')
  } finally { cleanup(p) }
})

test('A5. 报告写了一半 / 不是 JSON ⇒ 判「没读到」（parse），不崩', () => {
  const p = writeTmpReport('[{"filePath":"a.js","messages":[{"sev')
  try {
    const r = collectLintReport(p, 0)
    assert.equal(r.errCount, -1)
    assert.equal(r.reason, 'parse')
  } finally { cleanup(p) }
})

test('A6. 每种「没读到」都有大白话说明（负责人看后果，不看术语）', () => {
  for (const reason of ['missing', 'stale', 'parse']) {
    const text = lintReportReasonText(reason)
    assert.ok(text && text.length >= 6, `${reason} 必须有一句人话说明`)
  }
  assert.equal(lintReportReasonText('ok'), '', 'ok 不需要解释文案')
})

// ───────────────────── B. 源码契约：patrol.mjs 必须走本轮判据 ─────────────────────

/**
 * 判据集合：给定 patrol.mjs 源码，返回违规列表。
 * 只认三件事：① 引入 lintReportKit；② 跑 eslint **之前**先删旧报告；③ 用 collectLintReport 读。
 * 注释先剔掉（注释里会引用旧写法当反面教材，不能把说明文字当违规代码 —— r148/r152/r158 都踩过）。
 */
export function collectPatrolLintFailures(src) {
  const fails = []
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

  if (!/from\s+['"]\.\/lintReportKit\.mjs['"]/.test(body)) {
    fails.push("未从 './lintReportKit.mjs' 引入 lint 报告判据（又会退回「读哪份报告都行」）")
  }

  // eslint 调用锚点：必须存在，否则锁本身失效（fail-closed：找不到就报红，不静默放过）
  const spawn = body.indexOf("'eslint', 'bin', 'eslint.js'")
  if (spawn < 0) {
    fails.push("找不到 eslint 调用锚点（'eslint', 'bin', 'eslint.js'）——源码改过请同步本锁")
  }

  const rm = body.indexOf('rmSync(')
  if (rm < 0) {
    fails.push('跑 eslint 前没有删旧报告（rmSync）—— 旧报告会冒充本轮结果（假 lint=0）')
  } else if (spawn >= 0 && rm > spawn) {
    fails.push('删旧报告发生在 eslint 之后，起不到作用（必须先删再跑）')
  }

  if (!/collectLintReport\s*\(/.test(body)) {
    fails.push('没有用 collectLintReport() 读本轮报告')
  }
  // ⚠️ 只盯「报告文件」这一处：patrol.mjs 另有 `JSON.parse(fs.readFileSync(STATE))` 读轮次状态，
  //    那是正当用法，判据不能误伤（本锁第一次就踩了这个坑）。
  if (/JSON\.parse\(\s*fs\.readFileSync\([^)]*prune-lint\.json/.test(body)) {
    fails.push('仍在直接读报告文件（绕过「只认本轮」判据）')
  }
  return fails
}

test('B1. 当前 patrol.mjs 满足「跑前删旧报告 + 只认本轮报告」', () => {
  const fails = collectPatrolLintFailures(patrolSrc())
  assert.deepEqual(fails, [], '\npatrol.mjs lint 判据违规：\n' + fails.map((x) => `  - ${x}`).join('\n'))
})

test('B2. lintReportKit 必须真存在且被 import（防「锁了个人名」）', () => {
  assert.ok(existsSync(resolve(ROOT, KIT)), `${KIT} 不见了，锁形同虚设`)
  assert.match(patrolSrc(), /from\s+['"]\.\/lintReportKit\.mjs['"]/, 'patrol.mjs 必须 import 本 kit')
})

// ───────────────────── C. 反向自检（防空锁 / 防永远判红） ─────────────────────

/** 修复前的真实形状（= bug 本身），仅用于反向自检 */
const OLD_LINT_SECTION =
  "/* ── E. lint + 死声明 ── */\n" +
  "section('E. lint + 死声明')\n" +
  "run('node', [path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'), '.', '-f', 'json', '-o', 'tmp/prune-lint.json'], { timeout: 180000, silent: true })\n" +
  "let errCount = 0, unusedVars = 0\n" +
  "try {\n" +
  "  const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp', 'prune-lint.json'), 'utf8'))\n" +
  "  for (const f of report) for (const m of f.messages || []) {\n" +
  "    if (m.severity === 2) errCount++\n" +
  "    if (m.ruleId === 'no-unused-vars') unusedVars++\n" +
  "  }\n" +
  "} catch { errCount = -1 }\n"

test('C1. 判据套「修复前」坏样本必须判红（不依赖 git）', () => {
  const probe = collectPatrolLintFailures(OLD_LINT_SECTION)
  assert.ok(probe.length >= 1, `判据套修复前坏样本应报 ≥1 处，实际 ${probe.length} —— 锁可能是空锁`)
  assert.ok(probe.some((x) => /没有删旧报告/.test(x)), '坏样本必须命中「跑前没删旧报告」')
  assert.ok(probe.some((x) => /直接读报告文件/.test(x)), '坏样本必须命中「直接读报告文件」')
  assert.ok(probe.some((x) => /未从 '\.\/lintReportKit\.mjs'/.test(x)), '坏样本必须命中「没引入 kit」')
})

test('C2. 判据不得误伤修复后的正确写法（防「永远判红」）', () => {
  const good =
    "import { collectLintReport } from './lintReportKit.mjs'\n" +
    "const LINT_REPORT = path.join(ROOT, 'tmp', 'prune-lint.json')\n" +
    "fs.rmSync(LINT_REPORT, { force: true })\n" +
    "const lintRun = run('node', [path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'), '.', '-f', 'json', '-o', 'tmp/prune-lint.json'], { timeout: 180000, silent: true })\n" +
    "const lint = collectLintReport(LINT_REPORT, Date.parse(started))\n"
  assert.deepEqual(collectPatrolLintFailures(good), [], '正确写法必须判绿')

  // 注释里出现旧写法（当反面教材）不得被误判
  const withComment =
    "import { collectLintReport } from './lintReportKit.mjs'\n" +
    "// 旧写法：const report = JSON.parse(fs.readFileSync('tmp/prune-lint.json', 'utf8'))\n" +
    "fs.rmSync(LINT_REPORT, { force: true })\n" +
    "const lintRun = run('node', [path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js')], { silent: true })\n" +
    "const lint = collectLintReport(LINT_REPORT, Date.parse(started))\n"
  assert.deepEqual(collectPatrolLintFailures(withComment), [], '注释里的旧写法不得误伤')
})
