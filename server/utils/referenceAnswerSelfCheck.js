/**
 * 参考答案自洽性核查（P0 ③，2026-09-14 错题再测-0911 事故）
 *
 * 治什么
 *   答案引擎（deepseek-v4-pro）深解时偶尔「步骤对、结论错」，而 answer 字段照抄了那个
 *   错误结论，判等层于是把答对的学生判成错。事故实证：
 *     #7(2.6̇→a/b) 解析写完 8/3 却落笔「a + b = 8 + 3 = 29」，答案 29（正确 11）；
 *     #4(|x|=√6…) 解析自己推出 x+y = √6+2（≈4.45），末句却写「最终答案是 2」，答案 2；
 *     #12(级数)    2S 应为 4+1+…，解析写成 4+2+…，答案 4（正确 3）。
 *
 * 只做一件事：找「答案抄自一个算错的等式」的铁证（判据 A）。
 *   解析结论区存在一个**纯算术等式**且它本身算错，而 answer 恰好等于该等式的右边
 *   ⇒ 答案的来源就是一个错误的推导，标风险、交老师定。
 *
 * 为什么不做「算术自检不通过就拦」——已用 586 条真实缓存回测否决
 *   原本还想加判据 B（answer 是单值且解析里抽不到能回算它的算式 → 转人工）。
 *   实测全库命中 28 条，逐条核验**只有 1 条是真幻觉**（#4），其余 27 条是正确答案：
 *   `27 的立方根为 3`、`√9 的算术平方根是 3`、`x³=64 则 x=4`……全被误判。
 *   原因是解析写法千变万化（口算、文字描述、算式片段被截断），"抽不到可回算的算式"
 *   根本不等于"答案错"。这类判据一旦上线就是大面积误伤，故**不实现**。
 *
 * 边界（故意不管）
 *   - 主观题（answer/essay/proof/drawing/composition）：叙述本身就是答案。
 *   - 含字母/根号/π/循环点的推导（`2S = 4 + 2 + …`、`100x = 312.222…`）：无法数值化。
 *     #12 那条级数幻觉属此类，规则抓不住，只能靠老师对照 ai_answer + analysis 人工判断。
 *
 * 用法
 *   findBrokenEquationSource(analysis, answer) → 命中的错误等式 | null
 *   describeReferenceAnswerRisk({ answer, analysis, questionType }) → 提示文案 | null
 *
 * 纯函数、零副作用；worker（入库时标注）与回填脚本共用同一口径。
 */
import { validateArithmeticAnswer } from './arithmeticAnswerValidator.js'

const SUBJECTIVE_TYPES = new Set(['answer', 'essay', 'proof', 'drawing', 'composition'])

/**
 * 解析里的「纯算术等式」：两侧只允许数字与算符。
 *
 * 字符类必须把 OCR 常见变体（×✕·÷、−–—、全角括号）一并收进来：
 * 漏掉 `×` 时 `2×1-5=2-5=-3` 会被从中间切断成 `1-5=2-5`，凭空造出一个"算错的等式"
 * ——实测这正是唯一的假阳性来源（answer=-3 本来是对的）。
 * 求值侧的归一化由 validateArithmeticAnswer 内部完成，这里只负责别切错。
 * 刻意不含字母/根号/π/循环点：这些等式无法数值化，硬算必然误判。
 */
const ARITHMETIC_EQUATION_RE = /(?<![\d.])(\d[\d+\-*/().\s×✕·÷−–—（）]{0,40}?)\s*=\s*(\d[\d+\-*/().\s×✕·÷−–—（）]{0,40})(?![\d.])/g

const isSubjective = (t) => SUBJECTIVE_TYPES.has(String(t || '').toLowerCase())

/**
 * 两个「纯算术」串是否数值相等；任一不可解析 → false。
 *
 * 注意：validateArithmeticAnswer 的 applicable 要求两侧都**含运算符**（纯数字串会被
 * 判成"不是算式"直接 applicable:false）。所以两侧各补 `+0`：不改变数值，又能让
 * `29` 这种纯数字进入求值器。缺这一步时 `8 + 3 = 29` 这类"答案来自算错等式"永远抓不到
 * （实测 #7 的 29 因此漏判）。
 */
function numericallyEqual(expr, value) {
  if (typeof expr !== 'string' || typeof value !== 'string' || !expr.trim() || !value.trim()) return false
  try {
    const r = validateArithmeticAnswer(`${expr}+0`, `${value}+0`)
    return r.applicable === true && r.isValid === true
  } catch {
    return false
  }
}

/**
 * 找「答案抄自算错等式」的铁证。
 *
 * 只认**结论区**（后 40% 文本）的等式：模型在中间推导里写错一个中间等式、最终答案却
 * 正确的情况很常见，只有结论区的等式才构成"答案抄自哪里"的证据。
 *
 * @returns {{left:string,right:string,expected:string,actual:string}|null}
 */
export function findBrokenEquationSource(analysis, answer) {
  if (!analysis || typeof analysis !== 'string' || !answer) return null
  const text = analysis.length > 2000 ? analysis.slice(-2000) : analysis
  const conclusionStart = Math.floor(text.length * 0.6)
  ARITHMETIC_EQUATION_RE.lastIndex = 0
  let m
  while ((m = ARITHMETIC_EQUATION_RE.exec(text)) !== null) {
    if (m.index < conclusionStart) continue
    const left = m[1]
    const right = m[2]
    let eq
    try { eq = validateArithmeticAnswer(left, right) } catch { continue }
    if (!eq.applicable || eq.isValid) continue
    // 答案必须正好等于这个算错的等式的右边，才说明答案是从它抄来的
    if (numericallyEqual(right, String(answer))) {
      return { left: left.trim(), right: right.trim(), expected: eq.expected, actual: eq.actual }
    }
  }
  return null
}

/**
 * 参考答案风险提示文案；无可证据的风险返回 null。
 *
 * 只提示、**不改判定**：风险标注写入 questions.ai_answer_risk_reason
 * （列 050 迁移已建，语义即「AI 给出了结论，但参考本身可能不可靠」，
 * 前端 getAiAnswerRiskText 在 wrong 状态也会展示）。
 *
 * @param {{answer?: string, analysis?: string, questionType?: string}} input
 * @returns {string|null}
 */
export function describeReferenceAnswerRisk({ answer, analysis, questionType } = {}) {
  if (isSubjective(questionType)) return null
  const value = String(answer ?? '').trim()
  if (!value) return null
  const broken = findBrokenEquationSource(analysis, value)
  if (!broken) return null
  return `参考答案存疑：解析结论区的算式「${broken.left}=${broken.right}」本身算错（应得 ${broken.expected}），参考答案正好等于它的右边，疑似照抄了错误推导，请人工确认`
}
