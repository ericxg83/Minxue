import test from 'node:test'
import assert from 'node:assert/strict'
import { judgeAnswer, detectUnverifiableReference } from '../server/services/judgeService.js'

// 判题域硬规则：判不出来一律 null，绝不写 false，更不能写 true。
//
// r103 前本锁守的是移动端离线判题副本（src/utils/answerJudge.js，唯一消费者是
// useUploadFlow.processTask 的前端直调识别）。r103 随「前端直调 AI 整体删除」
// （负责人裁决⑧）该副本退役，本锁迁移到**权威实现** server/services/judgeService.js
// —— 服务端精简管线（processSlimGrading）与通用管线都走它，语义不许漂移。

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

test('参考答案无法核对时判不出（略/证明见解析/答案不唯一）', () => {
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
