import test from 'node:test'
import assert from 'node:assert/strict'
import { rationalizeAnswer } from '../server/utils/radicalSimplify.js'

const R = '√'

test('rationalizes ratios so the second term has no radical', () => {
  assert.equal(rationalizeAnswer(`${R}3:${R}2`), `${R}6:2`)
  assert.equal(rationalizeAnswer(`${R}2:${R}3`), `${R}6:3`)
  // 有理化后还要把比约到最简
  assert.equal(rationalizeAnswer(`2${R}3:${R}2`), `${R}6:1`)
  assert.equal(rationalizeAnswer(`${R}3:${R}12`), '1:2')
})

test('rationalizes denominators', () => {
  assert.equal(rationalizeAnswer(`1/${R}2`), `${R}2/2`)
  assert.equal(rationalizeAnswer(`3/${R}5`), `3${R}5/5`)
})

test('leaves already-simplified or unparseable answers untouched', () => {
  assert.equal(rationalizeAnswer(`${R}6:2`), `${R}6:2`)
  assert.equal(rationalizeAnswer('3:2'), '3:2')
  assert.equal(rationalizeAnswer(`5${R}3`), `5${R}3`)
  assert.equal(rationalizeAnswer(`x = -m ± ${R}n`), `x = -m ± ${R}n`)
  assert.equal(rationalizeAnswer(`${R}3:${R}2:${R}5`), `${R}3:${R}2:${R}5`)
  assert.equal(rationalizeAnswer(''), '')
  assert.equal(rationalizeAnswer(null), '')
})
