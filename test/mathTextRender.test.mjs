import test from 'node:test'
import assert from 'node:assert/strict'
import katex from 'katex'
import { preprocessMath, splitToSegments, renderContent } from '../src/utils/mathText.js'

/**
 * 2026-09-13 再测卷 PDF「a=方块」乱码事故沉淀的渲染标准回归：
 *   1. 纯文本题干（无 $ 定界符）经 preprocessMath + splitToSegments 后，
 *      数学片段必须能被 KaTeX 无警告渲染（字体由 katexCssWithFonts 内联，另一条线）。
 *   2. 高频 Unicode 数学符号必须映射为 LaTeX 命令，禁止裸 Unicode 进 KaTeX
 *      （裸符号在无数学字体的容器里渲染成方块/兜底字形）。
 */

/** 用 KaTeX 渲染并捕获 strict 警告（unknownSymbol 等以 warn 上报） */
function renderStrictAware(latex) {
  const warnings = []
  katex.renderToString(latex, {
    throwOnError: true,
    strict: (code) => { warnings.push(code); return 'ignore' },
  })
  return warnings
}

function mathSegments(text) {
  return splitToSegments(preprocessMath(text)).filter((s) => s.isMath && s.text).map((s) => s.text)
}

test('纯文本二次函数题干：自动分段且 KaTeX 零警告渲染', () => {
  const stem = '对于一个二次函数y=a(x-m)²+k(a≠0),若存在一点P(x\',y\'),使得x\'-m=y\'-k≠0'
  const segs = mathSegments(stem)
  assert.ok(segs.length > 0, '应识别出数学片段')
  for (const latex of segs) {
    const warnings = renderStrictAware(latex)
    assert.deepEqual(warnings, [], `数学片段「${latex}」不应产生 KaTeX 警告`)
  }
  const html = renderContent(stem)
  assert.ok(!html.includes('≠'), '渲染结果不应残留裸 Unicode ≠')
})

test('U+2212 数学减号映射为 ASCII -，并入数学段', () => {
  const segs = mathSegments('当−1≤x<2时')
  assert.ok(segs.some((s) => s.includes('\\le')), '≤ 应映射为 \\le 并进入数学段')
  assert.ok(segs.some((s) => s.includes('-1')), '− 应规范为 ASCII -')
  const html = renderContent('温度下降了−5')
  assert.ok(!html.includes('−'), '− 应被规范化')
  const mathText = mathSegments('a−b=0').join('')
  assert.ok(!mathText.includes('−'), '数学段不应残留 U+2212')
})

test('⊥ ∥ 映射为 \\bot / \\parallel，KaTeX 无 unknownSymbol 警告', () => {
  const segs = mathSegments('AB⊥CD, l∥m')
  assert.ok(segs.some((s) => s.includes('\\bot')), '⊥ 应映射为 \\bot')
  assert.ok(segs.some((s) => s.includes('\\parallel')), '∥ 应映射为 \\parallel')
  for (const latex of segs) {
    const warnings = renderStrictAware(latex)
    assert.deepEqual(warnings, [], `数学片段「${latex}」不应产生 KaTeX 警告`)
  }
})

test('上标字母/括号并入整体指数：aᵐ⁽ⁿ⁾ → a^{m(n)}', () => {
  const segs = mathSegments('xᵐ⁽ⁿ⁾')
  assert.ok(segs.some((s) => s.includes('^{m(n)}')), `应合并为 ^{m(n)}，实际: ${segs}`)
})

test('连续上标数字不拆分：x²⁰²¹ → x^{2021}', () => {
  const segs = mathSegments('x²⁰²¹')
  assert.ok(segs.some((s) => s.includes('^{2021}')), '禁止拆成 ^{2}^{0}^{2}^{1}')
})

test('已知病态样本：根号、分数、填空线混合渲染不抛错', () => {
  const cases = [
    '计算√17(a²+b²)的值',
    '3/4 + 1 1/2 = ______',
    '解不等式2x²−3x≥−1',
    '若a∥b,∠1=50°,则∠2=______',
  ]
  for (const c of cases) {
    const segs = mathSegments(c)
    for (const latex of segs) {
      assert.doesNotThrow(() => katex.renderToString(latex, { throwOnError: true }), `「${c}」的片段「${latex}」渲染失败`)
    }
  }
})
