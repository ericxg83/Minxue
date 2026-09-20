import assert from 'node:assert/strict'
import { validateArithmeticAnswer } from '../server/utils/arithmeticAnswerValidator.js'

const cases = [
  {
    question: '计算：13 1/8 + [3 3/7 + (-3 6/7) + (-5.125)] + (-4/7)。',
    answer: '7',
    valid: true,
  },
  {
    question: '计算：13 1/8 + [3 3/7 + (-3 6/7) + (-5.125)] + (-4/7)。',
    answer: '3 1/8',
    valid: false,
  },
  {
    question: '计算：(1/2 - 3/4) × 8 ÷ 2。',
    answer: '-1',
    valid: true,
  },
  {
    question: '求 x：2x + 1 = 5。',
    answer: '2',
    valid: true,
    applicable: false,
  },

  // ── 2026-09-15 科学记数法误清空事故（老师报障「他原本说缺少参考答案，我手动批的」）──
  // 根因：候选片段的字符集里没有 Unicode 上标，题干 `-3.6×10⁻⁴` 被截成 `-3.6×10`
  // （**指数被吃掉**）→ 算出 -36 → 与正确答案 -0.00036 一比判「验算不符」→
  // worker 清空参考答案 + 转人工 → 页面显示「缺少参考答案」。
  // 全库 4 条同类误伤（3 条这道题的不同学生卷 + 1 条 (3/2)^2024·(-2/3)^2024）。
  {
    question: '一个数用科学记数法表示为 -3.6×10⁻⁴，这个数是____',
    answer: '-0.00036',
    valid: true,
  },
  {
    // 同题干，另一种 Unicode 负号（U+2212），OCR 与教材排版都常见
    question: '一个数用科学记数法表示为 −3.6×10⁻⁴，这个数是___',
    answer: '-0.00036',
    valid: true,
  },
  {
    // 反例：同一个题干，答案真的不对，必须继续拦下（不得因为修上标而放水）
    question: '一个数用科学记数法表示为 -3.6×10⁻⁴，这个数是____',
    answer: '-0.0000036',
    valid: false,
  },
  {
    // 正指数：5×10² = 500
    question: '5×10²',
    answer: '500',
    valid: true,
  },
  {
    // 答案本身写成科学记数法也要能求值
    question: '500×500',
    answer: '2.5×10⁵',
    valid: true,
  },
  {
    // 指数超限：无法精确求值就必须放弃校验（applicable:false），
    // 绝不能靠"切开算式取半截"算出一个看似合理的错值去比对 —— 那正是事故的成因。
    question: '(3) (3/2)^2024 · (-2/3)^2024',
    answer: '1',
    valid: true,
    applicable: false,
  },

  // ── 2026-09-20 误清空事故（填空 #27「写出一个比1/4大，比1/3小且分母为48的最简分数」）──
  // 根因：题干里的**参照分数**（比1/4大、比1/3小）被提取成"算式" `1/4`，
  // evaluate 得 1/4，与正确答案 13/48 比对必不等 → 判「验算不符」→
  // worker 清空参考答案 + 转人工 → 页面显示「缺少参考答案，无法自动判定」。
  // 单个分数是数值不是算式，必须跳过校验；正确/错误答案都要放行给判题层处理。
  {
    question: '写出一个比1/4大，比1/3小且分母为48的最简分数。______',
    answer: '13/48',
    valid: true,
    applicable: false,
  },
  {
    question: '写出一个比1/4大，比1/3小且分母为48的最简分数。______',
    answer: '1/2',
    valid: true,
    applicable: false,
  },
  {
    // 反例：多个分数组成**真实算式**时仍必须继续校验（不得因修参照分数而放水）
    question: '计算：1/4 + 1/3。',
    answer: '7/12',
    valid: true,
    applicable: true,
  },
  {
    question: '计算：1/4 + 1/3。',
    answer: '1/2',
    valid: false,
    applicable: true,
  },
]

for (const testCase of cases) {
  const result = validateArithmeticAnswer(testCase.question, testCase.answer)
  assert.equal(result.isValid, testCase.valid, JSON.stringify({ testCase, result }))
  if ('applicable' in testCase) assert.equal(result.applicable, testCase.applicable, JSON.stringify({ testCase, result }))
}

console.log(`arithmetic answer validator: ${cases.length} cases passed`)
