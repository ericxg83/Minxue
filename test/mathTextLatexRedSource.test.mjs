/**
 * 2026-10-10 批改页「学生答案」LaTeX 红色源码乱码事故 —— 回归锁
 *
 * 症状：PC 批改页左侧「学生答案」列满屏红色源码（`\begin{cases}\angle`、
 * `\therefore`、`A_{1B}_{1C_{1}}\frac` …），右侧「参考答案」列正常。
 * 两列用的是同一个 MathRender + autoDetect，所以问题在**入库原文经规范化的产物**。
 *
 * 两个根因（都已修，见 src/utils/mathText.js）：
 *   A. 上下标补花括号的正则**贪婪**：
 *      `A_1B_1C_1`（三个独立下标）被吞成 `A_{1B}_1C_{1}`、`6a^2b^6` 被吞成 `6a^{2b}^6`
 *      —— 基底字母被误当上标/下标内容，产物不是合法 LaTeX。
 *   B. `\begin{cases}…\\…\end{cases}` 环境被**从中间切断**：
 *      `\\` 与环境体内的空格都会 flushMath，`\begin{cases}` 与 `\end{cases}`
 *      落进不同 `$...$` 片段，KaTeX 判定环境残缺。
 *
 * 共同后果：KaTeX 对非法片段输出 `katex-error`（#cc0000 红色），把源码原样吐回屏幕。
 * 注意 MathRender 的 fallbackErrorHtml 只在 katex **抛异常**时才走，而这里
 * throwOnError:false ⇒ 不抛异常 ⇒ 红字直接来自 KaTeX 本尊，兜底管不到。
 *
 * 本文件的作用：把「产物必须能被 KaTeX 无错渲染」这条判据锁死，
 * 两份渲染实现（PC/PDF 的 utils/mathText.js 与移动端 MathText fork）都要过。
 */
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import katex from 'katex'
import { preprocessMath, splitToSegments, renderContent } from '../src/utils/mathText.js'

/** 判定「页面会不会红」：产物里只要有一个 katex-error 片段就会 */
function redFragments(text) {
  const normalized = renderContent(String(text || ''))
  const bad = []
  let remaining = normalized
  let guard = 0
  while (remaining.length > 0 && guard++ < 4000) {
    const display = remaining.match(/^\$\$([\s\S]*?)\$\$/)
    const inline = display ? null : remaining.match(/^\$([\s\S]*?)\$/)
    if (display || inline) {
      const m = display || inline
      const raw = m[1].trim()
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      if (!raw) { remaining = remaining.slice(m[0].length); continue }
      const html = katex.renderToString(raw, { displayMode: !!display, throwOnError: false })
      if (html.includes('katex-error')) bad.push(raw)
      remaining = remaining.slice(m[0].length)
      continue
    }
    const nextDollar = remaining.indexOf('$')
    if (nextDollar === -1) break
    else if (nextDollar > 0) remaining = remaining.slice(nextDollar)
    else remaining = remaining.slice(1)
  }
  return bad
}

function mathSegs(text) {
  return splitToSegments(preprocessMath(text))
    .filter((s) => s && s.isMath && typeof s.text === 'string' && s.text.trim())
    .map((s) => s.text)
}

test('根因A：几何角标 A_1B_1C_1 必须拆成三个独立下标，不被贪婪吞并', () => {
  assert.equal(preprocessMath('A_1B_1C_1'), 'A_{1}B_{1}C_{1}')
  assert.equal(preprocessMath('D_1B_1E_1'), 'D_{1}B_{1}E_{1}')
  assert.equal(preprocessMath('B_1D_1'), 'B_{1}D_{1}')
  for (const latex of mathSegs('A_1B_1C_1')) {
    assert.doesNotThrow(
      () => katex.renderToString(latex, { throwOnError: true }),
      `「${latex}」应能被 KaTeX 完整渲染`
    )
  }
})

test('根因A：上标同样不能贪婪（6a^2b^6 曾被吞成 6a^{2b}^6）', () => {
  assert.equal(preprocessMath('6a^2b^6'), '6a^{2}b^{6}')
  assert.equal(preprocessMath('a^2b^2'), 'a^{2}b^{2}')
  for (const latex of mathSegs('6a^2b^6 ÷ x^2')) {
    assert.doesNotThrow(() => katex.renderToString(latex, { throwOnError: true }), `「${latex}」渲染失败`)
  }
})

test('根因A：既有正确形态不被破坏（单下标 / 多位下标 / 括号上标 / 已有花括号）', () => {
  assert.equal(preprocessMath('x_1 = 2'), 'x_{1} = 2')
  assert.equal(preprocessMath('x_1 + x_2'), 'x_{1} + x_{2}')
  assert.equal(preprocessMath('x^12'), 'x^{12}')
  assert.equal(preprocessMath('(x+2)^2=a'), '(x+2)^{2}=a')
  assert.equal(preprocessMath('a_{1B}'), 'a_{1B}', '已是花括号下标，必须原样保留')
})

test('根因A：同一基底的上下标必须上标在前（p_{1}^{k}_{1} 数学上非法）', () => {
  const out = preprocessMath('p_1^k_1')
  assert.equal(out, 'p_{1}^{k+1}')
  // 真正的非法形态是「上标后跟下标」：p_{1}^{k}_{1}
  assert.ok(!/\}\s*_\{/.test(out), `不应留下「上标后跟下标」的非法形态：${out}`)
  for (const latex of mathSegs('p_1^k_1')) {
    assert.doesNotThrow(() => katex.renderToString(latex, { throwOnError: true }), `「${latex}」渲染失败`)
  }
})

test('根因B：cases 环境不被切断，\\begin 与 \\end 落在同一数学段', () => {
  const src = '\\begin{cases} \\angle ADG = \\angle B \\\\ \\angle A = \\angle A \\end{cases}'
  const math = mathSegs(src)
  assert.equal(math.length, 1, `cases 必须整体成一个数学段，实际：${JSON.stringify(math)}`)
  assert.ok(math[0].includes('\\begin{cases}') && math[0].includes('\\end{cases}'),
    `同一段里应同时含 begin/end，实际：${math[0]}`)
  assert.doesNotThrow(() => katex.renderToString(math[0], { throwOnError: true }),
    '完整 cases 必须能被 KaTeX 渲染')
})

test('事故三题原文端到端：产物零 katex-error（老师看到的就是这三行）', () => {
  // 逐字取自库中三道题的 student_answer（几何相似/角平分线题）。
  const CASES = [
    "$\\because \\triangle ABC \\sim \\triangle A_1B_1C_1$ $\\therefore \\angle ABC = \\angle A_1B_1C_1$，$BD, B_1D_1$ 分别是 $\\angle ABC, \\angle A_1B_1C_1$ 的平分线 $\\therefore \\frac{AB}{A_1B_1} = \\frac{BD}{B_1D_1} = \\frac{BC}{B_1C_1}$，$\\angle DBE = \\angle D_1B_1E_1$ 又 $\\because E, E_1$ 分别是 $BC, B_1C_1$ 的中点 $\\therefore \\frac{BD}{B_1D_1} = \\frac{BE}{B_1E_1}$ 在 $\\triangle BDE$ 与 $\\triangle B_1D_1E_1$ 中 $\\begin{cases} \\frac{BD}{B_1D_1} = \\frac{BE}{B_1E_1} \\\\ \\angle DBE = \\angle D_1B_1E_1 \\end{cases}$ $\\therefore \\triangle BDE \\sim \\triangle B_1D_1E_1$",
    "设 $DE=EF=FG=DG=x$ $\\because AH=40$ $\\therefore AP=40-x$ 又 $\\because DG \\parallel BC$ $\\therefore \\angle ADG = \\angle B$ 在 $\\triangle ADG$ 与 $\\triangle ABC$ 中 $\\begin{cases} \\angle ADG = \\angle B \\\\ \\angle A = \\angle A \\end{cases}$ $\\therefore \\triangle ADG \\sim \\triangle ABC$ $\\therefore$ 代入得：$\\frac{40-x}{40} = \\frac{x}{60}$ $40x = 2400 - 60x$ $100x = 2400$ $x = 24$",
    "$\\triangle BDP \\sim \\triangle ACP$ $\\triangle ABP \\sim \\triangle ACP$ 如图所示 $\\because AC \\parallel BD$ $\\therefore \\angle D = \\angle PAC = \\angle BAP$ $\\angle AB = BD$ 在 $\\triangle BDP$ 与 $\\triangle ACP$ 中 $\\begin{cases} \\angle BPD = \\angle APC \\\\ \\angle D = \\angle PAC \\end{cases}$ $\\therefore \\triangle BDP \\sim \\triangle ACP$",
  ]
  for (const src of CASES) {
    const red = redFragments(src)
    assert.deepEqual(red, [], `不应有红色源码片段，实际：${JSON.stringify(red)}`)
  }
})

test('同构锁：移动端 MathText fork 必须具备同一套修正', () => {
  const src = readFileSync(new URL('../src/components/MathText/index.jsx', import.meta.url), 'utf8')
  for (const mark of ['normalizeScripts', 'mergeTrailingSubscriptIntoSuperscript', 'envDepth']) {
    assert.ok(src.includes(mark), `移动端 MathText 缺少 ${mark}（两份渲染实现必须同步，否则手机端仍吐红色源码）`)
  }
  // 贪婪正则不得复活：这两条是本次事故的直接成因
  assert.ok(!src.includes(String.raw`([a-zA-Z])_([a-zA-Z0-9]+)`),
    '移动端不得恢复贪婪下标正则（会把 A_1B_1C_1 吞成 A_{1B}_1C_{1}）')
})
