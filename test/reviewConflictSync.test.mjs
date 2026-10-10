/**
 * 「已标记错误」与「判定为对」并存 —— 修复回归锁（2026-10-10）
 *
 * 报障：负责人截图 #1（题 7570cd1b）—— 重练都做对了，复核页还挂着
 * 「已标记错误」+「已复核-AI翻案」，红标与绿色 95% 自相矛盾。
 *
 * 根因（两条写入路径各自漏了一步同步）：
 *   ① 重练卷结算 finalizeGeneratedExamResults 只写 is_correct，
 *      不解除 review_status='wrong'/'wrong_no_book'，也不把 status 从 'wrong' 翻回来；
 *   ② 人工改判为「对」finalizeRejudgeResult / PUT /api/questions/:id 同样只改 is_correct；
 *   ③ PC 端标错（src/services/apiService.js#updateQuestionReviewStatus）**只传 review_status**，
 *      后端 PUT 不同步 is_correct ⇒ AI 判对的题被标错后仍留 is_correct=true。
 *
 * 本文件锁三件事（源码级，全部 fail-closed 走 sourceLockKit）：
 *   A. 重练结算判「对」时，必须解除错题标记 + 回退错题筛选 status；
 *   B. 人工改判为「对」时（含 PUT 与 finalizeRejudgeResult），必须解除错题标记；
 *   C. PUT 里只传 review_status 时，is_correct 必须按人工结论同步。
 * 外加一条展示层行为锁：标记被解除后，复核页不得再出现「已复核-AI翻案」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { anchoredSlice, anchoredRange } from './sourceLockKit.mjs'
import { getReviewStateLabel } from '../src/utils/reviewDecision.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const INDEX_SRC = read('server/index.js')
const FINALIZER_SRC = read('server/services/gradingFinalizer.js')

// ── A. 重练结算（finalizeGeneratedExamResults）────────────────────────────
test('A. 重练判「对」必须解除错题标记并回退 status（重练＝消灭错题）', () => {
  const fails = []
  const seg = anchoredSlice(
    FINALIZER_SRC,
    'export const finalizeGeneratedExamResults',
    9000,
    'finalizeGeneratedExamResults',
    fails
  )
  assert.deepEqual(fails, [], '锚点必须存在（函数改名请同步本锁）')
  assert.ok(seg.includes('const correctIds = updateQuestionIds.filter'),
    '必须挑出判「对」的题（只有判对才解除标记，判错保持原样）')
  assert.ok(/review_status\s*=\s*CASE/.test(seg),
    '结算 UPDATE 必须带 review_status 的 CASE')
  assert.ok(seg.includes("review_status IN ('wrong', 'wrong_no_book')"),
    '只解除错题标记，不动 correct / exclude')
  assert.ok(seg.includes('THEN NULL::text'),
    'NULL 必须显式 ::text —— 与 is_correct 的 ::boolean 同理，否则 PG 报类型推断错误')
  assert.ok(/status\s*=\s*CASE/.test(seg) && seg.includes("THEN 'pending'"),
    "status='wrong' 必须一并回退成 'pending'，否则 ?status=wrong 仍把这题当错题筛出来")
})

// ── B. 人工改判为「对」（finalizeRejudgeResult）───────────────────────────
test('B. 人工改判为「对」必须解除错题标记（AI 自动重判不得推翻老师结论）', () => {
  const fails = []
  const seg = anchoredSlice(
    FINALIZER_SRC,
    'export const finalizeRejudgeResult',
    5000,
    'finalizeRejudgeResult',
    fails
  )
  assert.deepEqual(fails, [], '锚点必须存在')
  assert.ok(seg.includes("WHEN $5::boolean AND $1 IS TRUE AND review_status IN ('wrong', 'wrong_no_book')"),
    '改判为对时解除错题标记，且必须由 $5（manualOverride）把关')
  assert.ok(seg.includes('manualOverride === true'),
    '$5 必须是 manualOverride —— AI 自动重解析（manualOverride=false）不得清掉老师的人工结论')
})

// ── C. PUT /api/questions/:id：只传 review_status 时同步 is_correct ──────
test('C. 只传 review_status 时必须按人工结论同步 is_correct（PC 端标错漏同步的根因）', () => {
  const fails = []
  const seg = anchoredRange(
    INDEX_SRC,
    "const hasIsCorrectRaw = 'is_correct' in req.body",
    'const hasDisplayImageType',
    'PUT is_correct 同步',
    fails
  )
  assert.deepEqual(fails, [], '锚点必须存在')
  assert.ok(seg.includes('isCorrectEffective'),
    '必须走 isCorrectEffective（推导后的值），不能直接用 body 的 is_correct')
  assert.ok(seg.includes("review_status === 'wrong'") && seg.includes('isCorrectEffective = false'),
    '标「错 / 错误但不入册」→ is_correct 同步为 false')
  assert.ok(seg.includes("review_status === 'correct'") && seg.includes('isCorrectEffective = true'),
    '标「对」→ is_correct 同步为 true')
  assert.ok(!/review_status === 'exclude'[\s\S]{0,80}isCorrectEffective/.test(seg),
    'exclude 是「这题不该出现在本卷」的软删除，与正误无关，不得动 is_correct')
})

test('C2. PUT 的 UPDATE 里，改判为「对」必须同时解除错题标记', () => {
  const fails = []
  const seg = anchoredRange(
    INDEX_SRC,
    'review_status = CASE',
    'display_image_type = CASE',
    'PUT review_status CASE',
    fails
  )
  assert.deepEqual(fails, [], '锚点必须存在')
  assert.ok(seg.includes("WHEN $14 AND $8::boolean IS TRUE"),
    'is_correct 被改成 true 时必须触发解除')
  assert.ok(seg.includes("review_status IN ('wrong', 'wrong_no_book')") && seg.includes('THEN NULL::text'),
    '只解除错题标记，且显式 ::text')
})

// ── D. 展示层行为锁：标记解除后不得再出现矛盾文案 ─────────────────────────
test('D. 错题标记被解除后，复核页不再显示「已复核-AI翻案」', () => {
  const base = { confidence: 0.95, answer_source: 'recognized' }

  // 修复前的形态（review_status='wrong' + is_correct=true）→ 矛盾文案
  assert.equal(
    getReviewStateLabel({ ...base, review_status: 'wrong', is_correct: true }),
    '已复核-AI翻案'
  )

  // 修复后：标记被解除 → 按判定走，不再自相矛盾
  const fixed = getReviewStateLabel({ ...base, review_status: null, is_correct: true })
  assert.equal(fixed, 'AI判对')
  assert.notEqual(fixed, '已复核-AI翻案')
})

// ── E. 反向自检：旧版写法必须判红（锁本身不能是"看着绿其实没查"）──────────
test('E. 反向自检：修复前的写法在 A/B/C 判据下必须不成立', () => {
  // A 的旧写法：只写 is_correct，不带 review_status/status 的 CASE
  const OLD_A = `SET is_correct = CASE id \${buildIsCorrectAssignments(updateQuestionIds)} END, updated_at = NOW()`
  assert.ok(!/review_status\s*=\s*CASE/.test(OLD_A), 'A：旧写法必须不含 review_status CASE')

  // B 的旧写法：只有 status / confidence 的 CASE
  const OLD_B = `SET is_correct = $1,
         status = CASE WHEN status = 'mastered' THEN status WHEN $1 IS FALSE THEN 'wrong' END,
         confidence = CASE WHEN $2::numeric IS NULL THEN confidence ELSE GREATEST(COALESCE(confidence, 0), $2::numeric) END`
  assert.ok(!OLD_B.includes("review_status IN ('wrong', 'wrong_no_book')"), 'B：旧写法必须不含标记解除')

  // C 的旧写法：body 的 is_correct 直接进 SQL，没有推导
  const OLD_C = `const hasIsCorrect = 'is_correct' in req.body
    const hasReviewStatus = 'review_status' in req.body`
  assert.ok(!OLD_C.includes('isCorrectEffective'), 'C：旧写法必须不含推导变量')
})
