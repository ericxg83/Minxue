// 回归测试：答案册解析器必须认出「编号内夹空白/全角句点」的课时标题行
//
// 事故背景（2026-09-15《九上上海作业答案》）：
//   PDF 第 3 页中部印着单元标题「27.2(3) 形如 y=a(x+m)² 的二次函数的图像与性质」，
//   其下就是该单元题 1~12 的答案。但 OCR 把编号读成 "27. 2(3)" / "27．2(3)" 这类形态，
//   而编号正则要求"点后紧跟数字" → 整行匹配不上 parseUnitHeader →
//   退化成「题号 27 的答案」（库里实存：question_no=27,
//   answer='2(3) 形如 y=a(x+m)² 的二次函数的图像与性质'）。
//   后果：整个 27.2(3) 单元被并进上一个单元 27.2(2)，两课时题号都从 1 开始
//   → 同号互相覆盖 → 连锚定本来正确的 27.2(2) 卷也被误判，
//     学生答对（A / D / 2,1）却被判错，老师被迫逐题手动改判。
//
// 本测试锁定两件事：
//   ① 编号内的空白与全角句点必须被容忍（归一化后仍能得到 27.2(3)）；
//   ② 放宽之后不得把普通答案行误判成单元标题。
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseUnitHeader, parseAnswerText, normLesson } from '../server/services/answerParseService.js'

test('课时标题行：常规形态', () => {
  const r = parseUnitHeader('27.2(3) 形如 y=a(x+m)² 的二次函数的图像与性质')
  assert.equal(r?.unit_key, '27.2(3)')
  assert.equal(r?.lesson_code, '27.2(3)')
})

test('课时标题行：编号内夹空白 / 全角句点（本次事故的真实形态）', () => {
  const variants = [
    '27. 2(3) 形如 y=a(x+m)² 的二次函数的图像与性质',
    '27 . 2(3) 形如 y=a(x+m)² 的二次函数的图像与性质',
    '27．2(3) 形如 y=a(x+m)² 的二次函数的图像与性质',
    '27.2（3） 形如 y=a(x+m)² 的二次函数的图像与性质',
    '27.2(3)形如y=a(x+m)²的二次函数的图像与性质',
    '27.2 (3) 形如 y=a(x+m)² 的二次函数的图像与性质',
  ]
  for (const v of variants) {
    const r = parseUnitHeader(v)
    assert.equal(r?.unit_key, '27.2(3)',
      `形态 ${JSON.stringify(v)} 必须归一到 27.2(3)，否则该单元会被并进上一单元`)
  }
})

test('normLesson 必须压空白并把全角括号/句点转半角', () => {
  assert.equal(normLesson('27. 2（3）'), '27.2(3)')
  assert.equal(normLesson('27．2(3)'), '27.2(3)')
  assert.equal(normLesson(' 19.1(1) '), '19.1(1)')
})

test('其它课时编号形态（回归：不要因为放宽而破坏）', () => {
  assert.equal(parseUnitHeader('19.1(1) 算术平方根')?.unit_key, '19.1(1)')
  assert.equal(parseUnitHeader('27.4(1) 二次函数与一元二次方程(1)')?.unit_key, '27.4(1)')
  assert.equal(parseUnitHeader('27.2(2) 形如y=ax²+h 的二次函数的图像与性质')?.unit_key, '27.2(2)')
})

test('普通答案行不得被误判成单元标题', () => {
  const notTitles = [
    '1. C',
    '2. B',
    '3. 2, 1',
    '5. D',
    '4. 解：易知抛物线 y=(x-2)² 的顶点 C 的坐标为 (2,0).',
    '9. -1 或 -6  解析：∵二次函数 y=-(x+h)² 的图像开口向下',
    '的二次函数的图像与性质',
    '2(3) 形如 y=a(x+m)² 的二次函数的图像与性质',
    '一、选择题',
  ]
  for (const s of notTitles) {
    assert.equal(parseUnitHeader(s), null, `${JSON.stringify(s)} 不应被当成单元标题`)
  }
})

test('端到端：变形标题行之后的行必须归属到该单元，而不是降级成"题号 27 的答案"', () => {
  const text = [
    '27．2(3) 形如 y=a(x+m)² 的二次函数的图像与性质',
    '1. C',
    '2. B',
    '3. y=1/2(x-2)²',
  ].join('\n')
  const { answers } = parseAnswerText(text)
  assert.equal(answers.length, 3, '标题行不得进入答案列表')
  for (const a of answers) {
    assert.equal(a.unit_key, '27.2(3)', '所有答案都应归属 27.2(3)')
  }
  assert.deepEqual(answers.map(a => String(a.question_no)), ['1', '2', '3'])
  assert.ok(!answers.some(a => String(a.question_no) === '27'),
    '绝不能再出现"题号 27"这种把单元标题当答案的记录')
})
