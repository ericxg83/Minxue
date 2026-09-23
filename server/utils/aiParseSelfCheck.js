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
  // 2026-09-22 补（今日 d17c12ce 10.3/10.4 教训）：模型常说「最终结果为 1/8」，
  // 旧标记只认「最终答案」→ 救场提取返回 null → answer 字段为空的题直接「答案为空」转人工。
  new RegExp(`最终结果${SEP}${CAP}`, 'i'),
]

// 客观题 answer 字段里的「元话语」特征。命中即认为这条 answer 不是可对照的答案值，
// 而是模型的自述残句/整段解释（`应包含10`、`写作0.31818...（或标准循环小数记法…）`）。
// 主观题（essay/answer 等长答案）不适用本判据，只在 choice/fill/judge 上使用。
// 刻意保守：宁可漏判（走原有判等路径）也不要把正常答案判成「不可核对」推人工。
// 2026-09-22 补「矛盾/自检/无法确定/无法判断/存疑」（今日 #8 教训：模型把自检结论
// 「与 answer 一致，但解析中有矛盾」写进 answer 字段，客观题叙述闸没拦住直接入库，
// 学生因此被误判）。这些词只出现在元话语/退让里，不会出现在可对照的答案值中。
const NARRATION_HINTS = /应包含|应为|应该是|应该|注意|题目要求|按题目|见解析|写作|等等|以上|由于|因此|所以|说明|解释|可能|矛盾|自检|存疑|无法确定|无法判断/

// 候选值「不像答案」的较宽判据，只用于在多个答案标记之间**挑一个**（不用于拒写）。
// 比 NARRATION_HINTS 多的是解析口吻的动词：`解得…`、`取到…`、`不等于…`、`…为准`。
const CHATTY_FRAGMENT_RE = new RegExp(
  `${NARRATION_HINTS.source}|解得|不等于|正确|错误|选项|取到|满足条件|函数值为|分为|讨论|移项|代入|如图|为准`
)

/**
 * 判断 answer 字段是否是「不可入库的叙述型答案」（仅用于客观题）。
 *
 * 2026-09-14 新增（错题再测-0911 事故）：
 *   答案引擎的 answer 字段偶尔是元话语——解析里自言自语「所以正确答案应包含10」
 *   被当成答案写进 `questions.answer`，再经 question_cache 指纹复用传染给
 *   所有同题干的学生（全库 45/586 条缓存命中此类）。客观题的答案必须是可对照的短值，
 *   命中叙述特征时应当**拒写并转人工**，而不是把一个判等层永远对不上的字符串塞进库。
 *
 * 判据只用关键词，**不做长度阈值**：实测客观题里按长度（>30/40/60 字）判会把
 * 合法的多空答案（`(1)a⁶；(2)-x¹²；(3)x¹⁰`、`18的因数有1,2,3,6,9,18，其中…`）
 * 一起打成"叙述型"，误伤远大于收益；关键词口径在 360 条客观题缓存上命中 14 条且全是坏答案。
 */
export function isNarrativeAnswer(answer) {
  const s = String(answer ?? '').trim()
  if (!s) return false
  return NARRATION_HINTS.test(s)
}

/**
 * 剥掉答案尾部的分隔符。**保留无限小数的省略号**：`0.31818...` 的 `...` 是有信息的，
 * 统一按"最后两个字符是不是 `..`"来判断要不要剥那个孤立的句末点。
 * （2026-09-14：原先一律 `[，,；;、.]+$` 会把 `0.31818...` 吃成 `0.31818`，
 *   把一个无限小数变成了截断值 —— 参考答案从此与题目语义不符。）
 */
export function stripTrailingSeparators(value) {
  let out = String(value ?? '').replace(/[，,；;、\s]+$/, '')
  if (/[^.]\.$/.test(out)) out = out.replace(/\.$/, '')
  return out
}

/** 剥掉候选值两侧的语气脚手架：「应为 X」「以 X 为准」「“X”」。 */
export function cleanAnswerScaffold(value) {
  return stripTrailingSeparators(String(value ?? ''))
    .replace(/^[“"「'']\s*/, '')
    .replace(/\s*[”"」'']$/, '')
    .replace(/^(?:应为|应该是|应该是|应该|是|答案[是为：:]?|故|所以|以|写作|写为|记作)\s*/, '')
    .replace(/\s*(?:为准|即可|为止)\s*$/, '')
    .trim()
}

/**
 * 从 analysis 文本中抽"最终答案"字段。
 * 直接复用 worker.js 现有逻辑（CAP/SEP 模板避小数点误切 + tail(800) 截断）。
 * 返回的字符串是模型声称的最终答案，可包含逗号/分号分隔的多空答案。
 *
 * 2026-09-03 增 fallback：AI 在 analysis 末尾以"= 数/根式/分数"形式给答案，
 * 但 answer 字段写错（典型如题 14：analysis 末尾 "= 11/5"，answer 写 "√5"）。
 * 抓不到会导致自检全套通过、answer 字段悄悄错。fallback 限定取末行末段，避免
 * 误抓 analysis 中间步骤的等式右边。
 *
 * 2026-09-14 修正取值口径（错题再测-0911 事故）：
 *   旧实现按 pattern 列表顺序返回**第一个**命中，模型在解析里自我纠错/自言自语时
 *   （例：`……所以正确答案应包含10。……最终答案：2,3,5,6,7,8,10。`）会抓到中间那句
 *   `应包含10` 并写进 questions.answer —— 实测全库 45/586 条缓存答案因此不是文末答案。
 *   现在：收集**所有**命中，先筛掉「解析口吻」的候选（`解得…`、`以…为准`），
 *   在剩下的候选里取**位置最靠后**的一个；全都不干净时退回最后一个。
 *   实测 30 条多候选样本里 20+ 条因此拿到更完整的答案（`应为①、④、⑤`→`①,④,⑤`）。
 */
export function extractFinalAnswerFromAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'string') return null
  const tail = analysis.length > 800 ? analysis.substring(analysis.length - 800) : analysis

  const candidates = []
  for (const pattern of ANSWER_MARKER_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    let match
    while ((match = re.exec(tail)) !== null) {
      const value = cleanAnswerScaffold(match[1])
      if (value) candidates.push({ index: match.index, value })
      if (match.index === re.lastIndex) re.lastIndex += 1
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => a.index - b.index)
    const cleanOnes = candidates.filter(c => !CHATTY_FRAGMENT_RE.test(c.value))
    // 全是解析口吻的候选（`以 -1<t<0 为准`、`解得 m≠1…`）时返回 null：
    // 宁可让调用方保留 answer 字段原值，也不要拿半截句子去覆盖它。
    // （旧实现在这种情况下返回列表里先命中的那个，正是 `应包含10` 入库的成因之一。）
    return cleanOnes.length ? cleanOnes[cleanOnes.length - 1].value : null
  }

  // Fallback：analysis 末行以"= X"结尾，X 含数字/根号/字母/分数。
  // 取末行（按换行/句号切），避免抓到中间步骤的等式右边。
  const lastLine = tail.split(/[\n。]/).filter(s => s.trim()).pop() || tail
  const m = lastLine.match(/=\s*([^=\n]+\S)\s*[.。]?\s*$/)
  if (m && m[1]) {
    const extracted = m[1].trim()
    if (extracted) return extracted
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
 * 归一化后再做「answer 是否逐字抄了 student_answer」判定。
 *
 * 只抹掉纯排版差异（空白、换行、中英文标点、全角半角、LaTeX 的 $ 包裹），
 * **不抹数学结构** —— 幂次、根号、分数、正负号一律保留，避免把两道数学上
 * 不同但排版相近的答案判成同一串。
 *
 * @param {unknown} value
 * @returns {string} 归一化后的字符串（不可比时返回空串）
 */
function normalizeForCopyCheck(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\$/g, '')                       // LaTeX 定界符
    .replace(/\s+/g, '')                      // 所有空白（含换行）
    .replace(/[，。；：、,.;:]/g, '')          // 中英文标点
    .replace(/[（(]/g, '(').replace(/[）)]/g, ')')
    .replace(/[【\[]/g, '[').replace(/[】\]]/g, ']')
    .replace(/[“”"']/g, '')                    // 引号
    .replace(/[＝]/g, '=')
    .replace(/[＋]/g, '+').replace(/[－−]/g, '-')
    .trim()
}

/** 抄学生判定的最小长度门槛：短于此值不报，避免误伤「学生恰好答对」。 */
export const ANSWER_COPY_MIN_LEN = 8

/**
 * 「answer 是不是逐字抄了 student_answer」的唯一判据。
 *
 * 为什么独立导出：写入侧（worker 答案采纳链）与自检侧（aiParseSelfCheck）必须同口径，
 * 否则会出现「自检说污染、写入侧照样采纳」或反之的裂缝。两侧一律调本函数。
 *
 * 为什么门槛是 8：短答案（"24"、"8"、"-√2+2"）学生答对时与参考答案本来就该相同，
 * 报出来全是误伤；而真正的"抄学生"样本（整段证明/代数式/作图描述）都远超 8 字符。
 *
 * @param {unknown} answer 答案引擎产出的参考答案
 * @param {unknown} studentAnswer 学生的作答
 * @returns {boolean}
 */
export function detectAnswerCopiedFromStudent(answer, studentAnswer) {
  if (typeof answer !== 'string' || typeof studentAnswer !== 'string') return false
  const na = normalizeForCopyCheck(answer)
  const ns = normalizeForCopyCheck(studentAnswer)
  if (!na || !ns) return false
  return na === ns && Math.max(na.length, ns.length) > ANSWER_COPY_MIN_LEN
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
 * 主入口。对 AI 返回的单题结果做五项自检：
 *   - serial_pollution: answer 与 student_answer 数字串高度重叠且 answer 无独立数字
 *   - answer_copied_from_student: answer 与 student_answer **逐字全等**（2026-09-23 新增，
 *     见下）
 *   - arithmetic_mismatch: analysis 末尾 X 没法从任一算式候选回算
 *   - self_check_skipped: analysis 末尾显式【未自检】
 *   - answer_sign_mismatch: 学生答案含 ± 但 AI answer 完全不含 ±（典型：
 *   "√81 的平方根是____" 学生写 ±3，AI 给 9；把"平方根"当"算术平方根"
 *   答非所问）。仅判"学生写了 ± 而 AI 没写"方向，避免对 AI 多写 ± 误报。
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

  // 0. 符号集合冲突：学生答案含 ± 但 AI answer 完全不含
  // 触发场景：题目问"平方根"（x²=a 的所有解，可正可负）但 AI 误答"算术平方根"（默认非负）。
  // 仅判"学生写了 ± AI 没写"——反向（学生漏写 ±）保守不报，避免误伤多空填空。
  // 排除 answer 为 null / 空字符串（无标准答案时不参与判定）。
  if (typeof student_answer === 'string' && typeof answer === 'string' && answer.trim()) {
    const sPlusMinus = (student_answer.match(/±/g) || []).length
    const aPlusMinus = (answer.match(/±/g) || []).length
    if (sPlusMinus > 0 && aPlusMinus === 0) {
      issues.push('answer_sign_mismatch')
    }
  }

  // 0.5 【2026-09-23】answer 与 student_answer 逐字全等 ⇒ 答案引擎把学生笔迹读成了参考答案。
  //
  // 为什么必须单独加这一路：下面第 1 路的 serial_pollution 会**故意放过**数字集合完全相同的
  // 情形（注释见下：那时当成"学生答对了，AI 也照参考答案填了同一个值"）。那个豁免对纯数值题
  // 是合理的，但对**非数值类**答案（整段证明、代数式、作图描述、带过程的算式串）就失效了：
  // 学生写 "1+a+b-1+b-a+b=2b"，`answer` 也一字不差是 "1+a+b-1+b-a+b=2b" —— 这不可能
  // 是答案册原文，只可能是 OCR 把学生手写抄进了 answer 列。
  //
  // 实测规模（近 14 天，「缺少参考答案，无法自动判定」110 道）：**92 道（84%）命中本路**，
  // 且这 92 道 ai_self_check_passed 全为 true、issues 全为空 —— 即旧自检完全没看见。
  // 后果是这 92 道既拿不到参考答案、又被系统当成"引擎解不出来"，全部堆进人工复核。
  //
  // 判据刻意收得很紧（要求归一化后全等，且至少一边够长），避免把"学生恰好答对且答案就是
  // 这个值"的短答案误判成污染 —— 短答案（≤8 字符，如 "24"）不报，交由原 serial_pollution
  // 与数值判等去处理。
  if (detectAnswerCopiedFromStudent(answer, student_answer)) {
    issues.push('answer_copied_from_student')
  }

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

  // 2026-09-03 新增：answer 末段 = 右侧 与 analysis 抽出的最终答案不一致。
  // 典型场景：题 14 answer="a = ±1；√(b+√c) = √5"，analysis 末尾 "= 11/5"，
  // AI 把第 (2) 题的最终答案算对了，但 answer 字段抄错成 √5。光改
  // extractFinalAnswerFromAnalysis 让它能抽出 11/5 不够——还要比对答案字段自己
  // 写的最后子答案和分析算出的答案是否一致。
  // 限制：answer 含 = 才检测（无 = 的纯数值答案靠 arithmetic_mismatch 覆盖），
  // 两侧都是纯数值才走这条路（函数表达式如 y=½(x-2)² 让位给 arithmetic_mismatch）。
  // 用数字串集合比对——规范化字符串会把"√5"归到"5"被"11/5"包含，掩盖 bug。
  if (typeof answer === 'string' && answer.trim() && /=/.test(answer)) {
    const extractedFromAnalysis = extractFinalAnswerFromAnalysis(analysis)
    const lastEqMatch = answer.match(/=\s*([^=]+?)\s*[.。;；]?\s*$/)
    const answerLast = lastEqMatch ? lastEqMatch[1].trim() : null
    // 纯数值判断：只允许数字、空格、+/-/*/÷、/、√、±、(小数点/等号等基础算符)
    const isPureNumerical = (s) => /^[\d\s.+\-/(×÷)]*[\d/√±][\d\s.+\-/(×÷)]*$/.test((s || '').replace(/^=/, '').trim())
    if (extractedFromAnalysis && answerLast && answerLast.length <= 20 && extractedFromAnalysis.length <= 20
        && isPureNumerical(extractedFromAnalysis) && isPureNumerical(answerLast)) {
      const answerNums = extractNumericTokens(answerLast)
      const extractedNums = extractNumericTokens(extractedFromAnalysis)
      if (answerNums.length > 0 && extractedNums.length > 0) {
        const ansSet = new Set(answerNums)
        const extSet = new Set(extractedNums)
        const sameNums = answerNums.length === extractedNums.length && answerNums.every((n, i) => n === extractedNums[i])
        const sameSet = ansSet.size === extSet.size && [...ansSet].every(x => extSet.has(x))
        if (!sameNums && !sameSet) {
          issues.push('answer_extracted_mismatch')
        }
      }
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
