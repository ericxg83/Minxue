import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeManualMark, resolveGradingResult } from '../server/worker.js'

test('conflicting teacher annotation sends a question to manual review', () => {
  const result = resolveGradingResult({
    studentAnswer: 'D',
    answer: 'D',
    questionType: 'choice',
    manualMark: 'wrong'
  })

  assert.deepEqual(result, {
    isCorrect: null,
    source: 'annotation_conflict_review',
    manualMark: 'wrong'
  })
})

test('conflicting legacy checkmark sends a question to manual review', () => {
  assert.equal(normalizeManualMark(null, true), 'correct')
  assert.deepEqual(resolveGradingResult({
    studentAnswer: 'D',
    answer: 'C',
    questionType: 'choice',
    manualMark: 'correct'
  }), {
    isCorrect: null,
    source: 'annotation_conflict_review',
    manualMark: 'correct'
  })
})

test('conflicting partial annotation sends a question to manual review', () => {
  assert.deepEqual(resolveGradingResult({
    studentAnswer: 'D',
    answer: 'D',
    questionType: 'choice',
    manualMark: 'partial'
  }), {
    isCorrect: null,
    source: 'annotation_conflict_review',
    manualMark: 'partial'
  })
})

test('no annotation keeps deterministic answer comparison', () => {
  assert.deepEqual(resolveGradingResult({
    studentAnswer: 'D',
    answer: 'C',
    questionType: 'choice',
    manualMark: 'none'
  }), {
    isCorrect: false,
    source: 'answer_comparison',
    manualMark: 'none'
  })
})
test('matching teacher annotation does not bypass deterministic comparison', () => {
  assert.deepEqual(resolveGradingResult({
    studentAnswer: 'D',
    answer: 'D',
    questionType: 'choice',
    manualMark: 'correct'
  }), {
    isCorrect: true,
    source: 'answer_comparison',
    manualMark: 'correct'
  })
})
