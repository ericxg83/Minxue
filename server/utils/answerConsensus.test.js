import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeAnswerKey,
  parseNumericValues,
  answersEquivalent,
  voteAnswers,
  describeConsensus,
} from './answerConsensus.js'

// ── 归一化 ────────────────────────────────────────────────────────────────

test('归一化：脚手架、全角、空格、尾部标点都被折叠', () => {
  assert.equal(normalizeAnswerKey('答案是±2√5。'), '±2√5')
  assert.equal(normalizeAnswerKey('  2√5 - 4 '), '2√5-4')
  assert.equal(normalizeAnswerKey('（√5＋1）／2'), '(√5+1)/2')
  assert.equal(normalizeAnswerKey('最终答案：3'), '3')
})

test('归一化：`10 或 -10` 与 `10,-10` 折叠成同一个 ±10', () => {
  assert.equal(normalizeAnswerKey('10 或 -10'), '±10')
  assert.equal(normalizeAnswerKey('10,-10'), '±10')
  assert.equal(normalizeAnswerKey('±10'), '±10')
})

test('归一化：上标指数、OCR 误识的「士」', () => {
  assert.equal(normalizeAnswerKey('10²'), '10^(2)')
  assert.equal(normalizeAnswerKey('士3'), '±3')
})

test('归一化：去掉每个分空上的「变量名=」前缀', () => {
  assert.equal(normalizeAnswerKey('b=6，c=10'), '6,10')
  assert.equal(normalizeAnswerKey('x=6'), '6')
  assert.ok(answersEquivalent('b=6，c=10', '6,10'))
  assert.ok(answersEquivalent('y=3x²-12x+5', '3x^(2)-12x+5'))
})

// ── 数值解析 ──────────────────────────────────────────────────────────────

test('数值解析：±2√5 展开成两支', () => {
  const v = parseNumericValues('±2√5')
  assert.equal(v.length, 2)
  assert.ok(Math.abs(v[0] - 2 * Math.sqrt(5)) < 1e-9)
  assert.ok(Math.abs(v[1] + 2 * Math.sqrt(5)) < 1e-9)
})

test('数值解析：隐式乘法与分数', () => {
  assert.ok(Math.abs(parseNumericValues('6+√5')[0] - (6 + Math.sqrt(5))) < 1e-9)
  assert.ok(Math.abs(parseNumericValues('√6/2')[0] - Math.sqrt(6) / 2) < 1e-9)
  assert.ok(Math.abs(parseNumericValues('(√5+1)/2')[0] - (Math.sqrt(5) + 1) / 2) < 1e-9)
  assert.ok(Math.abs(parseNumericValues('∛27')[0] - 3) < 1e-9)
})

test('数值解析：含字母/无法解析返回 null（不猜）', () => {
  // `x=6` 的「变量名=」前缀会被归一化掉，剩下纯数值 6 —— 这是期望行为（与 `6` 等价）
  assert.deepEqual(parseNumericValues('x=6'), [6])
  // 真正含未知量的表达式仍然解析不了，必须返回 null 而不是猜一个值
  assert.equal(parseNumericValues('y=3x²-12x+5'), null)
  assert.equal(parseNumericValues('待人工补充'), null)
  assert.equal(parseNumericValues('数值较小的是A'), null)
})

// ── 等价判定 ──────────────────────────────────────────────────────────────

test('等价：同一答案的不同写法', () => {
  assert.ok(answersEquivalent('2√5-4', '2√5 - 4'))
  assert.ok(answersEquivalent('1/2', '0.5'))
  assert.ok(answersEquivalent('(√5+1)/2', '(1+√5)/2'))
  assert.ok(answersEquivalent('-2 - 2√3', '-2-2√3'))
})

test('不等价：±10 与 10 必须算成不同答案（漏写 ± 是平方根题的高频分歧点）', () => {
  assert.ok(!answersEquivalent('±10', '10'))
  assert.ok(!answersEquivalent('±2√5', '2√5'))
})

test('不等价：本次事故的两个答案', () => {
  assert.ok(!answersEquivalent('±2√5', '±10'))
  assert.ok(!answersEquivalent('±5', '±10'))
})

test('多空答案按顺序比对（「依次填 1,2」≠「2,1」）', () => {
  assert.ok(!answersEquivalent('1,2', '2,1'))
  assert.ok(answersEquivalent('1,2', '1，2'))
})

// ── 投票 ──────────────────────────────────────────────────────────────────

test('投票：本题实测分布 ±5 / ±10 / ±10 → majority 且多数派是 ±10', () => {
  const r = voteAnswers(['±5', '±10', '±10'])
  assert.equal(r.verdict, 'majority')
  assert.equal(r.winner, '±10')
  assert.equal(r.total, 3)
})

test('投票：全一致 → unanimous', () => {
  const r = voteAnswers(['±10', '± 10', '答案是±10'])
  assert.equal(r.verdict, 'unanimous')
  assert.equal(r.winner, '±10')
})

test('投票：三个都不同 → split，且不谎称有共识', () => {
  const r = voteAnswers(['±2√5', '±5', '±10'])
  assert.equal(r.verdict, 'split')
  assert.equal(r.groups.length, 3)
})

test('投票：空输入 → empty，winner 为 null', () => {
  const r = voteAnswers([])
  assert.equal(r.verdict, 'empty')
  assert.equal(r.winner, null)
})

// ── 提示文案 ──────────────────────────────────────────────────────────────

test('文案：一致或单样本不产生噪音', () => {
  assert.equal(describeConsensus(voteAnswers(['±10', '±10'])), null)
  assert.equal(describeConsensus(voteAnswers(['±10'])), null)
})

test('文案：分歧必须列出候选与票数，并带上求解通道', () => {
  const text = describeConsensus(voteAnswers(['±5', '±10', '±10']), { engine: 'Huihuiyun:deepseek-v4-flash' })
  assert.ok(text.includes('±10（2/3）'), text)
  assert.ok(text.includes('±5（1/3）'), text)
  assert.ok(text.includes('Huihuiyun:deepseek-v4-flash'), text)
  assert.ok(text.includes('人工核对'), text)
})

test('归一化：剥掉「答案 + 自证尾巴」（2026-09-21 存量重跑实测）', () => {
  // 库内常写成「18√7，与答案一致」这种「答案 + 自证」形式；
  // 不剥掉会把同一个答案判成两个值，白报一次分歧。
  assert.ok(answersEquivalent('18√7，与答案一致', '18√7'))
  assert.ok(answersEquivalent('B（已核对）', 'B'))
  assert.equal(normalizeAnswerKey('18√7，与答案一致'), '18√7')
  assert.equal(normalizeAnswerKey('B（核对无误）'), 'B')
})

test('回归：自证尾巴剥离不得误伤正常多空答案', () => {
  // 「1,2」里的逗号是分空分隔，不是自证尾巴
  assert.ok(answersEquivalent('1,2', '1,2'))
  assert.ok(!answersEquivalent('1,2', '1'))
  // 「正确」只作为尾巴时才剥；出现在值里不能动
  assert.equal(normalizeAnswerKey('3'), '3')
})

test('归一化：剥掉 LaTeX 定界符 $（2026-09-21 存量重跑实测）', () => {
  // 库内混着 `$x=-\frac{1}{2}$` 与 `x=-1/2` 两种写法，是同一个答案
  assert.ok(answersEquivalent('$x=-\\frac{1}{2}$', 'x=-1/2'))
  assert.ok(answersEquivalent('$45^\\circ$', '45°'))
  // 字符串键不要求逐字相同（\frac 折叠成 (1)/(2) 会留括号），但数值必须等价；
  // 简单式子的键则应完全一致。
  assert.equal(normalizeAnswerKey('$45^\\circ$'), '45°')
  assert.equal(normalizeAnswerKey('$x=3$'), '3')
})

// ── 2026-09-21 存量重跑（1432 条）实测暴露的归一化缺口 ────────────────────────
// 这批用例的共同点：**都是「同一个答案的两种写法」被判成了分歧**。
// 伪分歧的代价不是「多看一眼」，而是会把正确答案也拖进待确认清单里，稀释真错的信号。

test('归一化：指数形态统一 —— 上标 ² 与 ^2（存量重跑 #167 / #111）', () => {
  // foldSuperscripts 把 ² 折成 ^(2)，而模型直接写 ^2；不统一就白报分歧
  assert.ok(answersEquivalent('y=x²+2x', 'y=x^2+2x'))
  assert.ok(answersEquivalent('S = -m²-4m+4（-4 < m<0）', 'S=-m^2-4m+4（-4<m<0）'))
  assert.equal(normalizeAnswerKey('x²'), 'x^(2)')
  assert.equal(normalizeAnswerKey('x^2'), 'x^(2)')
  // 但底数/指数本身不同时仍须判为不同
  assert.ok(!answersEquivalent('x^2', 'x^3'))
})

test('归一化：全角不等号 ＜＞（存量重跑 #192）', () => {
  assert.ok(answersEquivalent('＜', '<'))
  assert.ok(answersEquivalent('x≤5', 'x<=5'))
  // ≤ 与 < 是不同答案，不能因为都含 < 就折一起
  assert.ok(!answersEquivalent('x≤5', 'x<5'))
})

test('归一化：表达式= 前缀（存量重跑 #159）', () => {
  // 题目问的就是这个比值，`EA/AB = 1/2` 与 `1/2` 是同一答案
  assert.ok(answersEquivalent('EA/AB = 1/2', '1/2'))
  assert.ok(answersEquivalent('b=6,c=10', '6,10'))
  // 但前缀剥离不得把「等式关系型答案」整段吃掉成等价
  assert.ok(!answersEquivalent('AD²=AF·AB', 'AD是AF、AB的比例中项'))
})

test('归一化：单位后缀（存量重跑 #179）', () => {
  assert.ok(answersEquivalent('1.75×10^9 mL', '1.75×10^9'))
  assert.ok(answersEquivalent('15cm', '15'))
  // ⚠️ 成对条件：单位不同（cm vs m）必须保持为两个答案
  assert.ok(!answersEquivalent('5cm', '5m'))
  assert.ok(!answersEquivalent('1.75×10^9 mL', '1.75×10^9 L'))
})

test('归一化：纯三角形列表的顶点顺序（存量重跑 #156）', () => {
  assert.ok(answersEquivalent('△ACE、△BEO、△CDO', '△ACE、△OBE、△OCD'))
  assert.equal(normalizeAnswerKey('△BEO'), '△BEO')
  assert.equal(normalizeAnswerKey('△OBE'), '△BEO')
})

test('回归：相似符号里的三角形顺序有语义，绝不能排序（防上面那条越界）', () => {
  // △ABC∽△DEF 表示 A↔D、B↔E、C↔F；△ABC∽△EDF 是另一组对应关系，不是同一个答案
  assert.ok(!answersEquivalent('△ABC∽△DEF', '△ABC∽△EDF'))
  assert.equal(normalizeAnswerKey('△ABC∽△DEF'), '△ABC∽△DEF')
})

test('归一化：带分数（混数）—— 必须在去空白之前处理（存量重跑 #49）', () => {
  // `1 6/7` 是 13/7；SYMBOL_FOLD 的 \s+→'' 会把它压成 `16/7`（错值），
  // 于是与模型写的 `13/7` 判成两个答案。所以混数折叠必须先做。
  assert.ok(answersEquivalent('1 6/7', '13/7'))
  assert.equal(normalizeAnswerKey('1 6/7'), '13/7')
  assert.equal(normalizeAnswerKey('2 1/2'), '5/2')
  assert.ok(answersEquivalent('-1 6/7', '-13/7'))
  // 不能把普通分数/整数误伤
  assert.equal(normalizeAnswerKey('13/7'), '13/7')
  assert.ok(!answersEquivalent('1 6/7', '16/7'))
})

test('回归：真实数值差异 / 描述型差异仍须判为不同（宁可多报，不可漏报）', () => {
  // 1.60×10¹¹ 与 1.5990×10^11 是两个数（有效数字不同），必须留给人工定夺
  assert.ok(!answersEquivalent('1.60×10¹¹', '1.5990×10^11'))
  // 描述型答案无法可靠归一，保持分歧
  assert.ok(!answersEquivalent('正方形面积为 4π，圆的半径为 2', '4π，2'))
  assert.ok(!answersEquivalent('x是无理数', '错误'))
  // 判断题的 是 / 不是 是相反结论，剥离后不能双双变成空串而误判等价
  assert.ok(!answersEquivalent('不是', '是'))
})
