import { query, TABLES } from '../config/neon.js'
import { callTextCompletion } from '../config/ai.js'

// ============================================================
// 教学诊断服务
//
// 核心设计（与产品约定一致，勿混淆）：
//   1. 错题分两种形态：
//      - 空题（is_blank）：学生压根没写 → 不做错因分析，标记 is_blank=true 即可
//      - 做错（非空）：学生写了但错了 → 必须分析错因（error_type / error_reason）
//   2. 错因分析只对「做错」进行，空题绝不分析错因
//   3. AI 只在本地启发式判不了时兜底，且受 error_types 词表约束，绝不自由发挥
//   4. 全部走异步回填（runErrorDiagnosis），不进批改热路径
// ============================================================

// ── 空题判定 ──
const BLANK_PATTERNS = [
  /^\s*$/,
  /^\s*[无未]?\s*(?:作答|回答|答|写|填|做)?\s*[。.]?\s*$/i,
  /^\s*\/\s*$/,
  /^\s*[×xX✗✘]\s*$/,
  /^\s*无\s*$/,
  /^\s*不会\s*$/,
]

/**
 * 判定一道错题是否为「空题」（学生未作答）。
 * 优先使用 questions.answer_source='blank'（系统已有标记），
 * 兼容自包含 wrong_questions 的 student_answer 文本。
 */
export function isBlankAnswer({ studentAnswer, answerSource } = {}) {
  if (answerSource === 'blank') return true
  if (studentAnswer === null || studentAnswer === undefined) return true
  const text = String(studentAnswer).trim()
  if (!text) return true
  return BLANK_PATTERNS.some(p => p.test(text))
}

// ── 单位/数字辅助 ──
const UNIT_WORDS = [
  '元', '角', '分', '米', '厘米', '毫米', '千米', '分米', '克', '千克', '吨',
  '升', '毫升', '小时', '时', '分钟', '分', '秒', '天', '个', '本', '只', '棵',
  '张', '支', '辆', '人', '名', '岁', '倍', '角', '度', '°', '%', '％',
]

const stripNumber = (s) => String(s || '')
  .replace(/\s+/g, '')
  .replace(/[，,。．.：:；;]/g, '')
  .replace(/^(约|大约|等于|得|答案(是|为)?|所以|最终)/, '')
  .replace(/(元|角|分|米|厘米|毫米|千米|克|千克|吨|升|毫升|小时|分钟|秒|个|本|只|棵|张|支|辆|人|名|岁|倍|度|°)$/g, '')
  .replace(/(%|％)$/, '')

/** 提取答案中的纯数字（含分数/小数/百分数），无则返回 null */
function extractNumber(text) {
  const t = stripNumber(String(text || ''))
  const m = t.match(/(-?\d+(?:\.\d+)?|\d+\/\d+)/)
  return m ? m[1] : null
}

/** 判断答案文本是否带单位词 */
function hasUnit(text) {
  const t = String(text || '')
  return UNIT_WORDS.some(u => t.includes(u))
}

// ── 本地启发式错因分析（零 LLM，高把握才用，否则返回 null 交给 LLM）──

/**
 * @param {Object} q - { content, studentAnswer, correctAnswer, questionType, options }
 * @returns {{ errorType: string, reason: string, confidence: number } | null}
 */
export function analyzeErrorLocally({ content, studentAnswer, correctAnswer, questionType }) {
  if (!studentAnswer || !correctAnswer) return null
  const student = String(studentAnswer).trim()
  const correct = String(correctAnswer).trim()
  if (!student || !correct) return null

  // 1. 单位错误：正确答案带单位而学生答案不带（数字对得上/接近）
  const studentNum = extractNumber(student)
  const correctNum = extractNumber(correct)
  if (correctNum && studentNum && studentNum === correctNum) {
    const correctHasU = hasUnit(correct)
    const studentHasU = hasUnit(student)
    if (correctHasU && !studentHasU) {
      return { errorType: '单位错误', reason: `结果数字正确但漏写了单位（${correct}）`, confidence: 0.8 }
    }
  }

  // 2. 计算错误：双方都是纯数值且结果不同（数字型题，多半是计算失误）
  if (correctNum && studentNum && studentNum !== correctNum) {
    const isCalc = /计算|求值|求下列|化简|解方程|=\s*[?？]|\d+\s*[+\-×÷*/]\s*\d+/.test(String(content || ''))
    if (isCalc) {
      return { errorType: '计算错误', reason: `学生算出 ${studentNum}，正确应为 ${correctNum}，属计算环节失误`, confidence: 0.6 }
    }
  }

  // 3. 步骤遗漏：解答题学生答案明显短于正确答案（仅示意性提示，低置信度）
  if (questionType === 'answer' && student.length * 2 < correct.length && correct.length > 20) {
    return { errorType: '步骤遗漏', reason: '答案较标准解析明显过短，可能省略了解题步骤', confidence: 0.5 }
  }

  return null
}

// ── LLM 约束式错因分析（本地判不了才用）──

let _errorTypesCache = null

export async function getErrorTypes() {
  if (_errorTypesCache) return _errorTypesCache
  const { rows } = await query(
    `SELECT name FROM ${TABLES.ERROR_TYPES} ORDER BY sort_order`
  )
  _errorTypesCache = rows.map(r => r.name)
  return _errorTypesCache
}

export function buildErrorAnalysisPrompt(errorTypeList, subject = null) {
  return `你是一位 K12 错因诊断助手。给定一道学生已作答但答错的题（不是空题，学生确实写了答案），从给定的错误原因列表中选择最匹配的 1 个，并简述理由。只返回 JSON，不要输出任何额外说明。
${subject ? `学科：${subject}\n` : ''}
可选错误原因（必须从中选择，不得自创）：${errorTypeList.join('、')}

返回格式：
{
  "error_type": "计算错误",
  "reason": "一句话说明错因",
  "confidence": 0.9
}

要求：
1. error_type 必须严格来自上面的列表。
2. 无法确定错因时 confidence 给 0.4 以下。
3. reason 用中文，不超过 40 字。`
}

/**
 * 用 LLM 分析做错题目的错因（受 error_types 词表约束）。
 * 主备 API 全失败时返回 null（保持字段为空，留待回填重试），不写「未分类」。
 */
export async function analyzeErrorWithLLM({ content, studentAnswer, correctAnswer, questionType, subject }, retryCount = 0) {
  try {
    const errorTypeList = await getErrorTypes()
    const prompt = buildErrorAnalysisPrompt(errorTypeList, subject)

    const userContent = [
      `题目：${content || '(无题目文本)'}`,
      `学生答案：${studentAnswer || '(空)'}`,
      `正确答案：${correctAnswer || '(空)'}`,
      `题型：${questionType || 'unknown'}`,
    ].join('\n')

    const { content: raw } = await callTextCompletion({
      systemContent: prompt,
      userContent,
      temperature: 0.2,
      maxTokens: 500
    })
    if (!raw) throw new Error('AI 返回内容为空')

    let jsonStr = raw
    const jsonMatch = raw.match(/```json\n?([\s\S]*?)\n?```/) || raw.match(/```\n?([\s\S]*?)\n?```/)
    if (jsonMatch) jsonStr = jsonMatch[1]

    let result
    try {
      result = JSON.parse(jsonStr)
    } catch (parseError) {
      const repaired = jsonStr
        .replace(/'/g, '"')
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
        .replace(/,\s*([}\]])/g, '$1')
      try {
        result = JSON.parse(repaired)
      } catch {
        throw new Error(`JSON 解析失败: ${parseError.message}`)
      }
    }

    const errorType = String(result.error_type || '').trim()
    // 词表校验：不在 error_types 列表内的一律丢弃，防止 AI 自由发挥
    if (!errorType || !errorTypeList.includes(errorType)) {
      console.warn(`[诊断] AI 返回的错因「${errorType}」不在词表内，已丢弃`)
      return null
    }

    let confidence = Number(result.confidence)
    if (!Number.isFinite(confidence)) confidence = 0.5
    confidence = Math.max(0, Math.min(1, confidence))

    return {
      errorType,
      reason: String(result.reason || '').trim().slice(0, 80),
      confidence
    }
  } catch (error) {
    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    if (isNetworkError && retryCount < 2) {
      await new Promise(r => setTimeout(r, (retryCount + 1) * 2000))
      return analyzeErrorWithLLM({ content, studentAnswer, correctAnswer, questionType, subject }, retryCount + 1)
    }
    console.warn(`[诊断] LLM 错因分析失败: ${error.message}`)
    return null
  }
}

// ── 批量回填（异步任务，仿 backfillTags 模式）──

/**
 * 为「未分析」的错题补充 is_blank / error_type / error_reason / ai_confidence。
 * 扫描条件：error_type IS NULL 且 未标记为空题 —— 空题判定也会在此统一补齐 is_blank。
 *
 * 每条记录的处理顺序（勿乱）：
 *   1. 空题判定 → 空则写 is_blank=true，到此为止（不做错因）
 *   2. 非空 → 本地启发式
 *   3. 本地判不了 → LLM 约束式分析
 *   4. 全失败 → 保持 NULL，留待下次回填
 *
 * @param {{ limit?: number, trigger?: string, chain?: boolean }} opts
 */
export async function runErrorDiagnosis({ limit = 20, trigger = 'manual', chain = false } = {}) {
  const { rows: rows } = await query(
    `SELECT wq.id, wq.student_answer AS wq_answer, wq.is_blank,
            wq.content AS wq_content, wq.correct_answer AS wq_correct,
            wq.question_type AS wq_type,
            q.content AS q_content, q.student_answer AS q_answer,
            q.answer AS q_correct, q.answer_source, q.question_type AS q_type, q.subject
     FROM ${TABLES.WRONG_QUESTIONS} wq
     LEFT JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
     WHERE wq.error_type IS NULL
       AND (wq.is_blank IS NULL OR wq.is_blank = FALSE)
     ORDER BY wq.added_at DESC
     LIMIT $1`,
    [limit]
  )

  if (rows.length === 0) {
    console.log(`[Diagnosis] (${trigger}) 没有待分析的错题`)
    return { started: true, total: 0 }
  }

  console.log(`[Diagnosis] (${trigger}) 本批 ${rows.length} 道待分析`)

  let blank = 0
  let updated = 0
  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const w = rows[i]

    // 1. 空题判定：优先 questions.answer_source，其次文本
    const studentAnswer = w.wq_answer ?? w.q_answer ?? ''
    const isBlank = isBlankAnswer({
      studentAnswer,
      answerSource: w.answer_source
    })

    if (isBlank) {
      if (!w.is_blank) {
        await query(`UPDATE ${TABLES.WRONG_QUESTIONS} SET is_blank = TRUE, updated_at = NOW() WHERE id = $1`, [w.id])
        blank++
        console.log(`  [Diagnosis] ⬜ [${i + 1}/${rows.length}] ${String(w.id).slice(0, 8)}: 空题`)
      }
      continue
    }

    // 2~3. 做错 → 错因分析
    const content = w.wq_content || w.q_content || ''
    const correctAnswer = w.wq_correct ?? w.q_correct ?? ''
    const questionType = w.wq_type || w.q_type || null
    const subject = w.subject || null

    const local = analyzeErrorLocally({
      content,
      studentAnswer,
      correctAnswer,
      questionType
    })

    let result = local
    if (!result) {
      result = await analyzeErrorWithLLM({ content, studentAnswer, correctAnswer, questionType, subject })
    }

    if (!result) {
      skipped++
      console.log(`  [Diagnosis] ⏭️ [${i + 1}/${rows.length}] ${String(w.id).slice(0, 8)}: 无法判定错因`)
      continue
    }

    await query(
      `UPDATE ${TABLES.WRONG_QUESTIONS}
       SET error_type = $1, error_reason = $2, ai_confidence = $3, is_blank = FALSE, updated_at = NOW()
       WHERE id = $4`,
      [result.errorType, result.reason, result.confidence, w.id]
    )
    updated++
    console.log(`  [Diagnosis] ✅ [${i + 1}/${rows.length}] ${String(w.id).slice(0, 8)}: ${result.errorType} (${result.confidence})`)

    if (i < rows.length - 1) {
      await new Promise(r => setTimeout(r, 1200))
    }
  }

  console.log(`[Diagnosis] (${trigger}) 本批完成！空题:${blank} 已分析:${updated} 无法判定:${skipped}`)
  return { started: true, total: rows.length, blank, updated, skipped }
}
