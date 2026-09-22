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

  // ── 2026-09-22 误清空事故（第三次同族）──────────────────────────────
  // 根因：省略号 `⋯`/`…` 不在候选字符集 → 无穷级数题干被切成**不完整的有限和**。
  //   题干「求 2⁰+2⁻¹+2⁻²+2⁻³+2⁻⁴+⋯ 的值」→ 切出 `2⁰+2⁻¹+2⁻²+2⁻³+2⁻⁴`（缺最后一项）
  //   → evaluate 得 31/16，而真实正解是无穷级数和 2/1 → 判「验算不符」→ 清空正确答案。
  //   今日 8 条、全库 10 条被误伤。
  // 修法：加「算式完整性闸」——含省略号 / 缺操作数 / 括号不配对 → 一律 applicable:false。
  // 前两次同族事故（09-15 缺上标、09-20 参照分数）都只补特例，故本次建立总闸。
  {
    question: '请仿照这种方法，解决下面的问题：(2) 求 2⁰ + 2⁻¹ + 2⁻² + 2⁻³ + 2⁻⁴ + ⋯ 的值。',
    answer: '2/1',
    valid: true,
    applicable: false,
  },
  {
    // 同一题的平文本变体（OCR 可能把上标拍平），也必须跳过
    question: '请仿照这种方法，解决下面的问题：(2) 求 2^0 + 2^-1 + 2^-2 + 2^-3 + 2^-4 + ⋯ 的值。',
    answer: '2/1',
    valid: true,
    applicable: false,
  },
  {
    // 省略号在句中（`1+1/2+1/4+...`）：同样不得按有限和求值
    question: '计算 1 + 1/2 + 1/4 + ... 的值。',
    answer: '2/1',
    valid: true,
    applicable: false,
  },
  {
    // 缺右操作数（算式被截断）：`12 +` 不是完整算式，不得拿来当正解
    question: '计算 12 + 的值。',
    answer: '99/1',
    valid: true,
    applicable: false,
  },
  {
    // 括号不配对：片段而非完整算式
    question: '计算 (12 + 8 的值。',
    answer: '99/1',
    valid: true,
    applicable: false,
  },
  {
    // 反例：省略号不得让**正常算式**跟着放水 —— 无省略号的完整算式仍须真校验
    question: '计算 2⁰ + 2⁻¹ + 2⁻² + 2⁻³ + 2⁻⁴ 的值。',
    answer: '31/16',
    valid: true,
    applicable: true,
  },
  {
    question: '计算 2⁰ + 2⁻¹ + 2⁻² + 2⁻³ + 2⁻⁴ 的值。',
    answer: '2/1',
    valid: false,
    applicable: true,
  },

  // ── 2026-09-22 第 4 次同族误清空事故：÷ 后跟裸分数被左结合拆成 ÷a÷b ──
  // d17c12ce 任务（数学作业 09/22 17:51）9.1/9.2/10.1 三题正解被清空转人工：
  //   `1 3/4 ÷ 4/7` → `(1+3/4)/4/7` → (7/4÷4)÷7 = 1/16 ≠ 49/16 →「验算不符」清空。
  //   根因：normalizeExpression 先把 ÷ 归一成 /，带分数规则又只括号化「整数+分数」，
  //   裸分数除数失去括号 → 左结合。修复：÷ 后紧跟分数先括号化。
  {
    question: '计算。\n1 3/4 ÷ 4/7',
    answer: '49/16',
    valid: true,
  },
  {
    question: '计算。\n1 ÷ 3/5',
    answer: '5/3',
    valid: true,
  },
  {
    question: '计算。\n3 1/3 ÷ 9/2',
    answer: '20/27',
    valid: true,
  },
  {
    // 除数是带分数：修前就正确（被混合数规则括号化），修后不得回归
    question: '计算。\n1 1/3 ÷ 5 3/5',
    answer: '5/21',
    valid: true,
  },
  {
    // 反例：答案真错时仍必须拦下（不得因为修复而放水）
    question: '计算。\n1 3/4 ÷ 4/7',
    answer: '21/16',
    valid: false,
  },
  {
    // 09-20「参照分数当算式」同族残留：参照混合数 N N/D 不得被当算式求值。
    // 修前：`2 2/3` 被当成算式算出 8/3，与正解 1/2 比对"不符"→ 清空（同日 #11）。
    // 修后：单个数/单个混合数不是算式 → applicable:false 跳过校验、保留答案。
    question: '一个分数，乘 3/5、2 2/3、1 1/4 的积是最小正整数，求这个分数。',
    answer: '1/2',
    valid: true,
    applicable: false,
  },
]

for (const testCase of cases) {
  const result = validateArithmeticAnswer(testCase.question, testCase.answer)
  assert.equal(result.isValid, testCase.valid, JSON.stringify({ testCase, result }))
  if ('applicable' in testCase) assert.equal(result.applicable, testCase.applicable, JSON.stringify({ testCase, result }))
}

console.log(`arithmetic answer validator: ${cases.length} cases passed`)
