import { judgeAnswer, extractChoiceLetters } from '../services/judgeService.js'

// 线上事故：答案库里的选择题参考答案带着选项内容和 markdown 残留
// （任务 432a661d 第 5 题 answer = "A（21/2）**"），学生写 A 却被判错。
const judgeCases = [
  ['脏参考答案(字母+选项内容+markdown)', 'A', 'A（21/2）**', 'choice', true],
  ['脏参考答案 学生选错', 'B', 'A（21/2）**', 'choice', false],
  ['脏参考答案(括号字母+内容)', 'D', '(D) 2√5/5', 'choice', true],
  ['脏参考答案(括号字母+内容) 学生选错', 'C', '(D) 2√5/5', 'choice', false],
  ['markdown 包裹单字母', 'A', '**A**', 'choice', true],
  ['markdown 包裹多选字母', 'AB', '**AB**', 'choice', true],
  ['中文前缀+脏内容', 'A', '答案：A（21/2）', 'choice', true],
  ['干净字母(回归)', 'C', 'C', 'choice', true],
  ['干净字母选错(回归)', 'B', 'D', 'choice', false],
  ['学生答案带括号(回归)', '(C)', 'C', 'choice', true],
  ['学生只写选项内容 无字母可比', '21/2', 'A（21/2）**', 'choice', false],
  ['填空题不受影响: 前缀参考答案', '8', 'AC = 8', 'fill', true],
  ['填空题不受影响: 数值等价', '3/2', '1.5', 'fill', true],
  ['填空题不受影响: 分数颠倒判错', '4/3', '3/4', 'fill', false],
  // AI 现场生成的答案（答案库没命中时）是整句话，形态和答案库的脏答案不同
  ['AI 生成答案: 选项 C', 'C', '选项 C', 'choice', true],
  ['AI 生成答案: 选项 C 学生选错', 'A', '选项 C', 'choice', false],
  ['AI 生成答案: 为选项D', 'D', '为选项D', 'choice', true],
  ['AI 生成答案: 字母在句尾括号里', 'B', 'sin∠CAB = 3/5，选(B)', 'choice', true],
  ['AI 生成答案: 字母+单位', 'A', '(A) 12米', 'choice', true],
  ['AI 生成答案: 字母+单位 学生选错', 'C', '(A) 12米', 'choice', false],
  ['AI 生成答案: 正确答案是 B', 'B', '正确答案是 B', 'choice', true],
  ['AI 生成答案: 故选 C 项', 'C', '故选 C 项', 'choice', true],
  ['填空题整句参考答案不受影响', '3/4', '底角的余弦值等于 3/4 或 1/3', 'fill', true],
  ['填空题带前缀参考答案不受影响', '5/12', '为 5/12', 'fill', true],
]

// "AC = 8" 这类填空答案绝不能被当成选项 A+C
const extractCases = [
  ['A（21/2）**', 'A'],
  ['(D) 2√5/5', 'D'],
  ['**AB**', 'AB'],
  ['答案：C（3/4）', 'C'],
  ['选项 C', 'C'],
  ['为选项D', 'D'],
  ['sin∠CAB = 3/5，选(B)', 'B'],
  ['D', 'D'],
  ['AC = 8', ''],
  ['BC = 15', ''],
  ['tanB = √3/4', ''],
  ['为 5/12', ''],
  ['√', ''],
  ['', ''],
  [null, ''],
]

let pass = 0
let fail = 0

for (const [name, student, ref, type, expect] of judgeCases) {
  const got = judgeAnswer(student, ref, type).isCorrect
  if (got === expect) { pass++; console.log(`✅ ${name}`) }
  else { fail++; console.log(`❌ ${name}: student=${JSON.stringify(student)} ref=${JSON.stringify(ref)} 期望 ${expect}，实际 ${got}`) }
}

for (const [raw, expect] of extractCases) {
  const got = extractChoiceLetters(raw)
  if (got === expect) { pass++; console.log(`✅ extractChoiceLetters(${JSON.stringify(raw)}) → ${JSON.stringify(got)}`) }
  else { fail++; console.log(`❌ extractChoiceLetters(${JSON.stringify(raw)}) 期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(got)}`) }
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
