/**
 * 「多小问大题公共题干疑似丢失」判据的测试（2026-09-20 第19题事故）。
 *
 * 正样本全部取自库内真实数据（2026-09-20 全库扫出 14 条命中，逐条与原卷页图核对后 7 真 7 假）：
 *   真丢 7 条 —— 任务 5636fc30 题19/20/21/22/23/24、任务 165acb27 题24（公共题干见各用例注释）
 *   误报 7 条 —— 任务「数学堂堂清01」题13、任务 8ed83ce9 题2（本来就没有公共题干）
 *
 * 判据本体：`server/utils/parentStemTrust.js`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeLostParentStem } from '../server/utils/parentStemTrust.js'

// ── 真丢：公共题干确实存在于原卷、但既不在 content 也不在 parent_stem ──

// 任务 5636fc30 题19：原卷公共题干「如图，一只蚂蚁从点A沿数轴向右爬行了2个单位长度
// 到达点B，点A表示-√2，设点B所表示的实数为m」+ 数轴图
const Q19_CONTENT = '(1)实数m的值是____；(2)化简：$|m+1|+|m-1|$=____；(3)若在数轴上有C,D两点分别表示实数c,d，且$|3c+d|$与$\\sqrt{d+9}$互为相反数，求cd的立方根。'
// 任务 5636fc30 题20：原卷公共题干「已知正数m的两个平方根分别是a和b.」
const Q20_CONTENT = '(1)求$\\sqrt[3]{a}+\\sqrt[3]{b}$的值；(2)若$7a-3b \\le -30$，且$ab \\ge -9$，求m。'
// 任务 5636fc30 题21：原卷公共题干「在第八章《实数》的复习课上…第1个等式…第4个等式…」
const Q21_CONTENT = '(1)【规律发现】$\\sqrt{1-\\frac{19}{100}}=$____；(2)用含字母n的式子表示第n个等式：____（$n \\ge 1$且n为整数）；(3)【规律应用】计算：…'
// 任务 5636fc30 题22：原卷公共题干「已知5a+2的立方根是3，3a+b-1的算术平方根是4，c是√15的整数部分.」
const Q22_CONTENT = '(1)求7+√15的小数部分；(2)求3a-b+c的平方根。'
// 任务 5636fc30 题23：原卷公共题干「陕北剪纸是…现有一张长方形红色宣纸，长、宽之比为4:3，宣纸面积为588cm².」
const Q23_CONTENT = '(1)求宣纸的周长；(2)剪纸匠人想利用这张宣纸裁出一张面积为291cm²的完整圆形纸胚来创作花鸟图，她能够裁出来吗？请说明理由。（π取3）'
// 任务 5636fc30 题24：原卷公共题干「已知一正数的平方根是a+1与a-11，5a+2b的立方根是3，c是√11的整数部分.」
const Q24_CONTENT = '(1)求a，b，c的值；(2)求a+b+c的平方根。'
// 任务 165acb27 题24：原卷公共题干是整段「恒等变形是代数式求值的一个重要方法…请参照以上解决问题的思路」
const C8_Q24_CONTENT = '(1) 若x=√2-1，则(x+1)²=______，x³+2x²-x+2=______；\n(2) 若a²-3a+1=0，求2a³-5a²+6+3/(a²+1)的值；\n(3) 已知x=1/(√5-2)，求(x⁴-2x³-10x²+2x+2025)/(x²-4x)的值'

test('真丢：content 以小问标号开头且 parent_stem 为空 → 命中', () => {
  for (const [name, content] of [
    ['5636fc30 题19 蚂蚁数轴', Q19_CONTENT],
    ['5636fc30 题20 平方根', Q20_CONTENT],
    ['5636fc30 题21 规律探究', Q21_CONTENT],
    ['5636fc30 题22 立方根', Q22_CONTENT],
    ['5636fc30 题23 宣纸', Q23_CONTENT],
    ['5636fc30 题24 平方根/立方根', Q24_CONTENT],
    ['165acb27 题24 恒等变形', C8_Q24_CONTENT],
  ]) {
    assert.equal(looksLikeLostParentStem(content, null), true, `${name} 应命中`)
    assert.equal(looksLikeLostParentStem(content, ''), true, `${name}（parent_stem 空串）应命中`)
    assert.equal(looksLikeLostParentStem(content, '   '), true, `${name}（parent_stem 全空白）应命中`)
  }
})

// ── 误报边界：本来就没有公共题干的多小问，不得误伤（判据只用于告警，不拦截） ──

test('误报边界：独立小问（各自自带完整条件）→ 命中但语义上是误报，故禁止用于拦截', () => {
  // 任务「数学堂堂清01」题13：(1)(2) 是两个独立的完整问题，原卷没有公共题干
  const SQ_CONTENT = '(1)一个正方形的周长是16cm，这个正方形的面积是多少平方厘米？(2)一个正方形的面积是16cm²，这个正方形的周长是多少厘米？'
  assert.equal(looksLikeLostParentStem(SQ_CONTENT, null), true)
  // 任务 8ed83ce9 题2：化简题，公共语只有「化简：」两个字
  const SIMPLIFY_CONTENT = '(1) $\\sqrt{8 - 2\\sqrt{15}}$. (2) $\\sqrt{2 - \\sqrt{3}}$.'
  assert.equal(looksLikeLostParentStem(SIMPLIFY_CONTENT, null), true)
})

// ── 不该命中 ──

test('公共条件已写在 content 里（合并输出）→ 不命中', () => {
  const content = '已知正数m的两个平方根分别是a和b。(1)求$\\sqrt[3]{a}+\\sqrt[3]{b}$的值；(2)若$7a-3b \\le -30$，且$ab \\ge -9$，求m。'
  assert.equal(looksLikeLostParentStem(content, null), false)
})

test('已正确拆行并带 parent_stem → 不命中', () => {
  const content = '(1)求 a、b 的值；(2)求抛物线与直线 y=x+5 的两交点及顶点所构成的三角形的面积。'
  assert.equal(looksLikeLostParentStem(content, '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).'), false)
})

test('普通单问题 / 选择题 → 不命中', () => {
  assert.equal(looksLikeLostParentStem('计算：$\\sqrt[3]{27}-\\sqrt{64}+|\\sqrt{3}-2|-|1-\\sqrt{3}|$。', null), false)
  assert.equal(looksLikeLostParentStem('下列说法正确的是（ ）', null), false)
  assert.equal(looksLikeLostParentStem('如图，在数轴上有A，B，C，D四个点，则下列说法正确的是（ ）', null), false)
})

test('只有 (1) 没有后续小问 → 不命中（不构成多小问大题）', () => {
  assert.equal(looksLikeLostParentStem('(1) 实数 m 的值是______；', null), false)
})

test('空值/异常输入不抛错', () => {
  for (const v of [null, undefined, '', '   ', 0]) {
    assert.equal(looksLikeLostParentStem(v, null), false)
    assert.equal(looksLikeLostParentStem(null, v), false)
  }
})

test('全角括号同样命中', () => {
  assert.equal(looksLikeLostParentStem('（1）求宣纸的周长；（2）剪纸匠人想利用这张宣纸裁出…', null), true)
})

test('括号内有空格（模型常见输出）同样命中', () => {
  assert.equal(looksLikeLostParentStem('( 1 ) 求 $\\sqrt[3]{a}$ 的值；( 2 ) 求 m。', null), true)
})
