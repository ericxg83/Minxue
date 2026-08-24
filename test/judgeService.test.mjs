import test from 'node:test'
import assert from 'node:assert/strict'
import { judgeAnswer, normalizeChoiceAnswer, normalizeQuestionType } from '../server/services/judgeService.js'

test('normalizes explicit choice answer variants globally', () => {
  assert.equal(normalizeChoiceAnswer('D'), 'D')
  assert.equal(normalizeChoiceAnswer('(D)'), 'D')
  assert.equal(normalizeChoiceAnswer(String.fromCharCode(0xFF08, 0x9009, 0x20, 0x44, 0xFF09)), 'D')
  assert.equal(normalizeChoiceAnswer(String.fromCharCode(0x7B54, 0x6848, 0x4E3A) + ':d.'), 'D')
  assert.equal(normalizeQuestionType(String.fromCharCode(0x9009, 0x62E9, 0x9898)), 'choice')
  assert.equal(normalizeQuestionType(String.fromCharCode(0x5355, 0x9009, 0x9898)), 'choice')
  assert.equal(normalizeChoiceAnswer('2D'), '')
  assert.equal(normalizeChoiceAnswer('xD'), '')
})

test('does not misjudge a correct option when question type is wrong', () => {
  assert.deepEqual(judgeAnswer('D', 'D', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('(D)', 'D', 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer(String.fromCharCode(0x9009) + 'D', 'D', 'unknown'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('B', 'D', 'fill'), { isCorrect: false, unrecognized: false })
})

test('keeps existing mathematical equivalence behavior', () => {
  assert.deepEqual(judgeAnswer('1/2', '0.5', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer(String.fromCharCode(0x221A) + '4', '2', 'answer'), { isCorrect: true, unrecognized: false })
})
