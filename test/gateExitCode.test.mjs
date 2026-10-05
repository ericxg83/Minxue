/**
 * r152 回归锁：审计/门禁脚本必须**有脏即非零退出**，不得 fail-open。
 *
 * 真缺陷（实测取证，非推测）：四个脚本都算出了失败计数并打印汇总，但**从不设置退出码**，
 * 恒退 0。实测（对死端口跑，2026-10-05）：
 *   scripts/gate/route_sweep.mjs    → 16/16 路由有异常      → exit 0
 *   scripts/gate/text_audit.mjs     → 14/14 路由有专业度问题  → exit 0
 *   scripts/gate/overflow_audit.mjs → 14/14 路由有布局问题    → exit 0
 *   scripts/auditStoreContract.mjs  → 「共 N 处」未暴露字段读取 → exit 0
 * 后果：一旦被串进 `&&` / CI / 任何看 `$?` 的自动化，**全坏也算绿**。
 * 这不是假设 —— backlog 记过 `route_sweep 4/16`（学生管理/学生档案 500）真的出现过，
 * 当时靠人肉读输出才发现；同目录的 `cert_probe.mjs` / `render_smoke.mjs` 早就有
 * `process.exit(pass === results.length ? 0 : 1)`，`check-skill-refs.mjs` 也有
 * `process.exit(errors === 0 ? 0 : 1)` —— 唯独这四个漏了。
 *
 * 修法：四处各补一行由运行结果决定的 `process.exit(...)`，放在汇总打印之后。
 * 零业务影响：全仓 grep 只有 docs/memory 提到这些脚本名，没有调用方依赖其退出码。
 *
 * ⛔ 为什么这里是**源码锁**而不是真跑：跑真 Chromium 对死端口实测单个脚本要 **34.7s**
 * （16 路由 × ~2.2s），三个 ≈ 100s，塞进 `npm test` 不可接受；且全仓 `test/` 目前
 * **没有任何用例依赖 playwright**（刻意把浏览器检查留在闸门侧）。本轮的端到端行为证据
 * 以「真跑一遍死端口、看退出码」的形式落在交付报告里（_r152_reverse_probe.mjs），不进常驻套件。
 * ⛔ 反向自检禁止 spawnSync 调 git（Windows EBUSY），改成内联合成「修复前」坏样本。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 必须 fail-closed 的审计脚本（相对仓库根；cert_probe / render_smoke / check-skill-refs 早已正确，不在此列） */
const SCRIPTS = [
  'scripts/gate/route_sweep.mjs',
  'scripts/gate/text_audit.mjs',
  'scripts/gate/overflow_audit.mjs',
  'scripts/auditStoreContract.mjs',
]

/** 修复前的真实尾部形状（= bug 本身），只用于反向自检与「说明它为什么错」 */
const OLD_TAIL = [
  'await browser.close()',
  '',
  'let dirty = 0',
  'for (const r of report) {',
  "  const flag = (r.errors.length || r.bad.length) ? '🔴' : '🟢'",
  "  if (flag === '🔴') dirty++",
  '}',
  'console.log(`\\n════ ${dirty}/${report.length} 路由有异常 ════`)',
  '',
].join('\n')

/**
 * 判据集合：给定脚本源码，返回违规列表（可套合成坏样本，见反向自检）。
 * 只认「退出码由运行结果决定」这一件事，不绑定计数器变量名（dirty / findings / …）。
 */
export function collectExitFailures(src) {
  const fails = []
  // 先剔掉注释（整行 `//` 与块注释）：注释里会引用「旧版恒退 0」当反面教材，
  // 不能把「说明文字」当成违规代码（r148 锁里已踩过这个坑）。
  const body = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

  // 1) 不得出现无条件 process.exit(0)：那是「失败也退 0」的 fail-open 本体
  if (/process\.exit\(\s*0\s*\)/.test(body)) {
    fails.push('出现无条件 process.exit(0)：失败也会退 0（fail-open）')
  }

  // 2) 必须有「参数不是纯数字字面量」的退出调用（= 退出码由运行结果决定）
  const exitCalls = body.match(/process\.exit\([^)]*\)/g) || []
  const guarded = exitCalls.filter((c) => {
    const arg = c.slice('process.exit('.length, -1).trim()
    return arg !== '' && !/^\d+$/.test(arg)
  })
  if (guarded.length === 0) {
    fails.push('缺少由运行结果决定的退出码（应形如 process.exit(dirty === 0 ? 0 : 1)）')
  }

  // 3) 退出必须发生在最后一次汇总打印之后，否则会截断报告（只打印一半就退）
  const logIdx = body.lastIndexOf('console.log')
  const exitIdx = body.lastIndexOf('process.exit(')
  if (logIdx >= 0 && exitIdx >= 0 && exitIdx < logIdx) {
    fails.push('process.exit 出现在汇总打印之前：会截断报告')
  }
  return fails
}

// ─────────────────────────── ① 当前树必须零违规 ───────────────────────────

test('⛔ 四个审计脚本：有脏必须非零退出（当前树零违规）', () => {
  for (const rel of SCRIPTS) {
    const p = join(ROOT, rel)
    assert.ok(existsSync(p), `${rel} 不见了`)
    const fails = collectExitFailures(readFileSync(p, 'utf8'))
    assert.deepEqual(fails, [], `\n${rel} 存在 fail-open 违规：\n` + fails.map((f) => `  - ${f}`).join('\n'))
  }
})

// ─────────────────────────── ② 反向自检（防空锁 / 防永远判红） ───────────────────────────

test('锁健全性：判据套「修复前」坏样本必须判红（防空锁，不依赖 git）', () => {
  const probe = collectExitFailures(OLD_TAIL)
  assert.ok(probe.length >= 1, `判据套修复前坏样本应报 ≥1 处，实际 ${probe.length} —— 锁可能是空锁`)
  assert.match(probe[0], /缺少由运行结果决定/, '坏样本必须命中「缺少非零退出」这条判据')
})

test('锁健全性：另外两类坏样本也要判红（无条件退 0 / 退出早于打印）', () => {
  const unconditional = "console.log('════ 14/14 路由有异常 ════')\nprocess.exit(0)\n"
  const bad1 = collectExitFailures(unconditional)
  assert.ok(bad1.length >= 1, '无条件 process.exit(0) 必须被判红')
  assert.ok(bad1.some((f) => /无条件/.test(f)), '应命中「无条件 exit(0)」判据')

  const truncated = "process.exit(dirty === 0 ? 0 : 1)\nconsole.log('════ 14/14 路由有异常 ════')\n"
  const bad2 = collectExitFailures(truncated)
  assert.ok(bad2.some((f) => /截断报告/.test(f)), '退出早于打印必须被判红（会截断报告）')
})

test('锁健全性：判据不得误伤修复后的正确写法（防「永远判红」）', () => {
  const good = [
    'await browser.close()',
    'let dirty = 0',
    'console.log(`\\n════ ${dirty}/${ROUTES.length} 路由有异常 ════`)',
    '// r152：闸门必须「有脏即非零退出」',
    'process.exit(dirty === 0 ? 0 : 1)',
    '',
  ].join('\n')
  assert.deepEqual(collectExitFailures(good), [], '正确写法必须判绿（否则锁永远红，等于没锁）')

  // 计数器不叫 dirty 时同样成立（auditStoreContract 用的是 findings）
  const good2 = [
    "console.log('共', findings.length, '处')",
    'process.exit(findings.length === 0 ? 0 : 1)',
    '',
  ].join('\n')
  assert.deepEqual(collectExitFailures(good2), [], '计数器改名不得误伤（判据不绑定变量名）')
})
