import test from 'node:test'
import assert from 'node:assert/strict'
import { judgeAnswer, detectUnverifiableReference } from '../src/utils/answerJudge.js'

// 移动端离线兜底管线（useUploadFlow.processTask）用的是这份判题实现，
// 与后端 judgeService 是两套代码。判题域硬规则必须两端一致：
// 判不出来一律 null，绝不写 false，更不能写 true。

test('缺参考答案时判不出，绝不当成学生做对了', () => {
  // 原先这里直接返回 { isCorrect: true } —— 无从核对的题被记成正确，
  // 真错题从复核视野消失，掌握度还会被记上一次正确。
  assert.deepEqual(judgeAnswer('D', '', 'choice'), { isCorrect: null, unrecognized: true })
  assert.deepEqual(judgeAnswer('70', null, 'fill'), { isCorrect: null, unrecognized: true })
})

test('学生未作答时判不出', () => {
  assert.deepEqual(judgeAnswer('', 'C', 'choice'), { isCorrect: null, unrecognized: true })
  assert.deepEqual(judgeAnswer('未作答', 'C', 'choice'), { isCorrect: null, unrecognized: true })
})

test('参考答案无法核对时判不出，与后端同语义', () => {
  const cases = [
    '(1)证明略；(2)70°',
    '(1) 证明见解析；(2) FG = a - b',
    '略',
    '$\\frac{31}{15}$ (答案不唯一)'
  ]
  for (const answer of cases) {
    assert.equal(detectUnverifiableReference(answer), 'unverifiable_reference', answer)
    assert.equal(judgeAnswer('70°', answer, 'answer').isCorrect, null, answer)
  }
})

test('正常题目判定行为不变', () => {
  assert.equal(judgeAnswer('C', 'C', 'choice').isCorrect, true)
  assert.equal(judgeAnswer('B', 'C', 'choice').isCorrect, false)
  assert.equal(judgeAnswer('1/2', '0.5', 'fill').isCorrect, true)
  assert.equal(detectUnverifiableReference('70°'), null)
  assert.equal(detectUnverifiableReference('FG = a - b'), null)
})
