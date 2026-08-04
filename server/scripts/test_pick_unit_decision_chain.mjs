/**
 * 验证 pickAnswerUnit 决策链重排（2026-08）：
 *   1. 标题匹配 (pageTitle+chapterHint+lessonHint+内容特征)
 *   2. 学生答案反推（按题粒度，searchUnitByStudentAnswers）
 *   3. 答案覆盖率兜底（整页学生答案 vs 整本标准答案，≥60% + ≥3题）
 *   4. 页码范围兜底（依赖答案 PDF 元数据）
 *   5. 调用方做的相邻页继承（不在 pickAnswerUnit 内部）
 *
 * 题号覆盖率已完全移除（纯数字信号跨章错挂风险高）。
 */
import { pickAnswerUnit } from '../worker.js'

// ── 构造 3D Map（unitKey → section → qNo|subNo → row）──
// 关键：每个 unit 的题号都是从 1 开始（这是错挂的根源场景）
function makeUnitMap(unitKey, unitTitle, answerMap) {
  const qMap = new Map()
  for (const [qNo, answerData] of Object.entries(answerMap)) {
    qMap.set(`${qNo}|`, {
      standard_answer: answerData.ans,
      answer_type: answerData.type || 'fill',
      unit_key: unitKey,
      unit_title: unitTitle,
      answer_page_start: answerData.answer_page_start,
      answer_page_end: answerData.answer_page_end,
    })
  }
  return new Map([['一、填空题', qMap]])
}

const answersByUnit = new Map()
// 试卷1: 19.1 平方根与立方根 —— 题号 1-25，答案都是 √运算，pageStart/pageEnd=[1,2]
answersByUnit.set('试卷1|19.1', makeUnitMap('试卷1|19.1', '试卷① 19.1 平方根与立方根 基础性测试', {
  1: { ans: '√2', answer_page_start: 1, answer_page_end: 2 },
  2: { ans: '√3', answer_page_start: 1, answer_page_end: 2 },
  3: { ans: '2', answer_page_start: 1, answer_page_end: 2 },
  4: { ans: '5', answer_page_start: 1, answer_page_end: 2 },
  14: { ans: '(1) 5/48=15/144', answer_page_start: 1, answer_page_end: 2 },
  15: { ans: '3.5', answer_page_start: 1, answer_page_end: 2 },
  18: { ans: '2.3', answer_page_start: 1, answer_page_end: 2 },
  20: { ans: '4', answer_page_start: 1, answer_page_end: 2 },
  22: { ans: '5', answer_page_start: 1, answer_page_end: 2 },
  25: { ans: '8', answer_page_start: 1, answer_page_end: 2 },
}))
// 试卷4: 19.2 实数 —— 题号 1-22，答案都是 实数/绝对值/相反数，pageStart/pageEnd=[3,4]
answersByUnit.set('试卷4|19.2', makeUnitMap('试卷4|19.2', '试卷④ 19.2 实数 提高性测试', {
  14: { ans: '1/5', answer_page_start: 3, answer_page_end: 4 },
  15: { ans: '3.5', answer_page_start: 3, answer_page_end: 4 },
  18: { ans: '2.3', answer_page_start: 3, answer_page_end: 4 },
  20: { ans: '4', answer_page_start: 3, answer_page_end: 4 },
  22: { ans: '5', answer_page_start: 3, answer_page_end: 4 },
  11: { ans: '0', answer_page_start: 3, answer_page_end: 4 },
  12: { ans: '-7', answer_page_start: 3, answer_page_end: 4 },
  1: { ans: '0.5', answer_page_start: 3, answer_page_end: 4 },
  2: { ans: '-3', answer_page_start: 3, answer_page_end: 4 },
  3: { ans: 'π', answer_page_start: 3, answer_page_end: 4 },
}))
// 试卷6: 19.3 近似数 —— 题号 1-15，pageStart/pageEnd=[5,6]
answersByUnit.set('试卷6|19.3', makeUnitMap('试卷6|19.3', '试卷⑥ 19.3 近似数 基础性测试', {
  1: { ans: '3.14', answer_page_start: 5, answer_page_end: 6 },
  2: { ans: '2.7', answer_page_start: 5, answer_page_end: 6 },
  3: { ans: '5.21', answer_page_start: 5, answer_page_end: 6 },
}))

console.log('=== 决策链回归测试（题号覆盖率已移除，改为答案覆盖率）===\n')

// ── 场景 1：用户截图真实场景 ──
// pageTitle="小初衔接" (OCR 误识别，trustedPageTitle 被置空) +
// 学生答案含 0.5/-3/π 强匹配 试卷4|19.2（实数）
// 期望：走"学生答案反推" → 试卷4|19.2（不再错挂到 试卷1|19.1）
const questions1 = [
  { question_number: 1, content: '1. 算术平方根', student_answer: '0.5', question_type: 'fill' },
  { question_number: 2, content: '2. 相反数', student_answer: '-3', question_type: 'fill' },
  { question_number: 3, content: '3. 无理数', student_answer: 'π', question_type: 'fill' },
  { question_number: 11, content: '11. 绝对值', student_answer: '0', question_type: 'fill' },
  { question_number: 12, content: '12. 相反数', student_answer: '-7', question_type: 'fill' },
]
const r1 = pickAnswerUnit(answersByUnit, '小初衔接', questions1, 5, null)
console.log('场景 1（pageTitle=小初衔接 + 学生答案含实数特征）:')
console.log('  实际:', r1)
console.log('  期望: 试卷4|19.2\n')

// ── 场景 2：pageTitle 正确（试卷小标题）──
// 期望：标题匹配直接命中 试卷1|19.1
const r2 = pickAnswerUnit(answersByUnit, '试卷① 19.1 平方根与立方根 基础性测试', questions1, 5, null)
console.log('场景 2（pageTitle=试卷①小标题）:')
console.log('  实际:', r2)
console.log('  期望: 试卷1|19.1\n')

// ── 场景 3：pageTitle=null + chapterHint="第十九章实数" ──
// 期望：chapterHint 关键词缩窄 → 学生答案反推 → 试卷4|19.2
const r3 = pickAnswerUnit(answersByUnit, null, questions1, 5, '第十九章实数')
console.log('场景 3（pageTitle=null + chapterHint=第十九章实数）:')
console.log('  实际:', r3)
console.log('  期望: 试卷4|19.2\n')

// ── 场景 4：答案覆盖率兜底 ──
// 标题匹配失败 + 学生答案反推失败 + 整页学生答案都在 试卷4|19.2 答案库
// 构造：3 道题，答案 √2/√3/2 都不在 试卷4/6 答案库（应在 试卷1）
// 但答案 0.5/-3/π 都在 试卷4 答案库 → 答案覆盖率兜底命中 试卷4|19.2
const questions4 = [
  { question_number: 1, content: '某题1', student_answer: '0.5', question_type: 'fill' },
  { question_number: 2, content: '某题2', student_answer: '-3', question_type: 'fill' },
  { question_number: 3, content: '某题3', student_answer: 'π', question_type: 'fill' },
  // 无 pageTitle 触发 pageTitle 自检置空，chapterHint=null 触发"无信号"场景
]
const r4 = pickAnswerUnit(answersByUnit, null, questions4, 7, null)
console.log('场景 4（无 pageTitle/chapterHint，整页学生答案覆盖 试卷4|19.2 整本答案）:')
console.log('  实际:', r4)
console.log('  期望: 试卷4|19.2（答案覆盖率 3/3 = 100% ≥ 60% 且 ≥ 3）\n')

// ── 场景 5：学生答案 < 3 道不准走答案覆盖率 ──
// 期望：返回 null（学生答案太少，宁可让数据走"待审"也不强行挂载）
const questions5 = [
  { question_number: 1, content: '某题1', student_answer: '0.5', question_type: 'fill' },
  { question_number: 2, content: '某题2', student_answer: '-3', question_type: 'fill' },
]
const r5 = pickAnswerUnit(answersByUnit, null, questions5, 7, null)
console.log('场景 5（仅 2 道非选择题，无 pageTitle/chapterHint）:')
console.log('  实际:', r5)
console.log('  期望: null（学生答案 < 3，拒绝答案覆盖率兜底）\n')

// ── 场景 6：选择题 + 页码范围兜底 ──
// 6 道选择题，pageNumber 落在 试卷4|19.2 [3,4] 区间
// 期望：标题匹配失败 → 学生答案反推跳过选择题 → 答案覆盖率跳过选择题 →
//      页码范围兜底命中 试卷4|19.2
const questions6 = [
  { question_number: 1, question_type: 'choice', student_answer: 'A' },
  { question_number: 2, question_type: 'choice', student_answer: 'B' },
  { question_number: 3, question_type: 'choice', student_answer: 'C' },
  { question_number: 4, question_type: 'choice', student_answer: 'D' },
  { question_number: 5, question_type: 'choice', student_answer: 'A' },
  { question_number: 6, question_type: 'choice', student_answer: 'B' },
]
const r6 = pickAnswerUnit(answersByUnit, null, questions6, 4, null)
console.log('场景 6（6 道选择题，pageNumber=4 落在 试卷4|19.2 [3,4]）:')
console.log('  实际:', r6)
console.log('  期望: 试卷4|19.2（页码范围兜底 + 答案覆盖率≥30%）\n')

// ── 场景 7：旧 bug 回归：pageTitle 不可信 + 题号跨章错挂 ──
// 关键回归：之前 pageTitle="小初衔接" + 题目 14-22（题号范围 1-28 都覆盖）会被题号覆盖率
// 错挂到 试卷1|19.1（题号最广）。新策略下，题号覆盖率已完全移除，决策链按
// 标题→学生答案→答案覆盖率→页码范围 走，答案反推成功时直接命中 试卷4|19.2。
const questions7 = [
  { question_number: 14, content: '18. 4/5 - 17/20', student_answer: '1/5', question_type: 'fill' },
  { question_number: 15, content: '19. -3.5 相反数', student_answer: '3.5', question_type: 'fill' },
  { question_number: 18, content: '20. 2.3 绝对值', student_answer: '2.3', question_type: 'fill' },
  { question_number: 20, content: '22. 科学记数法', student_answer: '4', question_type: 'fill' },
  { question_number: 22, content: '24. 平方根', student_answer: '5', question_type: 'fill' },
]
const r7 = pickAnswerUnit(answersByUnit, '小初衔接', questions7, 5, null)
console.log('场景 7（旧 bug 回归：题号 14-22 + pageTitle 不可信）:')
console.log('  实际:', r7)
console.log('  期望: 试卷4|19.2（题号覆盖率已移除，不再错挂到 试卷1|19.1）\n')

console.log('=== 决策链验证完成 ===')
