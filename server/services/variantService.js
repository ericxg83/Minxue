import { query, TABLES } from '../config/neon.js'
import { callTextCompletion } from '../config/ai.js'
import { detectEnglishQuestionType, ENGLISH_QUESTION_TYPE_LABELS } from './englishAnalyzer.js'
import { normalizeOptions, formatOptionsForPrompt } from '../utils/optionText.js'

// ============================================================
// 变式题生成服务（variantService）
//
// 职责：
//   1. 给定一道原始题（含题干/选项/答案/知识点），用 AI 生成 4 种策略的变式题
//   2. 存入 variant_questions 表
//   3. 查询某题已有的变式题列表
//
// 4 种策略（strategy key 不变，前端 UI / 数据库字段都按这 4 个识别）：
//   - change_number  ：数字/时态/人称微调，保持考点和结构
//   - change_condition：条件/状语/宾语主语互换
//   - inverse        ：逆命题/主动↔被动/已知未知互换
//   - context_shift  ：情境迁移/同义改写/场景更换
//
// 学科差异：
//   - 数学：4 个策略均生成数字题
//   - 英语：change_number 改时态；change_condition 改人称/状语；inverse 主动↔被动；
//          context_shift 改写/同义句转换。题面必须是英文。
// ============================================================

const STRATEGY_LABELS = {
  change_number: '改数字',
  change_condition: '改条件',
  inverse: '逆命题',
  context_shift: '情境迁移',
}

// ── 学科策略说明（提示词拼装用） ──
const STRATEGY_DESCRIPTIONS = {
  数学: {
    change_number: '"change_number"（改数字）：保持题目结构和考点不变，只修改数字/系数。',
    change_condition: '"change_condition"（改条件）：保持考点和难度，修改部分条件描述（如把"直角三角形"改成"等腰三角形"）。',
    inverse: '"inverse"（逆命题/逆问题）：保持知识点，把已知和未知互换（如已知方程的解求方程的系数）。',
    context_shift: '"context_shift"（情境迁移）：把应用题的背景场景换成另一类场景，考点不变。',
  },
  英语: {
    change_number: '"change_number"（改时态/词形）：保持句子结构和考点不变，只修改时态或动词形式（如一般现在时 → 一般过去时，第三人称单数 → 复数）。',
    change_condition: '"change_condition"（改人称/状语）：保持核心考点，把主语人称/时间状语/地点状语替换（如 I → he；yesterday → tomorrow）。',
    inverse: '"inverse"（主动↔被动/肯定↔否定/陈述↔疑问）：转换句型或语态，例如主动句改被动句，陈述句改一般疑问句或否定句。',
    context_shift: '"context_shift"（同义改写/场景迁移）：用同义词或同义结构改写原句，或换一个对话/场景但保留全部考点。',
  },
}

/**
 * 构建变式题生成的 AI 提示词
 */
function buildVariantPrompt({ content, options, answer, subject, kpName, englishType }) {
  const optionText = Array.isArray(options) && options.length > 0
    ? `\n选项：${formatOptionsForPrompt(options)}`
    : ''

  const subj = subject || '数学'
  const strategies = STRATEGY_DESCRIPTIONS[subj] || STRATEGY_DESCRIPTIONS.数学
  const isEnglish = subj === '英语'

  const systemContent = isEnglish
    ? `You are an experienced middle-school English teacher in China. You generate ${subj} variant questions for a student based on an original question.

Generate 4 variant questions (one per strategy below). All variants MUST be in English, and answers MUST be correct.

4 strategies:
1. ${strategies.change_number}
2. ${strategies.change_condition}
3. ${strategies.inverse}
4. ${strategies.context_shift}

Rules:
1. Output ONLY a valid JSON array. No extra explanation text.
2. Variants must keep the same knowledge point (${kpName || 'as in the original'}) and a similar difficulty (±1).
3. If the original is a multiple-choice question, each variant must have 4 options (A/B/C/D) and a single correct answer.
4. If the original is a fill-in-the-blank or short-answer (e.g. sentence rewrite / translation / grammar fill-in), options can be an empty array; answer is the full expected text.
5. If the original is a cloze (完形填空), each variant should remain a cloze with a single blank and 4 options A-D, with the correct option letter as the answer.
6. If the original is a 短文改错 / proofreading, set question_type to "error_correction", leave options as [], and put the corrected sentence in answer.
7. If the original is a 翻译, set question_type to "translation", leave options as [], and put the English target sentence in answer.
8. For English, the knowledge point context is: ${kpName || 'general English grammar/vocabulary'}.`
    : `你是一个专业的 K12 数学变式题生成助手。

请根据给定的原始题目，生成 4 道变式题（每道变式题使用一种策略）。

4 种策略说明：
1. ${strategies.change_number}
2. ${strategies.change_condition}
3. ${strategies.inverse}
4. ${strategies.context_shift}

要求：
1. 只返回合法 JSON，不要输出任何额外说明文字。
2. 每道变式题必须与原题难度相近（±1 档）。
3. 变式题的答案必须正确且唯一。
4. 选择题要生成 4 个选项，判断题要生成正确/错误判断。`

  // English: emit question_type per variant so downstream templates can render
  // the right layout (cloze / grammar_blank / reading / writing / etc).
  const questionTypeField = isEnglish
    ? `,
    "question_type": "cloze | grammar_blank | error_correction | translation | writing | reading | choice | fill_blank | other"`
    : ''

  // English: ask the model to keep the same question type across variants.
  // If we detected a type, force variants to follow it; else let the model decide.
  const englishTypeHint = isEnglish && englishType && englishType.type !== 'unknown'
    ? `\n原题题型：${englishType.label}（${englishType.type}）。变式题请保持同一题型。\n`
    : ''

  const userContent = isEnglish
    ? `Original question (knowledge point: ${kpName || 'general'}, subject: ${subj}):
${englishTypeHint}
Stem: ${content || ''}${optionText}
Reference answer: ${answer || ''}

Return a JSON array (4 elements, one per strategy). Each item:
[
  {
    "strategy": "change_number" | "change_condition" | "inverse" | "context_shift",
    "content": "the new English question stem",
    "options": ["option A text", "option B text", "option C text", "option D text"],   // plain text only, NO "A."/"(A)" labels; empty [] for fill-in / short-answer
    "answer": "the correct answer (option letter for choice, full text otherwise)",
    "analysis": "brief English explanation of the key point",
    "difficulty": 3${questionTypeField}
  }
]`
    : `原始题目信息：
知识点：${kpName || '未知'}
学科：${subj}
题目内容：${content || ''}${optionText}
标准答案：${answer || ''}

请生成以下格式的 JSON 数组（4 个元素，每种策略一个）：
[
  {
    "strategy": "change_number",
    "content": "变式题题干",
    "options": ["A选项正文", "B选项正文", "C选项正文", "D选项正文"],
    "answer": "正确答案",
    "analysis": "简要解析",
    "difficulty": 3
  },
  ...
]

注意：
- options 只填选项正文，不要带 "A."、"（A）"、"A、" 这类标号，标号由界面按顺序生成。
- 若原题是解答题/计算题，options 可留空数组。
- 若原题是判断题，options 填 ["正确", "错误"]（或 ["T", "F"]）。
- analysis 是可选字段，可以为空字符串。`

  return { systemContent, userContent }
}

/**
 * 解析 AI 返回的 JSON 字符串为变式题数组。
 * 容忍常见格式问题：外层额外文本、单引号、末尾逗号。
 */
function parseVariantResponse(text) {
  if (!text) return []

  // 尝试提取 JSON 数组部分
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []

  try {
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return parsed.filter(item =>
      item &&
      typeof item.content === 'string' &&
      item.content.trim().length > 0 &&
      typeof item.answer === 'string' &&
      item.answer.trim().length > 0 &&
      ['change_number', 'change_condition', 'inverse', 'context_shift'].includes(item.strategy)
    )
  } catch {
    // JSON 格式不标准，尝试修复
    try {
      const cleaned = match[0]
        .replace(/'/g, '"')          // 单引号 → 双引号
        .replace(/,\s*([}\]])/g, '$1') // 末尾逗号
      const parsed = JSON.parse(cleaned)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(item =>
        item &&
        typeof item.content === 'string' &&
        item.content.trim().length > 0 &&
        typeof item.answer === 'string' &&
        item.answer.trim().length > 0
      )
    } catch {
      return []
    }
  }
}

/**
 * 为一道题生成 4 种变式题。
 * 内部全部 try-catch，失败不影响主流程。
 *
 * @param {Object} question - 题目行（含 id, content, options, answer, subject, ai_tags）
 * @param {string} [kpName] - 关联的知识点名称（可选）
 * @returns {Promise<Array<{id, strategy, content, options, answer, analysis, difficulty, question_type}>>} 生成的变式题列表
 */
export async function generateVariantsForQuestion(question, kpName = null) {
  if (!question || !question.id || !question.content) return []

  const subject = question.subject || '数学'

  // 英语题型识别（用于 prompt 强约束 + 入库 question_type）
  const englishType = subject === '英语'
    ? detectEnglishQuestionType(question.content, question.options)
    : null

  const prompt = buildVariantPrompt({
    content: question.content,
    options: question.options,
    answer: question.answer,
    subject,
    kpName: kpName || (Array.isArray(question.ai_tags) ? question.ai_tags[0] : null),
    englishType,
  })

  let result
  try {
    result = await callTextCompletion({
      systemContent: prompt.systemContent,
      userContent: prompt.userContent,
      temperature: 0.7,
      maxTokens: 2048,
    })
  } catch (err) {
    console.warn(`  ⚠️ [Variant] AI 生成失败 q=${String(question.id).slice(0, 8)}:`, err.message)
    return []
  }

  const variants = parseVariantResponse(result.content)
  if (variants.length === 0) {
    console.warn(`  ⚠️ [Variant] AI 返回格式异常 q=${String(question.id).slice(0, 8)}`)
    return []
  }

  // 英语：把原题题型作为兜底（AI 没填 question_type 时用原题型）
  const fallbackQuestionType = englishType ? englishType.type : null

  // 存入数据库
  const saved = []
  for (const v of variants) {
    try {
      const questionType = subject === '英语'
        ? (typeof v.question_type === 'string' && v.question_type.trim()
            ? v.question_type.trim()
            : fallbackQuestionType || 'other')
        : null
      const { rows } = await query(
        `INSERT INTO ${TABLES.VARIANT_QUESTIONS}
         (source_question_id, strategy, content, options, answer, analysis, difficulty, subject, question_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, strategy, content, options, answer, analysis, difficulty, question_type`,
        [
          question.id,
          v.strategy,
          v.content.trim(),
          Array.isArray(v.options) ? JSON.stringify(normalizeOptions(v.options)) : null,
          v.answer.trim(),
          (v.analysis || '').trim(),
          Math.max(1, Math.min(5, v.difficulty || 3)),
          subject,
          questionType,
        ]
      )
      saved.push(rows[0])
    } catch (err) {
      console.warn(`  ⚠️ [Variant] 入库失败 ${v.strategy}:`, err.message)
    }
  }

  return saved
}

/**
 * 批量为一组题生成变式题。
 * @param {Array<Object>} questions - 题目列表
 * @param {Map<string, string>} [kpMap] - questionId → kpName 映射
 * @returns {Promise<number>} 成功生成的变式题总数
 */
export async function generateVariantsForQuestions(questions, kpMap = new Map()) {
  if (!Array.isArray(questions) || questions.length === 0) return 0
  let total = 0
  for (const q of questions) {
    const kpName = kpMap.get(q.id) || null
    const saved = await generateVariantsForQuestion(q, kpName)
    total += saved.length
  }
  return total
}

/**
 * 获取某题的所有变式题。
 * @param {string} questionId
 * @returns {Promise<Array>}
 */
export async function getVariantsForQuestion(questionId) {
  if (!questionId) return []
  const { rows } = await query(
    `SELECT id, source_question_id, strategy, content, options, answer, analysis, difficulty, subject, created_at
     FROM ${TABLES.VARIANT_QUESTIONS}
     WHERE source_question_id = $1
     ORDER BY strategy, created_at ASC`,
    [questionId]
  )
  return rows.map(r => ({
    ...r,
    options: Array.isArray(r.options) ? r.options : [],
  }))
}

/**
 * 获取某题按策略分组的变式题。
 * @param {string} questionId
 * @returns {Promise<Object>} { change_number: [], change_condition: [], inverse: [], context_shift: [] }
 */
export async function getVariantsGrouped(questionId) {
  const list = await getVariantsForQuestion(questionId)
  const grouped = { change_number: [], change_condition: [], inverse: [], context_shift: [] }
  for (const v of list) {
    if (grouped[v.strategy]) {
      grouped[v.strategy].push(v)
    } else {
      grouped.change_number.push(v)
    }
  }
  return grouped
}

export { STRATEGY_LABELS }