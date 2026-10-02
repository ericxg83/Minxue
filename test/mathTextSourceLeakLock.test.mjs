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

const FILES = [
  ['src/utils/mathText.js', readFileSync(new URL('../src/utils/mathText.js', import.meta.url), 'utf8')],
  ['src/components/MathText/index.jsx', readFileSync(new URL('../src/components/MathText/index.jsx', import.meta.url), 'utf8')],
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
