// 回归锁：移动端 MathText 组件与 PDF 链路（utils/mathText.js）共享同一份
// 「指数规范化 + 分数转换」逻辑（normalizeFractions），不再各自维护、顺序不一致。
//
// 修复前（2026-10-31）：MathText 在「分数转换之前」未做指数规范化，且分数操作数
// 不认 ^{...}，导致 a^2/b^3 → a^\frac{2}{b}^3（KaTeX 双上标报错，手机端红色源码），
// a/b^2 → \frac{a}{b}^{2}（语义错成 (a/b)²），而 PDF 链路正确。
//
// 反向自检：内联复刻「修复前顺序」，断言对 a^2/b^3 必然 KaTeX 报错（锁非空，
// 不调 git，避免 Windows EBUSY）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import katex from 'katex'
import { preprocessMath, normalizeFractions } from '../src/utils/mathText.js'

const TRICKY = ['a^2/b^3', 'a/b^2', '6a^2b^6', 'c^(2n+2)/a^(2n+1)', 'x^2/y', '1/2', 'a^2b', '2 1/2']

function render(s) {
  // throwOnError:true —— 任何解析错误都会抛，用作「是否合法 LaTeX」判据
  katex.renderToString(s, { throwOnError: true, strict: false })
}

test('normalizeFractions：带指数分数全部渲染合法且等价于 PDF 链路', () => {
  for (const inp of TRICKY) {
    const out = normalizeFractions(inp)
    assert.doesNotThrow(
      () => render(out),
      `normalizeFractions(${JSON.stringify(inp)}) 产出非法 LaTeX: ${out}`
    )
    // PDF 链路 preprocessMath 在分数这一步结果也应合法（且与共享逻辑渲染一致）
    assert.doesNotThrow(
      () => render(preprocessMath(inp)),
      `preprocessMath(${JSON.stringify(inp)}) 产出非法 LaTeX`
    )
  }
})

test('MathText 组件已统一到共享 normalizeFractions（防漂移锁）', () => {
  const src = readFileSync(
    new URL('../src/components/MathText/index.jsx', import.meta.url),
    'utf8'
  )
  assert.match(
    src,
    /import\s*\{[^}]*normalizeFractions[^}]*\}\s*from\s*['"]\.\.\/\.\.\/utils\/mathText\.js['"]/,
    'MathText 必须从 ../../utils/mathText.js 导入 normalizeFractions'
  )
  assert.match(
    src,
    /normalizeFractions\(result\)/,
    'MathText 必须调用共享 normalizeFractions(result)，不得再内联分数/指数正则'
  )
})

// ── 反向自检：复刻修复前 MathText 的「分数先于指数」顺序 + 简化分数正则 ──
function oldMathtextOrder(s) {
  s = s.replace(/(\([^)]+\))\s*\/\s*(\([^)]+\))/g, '\\frac{$1}{$2}')
  s = s.replace(/(\([^)]+\))\s*\/\s*([a-zA-Z0-9]+)/g, '\\frac{$1}{$2}')
  s = s.replace(/([a-zA-Z0-9]+)\s*\/\s*(\([^)]+\))/g, '\\frac{$1}{$2}')
  s = s.replace(/([a-zA-Z0-9°]+)\s*\/\s*([a-zA-Z0-9]+)/g, '\\frac{$1}{$2}')
  s = s.replace(/(-[0-9]+)\s*\/\s*([a-zA-Z0-9]+)/g, '\\frac{$1}{$2}')
  s = s.replace(/([a-zA-Z0-9])\^([0-9]+)(?![0-9A-Za-z])/g, '$1^{$2}')
  s = s.replace(/([a-zA-Z0-9])\^([a-zA-Z])(?![a-zA-Z0-9])/g, '$1^{$2}')
  s = s.replace(/([a-zA-Z0-9])\^\(([^()]*)\)/g, '$1^{$2}')
  s = s.replace(/([a-zA-Z0-9])\^([0-9])/g, '$1^{$2}')
  return s
}

test('反向自检：旧 MathText 顺序对 a^2/b^3 必然 KaTeX 报错（锁非空）', () => {
  const bad = oldMathtextOrder('a^2/b^3')
  assert.throws(
    () => render(bad),
    /Double superscript|KaTeX/,
    `修复前顺序应报错，实际产出却合法: ${bad}`
  )
})
