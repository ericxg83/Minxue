/**
 * 数学答案「同解异写」归一化回归测试（2026-09-24）
 *
 * 锁定 LaTeX/Unicode/上标字母等常见写法差异必须被判为同一答案 ——
 * 漏掉任一条，就会把「同题两次独立运行」的好答案当幻觉丢弃。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMathExpr, isSameMathAnswer } from '../server/utils/mathExprNormalize.js'

test('LaTeX \\times + \\frac 与 Unicode ·/ⁿ 同解（实测第 1 题原样）', () => {
  assert.equal(isSameMathAnswer('2 \\times (\\frac{5}{3})^n', '2·(5/3)ⁿ'), true)
})

test('上标字母 ⁿ 与 ^n 同解（漏掉会把好答案丢掉）', () => {
  assert.equal(isSameMathAnswer('(5/3)ⁿ', '(5/3)^n'), true)
})

test('上标数字 ² 与 ^2 同解', () => {
  assert.equal(isSameMathAnswer('x²+1', 'x^2+1'), true)
})

test('LaTeX \\frac 与斜杠分数同解', () => {
  assert.equal(isSameMathAnswer('\\frac{\\sqrt{6}}{2}', '√6/2'), true)
})

test('\\sqrt{6}/2 与 √6/2 同解', () => {
  assert.equal(isSameMathAnswer('\\sqrt{6}/2', '√6/2'), true)
})

test('多余括号不影响判同', () => {
  assert.equal(isSameMathAnswer('(5)/(3)', '5/3'), true)
})

test('全角括号与半角同解', () => {
  assert.equal(isSameMathAnswer('（a+b）²', '(a+b)^2'), true)
})

test('中文逗号结尾不影响判同', () => {
  assert.equal(isSameMathAnswer('2a+b-1，', '2a+b-1'), true)
})

test('⛔ 实质不同的答案绝不能被判同（防假一致）', () => {
  const diff = [
    ['2:1', '2:3'],
    ['±2', '2'],
    ['-3', '3'],
    ['①②③④', '①③④'],
    ['4', '5'],
    ['x>1', 'x<1'],
  ]
  for (const [a, b] of diff) {
    assert.equal(isSameMathAnswer(a, b), false, `${a} 与 ${b} 不应判同`)
  }
})

test('空值不判同', () => {
  assert.equal(isSameMathAnswer('', ''), false)
  assert.equal(isSameMathAnswer(null, null), false)
  assert.equal(isSameMathAnswer('', '2'), false)
})

test('归一化不改变语义骨架（抽样快照）', () => {
  assert.equal(normalizeMathExpr('2 \\times (\\frac{5}{3})^n'), '2*((5)/(3))^n')
  assert.equal(normalizeMathExpr('2·(5/3)ⁿ'), '2*(5/3)^n')
})
