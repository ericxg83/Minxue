/**
 * 复核页「待处理」口径锁（2026-10-10）
 *
 * 需求：PC 后台复核页左栏「题目列表 → 待处理」页签里，除 AI 没给出结论的三态
 * （pending / exception / processing）外，还要包含**「AI 已判出正误、但参考答案存疑」**
 * （ai_answer_risk_reason 非空，如「AI 视觉推理不擅长，建议核对参考答案」）的题 ——
 * 这类题在 6 态里是终态（AI 判错 → 红 X），旧口径下老师翻页即过，看不到要核对。
 *
 * 本文件锁两件事：
 *   1. 行为：needsHumanAttention 的判定边界（含「人工已复核后必须退出待处理」这条防死锁规则）
 *   2. 源码：reviewStore 的两个消费方（页签过滤 + 顶部「需处理 N」）必须共用同一函数，
 *      禁止任何一方再各写一套（本仓反复踩过的口径漂移）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { anchoredSlice, includesLit } from './sourceLockKit.mjs'
import {
  REVIEW_STATUS,
  needsHumanAttention,
  getAnswerRiskPendingText,
  getReviewState
} from '../src/utils/reviewDecision.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const IMAGE_RISK = 'AI 视觉推理不擅长，建议核对参考答案'

test('AI 没给出结论的三态仍然需要老师处理（行为不变）', () => {
  const processing = { is_correct: null, confidence: null, answer_source: 'recognized' }
  const undecided = { is_correct: null, confidence: 0.95, answer_source: 'recognized' }
  const pending = { is_correct: true, confidence: 0.3, answer_source: 'recognized' }
  assert.equal(getReviewState(processing), 'processing')
  assert.equal(getReviewState(undecided), 'exception')
  assert.equal(getReviewState(pending), 'pending')
  for (const q of [processing, undecided, pending]) {
    assert.equal(needsHumanAttention(q), true)
  }
})

test('AI 判错/判对但参考答案存疑 → 也要进「待处理」（本次需求核心）', () => {
  const wrongWithRisk = {
    is_correct: false, confidence: 0.95, answer_source: 'recognized',
    ai_answer_risk_reason: IMAGE_RISK
  }
  // 6 态仍是终态 wrong（红 X 照常显示），但它现在算「需要老师动手」
  assert.equal(getReviewState(wrongWithRisk), 'wrong')
  assert.equal(needsHumanAttention(wrongWithRisk), true)

  const correctWithRisk = {
    is_correct: true, confidence: 0.95, answer_source: 'recognized',
    ai_answer_risk_reason: IMAGE_RISK
  }
  assert.equal(getReviewState(correctWithRisk), 'correct')
  assert.equal(needsHumanAttention(correctWithRisk), true)

  // 没有存疑标注的普通判错题不受影响 —— 不能把所有判错题都推进待处理
  const plainWrong = { is_correct: false, confidence: 0.95, answer_source: 'recognized' }
  assert.equal(needsHumanAttention(plainWrong), false)
})

test('人工已复核 / 已排除的题必须退出「待处理」（防死锁）', () => {
  // 后端只在「参考答案被人工改写」时清 ai_answer_risk_reason（见 PUT /api/questions/:id
  // 的 answerRewritten 分支）：老师点「判错」确认 AI 结论时该列仍留着。
  // 若这里不看 review_status，这题会永远卡在待处理里清不掉。
  const reviewedWrong = {
    is_correct: false, confidence: 0.95, answer_source: 'recognized',
    review_status: REVIEW_STATUS.WRONG, ai_answer_risk_reason: IMAGE_RISK
  }
  assert.equal(needsHumanAttention(reviewedWrong), false)
  assert.equal(getAnswerRiskPendingText(reviewedWrong), '')

  const reviewedNoBook = { ...reviewedWrong, review_status: REVIEW_STATUS.WRONG_NO_BOOK }
  assert.equal(needsHumanAttention(reviewedNoBook), false)

  const reviewedCorrect = {
    is_correct: false, confidence: 0.95, answer_source: 'recognized',
    review_status: REVIEW_STATUS.CORRECT, ai_answer_risk_reason: IMAGE_RISK
  }
  assert.equal(needsHumanAttention(reviewedCorrect), false)

  // 已排除的题不进任何待办（后端本就不过滤，这里再加一道）
  assert.equal(needsHumanAttention({
    is_correct: false, review_status: REVIEW_STATUS.EXCLUDE, ai_answer_risk_reason: IMAGE_RISK
  }), false)
})

test('未作答（blank 终态）不因存疑标注被拉回待处理', () => {
  const blank = { answer_source: 'blank', is_correct: null, confidence: 0 }
  assert.equal(getReviewState(blank), 'blank')
  assert.equal(needsHumanAttention(blank), false)
})

test('null / undefined 安全返回 false；字段全空沿用 6 态「处理中」', () => {
  assert.equal(needsHumanAttention(null), false)
  assert.equal(needsHumanAttention(undefined), false)
  // {} 没有任何判定字段 → getReviewState 判 'processing'（既有口径），故仍算需处理。
  // 真实数据不会出现这种对象，这里只是钉住「与 6 态一致、不额外发明规则」。
  assert.equal(getReviewState({}), 'processing')
  assert.equal(needsHumanAttention({}), true)
})

test('列表行小签文案与待处理判据同源', () => {
  const q = {
    is_correct: false, confidence: 0.95, answer_source: 'recognized',
    ai_answer_risk_reason: IMAGE_RISK
  }
  assert.equal(getAnswerRiskPendingText(q), IMAGE_RISK)
  // 无存疑标注 → 无小签
  assert.equal(getAnswerRiskPendingText({ ...q, ai_answer_risk_reason: null }), '')
})

// ── 源码锁：两个消费方必须共用唯一判据 ──────────────────────────────
test('reviewStore 的「待处理」判据与顶部计数共用 needsHumanAttention', () => {
  const src = read('src/workbench/stores/reviewStore.js')
  const fails = []
  const label = 'reviewStore「待处理」口径'

  const confirmSeg = anchoredSlice(
    src, 'const questionConfirmationMap = computed(() => {', 400, label, fails
  )
  if (confirmSeg !== null && !confirmSeg.includes('needsHumanAttention(')) {
    fails.push(`${label}：questionConfirmationMap 必须走 needsHumanAttention，不得再各写一套`)
  }

  const countSeg = anchoredSlice(
    src, 'const needsAttentionCount = computed(', 400, label, fails
  )
  if (countSeg !== null && !countSeg.includes('needsHumanAttention(')) {
    fails.push(`${label}：needsAttentionCount 必须与页签同源（needsHumanAttention），否则两个数打架`)
  }

  assert.deepEqual(fails, [])
})

test('锁健全性：把判据改回「各写一套」的旧写法必须判红', () => {
  const src = read('src/workbench/stores/reviewStore.js')
  const broken = src.replace(
    'map[q.id] = !needsHumanAttention(q, confidenceThreshold.value)',
    "const state = getReviewState(q, confidenceThreshold.value)\n      map[q.id] = state !== 'pending' && state !== 'exception' && state !== 'processing'"
  )
  // fail-closed：若源码写法变了导致 replace 没命中，自检本身必须判红（别静默通过）
  assert.notEqual(broken, src, '合成样本没被改坏 —— 锚点已变，请同步本锁')
  const i = broken.indexOf('const questionConfirmationMap = computed(() => {')
  const seg = broken.slice(i, i + 400)
  assert.equal(
    seg.includes('needsHumanAttention('), false,
    '旧写法（只认三态、不含参考答案存疑）应当被锁判红'
  )
})

test('左栏列表行展示参考答案存疑小签，且判据同源', () => {
  const src = read('src/workbench/components/review/QuestionNavPanel.vue')
  const fails = []
  const label = 'QuestionNavPanel 存疑小签'

  const fnSeg = anchoredSlice(src, 'const answerRiskText = (q) =>', 200, label, fails)
  if (fnSeg !== null && !fnSeg.includes('getAnswerRiskPendingText(')) {
    fails.push(`${label}：行内小签必须用 getAnswerRiskPendingText（与待处理判据同源）`)
  }
  if (!includesLit(src, 'class="item-answer-risk"')) {
    fails.push(`${label}：模板里缺少 .item-answer-risk 小签，老师看不出这题为什么要核对`)
  }

  assert.deepEqual(fails, [])
})

test('移动端「需处理」计数与 PC 端同源（禁止两端各判一套）', () => {
  const src = read('src/hooks/useExamReview.js')
  const fails = []
  const label = '移动端需处理口径'

  const seg = anchoredSlice(src, 'const needsAttentionCount = useMemo(', 400, label, fails)
  if (seg !== null && !seg.includes('needsHumanAttention(')) {
    fails.push(`${label}：useExamReview 的 needsAttentionCount 必须调 needsHumanAttention —— 同一份卷两端数字必须一致`)
  }
  // 旧写法（只认三态）不得残留
  if (seg !== null && /state\s*===\s*'pending'/.test(seg)) {
    fails.push(`${label}：仍留着只认三态的旧判据，会漏掉「参考答案存疑」的题`)
  }

  assert.deepEqual(fails, [])
})
