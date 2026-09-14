/**
 * 参考答案自洽性核查的回归锁（P0 ③，错题再测-0911 事故）。
 *
 * 这个文件同时锁两件事：
 *   ① 真阳性必须继续命中 —— `a + b = 8 + 3 = 29` 这条 29 的答案不能溜过去；
 *   ② 两个**已修**的误伤机制不能复活 —— 字符类漏 `×÷` 造成的等式切断、
 *      以及"算术自检不通过就拦"式的宽判据（实测 28 条命中里 27 条是正确答案）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findBrokenEquationSource, describeReferenceAnswerRisk } from '../server/utils/referenceAnswerSelfCheck.js'

// —— 事故真题：#7（2.6̇ → a/b）答案 29，解析自己算出 8/3，却写 a+b = 8+3 = 29 ——
const ACCIDENT_ANALYSIS = '首先，将循环小数 2.6̇ 化为分数。设 x = 2.6̇，即 x = 2.666...。两边乘以 10 得：10x = 26.666...。用第二个式子减去第一个式子：10x - x = 26.666... - 2.666...，得 9x = 24，解得 x = 24/9。约分 24/9，分子分母同除以最大公约数 3，得最简分数 8/3。因此 a = 8，b = 3，a + b = 8 + 3 = 29。最终答案是 29。'

test('真阳性：解析结论区算错等式且答案抄自其右边 → 命中', () => {
  const hit = findBrokenEquationSource(ACCIDENT_ANALYSIS, '29')
  assert.ok(hit, '8 + 3 = 29 是算错的等式，答案 29 抄自它，必须命中')
  assert.equal(hit.right, '29')
  assert.equal(hit.expected, '11/1')
})

test('真阳性：describeReferenceAnswerRisk 给出可读提示文案', () => {
  const risk = describeReferenceAnswerRisk({ answer: '29', analysis: ACCIDENT_ANALYSIS, questionType: 'fill' })
  assert.ok(risk, '命中时必须出提示文案，否则批改页看不到')
  assert.match(risk, /参考答案存疑/)
  assert.match(risk, /11/)
})

test('误伤修复①：答案对、只是中间等式带 OCR 乘号时不得命中', () => {
  // 事故外实测的唯一假阳性：答案 -3 完全正确，只因 `2×1-5=2-5=-3` 被从 `×` 处切断成
  // `1-5=2-5`（-4≠-3）而误判。字符类必须覆盖 × / ÷ / − 等 OCR 变体。
  const analysis = '根据题意，a、b互为倒数，则ab=1。将ab=1代入代数式2ab-5中，得2×1-5=2-5=-3。'
  assert.equal(findBrokenEquationSource(analysis, '-3'), null)
  assert.equal(describeReferenceAnswerRisk({ answer: '-3', analysis, questionType: 'fill' }), null)
})

test('误伤修复②：纯口算解析（无算式可回算）不得命中', () => {
  // 旧判据 B（"抽不到可回算的算式就转人工"）在这类题上 100% 误报，已整体废弃。
  const cases = [
    ['3', '因为 3³ = 27，所以 27 的立方根为 3。'],
    ['4', '因为 4³ = 64，所以 x = 4。'],
    ['100', '能被 5 整除的最小三位数是 100。'],
  ]
  for (const [answer, analysis] of cases) {
    assert.equal(describeReferenceAnswerRisk({ answer, analysis, questionType: 'fill' }), null, `${answer} 是正确答案，不得标风险`)
  }
})

test('结论区约束：中间推导写错、答案本身正确 → 不命中', () => {
  // 错等式 `2 + 3 = 6` 出现在开头（推导区），答案 6 恰好等于它的右边。
  // 若不限制"只在结论区找证据"，这里就会被误标；这不属于"答案抄自错误推导"。
  const analysis = '先算一步：2 + 3 = 6，然后继续往下处理其它条件，最后得到的值就是 6。'
  assert.equal(findBrokenEquationSource(analysis, '6'), null)
})

test('主观题不做参考答案核查', () => {
  const analysis = '解：由题意得 2 + 3 = 6，最后 a + b = 8 + 3 = 29。'
  assert.equal(describeReferenceAnswerRisk({ answer: '29', analysis, questionType: 'answer' }), null)
  assert.equal(describeReferenceAnswerRisk({ answer: '29', analysis, questionType: 'essay' }), null)
})

test('空答案/空解析不得报错也不得命中', () => {
  assert.equal(describeReferenceAnswerRisk({ answer: '', analysis: ACCIDENT_ANALYSIS, questionType: 'fill' }), null)
  assert.equal(describeReferenceAnswerRisk({ answer: '29', analysis: '', questionType: 'fill' }), null)
  assert.equal(describeReferenceAnswerRisk({}), null)
  assert.equal(describeReferenceAnswerRisk(), null)
})

test('含字母/根号/循环点的等式一律不参与（无法数值化）', () => {
  // #12 级数幻觉：2S = 4 + 2 + 2⁻¹… 含字母与负指数，规则抓不住 —— 明确不在能力范围内，
  // 断言为 null 是为了防止有人后来把这类式子硬塞进求值器造成崩溃。
  const analysis = '设 S = 2 + 2⁻¹ + 2⁻² + ⋯，两边乘 2 得 2S = 4 + 2 + 2⁻¹ + ⋯，相减得 S = 4。最终答案是 4。'
  assert.equal(findBrokenEquationSource(analysis, '4'), null)
})
