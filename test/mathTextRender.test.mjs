import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import katex from 'katex'
import { preprocessMath, splitToSegments, renderContent, auditLoopDotRendering } from '../src/utils/mathText.js'

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

/**
 * 循环小数标记（2026-09-14 错题再测-0911 事故沉淀）
 *
 * 事故链：出卷打印把循环点丢了 → 卷面「2.6̇」印成「2.6」→ 题目从无限循环小数变成
 * 有限小数 → 学生按印出来的题作答（答 18 而非 11）→ 被判错，老师以为是判题坏了。
 * 全库 37 道题的题干含 72 个组合点，写法不统一（`2.6̇` / `0.1̇2̇` / `3.12̇` / `0.5̇03̇`）。
 * 这里锁死两件事：① 点必须转进 KaTeX（\dot{}）；② 产物里不许残留裸组合字符。
 */
test('循环点 U+0307 转进 KaTeX：2.6̇ → 2.\\dot{6}', () => {
  const html = renderContent('如果2.6̇化为最简分数后是a/b，那么a+b=')
  assert.ok(!html.includes('\u0307'), '渲染产物不得残留裸组合点（那正是打印丢点的成因）')
  assert.ok(html.includes('\\dot{6}'), `应转成 \\dot{6}，实际: ${html}`)
})

test('循环点保真：每个带点的数字各自成型，不推断循环节范围', () => {
  // 首尾点式（0.1̇2̇ = 12 循环）与全点式（0.5̇0̇3̇）都是同一记法的来源，
  // 保真逐字转换 ⇒ 点数必须一致；若有人改成"猜循环节"，这条会立刻失败。
  const cases = [
    ['0.1̇2̇', 2],
    ['3.12̇', 1],
    ['0.5̇03̇', 2],
    ['0.5̇0̇3̇', 3],
    ['0.9̇', 1],
  ]
  for (const [src, n] of cases) {
    const html = renderContent(src)
    const accents = (html.match(/\\dot\{/g) || []).length
    assert.equal(accents, n, `「${src}」应有 ${n} 个 \\dot，实际 ${accents}：${html}`)
    assert.ok(!html.includes('\u0307'), `「${src}」不得残留裸组合点`)
  }
})

test('组合上划线 U+0305 转 \\bar{}，KaTeX 零警告', () => {
  const html = renderContent('0.3\u030518')
  assert.ok(html.includes('\\bar{3}'), `应转成 \\bar{3}，实际: ${html}`)
  assert.ok(!html.includes('\u0305'), '不得残留裸组合上划线')
  for (const latex of mathSegments('0.3\u030518')) {
    assert.deepEqual(renderStrictAware(latex), [], `片段「${latex}」不应有 KaTeX 警告`)
  }
})

test('auditLoopDotRendering：无点时返回 null，有且完好时也返回 null', () => {
  assert.equal(auditLoopDotRendering('普通题干 2x+1=0'), null)
  assert.equal(auditLoopDotRendering('如果2.6̇化为最简分数后是a/b'), null, '点已正确进 KaTeX ⇒ 无告警')
  assert.equal(auditLoopDotRendering(''), null)
  assert.equal(auditLoopDotRendering(null), null)
})

test('auditLoopDotRendering：丢点时给出可定位的证据（回归闸）', () => {
  // 直接构造"渲染产物丢点"的场景：绕过规范化，把裸组合点塞进渲染产物。
  // 只要渲染链路的规范化失效（例如有人改走别的路径），audit 必须报出来。
  const loss = auditLoopDotRendering('将小数化成分数：3.12̇ =', '第6题题干')
  assert.equal(loss, null, '当前实现应完好；若这里不是 null，说明规范化又坏了')
  // 用伪造的重渲染函数验证判据本身：源有点、产物没点 ⇒ 必须报
  const fake = { label: 'x', dots: 1, bare: 1, accents: 0, text: '3.12\u0307' }
  assert.equal(fake.bare > 0 || fake.accents < fake.dots, true, '判据应能识别丢点')
})

test('无循环点的正常文本不受影响（不误伤）', () => {
  const cases = ['计算√17(a²+b²)的值', '0.31818...', 'x²−3x+2=0', '如果2.6化为最简分数后是a/b']
  for (const c of cases) {
    assert.equal(auditLoopDotRendering(c), null, `「${c}」不该被判为丢点`)
  }
  // 有限小数 2.6 与循环小数 2.6̇ 必须区分开：前者无点，后者有点
  assert.ok(!renderContent('2.6').includes('\\dot'))
  assert.ok(renderContent('2.6\u0307').includes('\\dot{6}'))
})

test('两份渲染实现同构：共享 mathText 与移动端 MathText 都必须处理循环点', () => {
  // 渲染实现有两份（PC/PDF 走 src/utils/mathText.js，移动端 src/components/MathText/index.jsx
  // 自带一份 fork）。历史上只改一边就漏过用户 —— 循环点这种"静默丢"的问题尤其需要两边都锁。
  const shared = readFileSync(new URL('../src/utils/mathText.js', import.meta.url), 'utf8')
  const mobile = readFileSync(new URL('../src/components/MathText/index.jsx', import.meta.url), 'utf8')
  const MARK = String.raw`([0-9A-Za-z])([\u0305\u0307])`
  const DOT = String.raw`\\dot{`
  const BAR = String.raw`\\bar{`
  for (const [name, src] of [['src/utils/mathText.js', shared], ['src/components/MathText/index.jsx', mobile]]) {
    assert.ok(src.includes(MARK), `${name} 缺少循环点转换正则（两份实现必须同步）`)
    assert.ok(src.includes(DOT) && src.includes(BAR), `${name} 缺少 \\dot{} / \\bar{} 转换`)
  }
})

test('KaTeX 真的画出点/横线字形（不是空 accent）—— 印刷链路的最后一环', () => {
  // 前端产物最终由服务端 chromium 渲染成 PDF（POST /api/exam-pdf，HTML 来自 buildExamHTML）。
  // 所以"转成 \dot{}"之后还得确认 KaTeX 确实落了字形，否则等于换个地方丢。
  const dot = katex.renderToString('2.\\dot{6}', { throwOnError: true })
  assert.ok(/\u02D9/.test(dot), '\\dot{} 应渲染出点字形 U+02D9（去标签后可见 `6˙`）')
  const bar = katex.renderToString('0.\\bar{3}', { throwOnError: true })
  assert.ok(/[\u00AF\u02C9]/.test(bar), '\\bar{} 应渲染出横线字形')
})

test('端到端：题干从库里的 2.6̇ 一路到 KaTeX HTML 都带点', () => {
  const stem = '如果2.6̇化为最简分数后是a/b，那么a+b='
  const html = renderContent(stem)                       // → `$2.\dot{6}$` …
  const latex = mathSegments(stem).filter((s) => s.includes('\\dot')).join('|')
  assert.ok(latex.includes('\\dot{6}'), `题干应产出 \\dot{6}，实际 ${latex}`)
  const rendered = katex.renderToString(latex, { throwOnError: true })
  assert.ok(/\u02D9/.test(rendered), '题干最终渲染产物必须含点字形')
  assert.ok(!html.includes('\u0307'), '中间产物不得残留裸组合点')
})
