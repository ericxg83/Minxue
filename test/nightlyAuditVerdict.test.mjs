// 回归测试（提案 r240-①）：夜间巡检「当晚通过没」不再把单测挂掉当成成功
//
// 背景（实测，不是推理）：`scripts/nightlyAudit.mjs` 结尾原本是
//   process.exit(ratchet.status === 'REGRESSED' ? 1 : 0)
// ⇒ **单元测试整晚挂掉，退出码仍然是 0**。它现在还没有定时调用方（提案 ㊲/⑲ 待拍板），
//   所以这个洞一直没被任何东西发现（与 r152 那三个 gate 脚本「全坏也算 exit 0」同款）。
// 同批修的还有：单测**一条都没跑**（node --test 的 glob 匹配不到时 exit 0）也被当绿灯 ——
// 这是 r215「9 个测试文件从不进套件」在巡检引擎里的残留。
//
// 本锁的做法：
//   1) 判定抽成纯函数 `scripts/nightlyAuditVerdict.mjs`，直接喂组合跑（不启动整个巡检）；
//   2) ⛔ 反向自检用**修复前那行旧退出码**当基线：同一场景旧版必须返回 0（洞是真的）、新版返回 3；
//   3) 元判据：先断言被锁的字面量真在脚本里（防判据写错字 ⇒ 假通过，r198/r237 同款）；
//   4) 顺手锁住「夜晚跑不会归到前一天」（r148~r157 时区家族在 scripts/ 里的漏网）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveNightlyVerdict, readTestsRun, NIGHTLY_EXIT } from '../scripts/nightlyAuditVerdict.mjs'
import { toLocalYmd } from '../server/utils/period.js'

const ROOT = resolve(import.meta.dirname, '..')
const AUDIT = resolve(ROOT, 'scripts/nightlyAudit.mjs')
const SRC = readFileSync(AUDIT, 'utf8')

/** ⛔ 反向自检基线：修复前那一行主流程的退出码算法（逐字照抄，不调 git）。 */
const OLD_EXIT = (ratchetStatus) => (ratchetStatus === 'REGRESSED' ? 1 : 0)

// ── 元判据：先证明「我锁的东西真的在源码里」 ──────────────────────────────
// ⛔ 防假通过第一道：判定文案若被顺手改掉，下面的颜色断言会全部失去意义。
test('元判据：被锁的字面量确实在源码里（改文案必须同步改这里）', () => {
  assert.ok(SRC.includes('process.exit(verdict.exitCode)'), '主流程必须由 verdict 决定退出码')
  assert.ok(!SRC.includes('process.exit(ratchet.status ==='), '旧的棘轮独断退出码写法必须消失')
  assert.ok(SRC.includes("import { resolveNightlyVerdict, readTestsRun } from './nightlyAuditVerdict.mjs'"), '应引入判定模块')
  assert.ok(SRC.includes('const today = toLocalYmd(new Date())'), '报告日期必须走本地日历日，不是 UTC')
  assert.ok(SRC.includes('3 = 单元测试失败'), '退出码表里必须写明 3 的含义')
})

// ── 正常场景：真跑过、全过 ⇒ 通过 ────────────────────────────────────────
test('单测全过（跑了 2000+ 条）⇒ 当晚通过', () => {
  const v = resolveNightlyVerdict({ testsExitCode: 0, testsRun: 2073, ratchetStatus: 'ok' })
  assert.equal(v.status, 'PASS')
  assert.equal(v.exitCode, 0)
  assert.equal(v.reason, null)
})

test('棘轮刚初始化（还没有基线）⇒ 当晚通过', () => {
  const v = resolveNightlyVerdict({ testsExitCode: 0, testsRun: 2073, ratchetStatus: 'initialized' })
  assert.equal(v.exitCode, 0)
  assert.equal(v.status, 'PASS')
})

// ── 洞一：单测挂了 ⇒ 必须失败（修复前这里返回 0）─────────────────────────
test('单元测试挂掉 ⇒ 判失败、退出码 3（不再假装成功）', () => {
  const v = resolveNightlyVerdict({ testsExitCode: 1, testsRun: 2064, ratchetStatus: 'ok' })
  assert.equal(v.status, 'TESTS_FAILED')
  assert.equal(v.exitCode, 3)
  assert.match(v.reason, /单元测试挂了/, '要说清是哪一项不过，别只给个码')
})

test('反向自检：修复前的退出码算法在同一场景下返回 0（洞是真的）', () => {
  assert.equal(OLD_EXIT('ok'), 0, '旧算法：棘轮没回退就报成功')
  const v = resolveNightlyVerdict({ testsExitCode: 1, testsRun: 2064, ratchetStatus: 'ok' })
  assert.notEqual(v.exitCode, OLD_EXIT(v.ratchetStatus), '同场景旧版必须判过、新版必须判不过')
})

// ── 洞二：一条测试都没跑 ⇒ 也必须是失败（r215 同款假绿）──────────────────
test('单测一条都没跑（runner 却 exit 0）⇒ 判「没验过」、退出码 3', () => {
  const v = resolveNightlyVerdict({ testsExitCode: 0, testsRun: 0, ratchetStatus: 'ok' })
  assert.equal(v.status, 'NO_TESTS_RUN')
  assert.equal(v.exitCode, 3)
  assert.match(v.reason, /一条单元测都没执行/)
})

test('压根读不到「跑了多少条」（换 reporter）⇒ 判「没验过」、退出码 3', () => {
  const v = resolveNightlyVerdict({ testsExitCode: 0, testsRun: null, ratchetStatus: 'ok' })
  assert.equal(v.status, 'NO_TESTS_RUN')
  assert.equal(v.exitCode, 3)
  assert.match(v.reason, /没读到执行条数/, '要说清是「没验过」，不能让人以为是跑挂了')
})

test('反向自检：修复前对「一条没跑」同样返回 0（这个洞也真存在）', () => {
  assert.equal(OLD_EXIT('ok'), 0)
  const v = resolveNightlyVerdict({ testsExitCode: 0, testsRun: 0, ratchetStatus: 'ok' })
  assert.notEqual(v.exitCode, OLD_EXIT('ok'))
})

// ── readTestsRun：三条分支各自能验红 ──────────────────────────────────────
test('readTestsRun 能分辨「真跑了 / 跑了 0 条 / 压根没这行」', () => {
  assert.deepEqual(readTestsRun({ tests: 13 }), { ok: true, reason: null })
  assert.equal(readTestsRun({ tests: 0 }).ok, false)
  assert.equal(readTestsRun({}).ok, false, 'reporter 换了、没这行 ⇒ 不许当绿灯')
  assert.equal(readTestsRun(undefined).ok, false)
  assert.match(readTestsRun(undefined).reason, /没从输出里读到/)
  assert.match(readTestsRun({ tests: 0 }).reason, /一条测试都没执行/)
})

// ── 优先级与退出码不自相矛盾 ──────────────────────────────────────────────
test('棘轮回退优先于单测失败（沿用修复前的行为顺序）', () => {
  const v = resolveNightlyVerdict({ testsExitCode: 1, testsRun: 2064, ratchetStatus: 'REGRESSED' })
  assert.equal(v.status, 'REGRESSED')
  assert.equal(v.exitCode, 1)
  assert.match(v.reason, /棘轮回退|不得合并/)
})

test('单测失败用的退出码不跟「巡检中止」的 2 撞车', () => {
  assert.equal(NIGHTLY_EXIT.ABORT, 2)
  const v = resolveNightlyVerdict({ testsExitCode: 1, testsRun: 2064, ratchetStatus: 'ok' })
  assert.notEqual(v.exitCode, NIGHTLY_EXIT.ABORT, '2 是 lint 报告拿不到的中止码，别被单测占用')
  const set = new Set([
    NIGHTLY_EXIT.PASS, NIGHTLY_EXIT.REGRESSED, NIGHTLY_EXIT.ABORT, NIGHTLY_EXIT.TESTS_FAILED
  ])
  assert.equal(set.size, 4, '四个退出码必须互不相同')
})

// ── 日期：夜里跑要归到当天，不是前一天 ────────────────────────────────────
test('夜间 03:30（本地）算出来的日期归当天，不是 UTC 的前一天', () => {
  // 2026-10-07 本地 03:30 = UTC 2026-10-06 19:30 ⇒ 旧口径 toISOString 会印 10-06。
  const local = new Date('2026-10-07T03:30:00+08:00')
  const utcDay = local.toISOString().slice(0, 10)
  assert.equal(utcDay, '2026-10-06', '这组数据本身就在演示 UTC 日会退一天')
  assert.equal(toLocalYmd(local), '2026-10-07', '报告/基线必须记本地日')
})
