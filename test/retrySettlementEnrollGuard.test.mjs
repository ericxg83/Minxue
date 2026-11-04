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
        for (const notAttempted of [true, false]) {
          const d = decideRetrySettlementItem({ existing, isCorrect, skipWrongBook, notAttempted })
          checked++
          if (d.action === RETRY_SETTLE_ACTION.SKIP) {
            assert.equal(d.errorCount, null, `skip 不得产出 errorCount（${JSON.stringify({ existing, isCorrect, skipWrongBook, notAttempted })}）`)
            assert.equal(d.status, null, `skip 不得产出 status（${JSON.stringify({ existing, isCorrect, skipWrongBook, notAttempted })}）`)
            continue
          }
          assert.ok(
            Number.isInteger(d.errorCount) && d.errorCount >= 1,
            `写入 errorCount 必须 ≥ 1，实际 ${d.errorCount}（${JSON.stringify({ existing, isCorrect, skipWrongBook, notAttempted })}）`
          )
        }
      }
    }
  }
  assert.equal(checked, existingVariants.length * 8, '组合数不对，穷举窗口被改窄了')
})

test('★ 红线：不存在任何输入能让结算写出 error_count = 0', () => {
  const existingVariants = [null, ...ALL_LIFECYCLES.map((lc) => existingRow(lc, 1))]
  for (const existing of existingVariants) {
    for (const isCorrect of [true, false]) {
      for (const skipWrongBook of [true, false]) {
        for (const notAttempted of [true, false]) {
          const d = decideRetrySettlementItem({ existing, isCorrect, skipWrongBook, notAttempted })
          assert.notEqual(d.errorCount, 0, `error_count=0 会让学生看到「我没做错过」的错题（${JSON.stringify({ existing, isCorrect, skipWrongBook, notAttempted })}）`)
        }
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

// ── D. 空题新口径（2026-11-04 负责人确认）────────────────────────────────
//
// 重练卷空题 = 零信号：不计错误次数、不动掌握档位、留册等下次重印。
// 一刀切「空=不会」的代价：误伤「量大/没时间而空」的零信号题，且 error_count
// 虚高会把没做的题推向周报再测卷选题前排（weeklyReport.js 同难度内 error_count 优先）。
// 老师明确标「错」的空题不带 notAttempted，仍走 wrong 分支——裁量权保留。

test('★ 空题新口径：notAttempted + 答错 ⇒ skip（不计错、不退档、留册）', () => {
  for (const lc of ALL_LIFECYCLES) {
    const d = decideRetrySettlementItem({ existing: existingRow(lc, 3), isCorrect: false, notAttempted: true })
    assert.equal(d.action, RETRY_SETTLE_ACTION.SKIP, `${lc} 档的空题不得被结算动到`)
    assert.equal(d.reason, 'blank_not_attempted')
    assert.equal(d.errorCount, null, `空题不得 +1 错误次数（${lc}）`)
    assert.equal(d.nextLifecycle, lc, `空题不得退档（${lc}）`)
    assert.equal(d.countsAs, null, '空题跳过不得计入 mastered/upgraded/reset 统计')
  }
})

test('★ 空题新口径：notAttempted + 不在册 ⇒ skip（不得凭空建行）', () => {
  const d = decideRetrySettlementItem({ existing: null, isCorrect: false, notAttempted: true })
  assert.equal(d.action, RETRY_SETTLE_ACTION.SKIP)
  assert.equal(d.reason, 'blank_not_attempted')
  assert.equal(d.errorCount, null)
})

test('★ 空题新口径：notAttempted 只在答错时生效，判对照常推进', () => {
  const d = decideRetrySettlementItem({ existing: existingRow('new', 1), isCorrect: true, notAttempted: true })
  assert.equal(d.action, RETRY_SETTLE_ACTION.UPDATE, '空题被判「对」说明老师有明确结论，照常推进')
  assert.equal(d.nextLifecycle, 'review_1')
  assert.equal(d.errorCount, 1)
})

test('★ 空题新口径：老师标「错」的空题（notAttempted=false）仍正常惩罚', () => {
  const d = decideRetrySettlementItem({ existing: existingRow('review_1', 2), isCorrect: false, notAttempted: false })
  assert.equal(d.action, RETRY_SETTLE_ACTION.UPDATE)
  assert.equal(d.errorCount, 3, '「他就是不会」的空题由老师标错，必须 +1')
  assert.equal(d.nextLifecycle, 'new')
})

test('★ 空题新口径：notAttempted 优先于 skipWrongBook（reason 记 blank_not_attempted）', () => {
  const d = decideRetrySettlementItem({ existing: existingRow('new', 1), isCorrect: false, skipWrongBook: true, notAttempted: true })
  assert.equal(d.action, RETRY_SETTLE_ACTION.SKIP)
  assert.equal(d.reason, 'blank_not_attempted', '两个都跳过时，审计 reason 应记更具体的空题口径')
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

// ── E. 补交对账翻案（2026-11-04 负责人拍板「支持补交 + 自动对账翻案」）────────
//
// 场景：重练卷分次提交 —— 首次只拍了部分页面，未拍摄页面的题被（旧口径）按
// 「未作答=不会」结算成错；补交剩余页面后，这些题判对 ⇒ 自动撤销上次的虚增。
// 仅单向翻案（错→对）：对→错不借补交落锤，OCR 抖动不得降掌握度。

test('★ 翻案：上次结算为错 + 本次判对 ⇒ 回退 error_count 并推进生命周期', () => {
  const d = decideRetrySettlementItem({
    existing: existingRow('new', 2),
    isCorrect: true,
    reversal: { rowTouchedSince: false }
  })
  assert.equal(d.action, RETRY_SETTLE_ACTION.UPDATE)
  assert.equal(d.reason, 'reversal_wrong_to_correct')
  assert.equal(d.errorCount, 1, '上次判错虚增的 +1 必须回退（2 → 1）')
  assert.equal(d.nextLifecycle, 'review_1', '翻案判对照常推进档位')
  assert.equal(d.countsAs, 'upgraded', '翻案是真实信号，计入升级统计')
  assert.notEqual(d.conservative, true, '行没被动过 ⇒ 走完整翻案')
})

test('★ 翻案：review_1 判对 ⇒ 推到 mastered（countsAs=mastered）', () => {
  const d = decideRetrySettlementItem({
    existing: existingRow('review_1', 3),
    isCorrect: true,
    reversal: { rowTouchedSince: false }
  })
  assert.equal(d.nextLifecycle, 'mastered')
  assert.equal(d.countsAs, 'mastered')
  assert.equal(d.errorCount, 2)
})

test('★ 翻案：error_count=1 时回退不得跌破 1（全局不变量）', () => {
  const d = decideRetrySettlementItem({
    existing: existingRow('new', 1),
    isCorrect: true,
    reversal: { rowTouchedSince: false }
  })
  assert.equal(d.errorCount, 1, 'error_count ≥ 1，只推进档位不再往下扣')
})

test('★ 翻案保守模式：行在结算后被别人动过 ⇒ 只回 error_count，不动档位', () => {
  for (const lc of ALL_LIFECYCLES) {
    const d = decideRetrySettlementItem({
      existing: existingRow(lc, 3),
      isCorrect: true,
      reversal: { rowTouchedSince: true }
    })
    assert.equal(d.action, RETRY_SETTLE_ACTION.UPDATE)
    assert.equal(d.reason, 'reversal_error_count_only')
    assert.equal(d.errorCount, 2)
    assert.equal(d.nextLifecycle, lc, `保守模式不得动档位（${lc}）`)
    assert.equal(d.countsAs, null, '保守模式没推进档位，不得计入升级统计')
    assert.equal(d.conservative, true, `保守模式必须显式标记（${lc}）`)
  }
})

test('★ 翻案：错题行已不存在（老师改判时删行）⇒ skip，不复活', () => {
  const d = decideRetrySettlementItem({
    existing: null,
    isCorrect: true,
    reversal: { rowTouchedSince: false }
  })
  assert.equal(d.action, RETRY_SETTLE_ACTION.SKIP)
  assert.equal(d.reason, 'reversal_without_existing_row')
  assert.equal(d.errorCount, null)
})

test('★ 翻案只单向：reversal + 判错 ⇒ 走普通判错路径（调用方分类不会放进来，防御性锁定）', () => {
  const d = decideRetrySettlementItem({
    existing: existingRow('new', 1),
    isCorrect: false,
    reversal: { rowTouchedSince: false }
  })
  assert.equal(d.reason, 'wrong_existing_row', 'reversal 分支只在判对时生效')
  assert.equal(d.errorCount, 2)
})

// ── C. 源码锁（fail-closed）──────────────────────────────────────────────

test('C1. 结算循环必须调用纯函数判定，不得把判定内联回循环', () => {
  const fails = []
  const loop = anchoredRange(
    FINALIZER_SRC,
    'for (const result of [...pendingResults, ...reversalResults]) {',
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

test('C4. 空题口径必须贯通结算链路：finalize 传参 notAttempted + 审计留痕 not_attempted', () => {
  const fails = []
  const fn = anchoredSlice(
    FINALIZER_SRC,
    'export const finalizeGeneratedExamResults',
    12000,
    'finalizeGeneratedExamResults 函数体',
    fails
  )
  if (fn !== null) {
    if (!fn.includes('notAttempted: r.notAttempted === true')) {
      fails.push('结算结果归一化丢了 notAttempted —— 空题会被当答错结算（2026-11-04 口径回归）')
    }
    if (!fn.includes('notAttempted: result.notAttempted')) {
      fails.push('结算循环没有把 notAttempted 传给 decideRetrySettlementItem —— 空题口径断链')
    }
    if (!fn.includes('not_attempted: result.notAttempted === true')) {
      fails.push('结算审计没写 not_attempted —— 回填/审计无法区分「未作答跳过」与「真实判错」')
    }
    if (!fn.includes("wrong_book_action: isReversal")) {
      fails.push('结算审计的 wrong_book_action 分支被改掉 —— 空题 skip / 翻案 reversal 的留痕口径回归')
    }
  }
  assert.deepEqual(fails, [])
})

// ── F. worker 自动批改路径贯通（2026-11-04 补交对账配套）────────────────────
//
// e5a1ae5 把空题口径接进了「老师完成复核」路径（reviewStore），但 worker 自动批改
// （processSlimGrading）当时没接 —— 自动批改的空题仍会被当答错结算。本节锁死：
//   C5. worker 结算 payload 必须带 notAttempted（blank 结果 ⇒ 零信号）；
//   C6. worker 必须保留「未对位且有旧判定的题不覆盖不重结算」守卫（补交安全的前提）。

const WORKER_SRC = readFileSync(join(ROOT, 'server/worker.js'), 'utf8')

test('C5. worker 结算 payload 必须把 blank 结果标记为 notAttempted（空题口径贯通自动批改）', () => {
  const fails = []
  const seg = anchoredSlice(
    WORKER_SRC,
    'const settledResults = results',
    1200,
    'worker processSlimGrading 结算 payload',
    fails
  )
  if (seg !== null && !seg.includes("notAttempted: r.reason === 'blank'")) {
    fails.push('worker 结算 payload 丢了 notAttempted —— 自动批改的空题会被当答错结算（2026-11-04 口径回归）')
  }
  assert.deepEqual(fails, [])
})

test('C6. worker 必须保留「未对位且有旧判定 ⇒ 保留旧结果」的补交守卫', () => {
  const fails = []
  const seg = anchoredSlice(
    WORKER_SRC,
    'const hasPriorJudgment =',
    1600,
    'worker processSlimGrading 补交守卫',
    fails
  )
  if (seg !== null) {
    if (!seg.includes("matchedBy === 'none'")) {
      fails.push('补交守卫没有按「未对位」判定 —— 只补拍新页面时已批题目会被覆盖成未作答')
    }
    if (!seg.includes('keptPrior')) {
      fails.push('补交守卫没有在对位明细里留 keptPrior 标记 —— 批改页无法区分「保留旧判定」的题')
    }
  }
  assert.deepEqual(fails, [])
})
