/**
 * 验证 pickAnswerUnit 三道防御在「OCR pageTitle 误识别 + 答案库多 unit」场景下的行为：
 * - 防御 1：pageTitle 不与任何 unit 匹配 → 置空 trustedPageTitle
 * - 防御 2：pageTitle 不可信 + chapterHint 含"实数" → 缩窄到含"实数"的 unit
 * - 防御 3：pageTitle 不可信 + bestKey 与 chapterHint 冲突 → 拒绝挂载
 * - 防御 3-2：pageTitle 不可信时把 60% 阈值提到 70%
 */
import { pickAnswerUnit } from '../worker.js'

// 构造一份真实形态的 3D Map
const answersByUnit = new Map()

function buildSample(unitKey, unitTitle) {
  // 第一题 1, 第二题 2... 简单 1-28 全覆盖
  const qMap = new Map()
  for (let i = 1; i <= 28; i++) {
    qMap.set(`${i}|`, { answer: `${i}-ans`, answer_type: 'fill', unit_key: unitKey, unit_title: unitTitle })
  }
  // 仿造 resource_answers 的 section 包装
  return new Map([['一、选择题', qMap]])
}
function makeUnit(unitKey, unitTitle) {
  return [unitKey, buildSample(unitKey, unitTitle)]
}
answersByUnit.set('试卷1|19.1', buildSample('试卷1|19.1', '试卷① 19.1 平方根与立方根 基础性测试'))
answersByUnit.set('试卷4|19.2', buildSample('试卷4|19.2', '试卷④ 19.2 实数 提高性测试'))
answersByUnit.set('试卷6|19.3', buildSample('试卷6|19.3', '试卷⑥ 19.3 近似数 基础性测试'))

// ── 场景 1：pageTitle="小初衔接"（OCR 误识别），题目 14-22 + 包含"实数"特征 ──
const questions1 = [
  { question_number: 14, content: '18. 4/5 - 17/20 + 1/4', student_answer: '= 1/5', question_type: 'fill' },
  { question_number: 15, content: '19. -3.5 的相反数是', student_answer: '3.5', question_type: 'fill' },
  { question_number: 18, content: '20. 2.3 绝对值', student_answer: '2.3', question_type: 'fill' },
  { question_number: 19, content: '21. 实数 a 在数轴上的位置', student_answer: '...', question_type: 'fill' },
  { question_number: 20, content: '22. 科学记数法', student_answer: '...', question_type: 'fill' },
]
const result1 = pickAnswerUnit(answersByUnit, '小初衔接', questions1, 5, '第十九章实数')
console.log('场景 1（pageTitle="小初衔接"）：', result1)
console.log('  期望: 试卷4|19.2（因 chapterHint=实数 + 实数特征 + 防御 1 把 pageTitle 置空）')

// ── 场景 2：pageTitle=正确的「试卷① 19.1 平方根与立方根 基础性测试」 ──
const result2 = pickAnswerUnit(answersByUnit, '试卷① 19.1 平方根与立方根 基础性测试', questions1, 5, null)
console.log('场景 2（pageTitle=正确小标题）：', result2)
console.log('  期望: 试卷1|19.1（精确匹配）')

// ── 场景 3：pageTitle=空 + chapterHint=null + 题目包含 √ ──
const questions3 = [
  { question_number: 5, content: '5. 化简 √12', student_answer: '2√3', question_type: 'fill' },
  { question_number: 6, content: '6. (√3+1)(√3-1)', student_answer: '2', question_type: 'fill' },
  { question_number: 7, content: '7. 二次根式运算', student_answer: '...', question_type: 'fill' },
]
const result3 = pickAnswerUnit(answersByUnit, null, questions3, 3, '第二十章二次根式')
console.log('场景 3（pageTitle=null + chapterHint=二次根式 + 含 √）：', result3)
console.log('  期望: null（因为候选里没有二次根式单元，应拒绝挂载）')

console.log('\n✅ 验证完成')
