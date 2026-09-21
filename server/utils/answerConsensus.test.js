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
