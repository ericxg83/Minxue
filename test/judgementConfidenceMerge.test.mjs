/**
 * 回归锁（2026-10-09）：复核页「学生答案与参考答案等值却显示待复核」
 *
 * 事故（用户截图）：错题重练卷 task c118309e 第 4 题
 *   题干「3¾小时的⅔是______。」 学生答 $\frac{5}{2}$、参考答案「2又1/2小时」
 *   —— 5/2 = 2又1/2，等值。库里 questions.is_correct = true、confidence = 0.95，
 *   但 PC 复核页显示「待复核」，老师被迫逐题重点一遍（该卷 15 题里 4 题是这种假待复核）。
 *
 * 根因：`reviewStore.mergeJudgements` 无条件 `q.confidence = j.confidence`。
 *   而人工类 judgement（manual_review 结算 / pc_edit / pc_rejudge /
 *   workbook_to_ai_regrade）**根本不下置信度**，confidence 恒为 NULL
 *   （见 server/services/gradingFinalizer.js 写 manual_review 审计时只写 is_correct）。
 *   于是题目自带的 0.95 被 NULL 抹掉 ⇒ src/utils/reviewDecision.js 的 confirmed 判据
 *   （confidence >= threshold）落空 ⇒ 状态从 'correct' 掉进 'pending' ⇒「AI判对」变「待复核」。
 *
 * 影响面（全库实测）：349 条命中「最新 judgement 的 confidence 为 NULL 且 is_correct=true」，
 *   其中 41 条 review_status 为空 ⇒ 这 41 条被凭空判成待复核。
 *
 * 修复：合并只许「有值才覆盖」，NULL 不得反向覆盖非 NULL —— 置信度只可能来自 AI 判定，
 *   人工结论走 is_correct，不表达为置信度。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { getReviewStateLabel } from '../src/utils/reviewDecision.js'
import { anchoredRange, includesLit } from './sourceLockKit.mjs'

const STORE = path.resolve(import.meta.dirname, '../src/workbench/stores/reviewStore.js')
const src = fs.readFileSync(STORE, 'utf8')

// ─────────────────────────── A. 合并语义（纯函数，无 DB）───────────────────────────

/** 题目：AI 判定正确 + 置信度达标 + 老师尚未逐题确认（review_status 为空） */
const question = () => ({
  is_correct: true,
  confidence: 0.95,
  review_status: null,
  answer_source: 'recognized',
})

/** 现行合并语义：judgement 不带置信度时保持题目原值 */
const mergeConfidence = (q, j) => {
  if (j && j.confidence != null) q.confidence = j.confidence
  return q
}

test('人工复核结算（confidence=null）不得把题目置信度抹成 null', () => {
  const q = mergeConfidence(question(), { source: 'manual_review', confidence: null })
  assert.equal(q.confidence, 0.95, '人工 judgement 没有置信度，不许覆盖')
  assert.equal(getReviewStateLabel(q), 'AI判对', '仍应显示 AI判对，不该掉进待复核')
})

test('judgement 带置信度时仍要覆盖（不能因噎废食）', () => {
  const q = mergeConfidence({ ...question(), confidence: 0.6 }, { source: 'ai_answer_gen', confidence: 0.98 })
  assert.equal(q.confidence, 0.98, 'AI 判定确实带置信度时，仍以最新 judgement 为准')
})

test('反向自检：旧版无条件覆盖会把「AI判对」打成「待复核」（这条断言就是事故本身）', () => {
  const q = { ...question() }
  const j = { source: 'manual_review', confidence: null }
  q.confidence = j.confidence // 旧实现
  assert.equal(q.confidence, null)
  assert.equal(getReviewStateLabel(q), '待复核', '旧实现下确实会显示待复核——证明根因定位成立')
})

// ─────────────────────────── B. 源码锁（fail-closed）───────────────────────────

const LABEL = 'reviewStore.mergeJudgements'
const GUARD_LIT = 'if (j && j.confidence != null) { q.confidence = j.confidence }'

test('源码锁：mergeJudgements 的 confidence 覆盖必须带 null 守卫', () => {
  const fails = []
  const body = anchoredRange(
    src,
    'const mergeJudgements = async (studentId, questions) => {',
    '// ── 批改工作台：场景模式控制 ──',
    LABEL,
    fails
  )
  assert.deepEqual(fails, [], fails.join('\n')) // 锚点缺失 ⇒ 立即判红（不静默失效）
  assert.ok(body, `${LABEL}：切片为空`)

  assert.ok(
    includesLit(body, GUARD_LIT),
    `${LABEL}：缺少「有值才覆盖」守卫 —— NULL 会再次抹掉题目自带的置信度`
  )
  assert.ok(
    includesLit(body, 'q.confidence = j.confidence'),
    `${LABEL}：合并 confidence 的语句整个不见了？若已迁走请同步本锁`
  )

  // 反向自检：把旧版函数体贴进来，同一判据必须判红（证明锁不是空断言）
  const oldBody = `
      for (const q of questions) {
        const j = judgeMap[q.id]
        if (j) {
          q.confidence = j.confidence
          // ⚠️ 不再用 judgement.is_correct 兜底覆盖题目状态
        }
      }`
  assert.equal(includesLit(oldBody, GUARD_LIT), false, '反向自检失败：锁在旧版上也通过 ⇒ 空断言')
})
