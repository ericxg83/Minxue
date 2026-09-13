/**
 * 回归测试：双路 OCR 结果合并 mergeOcrQuestions（worker.js）
 *
 * 数据取自 2026-09-13 真实作业照实测（prod_imgs/ocr_a.jpg，19.2 实数提高性测试）：
 *   sensenova-6.8-flash-lite 抽到 11/15 学生答案、answer 零污染，但 Q11 把 −2√3 认成 2√3；
 *   魔搭 Qwen3-VL-235B 抽到 15/15、Q11 正确，但 answer 字段 15/15 被学生答案污染。
 * 合并目标：同时拿到「魔搭的覆盖率」和「sensenova 的洁净度」，并把分歧挑出来给人工。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeOcrQuestions } from '../server/worker.js'

// sensenova 主干：Q6/Q10/Q13/Q14 漏抽（实测 4 题），Q11 丢负号
const SN = [
  { question_number: 1, student_answer: '5-2√6', answer: '', confidence: 0.9 },
  { question_number: 6, student_answer: '', answer: '', confidence: 0.9 },
  { question_number: 10, student_answer: '', answer: '', confidence: 0.9 },
  { question_number: 11, student_answer: '2√3', answer: '', confidence: 0.9 },
  { question_number: 13, student_answer: '', answer: '', confidence: 0.9 },
  { question_number: 14, student_answer: '', answer: '', confidence: 0.9 },
  { question_number: 15, student_answer: 'D', answer: '', confidence: 0.9 },
]
// 魔搭：抽得全，Q11 正确
const MS = [
  { question_number: 1, student_answer: '5 - 2√6', answer: '5 - 2√6', confidence: 0.9 },
  { question_number: 6, student_answer: '0.01', answer: '0.01', confidence: 0.9 },
  { question_number: 10, student_answer: '3', answer: '3', confidence: 0.9 },
  { question_number: 11, student_answer: '-2√3', answer: '-2√3', confidence: 0.9 },
  { question_number: 13, student_answer: '-3', answer: '-3', confidence: 0.9 },
  { question_number: 14, student_answer: '2/3', answer: '2/3', confidence: 0.9 },
  { question_number: 15, student_answer: 'D', answer: 'D', confidence: 0.9 },
]

test('补抽：主干漏抽的学生答案由另一路补上', () => {
  const { merged, filled } = mergeOcrQuestions(SN, MS)
  assert.equal(filled, 4, 'Q6/Q10/Q13/Q14 应被补抽')
  const byNo = Object.fromEntries(merged.map(q => [q.question_number, q]))
  assert.equal(byNo[6].student_answer, '0.01')
  assert.equal(byNo[10].student_answer, '3')
  assert.equal(byNo[13].student_answer, '-3')
  assert.equal(byNo[14].student_answer, '2/3')
})

test('分歧：两路不一致时置信度归零（转人工），且不擅自选边', () => {
  const { merged, conflicts, conflictDetails } = mergeOcrQuestions(SN, MS)
  assert.equal(conflicts, 1, '只有 Q11 分歧')
  assert.equal(conflictDetails[0].question_number, '11')
  const q11 = merged.find(q => q.question_number === 11)
  assert.equal(q11.confidence, 0, '分歧题置信度必须归零')
  assert.equal(q11.student_answer, '2√3', '保留主干原值，不擅自改成另一路的值')
})

test('一致题：不受影响，保留主干原值', () => {
  const { merged } = mergeOcrQuestions(SN, MS)
  const q1 = merged.find(q => q.question_number === 1)
  assert.equal(q1.student_answer, '5-2√6')
  assert.equal(q1.confidence, 0.9, '一致题不应被归零')
})

test('形态差异不算分歧（空白/全角负号归一后相同）', () => {
  // 主干 5-2√6 vs 另一路 5 - 2√6：仅空格差异，不应判为分歧
  const { conflicts } = mergeOcrQuestions(SN, MS)
  assert.equal(conflicts, 1, 'Q1 的空格差异不应计入分歧')
})

test('主干答案字段不被另一路的污染值带过来', () => {
  // 关键：魔搭 answer 全被污染（= 学生答案），合并后主干的 answer 必须保持洁净
  const { merged } = mergeOcrQuestions(SN, MS)
  for (const q of merged) {
    assert.equal(q.answer, '', `Q${q.question_number} 的 answer 不应被魔搭的污染值写入`)
  }
})

test('边界：题号缺失 / 空数组 / null 均不抛错', () => {
  assert.doesNotThrow(() => mergeOcrQuestions([], []))
  assert.doesNotThrow(() => mergeOcrQuestions(null, null))
  const { merged, filled, conflicts } = mergeOcrQuestions([{ student_answer: 'x' }], [{ student_answer: 'y' }])
  assert.equal(merged.length, 1)
  assert.equal(filled, 0, '无题号不参与补抽')
  assert.equal(conflicts, 0, '无题号不参与分歧检测')
})

test('边界：另一路该题未抽到时不覆盖主干已有值', () => {
  const primary = [{ question_number: 1, student_answer: '5', confidence: 0.9 }]
  const secondary = [{ question_number: 1, student_answer: '' }]
  const { merged, filled, conflicts } = mergeOcrQuestions(primary, secondary)
  assert.equal(merged[0].student_answer, '5')
  assert.equal(filled, 0)
  assert.equal(conflicts, 0)
})
