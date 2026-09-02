/**
 * AI 解析结果自检：抽 answer/student_answer/analysis 三个字段做一致性校验，
 * 把"步骤对结论错"算术幻觉 + answer 串行污染两路都标出来。
 *
 * 历史背景：2026-09-02 截图案例——y=3(x-1)²+2 代入 x=6，AI 展开步骤全对，
 * "最终答案为 83"，实际应为 77。同一 prompt 还把学生手写答案污染进 answer 列。
 * OCR 阶段 Qwen3-VL 一次返回的 answer/analysis 都是 LLM 自由输出，
 * 算术幻觉与字段串行污染是模型特性，单靠 prompt 措辞治不了。
 */

import { validateArithmeticAnswer } from './arithmeticAnswerValidator.js'

const CAP = '((?:[^\\n。！？]|\\.(?=[0-9]))+)'
const SEP = '[：:]?\\s*(?:[是为]\\s*[：:]?)?\\s*'

// 与 worker.js:1320 保持一致；不在此文件内单测 tail(800) 截断（已由原代码保障）
const ANSWER_MARKER_PATTERNS = [
  new RegExp(`(?:所以|因此|故)正确答案${SEP}${CAP}`, 'i'),
  new RegExp(`因此正确答案是${SEP}${CAP}`, 'i'),
  new RegExp(`正确答案是${SEP}${CAP}`, 'i'),
  new RegExp(`正确答案${SEP}${CAP}`, 'i'),
  new RegExp(`答案为${SEP}${CAP}`, 'i'),
  new RegExp(`故答案为${SEP}${CAP}`, 'i'),
  new RegExp(`答案是${SEP}${CAP}`, 'i'),
  new RegExp(`最终答案${SEP}${CAP}`, 'i'),
]

/**
 * 从 analysis 文本中抽"最终答案"字段。
 * 直接复用 worker.js 现有逻辑（CAP/SEP 模板避小数点误切 + tail(800) 截断）。
 * 返回的字符串是模型声称的最终答案，可包含逗号/分号分隔的多空答案。
 */
export function extractFinalAnswerFromAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'string') return null
  const tail = analysis.length > 800 ? analysis.substring(analysis.length - 800) : analysis
  for (const pattern of ANSWER_MARKER_PATTERNS) {
    const match = tail.match(pattern)
    if (match && match[1]) {
      const extracted = match[1].trim().replace(/[，,；;、.]+$/, '').trim()
      if (extracted) return extracted
    }
  }
  return null
}

/**
 * 抽出字符串中所有数字串（整数 + 小数），按出现顺序去重。
 * 例: "y=3x²-6x+5, 83" → ["3", "5", "83"]
 */
export function extractNumericTokens(text) {
  if (!text || typeof text !== 'string') return []
  const seen = new Set()
  const result = []
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!seen.has(m[0])) {
      seen.add(m[0])
      result.push(m[0])
    }
  }
  return result
}

/**
 * 集合 Jaccard 相似度。零依赖，纯 Set 操作。
 * 两侧都为空 → 0（视为"无证据"，不触发任何阈值）
 */
export function numericJaccard(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const x of setA) if (setB.has(x)) intersection += 1
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * 把分析文本里的算式归一化到 validateArithmeticAnswer 能吃的形态。
 * 关键处理：n² → n*n、n³ → n*n*n、×÷ 转 ASCII 乘除号，其它符号复用 arithmeticAnswerValidator。
 *
 * 此函数不导出；外层只用 extractExprCandidates。
 */
function normalizeMathExpression(raw) {
  return String(raw)
    .replace(/(\d)\s*²/g, '$1*$1')
    .replace(/(\d)\s*³/g, '$1*$1*$1')
    .replace(/[×✕·]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, '')
}

/**
 * 取字符串里最后一个数字串（含负号、小数）。用于把 "y=3x²-6x+5, 83" 拆出 "83"。
 * 算术自检必须拿纯数字与算式比，拿整段含字母的"最终答案"会让 validator
 * 的字母过滤直接 applicable:false，漏报所有含函数表达式的题。
 */
function extractTrailingNumber(text) {
  if (!text || typeof text !== 'string') return null
  const matches = text.match(/-?\d+(?:\.\d+)?/g)
  if (!matches || matches.length === 0) return null
  return matches[matches.length - 1]
}

/**
 * 从 analysis 文本里尽可能多地抽算式片段，用于自检"analysis 末尾的 X 能否从算式回算"。
 * 抓两种形态：
 *   1) "= 算式"（等号右侧的算式，最常见）
 *   2) "x=N: 算式"（代入值后的算式）
 *
 * 抽不出或形态不合法时返回空数组 —— 调用方按"无证据"处理，不算 fail。
 */
export function extractExprCandidates(analysis) {
  if (!analysis || typeof analysis !== 'string') return []
  const candidates = new Set()

  // 等号右侧算式。至少 3 字符防 "=1" 这种误入。
  for (const m of String(analysis).matchAll(/[=＝]\s*([0-9+\-*/×÷()（）.^²³\s]{3,})/g)) {
    const norm = normalizeMathExpression(m[1])
    if (/\d/.test(norm) && /[+\-*/]/.test(norm)) {
      candidates.add(norm)
    }
  }

  // 代入后算式：x=6: y=3*36-36+5 ... 截掉"y="前缀
  for (const m of String(analysis).matchAll(/[xX]\s*=\s*[\-]?\d+\s*[：:]?\s*([0-9+\-*/×÷()（）.^²³\s]{3,})/g)) {
    const stripped = m[1].replace(/^\s*[a-zA-Z]\s*=\s*/, '')
    const norm = normalizeMathExpression(stripped)
    if (/\d/.test(norm) && /[+\-*/]/.test(norm)) {
      candidates.add(norm)
    }
  }

  return Array.from(candidates)
}

/**
 * 主入口。对 AI 返回的单题结果做三项自检：
 *   - serial_pollution: answer 与 student_answer 数字串高度重叠且 answer 无独立数字
 *   - arithmetic_mismatch: analysis 末尾 X 没法从任一算式候选回算
 *   - self_check_skipped: analysis 末尾显式【未自检】
 *
 * 返回 { pass: boolean, issues: string[] }。
 * 调用方拿到 false 时不要直接拒绝入库 —— 见 worker.js createQuestions 的重试 + 标记策略。
 */
export function aiParseSelfCheck(aiResult) {
  const issues = []
  if (!aiResult || typeof aiResult !== 'object') {
    return { pass: false, issues: ['invalid_input'] }
  }

  const { answer, student_answer, analysis } = aiResult

  // 1. 串行污染：answer 的数字串集合几乎被 student_answer 覆盖，且 answer 自身没新数字
  // 排除"合法答对"：当 answer 与 student_answer 数字完全相同（jaccard=1 且 sOnly=[]），
  // 那是学生答对了，AI 也照参考答案填了同一个值，**不算污染**。
  // 真污染特征是 student 写了更多数字、answer 只是抄了其中若干 —— 也就是 sOnly 非空。
  const aNums = extractNumericTokens(answer)
  const sNums = extractNumericTokens(student_answer)
  if (aNums.length > 0 && sNums.length > 0) {
    const jac = numericJaccard(aNums, sNums)
    const aOnly = aNums.filter(x => !sNums.includes(x))
    const sOnly = sNums.filter(x => !aNums.includes(x))
    if (jac > 0.6 && aOnly.length === 0 && sOnly.length > 0) {
      issues.push('serial_pollution')
    }
  }

  // 2. 算术自检：analysis 末尾的"最终答案"必须可被至少一个算式回算
  const finalAns = extractFinalAnswerFromAnalysis(analysis)
  // 自检跳过标记：模型主动声明无法自检 —— 这条与 finalAns 是否有值无关，
  // 即便 AI 没填最终答案，光标"【未自检】"也是信号。
  if (analysis && /【未自检】/.test(analysis)) {
    issues.push('self_check_skipped')
  } else if (finalAns) {
    // 只取末位数字与算式比对；含函数表达式（"y=3x²-6x+5"）的整段会触发
    // validateArithmeticAnswer 的字母过滤直接 applicable:false，必须先拆数字。
    const finalAnsNum = extractTrailingNumber(finalAns)
    if (finalAnsNum) {
      const candidates = extractExprCandidates(analysis)
      const verified = candidates.some(expr => {
        try {
          return validateArithmeticAnswer(expr, finalAnsNum).isValid
        } catch {
          return false
        }
      })
      if (!verified) {
        issues.push('arithmetic_mismatch')
      }
    }
    // 末位无数字（如"最终答案为 y=3x²-6x+5"）：证据不足，不触发
  }

  return { pass: issues.length === 0, issues }
}
