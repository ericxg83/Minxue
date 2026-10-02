/**
 * 数学文本「裸源码上屏」同构锁（2026-10-02 第 39 轮）
 *
 * 缺陷现场（浏览器实测错题本列表，同一屏两类）：
 *   A. 定界符泄漏：题干显示成「已知 $\sqrt{x+2y-7}+|x-1|=0$」——
 *      一半已排成数学体，一半还露着裸 `$`。
 *   B. 填空线泄漏：题干显示成红色 `\sqrt{1-\frac{19}{100}}=____` 整段源码——
 *      `____` 落进数学段后 KaTeX 报「Expected group after '_'」，把整段原样吐回屏幕。
 *
 * 共同根因：项目里有两份数学文本预处理实现，必须同构（先例见 test/mathTextRender.test.mjs
 * 的循环小数同构断言）：
 *   - src/utils/mathText.js      （打印 / PDF / 白板链路）步骤 0 剥定界符、步骤 0.6 转填空线
 *   - src/components/MathText    （React 屏幕渲染链路）此前**两步都缺**
 * 只改一边就会漏用户：屏幕看到的和印出来的不是同一份东西，学生照着屏幕作答会被判错。
 *
 * 本锁两头钉：源码层「两份实现都有那行活代码」+ 行为层「打印链路产物不残留裸符号」。
 */
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { preprocessMath, splitToSegments, renderContent } from '../src/utils/mathText.js'

/** 两份渲染实现的源码（屏幕 fork 与打印原本） */
const SHARED = readFileSync(new URL('../src/utils/mathText.js', import.meta.url), 'utf8')
const MOBILE = readFileSync(new URL('../src/components/MathText/index.jsx', import.meta.url), 'utf8')

const FILES = [
  ['src/utils/mathText.js', SHARED],
  ['src/components/MathText/index.jsx', MOBILE],
]

/** 必须逐字同构的三行原码（少一行、或被注释掉，即红） */
const STRIP_DOLLAR = String.raw`replace(/\$\$?/g, '')`
const STRIP_PAREN = String.raw`replace(/\\\(/g, '')`
const BLANK_LINE = String.raw`_{2,}/g, '\\underline{\\quad}'`

/**
 * 断言该码是「能跑的代码」而不是注释里的遗迹：
 * 找到所在行，确认它不是 // 注释、也不是 * 或 /* 开头的文档行。
 */
function assertLiveCodeLine(src, needle, name) {
  const lines = src.split(/\r?\n/)
  const hit = lines.findIndex((l) => l.includes(needle))
  assert.ok(hit >= 0, `${name} 缺少「${needle}」这行代码（两份渲染实现必须同步）`)
  const line = lines[hit].trim()
  assert.ok(!line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'),
    `${name} 的「${needle}」被注掉了，裸源码会直接泄漏到屏幕上`)
}

for (const [name, src] of FILES) {
  test(`同构锁：${name} 必须剥定界符 $ / \\( \\)`, () => {
    assertLiveCodeLine(src, STRIP_DOLLAR, name)
    assertLiveCodeLine(src, STRIP_PAREN, name)
  })
  test(`同构锁：${name} 必须把填空线 ____ 转成 \\underline{\\quad}`, () => {
    assertLiveCodeLine(src, BLANK_LINE, name)
  })
}

const DELIMITER_CASES = [
  ['单美元行内', '已知 $\\sqrt{x+2y-7}+|x-1|=0$。求 $x+y$ 的平方根'],
  ['双美元独立', '$$\\frac{1}{2}x^2$$ 的面积'],
  ['圆括号定界', '\\(3.14\\) 是近似值'],
  ['裸定界符', '计算 $\\sqrt[3]{27}-\\sqrt{64}$ 的结果'],
]

for (const [label, input] of DELIMITER_CASES) {
  test(`打印链路产物不得残留定界符：${label}`, () => {
    const processed = preprocessMath(input)
    assert.ok(!processed.includes('$'), `preprocessMath 后仍残留 $：${processed}`)
    assert.ok(!processed.includes('\\(') && !processed.includes('\\)'), `preprocessMath 后仍残留 \\( \\)：${processed}`)
    for (const seg of splitToSegments(processed)) {
      assert.ok(!seg.text.includes('$'), `分段后仍残留 $：「${seg.text}」`)
    }
    // renderContent 的产物里 $ 只能是成对的公式定界符；出现奇数个 = 有裸 $ 泄漏
    const html = renderContent(input)
    assert.equal((html.match(/\$/g) || []).length % 2, 0, `renderContent 产物中 $ 必须成对：${html}`)
  })
}

test('填空线不得以裸 ____ 进数学段（KaTeX 会报错并把源码吐回屏幕）', () => {
  const stem = '【规律发现】$\\sqrt{1-\\frac{19}{100}}=____$；用含字母 n 的式子表示第 n 个等式：____'
  const processed = preprocessMath(stem)
  assert.ok(!/_{2,}/.test(processed), `不应残留裸连续下划线：${processed}`)
  assert.ok(processed.includes('\\underline{\\quad}'), `应转成 \\underline{\\quad}：${processed}`)
  for (const seg of splitToSegments(processed)) {
    assert.ok(!/_{2,}/.test(seg.text), `分段后数学段仍含裸下划线：「${seg.text}」`)
  }
})

test('纯文本题干不受影响：剥离与转换不得吞掉普通字符', () => {
  const plain = '第 3 题：甲、乙两地相距 120 千米'
  assert.ok(preprocessMath(plain).includes('120'), '数字应原样保留')
  assert.ok(preprocessMath(plain).includes('甲、乙两地'), '中文应原样保留')
  // 单个下划线仍留给下标语义（x_1 → x_{1}），不能被填空线规则误吞
  assert.ok(preprocessMath('x_1 + x_2 = 5').includes('x_{1}'), 'x_1 应规范为下标 x_{1}')
})

// ── 第二批同构漂移（第 41 轮，只读探测 8 个学生 307 条错题定量）──
// 裸根号 √ 命中 50 条（16%）、Unicode 上下标命中 110 条（36%）、乘点 · 命中 21 条（7%）。
// 这三类打印链路（utils/mathText.js）早就规范化了，屏幕链路没做——同一道题两个样。

/** 抽出源码里所有 `.replace(/[字符集]+/g` 的字符集（只算活代码，注释里的不算） */
function scriptClasses(src) {
  return src.split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .map((l) => l.match(/\.replace\(\/\[([^\]]+)\]\+\/g/))
    .filter(Boolean)
    .map((m) => m[1])
}

test('Unicode 上标/下标字符集必须与打印链路逐字相同（少一个字符即红）', () => {
  const utilClasses = scriptClasses(SHARED)
  const compClasses = scriptClasses(MOBILE)
  assert.ok(utilClasses.length >= 2, `打印链路应至少扫到上标与下标两条，实际 ${utilClasses.length}`)
  for (const cls of utilClasses) {
    assert.ok(
      compClasses.includes(cls),
      `屏幕链路缺少整条字符集 [${cls}]（含码位 ${[...cls].map((c) => c.codePointAt(0).toString(16)).join(' ')}）——` +
      '屏幕会把数学段撕成两半，与同一题的 PDF 不一致'
    )
  }
})

test('屏幕链路必须复用打印链路的 convertSqrt（裸 √ 不得留在文本段）', () => {
  assert.ok(SHARED.includes('function convertSqrt'), '打印链路应定义 convertSqrt')
  assert.ok(/export \{[\s\S]*convertSqrt/.test(SHARED), 'convertSqrt 必须具名导出供屏幕链路复用')
  // 必须用活代码断言：写成注释也算过的话，这道锁就是假的（本轮 red-check 实测拓出来的）
  assertLiveCodeLine(MOBILE, 'result = convertSqrt(result)', '屏幕链路（convertSqrt 调用）')
})

test('乘点 · 两边都要转 backslash-cdot（实测 21/307 条错题含它）', () => {
  assert.ok(SHARED.includes(String.raw`'·': '\\cdot '`), '打印链路缺乘点映射')
  assert.ok(MOBILE.includes(String.raw`'·': '\\cdot '`), '屏幕链路缺乘点映射，数学段会被 · 切断')
})

test('行为锁：裸根号与上标经打印链路规范化后不留裸符号', () => {
  const stem = '下列说法错误的是：a²+2a+4 是最简二次根式，√2 是二次根式'
  const processed = preprocessMath(stem)
  assert.ok(processed.includes('\\sqrt{2}'), `√2 应转成 \\sqrt{2}：${processed}`)
  assert.ok(processed.includes('a^{2}'), `a² 应转成 a^{2}：${processed}`)
  assert.ok(!processed.includes('√'), `不应残留裸根号：${processed}`)
  assert.ok(!/\u00B2/.test(processed), '不应残留 Unicode 上标')
})
