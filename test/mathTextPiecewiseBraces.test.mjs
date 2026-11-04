/**
 * 2026-11-04 「定义运算※」题红色源码事故 —— 回归锁
 *
 * 症状：重练卷/批改页第 18 题（定义新运算 ※）题干里，定义式整段露出红色源码：
 *   `n = { \sqrt{m}-\sqrt{n} (m>n)` ←红色   `; ` ←黑色   `\sqrt{m}+\sqrt{n} (m<n) }` ←红色
 *
 * 根因（2026-10-10 cases 事故的同型，切断物不同）：
 *   练习册卷面用大花括号把分段定义的两条分支括在一起，OCR 逐字符转录成
 *   `{ √m-√n (m>n) ; √m+√n (m<n) }`。`;` 不在 isMathChar ⇒ splitToSegments
 *   在分号处把数学段拦腰切断，`{` 与 `}` 落进**不同**片段，KaTeX 拿到
 *   不配对的花括号报 ParseError ⇒ katex-error 红色源码回显。
 *
 * 修法：preprocessMath 新增步骤 0.45（convertPiecewiseBraces）——
 *   花括号组内部**顶层**含 `;` / `；` 的组转成 `\begin{cases}A\\B\end{cases}`，
 *   渲染层兜底（存量数据不回填，页面与 PDF 共用一条口径）。
 *
 * 本文件锁三件事：
 *   1. 转换只命中「顶层含分号的花括号组」，集合/记号类花括号原样放行；
 *   2. 库里 5 个真实题干变体端到端零 katex-error（红色源码不再出现）；
 *   3. 同构锁：移动端 MathText fork 必须调用同一份 convertPiecewiseBraces。
 */
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import katex from 'katex'
import { preprocessMath, splitToSegments, renderContent, convertPiecewiseBraces } from '../src/utils/mathText.js'

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

test('转换命中：花括号组顶层含分号 → cases 环境，√ 转换在行内照常进行', () => {
  // convertPiecewiseBraces 只管花括号→cases，不动根号（√ 是 convertSqrt 的职责）
  assert.equal(
    convertPiecewiseBraces('{√m-√n(m>n); √m+√n(m<n)}'),
    '\\begin{cases}√m-√n(m>n) \\\\ √m+√n(m<n)\\end{cases}'
  )
})

test('转换命中：空格 / 全角分号 / 多分支形态', () => {
  assert.equal(
    convertPiecewiseBraces('{ a ; b }'),
    '\\begin{cases}a \\\\ b\\end{cases}'
  )
  assert.equal(
    convertPiecewiseBraces('{a；b}'),
    '\\begin{cases}a \\\\ b\\end{cases}',
    '全角分号同样是分隔符'
  )
  assert.equal(
    convertPiecewiseBraces('{a; b; c}'),
    '\\begin{cases}a \\\\ b \\\\ c\\end{cases}',
    '三个分支各占一行'
  )
})

test('保守边界：集合 / 记号类花括号（无顶层分号）必须原样放行', () => {
  // 集合用顿号/逗号分隔（题库真实数据）
  assert.equal(convertPiecewiseBraces('{-0.25、∛27、0}'), '{-0.25、∛27、0}')
  assert.equal(convertPiecewiseBraces('{0, ³√27, 0.25}'), '{0, ³√27, 0.25}')
  // 「{a} 表示 a 减去 [√a]」记号题（parent_stem 真实原文片段）——本函数也不动 √
  assert.equal(
    convertPiecewiseBraces('{√3}=√3-1，{2.2}=2.2-2=0.2'),
    '{√3}=√3-1，{2.2}=2.2-2=0.2'
  )
  // 圆括号内的分号不是分隔符，但顶层分号仍切分（行内保留括号及其内文）
  assert.equal(
    convertPiecewiseBraces('{f(x; y); g}'),
    '\\begin{cases}f(x; y) \\\\ g\\end{cases}'
  )
  // 已有 cases 环境不受影响（{cases} 组内无分号）
  const env = '\\begin{cases} \\angle A = \\angle B \\\\ \\angle C = \\angle D \\end{cases}'
  assert.equal(convertPiecewiseBraces(env), env)
  // 不配对的孤立 `{` 原样放行
  assert.equal(convertPiecewiseBraces('a { b'), 'a { b')
  // 空分支不转（避免把 `{;}` 变成残缺环境）
  assert.equal(convertPiecewiseBraces('{; }'), '{; }')
})

test('花括号组所在分支：; 与 } 之间、{ 与内容之间的空格保留，产物整段进同一数学段', () => {
  const segs = mathSegs('m※n = { √m-√n (m>n) ; √m+√n (m<n) }')
  const withEnv = segs.find((s) => s.includes('\\begin{cases}'))
  assert.ok(withEnv, `cases 必须整体落进一个数学段，实际：${JSON.stringify(segs)}`)
  assert.ok(withEnv.includes('\\end{cases}'), 'begin 与 end 必须同段')
  assert.ok(!withEnv.includes(';'), `分号应已被消费成分行，实际：${withEnv}`)
})

test('事故五变体端到端：产物零 katex-error（老师看到的就是这五行）', () => {
  // 逐字取自 questions 表 5 条真实题干（task 04f5c092 / 1b9bfee9 / 7f55ba20 / 3d8c69b2 / d17eedd8）
  const CASES = [
    '对于任意的正数 m、n 定义运算 ※ 为：m※n = {√m-√n(m>n); √m+√n(m<n)}，计算(3※2)×(8※12)的结果为 __',
    '对于任意的正数 m、n 定义运算※为：m※n = √m-√n (m>n)；√m+√n (m<n)，计算 (3※2)×(8※12) 的结果为 ____.',
    '对于任意的正数 m、n 定义运算※为：m※n = { √m - √n (m > n) ; √m + √n (m < n) }，计算 (3※2) × (8※12) 的结果为___.',
    '对于任意的正数 m、n 定义运算※为：m※n = { √m-√n (m>n) ; √m+√n (m<n) }，计算 (3※2)×(8※12) 的结果为 ___。',
    '18.对于任意的正数m、n定义运算※为：m※n = { √m-√n (m>n) ; √m+√n (m<n) }，计算(3※2)×(8※12)的结果为___.',
  ]
  for (const src of CASES) {
    const red = redFragments(src)
    assert.deepEqual(red, [], `不应有红色源码片段，实际：${JSON.stringify(red)}`)
  }
})

test('记号题（[√a]/{a}）与集合题端到端不回归：零 katex-error 且无 cases 误转', () => {
  // 库内真实 parent_stem：「用 {a} 表示 a 减去 [√a] 所得的差」
  const stem = '(8分)阅读下面的文字，解答问题.\n对于实数a，我们规定：用符号[√a]表示不大于√a的最大整数，用{a}表示a减去[√a]所得的差.\n例如：[√3]=1，[√2.2]=2，{√3}=√3-1，{2.2}=2.2-2=0.2.'
  assert.ok(!renderContent(stem).includes('\\begin{cases}'), '记号花括号不得误转成 cases')
  assert.deepEqual(redFragments(stem), [], '记号题不得出现红色源码')
  // 集合分类题（answer 原文）
  const setAns = '有理数集合：{-0.25、∛27、0}；无理数集合：{√7、π、1.2345⋯}'
  assert.ok(!renderContent(setAns).includes('\\begin{cases}'), '集合花括号不得误转成 cases')
})

test('cases 产物必须能被 KaTeX 无错渲染（throwOnError:true 实证）', () => {
  for (const latex of mathSegs('m※n = {√m-√n(m>n); √m+√n(m<n)}，计算(3※2)×(8※12)的结果为 __')) {
    assert.doesNotThrow(
      () => katex.renderToString(latex, { throwOnError: true }),
      `「${latex}」应能被 KaTeX 完整渲染`
    )
  }
})

test('同构锁：移动端 MathText fork 必须调用同一份 convertPiecewiseBraces', () => {
  const fork = readFileSync(new URL('../src/components/MathText/index.jsx', import.meta.url), 'utf8')
  const truth = readFileSync(new URL('../src/utils/mathText.js', import.meta.url), 'utf8')
  assert.ok(truth.includes('function convertPiecewiseBraces'), '真值源必须包含 convertPiecewiseBraces 实现')
  assert.ok(fork.includes('convertPiecewiseBraces'), '移动端 MathText 缺少 convertPiecewiseBraces（两份渲染实现必须同步，否则手机端仍吐红色源码）')
  // fork 必须从真值源 import（单一实现，不允许再 fork 一份逻辑）
  assert.ok(
    /import\s*\{[^}]*convertPiecewiseBraces[^}]*\}\s*from\s*'\.\.\/\.\.\/utils\/mathText\.js'/.test(fork),
    '移动端必须 import 真值源的 convertPiecewiseBraces，不得本地重写'
  )
})
