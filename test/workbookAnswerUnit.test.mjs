import test from 'node:test'
import assert from 'node:assert/strict'
import { pickAnswerUnit } from '../server/worker.js'

/**
 * 练习册答案单元匹配：新增的「正文小标题（section_title）」锚点。
 *
 * 事故背景：练习册页眉印的是全书通用的书名跑马灯（"新闵学校"成长·桥"练习 第01周"），
 * OCR 提示词要求 page_title 只读页眉 → 该值对不上任何 unit → 整页答案挂空。
 * 实测 3 份卷 32 题全部 pending，占老师被强制逐题点击的 70%。
 *
 * 设计约束：section_title 只在通过「与某个 unit 的 title/key 可互相包含」这一自检时才顶替
 * pageTitle，否则完全不改 pageTitle —— 拿不准就退化成改动前的行为，不放宽任何判据。
 */

const mkUnit = (unitKey, unitTitle) => {
  const qmap = new Map()
  for (const n of [1, 2, 3]) {
    qmap.set(`Q${n}`, {
      unit_key: unitKey,
      unit_title: unitTitle,
      answer: `${unitKey}-${n}`,
      question_no: n,
    })
  }
  return new Map([['s1', qmap]])
}

const twoUnits = () => new Map([
  ['27.2(2)', mkUnit('27.2(2)', '27.2（2）二次函数的图像与性质（2）')],
  ['27.4(2)', mkUnit('27.4(2)', '27.4（2）二次函数与一元二次方程（2）')],
])

// 题干刻意不含课时号，避免 lesson_code 通道抢先命中，隔离本次改动
const questions = [{ question_number: 1, content: '抛物线的开口方向与顶点坐标', student_answer: 'A' }]

const HEADER = '新闵学校“成长·桥”练习 第01周'
const SECTION = '27.4（2）二次函数与一元二次方程（2）'

test('页眉只读到书名时，正文小标题能把单元定位出来', () => {
  const abu = twoUnits()
  assert.equal(
    pickAnswerUnit(abu, HEADER, questions, 1, null, null),
    null,
    '只有页眉书名时应定位不到单元（复现事故现场）')
  assert.equal(
    pickAnswerUnit(abu, HEADER, questions, 1, null, SECTION),
    '27.4(2)',
    '给了正文小标题后应能定位到正确单元')
})

test('正文小标题不可信时不采用，结果与完全不传它一致', () => {
  const abu = twoUnits()
  const baseline = pickAnswerUnit(abu, HEADER, questions, 1, null, null)
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, '一、选择题'), baseline)
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, '数学'), baseline)
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, ''), baseline)
})

test('页眉本身就是课时小标题时仍按原路径匹配（回归）', () => {
  const abu = twoUnits()
  assert.equal(pickAnswerUnit(abu, SECTION, questions, 1, null, null), '27.4(2)')
})

test('正文小标题与页眉一致时不改变结果', () => {
  const abu = twoUnits()
  const a = pickAnswerUnit(abu, SECTION, questions, 1, null, null)
  const b = pickAnswerUnit(abu, SECTION, questions, 1, null, SECTION)
  assert.equal(b, a)
})

test('单单元练习册直接返回该单元（不受新参数影响）', () => {
  const abu = new Map([['only', mkUnit('only', '27.4（2）二次函数与一元二次方程（2）')]])
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, null), 'only')
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, SECTION), 'only')
})

// ─────────────────────────────────────────────────────────────
// 编号严格通道：实测该页 OCR 读出的正是下面这种"编号与副标题矛盾"的小标题。
// 答案库：27.3(1)＝已知图像上【三点】、27.3(2)＝已知图像上【两点】。
// OCR 输出："27.3（2）已知图像上三点求二次函数的表达式"（编号 (2) + 副标题"三点"）。
// 整串模糊匹配必在 (1)/(2) 之间打平 → 放弃，因此必须让编号当硬锚点。
// 实测（真实页图 + 真实答案库单元清单）：改动前 null → 改动后 27.3(2)。
// ─────────────────────────────────────────────────────────────
const contradictionUnits = () => new Map([
  ['27.3(1)', mkUnit('27.3(1)', '27.3(1)已知图像上三点求二次函数的表达式')],
  ['27.3(2)', mkUnit('27.3(2)', '27.3(2)已知图像上两点求二次函数的表达式')],
])

test('小标题的课时编号与副标题矛盾时，以编号为准定位', () => {
  const abu = contradictionUnits()
  // 编号 (2) + 副标题"三点"（属 (1)）→ 模糊匹配会打平，编号唯一决定归属
  assert.equal(
    pickAnswerUnit(abu, HEADER, questions, 1, null, '27.3（2）已知图像上三点求二次函数的表达式'),
    '27.3(2)')
  // 编号 (1) + 副标题"三点"（自洽）→ 同样以编号为准
  assert.equal(
    pickAnswerUnit(abu, HEADER, questions, 1, null, '27.3（1）已知图像上三点求二次函数的表达式'),
    '27.3(1)')
  // 全角/半角括号都要能归一
  assert.equal(
    pickAnswerUnit(abu, HEADER, questions, 1, null, '27.3(2)已知图像上两点求二次函数的表达式'),
    '27.3(2)')
})

test('编号在答案库里不存在时不得乱命中', () => {
  const abu = contradictionUnits()
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, '99.9（1）不存在的课时小标题'), null)
  // 只给章节号（无小节号），库里是 27.3(1)/(2)，不得含糊命中
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, '第27章 二次函数'), null)
})
