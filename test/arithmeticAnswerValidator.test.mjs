import assert from 'node:assert/strict'
import { validateArithmeticAnswer } from '../server/utils/arithmeticAnswerValidator.js'

const cases = [
  {
    question: '计算：13 1/8 + [3 3/7 + (-3 6/7) + (-5.125)] + (-4/7)。',
    answer: '7',
    valid: true,
  },
  {
    question: '计算：13 1/8 + [3 3/7 + (-3 6/7) + (-5.125)] + (-4/7)。',
    answer: '3 1/8',
    valid: false,
  },
  {
    question: '计算：(1/2 - 3/4) × 8 ÷ 2。',
    answer: '-1',
    valid: true,
  },
  {
    question: '求 x：2x + 1 = 5。',
    answer: '2',
    valid: true,
    applicable: false,
  },
]

for (const testCase of cases) {
  const result = validateArithmeticAnswer(testCase.question, testCase.answer)
  assert.equal(result.isValid, testCase.valid, JSON.stringify({ testCase, result }))
  if ('applicable' in testCase) assert.equal(result.applicable, testCase.applicable, JSON.stringify({ testCase, result }))
}

console.log(`arithmetic answer validator: ${cases.length} cases passed`)
