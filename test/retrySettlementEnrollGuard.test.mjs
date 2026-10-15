/**
 * 回归锁：「重练卷结算不得把学生答对的题凭空记成错题」（2026-10-15）
 *
 * 报障（负责人转述学生反馈）：**「错题里记录的错题，我没有错过。」**
 * 小范围排查确诊全库 47 条 —— `error_count = 0` 且 `last_wrong_at IS NULL`，
 * 即这条错题从未记录过任何一次做错。报告见
 * `_错题归属排查-我没有错过-20261015.md`。
 *
 * 根因（真实事故链，学生余晨瑞 / 题 97ea0160）：
 *   ① 原卷 AI 判错 → 入错题本；
 *   ② 老师组重练卷（该题在卷上，此时确实在册）；
 *   ③ 10-14 04:29:48 老师复核重练卷判「对」→ finalizeRejudgeResult **删掉整行**
 *      （判对＝误判，删是对的）；
 *   ④ 11 秒后 04:29:59 本结算按卷面题单逐题跑，发现该行已不存在 → **重新 INSERT，
 *      且 `errorCount = isCorrect ? 0 : 1` ⇒ error_count = 0**。
 *   两个写操作不原子、幂等键也不同源（`PUT /api/questions/:id` 调 finalizeRejudgeResult
 *   时根本不传 settlementKey，结算的幂等键 `generated_exam:<id>:final` 看不见它）。
 *
 * 修法：判定抽成纯函数 `server/services/retrySettlementDecision.js`，并加守卫
 *   **答对 + 不在错题本 = 无错可记 ⇒ skip（不建行、不推进、不计入统计）**。
 *
 * 本文件锁三件事：
 *   A. 行为不变量：**任何写入的 errorCount 都必须 ≥ 1**（穷举全部组合）。
 *      这是该 bug 的唯一签名 —— `error_count = 0` 全库只有结算的 INSERT 分支能写出来
 *      （其余四条入册路径都写死 1）。谁把 `isCorrect ? 0 : 1` 改回去，这里立刻红。
 *   B. 红线用例：答对 + 不在册 ⇒ skip；且 skip 不得产出任何写入。
 *   C. 源码锁：结算循环必须**调用**纯函数，不得把判定重新内联回循环里
 *      （内联后行为测试就管不到它了 —— 那正是这次事故能长期潜伏的原因）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { anchoredRange, anchoredSlice } from './sourceLockKit.mjs'
import {
  decideRetrySettlementItem,
  getNextLifecycle,
  RETRY_SETTLE_ACTION
} from '../server/services/retrySettlementDecision.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FINALIZER_SRC = readFileSync(join(ROOT, 'server/services/gradingFinalizer.js'), 'utf8')

const ALL_LIFECYCLES = ['new', 'review_1', 'review_2', 'mastered']
const existingRow = (lifecycle, errorCount) => ({
  id: 'wq-1',
  lifecycle_status: lifecycle,
  error_count: errorCount
})

// ── A. 行为不变量（穷举）──────────────────────────────────────────────────

test('★ 红线：穷举全部组合，任何写入的 errorCount 都必须 ≥ 1', () => {
  const existingVariants = [null, ...ALL_LIFECYCLES.map((lc) => existingRow(lc, 1)), existingRow('new', 0)]
  let checked = 0
  for (const existing of existingVariants) {
    for (const isCorrect of [true, false]) {
      for (const skipWrongBook of [true, false]) {
        const d = decideRetrySettlementItem({ existing, isCorrect, skipWrongBook })
        checked++
        if (d.action === RETRY_SETTLE_ACTION.SKIP) {
          assert.equal(d.errorCount, null, `skip 不得产出 errorCount（${JSON.stringify({ existing, isCorrect, skipWrongBook })}）`)
          assert.equal(d.status, null, `skip 不得产出 status（${JSON.stringify({ existing, isCorrect, skipWrongBook })}）`)
          continue
        }
        assert.ok(
          Number.isInteger(d.errorCount) && d.errorCount >= 1,
          `写入 errorCount 必须 ≥ 1，实际 ${d.errorCount}（${JSON.stringify({ existing, isCorrect, skipWrongBook })}）`
        )
      }
    }
  }
  assert.equal(checked, existingVariants.length * 4, '组合数不对，穷举窗口被改窄了')
})

test('★ 红线：不存在任何输入能让结算写出 error_count = 0', () => {
  const existingVariants = [null, ...ALL_LIFECYCLES.map((lc) => existingRow(lc, 1))]
  for (const existing of existingVariants) {
    for (const isCorrect of [true, false]) {
      for (const skipWrongBook of [true, false]) {
        const d = decideRetrySettlementItem({ existing, isCorrect, skipWrongBook })
        assert.notEqual(d.errorCount, 0, `error_count=0 会让学生看到「我没做错过」的错题（${JSON.stringify({ existing, isCorrect, skipWrongBook })}）`)
      }
    }
  }
})

// ── B. 红线用例 ──────────────────────────────────────────────────────────

test('★ 红线：答对 + 不在错题本 ⇒ 跳过（不得凭空建行）', () => {
  const d = decideRetrySettlementItem({ existing: null, isCorrect: true, skipWrongBook: false })
  assert.equal(d.action, RETRY_SETTLE_ACTION.SKIP, '答对的题不该进错题本')
  assert.equal(d.reason, 'correct_without_existing_row')
  assert.equal(d.errorCount, null)
  assert.equal(d.countsAs, null, '没入册就不该计入 mastered/upgraded 统计')
})

test('★ 红线：答错 + 不在错题本 ⇒ 入册，且起始 error_count = 1', () => {
  const d = decideRetrySettlementItem({ existing: null, isCorrect: false, skipWrongBook: false })
  assert.equal(d.action, RETRY_SETTLE_ACTION.INSERT)
  assert.equal(d.errorCount, 1, '真做错了才入册，起始错误次数必须是 1 不是 0')
  assert.equal(d.nextLifecycle, 'new')
  assert.equal(d.status, 'pending')
})

test('答对 + 已在册 ⇒ 推进生命周期，错误次数不增（new → review_1）', () => {
  const d = decideRetrySettlementItem({ existing: existingRow('new', 1), isCorrect: true })
  assert.equal(d.action, RETRY_SETTLE_ACTION.UPDATE)
  assert.equal(d.nextLifecycle, 'review_1')
  assert.equal(d.errorCount, 1, '答对不增加错误次数')
  assert.equal(d.countsAs, 'upgraded')
})

test('答对 + 已在册且 review_1 ⇒ mastered，计入 masteredCount', () => {
  const d = decideRetrySettlementItem({ existing: existingRow('review_1', 2), isCorrect: true })
  assert.equal(d.nextLifecycle, 'mastered')
  assert.equal(d.status, 'mastered')
  assert.equal(d.errorCount, 2)
  assert.equal(d.countsAs, 'mastered')
})

test('答对 + 已是 mastered ⇒ 原地保持，不计入任何统计', () => {
  const d = decideRetrySettlementItem({ existing: existingRow('mastered', 3), isCorrect: true })
  assert.equal(d.action, RETRY_SETTLE_ACTION.UPDATE)
  assert.equal(d.nextLifecycle, 'mastered')
  assert.equal(d.errorCount, 3)
  assert.equal(d.countsAs, null)
})

test('答错 + 已在册 ⇒ error_count + 1；review_1 退回 new 并计入 reset', () => {
  const d = decideRetrySettlementItem({ existing: existingRow('review_1', 1), isCorrect: false })
  assert.equal(d.action, RETRY_SETTLE_ACTION.UPDATE)
  assert.equal(d.errorCount, 2, '答错必须 +1')
  assert.equal(d.nextLifecycle, 'new', '假掌握必须回池')
  assert.equal(d.countsAs, 'reset')
})

test('答错 + mastered ⇒ 退回 review_1（重新验证）', () => {
  const d = decideRetrySettlementItem({ existing: existingRow('mastered', 2), isCorrect: false })
  assert.equal(d.nextLifecycle, 'review_1')
  assert.equal(d.errorCount, 3)
  assert.equal(d.countsAs, 'reset')
})

test('skipWrongBook 只在答错时生效；答对时由「不在册」那条守卫接管', () => {
  assert.equal(
    decideRetrySettlementItem({ existing: null, isCorrect: false, skipWrongBook: true }).action,
    RETRY_SETTLE_ACTION.SKIP, '调用方声明不入册 + 答错 ⇒ 跳过'
  )
  assert.equal(
    decideRetrySettlementItem({ existing: existingRow('new', 1), isCorrect: false, skipWrongBook: true }).action,
    RETRY_SETTLE_ACTION.SKIP, '已在册但调用方声明跳过 ⇒ 也跳过'
  )
  const correctSkip = decideRetrySettlementItem({ existing: existingRow('new', 1), isCorrect: true, skipWrongBook: true })
  assert.equal(correctSkip.action, RETRY_SETTLE_ACTION.UPDATE, '答对仍要推进生命周期（skipWrongBook 不拦答对）')
})

test('生命周期状态机未被本次抽函数改动（与 test/lifecycleQueue.test.mjs 同口径）', () => {
  assert.equal(getNextLifecycle('new', true), 'review_1')
  assert.equal(getNextLifecycle('review_1', true), 'mastered')
  assert.equal(getNextLifecycle('review_2', true), 'review_1')
  assert.equal(getNextLifecycle('mastered', true), 'mastered')
  assert.equal(getNextLifecycle('review_1', false), 'new')
  assert.equal(getNextLifecycle('mastered', false), 'review_1')
  assert.equal(getNextLifecycle('new', false), 'new')
})

// ── C. 源码锁（fail-closed）──────────────────────────────────────────────

test('C1. 结算循环必须调用纯函数判定，不得把判定内联回循环', () => {
  const fails = []
  const loop = anchoredRange(
    FINALIZER_SRC,
    'for (const result of pendingResults) {',
    '// ⚠️ 结算原子化',
    'gradingFinalizer 结算循环',
    fails
  )
  if (loop !== null) {
    if (!loop.includes('decideRetrySettlementItem(')) {
      fails.push('结算循环没有调用 decideRetrySettlementItem —— 判定被内联回循环后，'
        + 'test/retrySettlementEnrollGuard.test.mjs 的行为不变量就管不到它了（本次事故正是这样长期潜伏的）')
    }
  }
  assert.deepEqual(fails, [])
})

test('C2. 结算路径不得再出现 `errorCount: ... isCorrect ? 0 : 1` 这类字面量', () => {
  const fails = []
  const fn = anchoredSlice(
    FINALIZER_SRC,
    'export const finalizeGeneratedExamResults',
    9000,
    'finalizeGeneratedExamResults 函数体',
    fails
  )
  if (fn !== null) {
    // 允许空白差异：把 `? 0 : 1` 和 `: 0` 两种历史写法都堵死
    const bad = [/errorCount:\s*[^,\n]*isCorrect\s*\?\s*0\s*:\s*1/, /errorCount:\s*0\b/]
    for (const re of bad) {
      if (re.test(fn)) fails.push(`结算函数体里仍能写出 error_count=0：匹配到 ${re}`)
    }
  }
  assert.deepEqual(fails, [])
})

test('C3. 纯函数里必须保留「答对 + 不在册 ⇒ skip」守卫（防被顺手删掉）', () => {
  const DECISION_SRC = readFileSync(join(ROOT, 'server/services/retrySettlementDecision.js'), 'utf8')
  const fails = []
  const seg = anchoredSlice(
    DECISION_SRC,
    'if (!existing && isCorrect) return skip(',
    200,
    'retrySettlementDecision 答对无在册行守卫',
    fails
  )
  if (seg !== null && !seg.includes('correct_without_existing_row')) {
    fails.push('守卫的 reason 标识被改动了，请同步更新本锁与报告口径')
  }
  assert.deepEqual(fails, [])
})
