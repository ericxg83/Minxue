import test from 'node:test'
import assert from 'node:assert/strict'
import { coerceAIText, unwrapPgArrayLiteral } from '../server/utils/aiTextCoerce.js'

test('coerceAIText flattens AI answers that are not strings', () => {
  assert.equal(coerceAIText('x = 1'), 'x = 1')
  assert.equal(coerceAIText(['x1 = -1/2', 'x2 = 5/2']), 'x1 = -1/2, x2 = 5/2')
  assert.equal(coerceAIText({ x1: '-1/2', x2: '5/2' }), '-1/2, 5/2')
  assert.equal(coerceAIText(['a', '', null, 'b']), 'a, b')
  assert.equal(coerceAIText(null), '')
  assert.equal(coerceAIText(0), '0')
})

test('unwrapPgArrayLiteral restores text stored as a PG array literal', () => {
  assert.equal(unwrapPgArrayLiteral('{"x1 = -1/2","x2 = 5/2"}'), 'x1 = -1/2, x2 = 5/2')
  assert.equal(unwrapPgArrayLiteral('{"x1 = a + 1"}'), 'x1 = a + 1')
  // 逗号在引号内不能被切开
  assert.equal(unwrapPgArrayLiteral('{"1, 2"}'), '1, 2')
  // 正常含花括号的 LaTeX 不能被改写
  assert.equal(unwrapPgArrayLiteral('x = -\\frac{\\sqrt{2}}{2}'), 'x = -\\frac{\\sqrt{2}}{2}')
  assert.equal(unwrapPgArrayLiteral('{1}{2}'), '{1}{2}')
  assert.equal(unwrapPgArrayLiteral(''), '')
})
