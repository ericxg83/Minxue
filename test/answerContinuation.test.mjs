// 回归测试：练习册答案解析的「多行续行归并 + 子题拆分」
//
// 背景（2026-09-10）：九上上海作业答案 PDF（27.1 单元）的解答题答案是「首行 + (2)/(3) 等续行」版式：
//   4. 解：(1)由 y=3(x-1)²+2，得 y=3x²-6x+5。
//   (2)由题意，将 x=6 代入 y=3x²-6x+5，
//   得 y=3×6²-6×6+5=77，即 y=77。
// 旧逻辑逐行解析时，(2)/(3) 续行不以题号开头、不匹配任何模式被直接丢弃，
// 导致 q4/q9/q10 只入库首行答案、sub_no 为空。
//
// 修复：续行归并到上一题整题答案（同 unit_key + 同 section 锚点），
// 归并后再统一做 (1)(2)(3) 子题拆分。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAnswerText, splitSubAnswers } from '../server/services/answerParseService.js'

const SAMPLE = `参考答案
27.1 二次函数的概念
1. C
2. B
3. -2
4. 解：(1)由 y=3(x-1)²+2，得 y=3x²-6x+5。
(2)由题意，将 x=6 代入 y=3x²-6x+5，
得 y=3×6²-6×6+5=77，即 y=77。
5. B
6. (1)-5 (2)a≠-5 且 a≠2
7. y=-1/2x²+10x
8. 解：依题意，把两条小路分别进行平移，
∴y=(80-x)(60-x)=x²-140x+4800。
9. 解：(1)∵矩形的周长为20cm，它的一边长为a cm，
∴另一边长为(10-a)cm，
∴S=a(10-a)=-a²+10a，S是a的二次函数。
∵{a>0, 10-a>0}，∴0<a<10。
(2)由题意得 S=4×1/2x+10x²，
即 S=2x+10x²，S是x的二次函数。
∵{x>0, 4x<4}，∴0<x<1。
10. 解：(1)①30+x ②10x 200x ③(1000=10x)
(2)根据题意可得 y₁=(1000-10x)(30+x)+200x=-10x²+900x+30000。
(3)根据题意可得 y₂=y₁-30000-400x=-10x²+500x。
11. 解：任务1：区块Ⅰ的面积=1/2x²；
区块Ⅲ的面积=20×20-1/2x²-(-10x+200)=-1/2x²+10x+200。
28. 1/2
29. 解：(1)x>0 (2)y<0
30. 解：(x+1)(x-2)=0，x=2 或 x=-1。
`

function parseOnly(text) {
  const lc = []
  const r = parseAnswerText(text, lc, null, 1)
  return { answers: r.answers, lowConfidence: lc }
}

test('多行续行归并：q4 两条 (1)(2) 小问完整入库且 sub_no 正确', () => {
  const { answers } = parseOnly(SAMPLE)
  const q4 = answers.filter(a => a.question_no === 4 && a.unit_key === '27.1')
  assert.equal(q4.length, 2)
  assert.equal(q4[0].sub_no, '1')
  assert.equal(q4[1].sub_no, '2')
  assert.ok(q4[0].answer.includes('y=3x²-6x+5'))
  assert.ok(!q4[0].answer.includes('y=77'))
  assert.ok(q4[1].answer.includes('y=77'))
  assert.ok(q4[1].answer.includes('y=3×6²-6×6+5=77'))
})

test('多行续行归并：q9 两个小问完整，sub(2) 包含跨 3 行的末尾结论', () => {
  const { answers } = parseOnly(SAMPLE)
  const q9 = answers.filter(a => a.question_no === 9 && a.unit_key === '27.1')
  assert.equal(q9.length, 2)
  assert.equal(q9[0].sub_no, '1')
  assert.equal(q9[1].sub_no, '2')
  assert.ok(q9[0].answer.includes('S=a(10-a)=-a²+10a'))
  assert.ok(q9[0].answer.includes('0<a<10'))
  assert.ok(q9[1].answer.includes('S=2x+10x²'))
  assert.ok(q9[1].answer.includes('0<x<1'))
})

test('三小问拆分：q10 拆出 sub 1/2/3，且 (2)(3) 续行内容完整', () => {
  const { answers } = parseOnly(SAMPLE)
  const q10 = answers.filter(a => a.question_no === 10 && a.unit_key === '27.1')
  assert.equal(q10.length, 3)
  assert.deepEqual(q10.map(a => a.sub_no), ['1', '2', '3'])
  assert.ok(q10[1].answer.includes('y₁=(1000-10x)'))
  assert.ok(q10[2].answer.includes('y₂=y₁-30000-400x'))
})

test('多行解答完整归并为一整行（无 (1)(2) 标记时 sub_no 为空）', () => {
  const { answers } = parseOnly(SAMPLE)
  const q8 = answers.filter(a => a.question_no === 8 && a.unit_key === '27.1')
  assert.equal(q8.length, 1)
  assert.equal(q8[0].sub_no, '')
  assert.ok(q8[0].answer.includes('把两条小路分别进行平移'))
  assert.ok(q8[0].answer.includes('x²-140x+4800'))
})

test('长段解答子题（>80 字）仍可被拆分', () => {
  const long = '解：(1)∵矩形的周长为20cm，它的一边长为a cm， ∴另一边长为(10-a)cm， ∴S=a(10-a)=-a²+10a，S是a的二次函数。 ∵{a>0, 10-a>0}，∴0<a<10。 (2)由题意得 S=4×1/2x+10x²， 即 S=2x+10x²，S是x的二次函数。 ∵{x>0, 4x<4}，∴0<x<1。'
  const segs = splitSubAnswers(long)
  assert.ok(segs)
  assert.equal(segs.length, 2)
  assert.ok(segs[0].answer.length > 80, '第一段因归并可合法超过 80 字')
  assert.ok(segs[1].answer.includes('0<x<1'))
})

test('普通括号不误拆：(x+1)(x-2) 不是子题', () => {
  const { answers } = parseOnly(SAMPLE)
  const q30 = answers.filter(a => a.question_no === 30 && a.unit_key === '27.1')
  assert.equal(q30.length, 1)
  assert.equal(q30[0].sub_no, '')
  assert.ok(q30[0].answer.includes('(x+1)(x-2)'))
  assert.ok(q30[0].answer.includes('x=-1'))
})

test('选择、判断、简洁答案不受影响', () => {
  const { answers } = parseOnly(SAMPLE)
  const q1 = answers.find(a => a.question_no === 1 && a.unit_key === '27.1')
  assert.ok(q1 && q1.answer_type === 'choice' && q1.answer === 'C')
  const q28 = answers.find(a => a.question_no === 28 && a.unit_key === '27.1')
  assert.ok(q28 && q28.answer_type === 'answer' && q28.answer === '1/2')
  // 简单分数 1/2 不应被误拆
  assert.equal(q28.sub_no, '')
  // 单行 小问 (1)(2) 仍能正常拆分（旧内联拆分行为保持）
  const q29 = answers.filter(a => a.question_no === 29 && a.unit_key === '27.1')
  assert.equal(q29.length, 2)
  assert.equal(q29[0].sub_no, '1')
  assert.equal(q29[1].sub_no, '2')
})