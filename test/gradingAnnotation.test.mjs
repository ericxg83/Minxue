import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeManualMark, resolveGradingResult } from '../server/worker.js'

test('teacher wrong annotation overrides an OCR answer that matches the student answer', () => {
  const result = resolveGradingResult({
    studentAnswer: 'D',
    answer: 'D',
    questionType: 'choice',
    manualMark: 'wrong'
  })

  assert.deepEqual(result, {
    isCorrect: false,
    source: 'teacher_annotation',
    manualMark: 'wrong'
  })
})

test('teacher correct annotation remains compatible with legacy checkmark output', () => {
  assert.equal(normalizeManualMark(null, true), 'correct')
  assert.deepEqual(resolveGradingResult({
    studentAnswer: 'D',
    answer: 'C',
    questionType: 'choice',
    manualMark: 'correct'
  }), {
    isCorrect: true,
    source: 'teacher_annotation',
    manualMark: 'correct'
  })
})

test('teacher partial annotation never promotes a question to correct', () => {
  assert.deepEqual(resolveGradingResult({
    studentAnswer: 'D',
    answer: 'D',
    questionType: 'choice',
    manualMark: 'partial'
  }), {
    isCorrect: false,
    source: 'teacher_annotation',
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
