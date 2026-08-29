import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeStem,
  getQuestionIdentityKey,
  isSameWrongQuestion,
  dedupeWrongQuestions
} from '../src/domain/questionIdentity.js'

// ── 归一化必须吃掉的 OCR 格式噪声 ──

test('空白与 LaTeX 间距差异视为同一题', () => {
  assert.equal(
    normalizeStem('把下列各式因式分解：$a^2 - b^2$'),
    normalizeStem('把下列各式因式分解：$a^2-b^2$')
  )
  assert.equal(normalizeStem('计算 $a \\quad b$'), normalizeStem('计算 $ab$'))
})

test('全半角与句末标点差异视为同一题', () => {
  assert.equal(
    normalizeStem('如图，在△ABC中，AB=AC，∠A=40°，求∠B。'),
    normalizeStem('如图,在△ABC中,AB=AC,∠A=40°,求∠B')
  )
  assert.equal(normalizeStem('ＡＢＣ的面积'), normalizeStem('ABC的面积'))
  assert.equal(normalizeStem('计算 １２３'), normalizeStem('计算 123'))
})

test('填空下划线长度是 OCR 噪声', () => {
  assert.equal(normalizeStem('答案是 ____'), normalizeStem('答案是 ________'))
})

// ── 归一化绝不能吃掉的语义差异 ──
// 这几条是本次口径变更的核心：旧的 90% 相似度实现会把它们全部误合并，
// 导致变式题在错题本里塌成一条，并因取组内最高 lifecycle 而隐藏未掌握错题。

test('只改数字的变式题是不同的题', () => {
  assert.notEqual(normalizeStem('计算：$3x+5=20$，求 $x$'), normalizeStem('计算：$3x+5=26$，求 $x$'))
  assert.notEqual(normalizeStem('填空：$\\sqrt{16}=$'), normalizeStem('填空：$\\sqrt{25}=$'))
  assert.notEqual(normalizeStem('∠A=40°，求∠B'), normalizeStem('∠A=50°，求∠B'))
})

test('语义相反的题是不同的题', () => {
  assert.notEqual(normalizeStem('下面各数中，最小的数是（ ）'), normalizeStem('下面各数中，最大的数是（ ）'))
  assert.notEqual(normalizeStem('下列说法正确的是（ ）'), normalizeStem('下列说法错误的是（ ）'))
})

test('小数点承担语义，千分位逗号不承担', () => {
  assert.notEqual(normalizeStem('绳长1.5米'), normalizeStem('绳长15米'))
  assert.equal(normalizeStem('总人数1,000人'), normalizeStem('总人数1000人'))
})

// ── 身份键优先级：与后端去重键保持一致 ──

test('有 question_id 时按 question_id 定位', () => {
  assert.equal(getQuestionIdentityKey({ question_id: 'q1' }), 'qid:q1')
  // 题干不同但 question_id 相同 —— 仍是同一道题（后端唯一约束的口径）
  assert.equal(
    isSameWrongQuestion(
      { question_id: 'q1', question: { content: '甲' } },
      { question_id: 'q1', question: { content: '乙' } }
    ),
    true
  )
})

test('自包含错题按 worksheet + 页码 + 题号定位，不只看题号', () => {
  const a = { question_id: null, worksheet_id: 'w1', page_number: 1, question_no: 5, content: '甲' }
  const b = { question_id: null, worksheet_id: 'w1', page_number: 1, question_no: 5, content: '甲有OCR差异' }
  const samePageDiffNo = { question_id: null, worksheet_id: 'w1', page_number: 2, question_no: 5, content: '乙' }
  const diffWorksheet = { question_id: null, worksheet_id: 'w2', page_number: 1, question_no: 5, content: '丙' }
  assert.equal(isSameWrongQuestion(a, b), true)
  assert.equal(isSameWrongQuestion(a, samePageDiffNo), false)
  assert.equal(isSameWrongQuestion(a, diffWorksheet), false)
})

test('两个定位键都缺时回落到归一化题干', () => {
  assert.equal(getQuestionIdentityKey({ content: '题干甲。' }), getQuestionIdentityKey({ content: '题干甲' }))
})

test('无任何可定位信息的记录返回 null', () => {
  assert.equal(getQuestionIdentityKey({ content: '' }), null)
  assert.equal(getQuestionIdentityKey(null), null)
})

// ── 去重行为 ──

test('同一数据库行重复出现只算一条（分页重叠场景）', () => {
  const row = { id: 'r1', question_id: 'q1', error_count: 3, question: { content: '题' } }
  const result = dedupeWrongQuestions([row, { ...row }])
  assert.equal(result.length, 1)
  // 关键：不能把同一行的 error_count 累加成 6
  assert.equal(result[0].error_count, 3)
})

test('变式题不再塌陷为一条', () => {
  const variants = Array.from({ length: 20 }, (_, i) => ({
    id: 'g' + i,
    question_id: 'gq' + i,
    question: { content: `如图，在△ABC中，AB=AC，∠A=${30 + i}°，求∠B的度数。` }
  }))
  assert.equal(dedupeWrongQuestions(variants).length, 20)
})

test('缺少定位信息的记录被丢弃，不污染统计', () => {
  const result = dedupeWrongQuestions([
    { id: 'a', question_id: 'q1', question: { content: '题' } },
    { id: 'b', question_id: null, content: '' }
  ])
  assert.equal(result.length, 1)
})

test('保持入参顺序，排序交给调用方', () => {
  const result = dedupeWrongQuestions([
    { id: 'a', question_id: 'q2' },
    { id: 'b', question_id: 'q1' }
  ])
  assert.deepEqual(result.map(r => r.question_id), ['q2', 'q1'])
})

test('空输入与非数组输入返回空数组', () => {
  assert.deepEqual(dedupeWrongQuestions([]), [])
  assert.deepEqual(dedupeWrongQuestions(null), [])
  assert.deepEqual(dedupeWrongQuestions(undefined), [])
})
