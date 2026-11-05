/**
 * 回归锁：重练卷空题不得被写成「AI 判定为错误」（2026-11-05 陈昊煜重练卷事故）
 *
 * 事故链：
 *   ① 11-04 新口径（e5a1ae5）只改了**结算层**：notAttempted ⇒ skip，不计 error_count；
 *   ② 但重练卷 slim 判题管线（worker.js processSlimGrading）的「学生未作答」分支
 *      仍把 questions.is_correct 写成 false（同时 answer_source='blank'）；
 *   ③ 批改中心卷面定位框 PaperViewerPanel 直读 is_correct===false 画红叉，
 *      isWrongResult 也把空题当判错 ⇒ 负责人看到「空白题 AI 判定为错误」；
 *   ④ 11-04 12:1x 的全局脚本只清历史 184 条存量，14:16 这份卷重批又写回 19 条
 *      —— 不修源头，清多少次都会再生。
 *
 * 本文件锁四件事：
 *   A. 落库判据纯函数：空题恒 null，普通结论原样透传（行为不变量）。
 *   B. 展示/门禁判据：blank 不是 wrong；老师明确标错的空题仍算 wrong。
 *   C. 源码锁：worker 落库必须调用纯函数、对位明细不得写 false、
 *      结算仍带 notAttempted（零信号口径不能断链）。
 *   D. 源码锁：PC 卷面角标走 6 态而非直读 is_correct；完成复核仍把空题送进结算。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { anchoredSlice, anchoredRange, includesLit } from './sourceLockKit.mjs'
import {
  isRetryBlankResult,
  resolveRetryStoreIsCorrect,
  RETRY_BLANK_REASON
} from '../server/utils/retryBlankCaliber.js'
import { isWrongResult, getReviewState } from '../src/utils/reviewDecision.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKER_SRC = readFileSync(join(ROOT, 'server/worker.js'), 'utf8')
const VIEWER_SRC = readFileSync(join(ROOT, 'src/workbench/components/review/PaperViewerPanel.vue'), 'utf8')
const STORE_SRC = readFileSync(join(ROOT, 'src/workbench/stores/reviewStore.js'), 'utf8')
const DECISION_SRC = readFileSync(join(ROOT, 'src/utils/reviewDecision.js'), 'utf8')

// ── A. 落库判据（行为不变量）─────────────────────────────────────────────

test('★ 红线：重练卷空题落库 is_correct 必须是 null，不是 false', () => {
  const blank = { questionId: 'q1', isCorrect: false, reason: 'blank', studentAnswer: '' }
  assert.equal(isRetryBlankResult(blank), true)
  assert.equal(resolveRetryStoreIsCorrect(blank), null,
    '空题 = 零信号；写 false 会让批改中心显示「AI 判定为错误」')
  assert.equal(RETRY_BLANK_REASON, 'blank')
})

test('非空题的判定原样落库（判错/判对/判不出），不得被空题口径误伤', () => {
  assert.equal(resolveRetryStoreIsCorrect({ isCorrect: false, reason: 'subjective' }), false)
  assert.equal(resolveRetryStoreIsCorrect({ isCorrect: true }), true)
  assert.equal(resolveRetryStoreIsCorrect({ isCorrect: null, reason: 'no_reference_answer' }), null)
  assert.equal(resolveRetryStoreIsCorrect(null), null)
  assert.equal(isRetryBlankResult({ isCorrect: false, reason: 'low_confidence' }), false)
  assert.equal(isRetryBlankResult(null), false)
})

// ── B. 展示 / 错题门禁判据 ────────────────────────────────────────────────

test('★ 红线：blank + is_correct=false 不得被判成「判错结果」（含历史脏数据）', () => {
  const q = { answer_source: 'blank', is_correct: false, review_status: null, confidence: 1 }
  assert.equal(isWrongResult(q), false, '空题不该进 needsWrongBookDecision 错题门禁')
  assert.equal(getReviewState(q), 'blank', '6 态必须是「未作答」而不是「AI判错」')
})

test('老师明确标错的空题仍算 wrong（裁量权保留）', () => {
  assert.equal(isWrongResult({ answer_source: 'blank', is_correct: false, review_status: 'wrong' }), true)
  assert.equal(isWrongResult({ answer_source: 'blank', is_correct: null, review_status: 'wrong_no_book' }), true)
})

test('普通作业的真实判错不受影响', () => {
  assert.equal(isWrongResult({ answer_source: 'recognized', is_correct: false, review_status: null }), true)
  assert.equal(getReviewState({ answer_source: 'recognized', is_correct: false, review_status: null }), 'wrong')
})

// ── C. worker 源码锁：落库 / 对位 / 结算三处不许回退 ─────────────────────

test('★ 源码锁：slim 管线落库调用纯函数，且判据不在别处内联', () => {
  const fails = []
  const fn = anchoredSlice(
    WORKER_SRC,
    'const prefillFailures = []',
    2600,
    'worker 预填落库循环',
    fails
  )
  if (fn !== null) {
    if (!includesLit(fn, 'const storeIsCorrect = resolveRetryStoreIsCorrect(r)')) {
      fails.push('落库没有调用 retryBlankCaliber 纯函数 —— 空题会再次写成 is_correct=false')
    }
    if (!includesLit(fn, 'storeIsCorrect, nextConfidence')) {
      fails.push('UPDATE 参数没用 storeIsCorrect —— 纯函数算了却没落库')
    }
    if (includesLit(fn, '[nextAnswerSource === \'blank\' ? \'\' : nextStudentAnswer, r.isCorrect,')) {
      fails.push('落库又退回直接用 r.isCorrect —— 陈昊煜红叉事故复发')
    }
  }
  assert.deepEqual(fails, [])
})

test('★ 源码锁：空题分支的对位明细 isCorrect 必须是 null，不能画红叉', () => {
  const fails = []
  const branch = anchoredRange(
    WORKER_SRC,
    'if (!studentAnswer) {',
    '// ── ② 存储答案为空',
    'worker 空题分支',
    fails
  )
  if (branch !== null) {
    if (!includesLit(branch, 'alignRec.isCorrect = null')) {
      fails.push('对位明细把空题记成判错 —— paper 模式会画红叉')
    }
    if (includesLit(branch, 'alignRec.isCorrect = false')) {
      fails.push('空题对位明细不得写 false')
    }
    if (!includesLit(branch, "reason: 'blank'")) {
      fails.push('空题 reason 变了，isRetryBlankResult / notAttempted 判据会失效')
    }
  }
  assert.deepEqual(fails, [])
})

test('★ 源码锁：结算仍以 notAttempted 传空题（零信号审计不能断链）', () => {
  const fails = []
  const seg = anchoredSlice(
    WORKER_SRC,
    'const settledResults = results',
    700,
    'worker 结算映射',
    fails
  )
  if (seg !== null) {
    if (!includesLit(seg, 'notAttempted: isRetryBlankResult(r)')) {
      fails.push('结算丢了 notAttempted —— 空题会被当普通判错计入 error_count')
    }
    if (!includesLit(seg, 'isCorrect: r.isCorrect')) {
      fails.push('结算信号必须保留 isCorrect（配合 notAttempted 走 skip）')
    }
  }
  assert.deepEqual(fails, [])
})

test('★ 源码锁：worker 唯一实现来自 retryBlankCaliber（import 不能丢）', () => {
  assert.ok(
    includesLit(WORKER_SRC, "import { isRetryBlankResult, resolveRetryStoreIsCorrect } from './utils/retryBlankCaliber.js'"),
    'worker 必须从 retryBlankCaliber 取判据，禁止在管线里内联第二套'
  )
})

// ── D. 前端源码锁 ────────────────────────────────────────────────────────

test('★ 源码锁：PC 卷面角标走 6 态，不直读 is_correct', () => {
  const fails = []
  const seg = anchoredSlice(VIEWER_SRC, '<span class="overlay-number">', 900, '卷面定位框角标', fails)
  if (seg !== null) {
    if (includesLit(seg, 'is_correct === false')) {
      fails.push('卷面角标又在直读 is_correct —— 空题会重新出现红叉')
    }
    if (!includesLit(seg, "store.getAiState(store.currentReviewQuestion) === 'wrong'")) {
      fails.push('判错角标没走 6 态')
    }
    if (!includesLit(seg, "store.getAiState(store.currentReviewQuestion) === 'blank'")) {
      fails.push('空白角标缺失 —— 空题应显示「空」而不是被判错')
    }
  }
  assert.deepEqual(fails, [])
})

test('★ 源码锁：isWrongResult 保留 blank 排除（与 6 态同源）', () => {
  assert.ok(
    includesLit(DECISION_SRC, "question?.answer_source !== 'blank'"),
    'isWrongResult 丢了 blank 排除 —— 历史脏数据的空题会再次进错题门禁'
  )
})

test('★ 源码锁：完成复核仍把空题送进结算（is_correct 改 null 后不能漏）', () => {
  const fails = []
  const fn = anchoredSlice(
    STORE_SRC,
    'const persistTaskCompletion = async (task) => {',
    2600,
    'persistTaskCompletion',
    fails
  )
  if (fn !== null) {
    if (!includesLit(fn, 'isCorrect: notAttempted ? false : effectiveIsCorrect(q)')) {
      fails.push('空题 is_correct 改 null 后会被 filter 丢掉 —— 结算 skip 审计断链')
    }
    if (!includesLit(fn, 'notAttempted')) {
      fails.push('完成复核丢了 notAttempted')
    }
  }
  assert.deepEqual(fails, [])
})
