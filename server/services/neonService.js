import { randomUUID } from 'node:crypto'
import { query, TABLES, transaction } from '../config/neon.js'
import { checkQuestionCompleteness } from '../utils/questionCompleteness.js'
import { normalizeOptions } from '../utils/optionText.js'
import { coerceAIText } from '../utils/aiTextCoerce.js'

export const updateTaskStatus = async (taskId, status, result = null) => {
  const updateData = {
    status,
    updated_at: new Date().toISOString()
  }

  // 运维字段：从 result 提取并写入独立列（补齐前仅存于 result JSON 内）。
  // retry_count / started_at / failed_at 任一缺失则保留原值（COALESCE）。
  // last_error 例外：status 转为 done 时必须清空，否则中途失败过、最终成功的任务
  // 会一直带着旧错误 —— 前端会据此显示误导性的失败原因，
  // PendingTaskRecovery 的非重试黑名单也会因残留错误而跳过它后续的恢复。
  const retryCount = (result && typeof result.retry_count === 'number') ? result.retry_count : null
  const lastError = (result && typeof result.last_error === 'string') ? result.last_error : null
  const startedAt = (result && result.startedAt) ? result.startedAt : null
  const failedAt = (result && result.failedAt) ? result.failedAt : null

  if (result !== null) {
    const { rows } = await query(
      `SELECT result FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )
    const existingResult = rows[0]?.result || {}
    const merged = typeof existingResult === 'string'
      ? { ...JSON.parse(existingResult), ...result }
      : { ...existingResult, ...result }
    // 让独立列与 result JSON 内的同名字段保持一致，便于两端查看。
    if (retryCount !== null) merged.retryCount = retryCount
    if (lastError !== null) merged.last_error = lastError
    if (startedAt !== null) merged.startedAt = startedAt
    if (failedAt !== null) merged.failedAt = failedAt
    updateData.result = JSON.stringify(merged)
  } else {
    updateData.result = JSON.stringify(result || {})
  }

  await query(
    `UPDATE ${TABLES.TASKS}
     SET status = $1, result = $2, updated_at = $3,
         retry_count = COALESCE($4, retry_count),
         last_error = CASE WHEN $1 = 'done' THEN NULL ELSE COALESCE($5, last_error) END,
         started_at = COALESCE($6::timestamptz, started_at),
         failed_at = COALESCE($7::timestamptz, failed_at),
         notification_read_at = CASE WHEN $1 IN ('done', 'failed') THEN NULL ELSE notification_read_at END
     WHERE id = $8`,
    [status, updateData.result, updateData.updated_at,
     retryCount, lastError, startedAt, failedAt, taskId]
  )
}

export const createQuestions = async (questions) => {
  const questionsWithTime = questions.map(q => {
    let statusValue = 'pending'
    if (q.status === 'wrong' || q.is_correct === false) {
      statusValue = 'wrong'
    } else if (q.status === 'mastered') {
      statusValue = 'mastered'
    }

    return {
      // 防御：questions.id 无数据库默认值，调用方未提供时在此兜底生成
      id: q.id || randomUUID(),
      task_id: q.task_id,
      student_id: q.student_id,
      // 文本列的最后一道闸门：上游任一识别路径把数组/对象传进来，
      // node-postgres 会按 PG 数组字面量序列化（{"x₁ = -1/2","x₂ = 5/2"}）写进 text 列。
      content: coerceAIText(q.content) || null,
      options: JSON.stringify(normalizeOptions(q.options || [])),
      answer: coerceAIText(q.answer) || null,
      student_answer: coerceAIText(q.student_answer) || null,
      ai_answer: coerceAIText(q.ai_answer) || null,
      answer_source: q.answer_source || 'recognized',
      analysis: coerceAIText(q.analysis) || null,
      question_type: q.question_type || 'choice',
      subject: q.subject || null,
      is_correct: q.is_correct !== undefined ? q.is_correct : true,
      status: statusValue,
      image_url: q.image_url || null,
      geometry_image_url: q.geometry_image_url || null,
      ai_tags: JSON.stringify(q.ai_tags || []),
      manual_tags: JSON.stringify(q.manual_tags || []),
      tags_source: q.tags_source || 'ai',
      difficulty: q.difficulty ?? null,
      block_coordinates: q.block_coordinates ? JSON.stringify(q.block_coordinates) : null,
      question_number: q.question_number ?? null,
      text_bbox: q.text_bbox ? JSON.stringify(q.text_bbox) : null,
      image_bbox: (q.image_bbox || q.geometry_image?.bbox) ? JSON.stringify(q.image_bbox || q.geometry_image.bbox) : null,
      image_type: q.image_type || null,
      page_number: q.page_number ?? null,
      confidence: q.confidence ?? 0,
      is_complete: checkQuestionCompleteness(q).isComplete,
      created_at: new Date().toISOString()
    }
  })

  if (questionsWithTime.length === 0) return []

  const columns = Object.keys(questionsWithTime[0])
  const valuesPlaceholders = questionsWithTime.map((_, idx) => {
    return `(${columns.map((_, colIdx) => `$${idx * columns.length + colIdx + 1}`).join(', ')})`
  }).join(', ')

  const values = questionsWithTime.flatMap(q => columns.map(col => q[col]))

  await query(
    `INSERT INTO ${TABLES.QUESTIONS} (${columns.join(', ')}) VALUES ${valuesPlaceholders}`,
    values
  )
}

export const batchUpdateQuestionTags = async (tagUpdates) => {
  if (!tagUpdates || tagUpdates.length === 0) return []
  const results = []

  // 批量 UPDATE：通过 CASE WHEN + VALUES 构造单条 SQL，替代 N 条逐行 UPDATE
  const caseValues = []
  const caseParams = []
  let paramIdx = 1

  for (const update of tagUpdates) {
    const hasDifficulty = update.difficulty !== undefined && update.difficulty !== null
    const aiTagsJson = update.ai_tags && update.ai_tags.length > 0
      ? JSON.stringify(update.ai_tags)
      : null

    // 存参数：id, ai_tags, tags_source, difficulty
    caseParams.push(update.id)
    caseParams.push(aiTagsJson)
    caseParams.push(aiTagsJson ? 'ai' : null)
    caseParams.push(hasDifficulty ? update.difficulty : null)

    caseValues.push(
      `($${paramIdx}::uuid, $${paramIdx + 1}::jsonb, $${paramIdx + 2}, $${paramIdx + 3})`
    )
    paramIdx += 4

    results.push({ id: update.id })
  }

  try {
    await query(
      `UPDATE ${TABLES.QUESTIONS} AS q SET
        ai_tags = v.ai_tags,
        tags_source = v.tags_source,
        difficulty = COALESCE(v.difficulty, q.difficulty),
        updated_at = NOW()
      FROM (VALUES ${caseValues.join(', ')}) AS v(id, ai_tags, tags_source, difficulty)
      WHERE q.id = v.id`,
      caseParams
    )
  } catch (error) {
    console.error(`批量更新标签失败 (${tagUpdates.length} 题):`, error.message)
  }

  return results
}

export const addWrongQuestions = async (studentId, questionIds, questionConfidenceMap = null, questionMap = null) => {
  if (!questionIds || questionIds.length === 0) return []

  const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.8

  // [P0-1] 按置信度阈值过滤 — 低于 0.8 的不进入错题本
  // 注意：questionConfidenceMap 必须是 Map 实例（有 .get 方法）
  let filteredIds = questionIds
  if (questionConfidenceMap instanceof Map) {
    const lowConfList = questionIds.filter(id => {
      const conf = questionConfidenceMap.get(id)
      return conf !== undefined && conf !== null && conf < CONFIDENCE_THRESHOLD
    })
    if (lowConfList.length > 0) {
      console.log(`  ⚠️ 低置信度错题已排除: ${lowConfList.length} 道 (阈值: ${CONFIDENCE_THRESHOLD})`)
    }
    filteredIds = questionIds.filter(id => {
      const conf = questionConfidenceMap.get(id)
      return conf === undefined || conf === null || conf >= CONFIDENCE_THRESHOLD
    })
  }

  // 完整性过滤 — 仅完整题目可进入错题本
  // 注意：questionMap 必须是 Map 实例（有 .get 方法）
  if (questionMap instanceof Map) {
    const completeIds = filteredIds.filter(id => {
      const q = questionMap.get(id)
      if (!q) return false
      return checkQuestionCompleteness(q).isComplete
    })
    const skippedCount = filteredIds.length - completeIds.length
    if (skippedCount > 0) {
      console.log(`  ⚠️ 完整性检查未通过，未加入错题本: ${skippedCount} 道 (缺少答案/选项/配图)`)
    }
    filteredIds = completeIds
  }

  if (filteredIds.length === 0) return []

  const { rows: existing } = await query(
    `SELECT question_id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = ANY($2)`,
    [studentId, filteredIds]
  )
  const existingIds = new Set(existing.map(e => e.question_id))
  const newIds = filteredIds.filter(id => !existingIds.has(id))

  if (newIds.length === 0) return []

  const values = newIds.map((_, i) => `($1, $${i + 2}, 'pending', 1, NOW(), NOW(), NOW())`).join(',')
  const params = [studentId, ...newIds]

  await query(
    `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id, status, error_count, added_at, last_wrong_at, created_at) VALUES ${values} ON CONFLICT DO NOTHING`,
    params
  )

  return newIds.map(id => ({ question_id: id }))
}

/**
 * 添加自包含错题记录（不依赖 questions 表 FK）
 *
 * 当 workbook 批改发现学生答错时，裁剪学生作业图片 + 元数据直接存入
 * wrong_questions 表，使错题本完全自包含。
 *
 * 以 (student_id, worksheet_id, question_no) 作为自然键去重：
 * - 已存在 → 递增 error_count，更新 last_wrong_at
 * - 不存在 → INSERT 新记录
 */
export const addSelfContainedWrongQuestion = async (params) => {
  const {
    studentId, worksheetId, questionNo, pageNumber,
    studentAnswer, correctAnswer, answerType, content,
    questionType, blockCoordinates, questionImageUrl,
    subject, sourceType = 'workbook', questionId
  } = params

  // 防垃圾行守卫：既无 question_id 又无 (worksheet_id + question_no) 的错题没有
  // 任何关联与内容，写入只会污染错题本并虚增报告统计，直接拒绝。
  if (!questionId && !(worksheetId && questionNo)) {
    console.warn(`  ⚠️ [WrongBook] 拒绝写入无关联空壳错题: studentId=${studentId}, questionId=${questionId || 'null'}, worksheetId=${worksheetId || 'null'}, questionNo=${questionNo || 'null'}`)
    return null
  }

  const { rows: existing } = await query(
    `SELECT id, error_count FROM ${TABLES.WRONG_QUESTIONS}
     WHERE student_id = $1 AND worksheet_id = $2 AND question_no = $3`,
    [studentId, worksheetId, questionNo]
  )

  if (existing.length > 0) {
    await query(
      `UPDATE ${TABLES.WRONG_QUESTIONS}
       SET error_count = error_count + 1,
           last_wrong_at = NOW(),
           updated_at = NOW(),
           student_answer = $2,
           question_image_url = COALESCE($3, question_image_url),
           question_id = COALESCE($4, question_id)
       WHERE id = $1`,
      [existing[0].id, studentAnswer, questionImageUrl, questionId]
    )
    return existing[0].id
  }

  const { rows } = await query(
    `INSERT INTO ${TABLES.WRONG_QUESTIONS}
     (student_id, question_id, worksheet_id, page_number, question_no,
      student_answer, correct_answer, answer_type, content,
      question_type, block_coordinates, question_image_url,
      subject, source_type, status, error_count, added_at, last_wrong_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', 1, NOW(), NOW(), NOW(), NOW())
     RETURNING id`,
    [studentId, questionId || null, worksheetId, pageNumber, questionNo,
     studentAnswer, correctAnswer, answerType, content,
     questionType, blockCoordinates ? JSON.stringify(blockCoordinates) : null,
     questionImageUrl, subject, sourceType]
  )
  return rows[0].id
}

export const updateQuestionAnswer = async (questionId, answer, analysis, forceUpdate = false) => {
  if (!answer && !analysis) return

  let answerClause, params
  if (forceUpdate) {
    answerClause = 'answer = $1'
  } else {
    answerClause = "answer = COALESCE(NULLIF($1, ''), answer)"
  }

  // analysis_clause 和参数都依赖 analysis 是否存在
  let analysis_clause = ''
  if (analysis && analysis.trim()) {
    analysis_clause = ", analysis = $3"
    params = [answer || null, questionId, analysis]
  } else {
    params = [answer || null, questionId]
  }

  await query(
    `UPDATE ${TABLES.QUESTIONS}
     SET ${answerClause},
         updated_at = NOW()
         ${analysis_clause}
     WHERE id = $2`,
    params
  )
}

export const markAnswerException = async (questionId, reason) => {
  try {
    await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET answer_exception = $1,
           answer_exception_reason = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [true, reason, questionId]
    )
  } catch (err) {
    console.error(`标记题目 ${questionId} 解析异常失败:`, err.message)
  }
}

export const findCachedQuestionByFingerprint = async (fingerprint, parserVersion = 'v1') => {
  try {
    console.log(`[QuestionCache] 按指纹查找缓存: fingerprint=${fingerprint.substring(0, 16)}..., version=${parserVersion}`)
    
    const { rows } = await query(
      `SELECT id, question_fingerprint, content_type, content, options, answer, analysis, 
              question_type, subject, ai_tags, phash, parser_version, use_count
       FROM ${TABLES.QUESTION_CACHE}
       WHERE question_fingerprint = $1 AND parser_version = $2
       LIMIT 1`,
      [fingerprint, parserVersion]
    )
    
    if (rows.length > 0) {
      const cached = rows[0]
      console.log(`[QuestionCache] 缓存命中! id=${cached.id.substring(0, 8)}..., use_count=${cached.use_count}`)
      return {
        id: cached.id,
        content: cached.content,
        options: cached.options,
        answer: cached.answer,
        analysis: cached.analysis,
        question_type: cached.question_type,
        subject: cached.subject,
        ai_tags: cached.ai_tags,
        use_count: cached.use_count
      }
    }
    
    console.log(`[QuestionCache] 缓存未命中`)
    return null
  } catch (error) {
    console.error('[QuestionCache] 按指纹查找缓存失败:', error.message)
    return null
  }
}

export const findSimilarQuestion = async (content, subject, threshold = 0.85) => {
  try {
    console.log(`[QuestionCache] 按相似度查找: subject=${subject}, threshold=${threshold}`)
    
    const { rows } = await query(
      `SELECT id, content_type, content, options, answer, analysis, question_type, subject, ai_tags
       FROM ${TABLES.QUESTION_CACHE}
       WHERE subject = $1
       ORDER BY use_count DESC
       LIMIT 50`,
      [subject]
    )
    
    if (rows.length === 0) {
      console.log(`[QuestionCache] 无同类题目可对比`)
      return null
    }
    
    let bestMatch = null
    let bestSimilarity = 0
    
    for (const cached of rows) {
      const similarity = await calculateSimilarity(content, cached.content)
      
      if (similarity >= threshold && similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestMatch = {
          id: cached.id,
          content: cached.content,
          options: cached.options,
          answer: cached.answer,
          analysis: cached.analysis,
          question_type: cached.question_type,
          subject: cached.subject,
          ai_tags: cached.ai_tags,
          similarity
        }
      }
    }
    
    if (bestMatch) {
      console.log(`[QuestionCache] 相似题目匹配! similarity=${bestSimilarity.toFixed(4)}`)
    } else {
      console.log(`[QuestionCache] 无相似题目匹配 (最高相似度: ${bestSimilarity.toFixed(4)})`)
    }
    
    return bestMatch
  } catch (error) {
    console.error('[QuestionCache] 按相似度查找失败:', error.message)
    return null
  }
}

const calculateSimilarity = async (text1, text2) => {
  const normalized1 = normalizeString(text1)
  const normalized2 = normalizeString(text2)
  
  if (normalized1 === normalized2) return 1.0
  if (!normalized1 || !normalized2) return 0.0
  
  const distance = levenshteinDistance(normalized1, normalized2)
  const maxLength = Math.max(normalized1.length, normalized2.length)
  
  if (maxLength === 0) return 0.0
  
  return 1 - (distance / maxLength)
}

const normalizeString = (str) => {
  if (!str) return ''
  let s = String(str)
  s = s.replace(/\r\n/g, '\n')
  s = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  s = s.replace(/\u3000/g, ' ')
  s = s.replace(/[，。；：！？、（）【】《》""''·…—\-_\s]+/g, '')
  s = s.replace(/[\(\)\[\]{}〈〉「」『』]/g, '')
  s = s.toLowerCase().trim()
  return s
}

const levenshteinDistance = (str1, str2) => {
  const m = str1.length
  const n = str2.length
  
  if (m === 0) return n
  if (n === 0) return m
  
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }
  
  return dp[m][n]
}

export const cacheQuestion = async (questionData, fingerprint, phash = null, parserVersion = 'v1') => {
  try {
    console.log(`[QuestionCache] 写入缓存: fingerprint=${fingerprint.substring(0, 16)}..., phash=${phash ? phash.substring(0, 16) + '...' : 'null'}, version=${parserVersion}`)

    // 使用 ON CONFLICT 替代 SELECT-before-INSERT/UPDATE，将 2 次 DB 往返减为 1 次
    const { rows } = await query(
      `INSERT INTO ${TABLES.QUESTION_CACHE}
       (question_fingerprint, content_type, content, options, answer, analysis,
        question_type, subject, ai_tags, phash, parser_version, use_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, NOW(), NOW())
       ON CONFLICT (question_fingerprint, parser_version) DO UPDATE SET
         content = EXCLUDED.content,
         options = EXCLUDED.options,
         answer = EXCLUDED.answer,
         analysis = EXCLUDED.analysis,
         question_type = EXCLUDED.question_type,
         subject = EXCLUDED.subject,
         ai_tags = EXCLUDED.ai_tags,
         phash = EXCLUDED.phash,
         updated_at = NOW()
       RETURNING id`,
      [
        fingerprint,
        questionData.content_type || 'text',
        questionData.content || null,
        JSON.stringify(normalizeOptions(questionData.options || [])),
        questionData.answer || null,
        questionData.analysis || null,
        questionData.question_type || 'choice',
        questionData.subject || null,
        JSON.stringify(questionData.ai_tags || []),
        phash,
        parserVersion
      ]
    )
    console.log(`[QuestionCache] 缓存写入成功`)
    return rows[0].id
  } catch (error) {
    console.error('[QuestionCache] 缓存写入失败:', error.message)
    return false
  }
}

export const incrementQuestionUseCount = async (fingerprint, parserVersion = 'v1') => {
  try {
    console.log(`[QuestionCache] 增加使用次数: fingerprint=${fingerprint.substring(0, 16)}...`)
    
    const result = await query(
      `UPDATE ${TABLES.QUESTION_CACHE}
       SET use_count = use_count + 1, updated_at = NOW()
       WHERE question_fingerprint = $1 AND parser_version = $2
       RETURNING use_count`,
      [fingerprint, parserVersion]
    )
    
    if (result.rows.length > 0) {
      const newCount = result.rows[0].use_count
      console.log(`[QuestionCache] 使用次数已更新: ${newCount}`)
      return newCount
    }
    
    console.log(`[QuestionCache] 未找到对应缓存记录，无法增加使用次数`)
    return 0
  } catch (error) {
    console.error('[QuestionCache] 增加使用次数失败:', error.message)
    return 0
  }
}

/**
 * Shadow Mode: 追加写入判定记录（judgements 表）
 * 不阻塞主流程——外层调用者负责 try-catch
 * 用于记录所有 AI / 人工 / PC 编辑的判定历史
 */
export const createJudgement = async ({
  questionId,
  studentId,
  source,
  confidence = null,
  isCorrect = null,
  content = null,
  answer = null,
  studentAnswer = null,
  aiAnswer = null,
  analysis = null,
  metadata = {}
}) => {
  const maxRetries = 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await query(
        `INSERT INTO ${TABLES.JUDGEMENTS}
         (question_id, student_id, source, confidence, is_correct,
          content, answer, student_answer, ai_answer, analysis, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          questionId, studentId, source, confidence,
          isCorrect ?? null, content, answer,
          studentAnswer, aiAnswer, analysis,
          JSON.stringify(metadata)
        ]
      )
      return // success
    } catch (error) {
      if (attempt < maxRetries) {
        console.warn(`[Judgement] 写入失败(attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}`)
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)))
      } else {
        console.error(`[Judgement] 写入失败(已达最大重试次数): ${error.message}`)
        // 不抛异常，不阻塞主流程
      }
    }
  }
}

/**
 * 获取某题/学生的最新一条判定记录
 * 用于三层模型: Question → Judgements → WrongQuestions
 */
export const getLatestJudgement = async (questionId, studentId) => {
  const { rows } = await query(
    `SELECT id, question_id, student_id, source, is_correct, metadata, created_at FROM ${TABLES.JUDGEMENTS}
     WHERE question_id = $1 AND student_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [questionId, studentId]
  )
  return rows[0] || null
}

/**
 * 更新 questions 表的 cache_id（指向 question_cache 的权威条目）
 * @param {string} questionId - questions 表 id
 * @param {string} cacheId - question_cache 表 id
 */
export const updateQuestionCacheId = async (questionId, cacheId) => {
  try {
    await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET cache_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [cacheId, questionId]
    )
  } catch (error) {
    console.error(`更新 cache_id 失败 q=${questionId.substring(0, 8)}:`, error.message)
  }
}

// ── question_assets CRUD ──

/**
 * 创建题目资源记录
 * @param {Object} asset - { question_id, asset_type, original_image_url, cropped_image_url, bbox, tikz_code, tikz_status }
 * @returns {Object} 创建的记录
 */
export const createQuestionAsset = async (asset) => {
  const { rows } = await query(
    `INSERT INTO ${TABLES.QUESTION_ASSETS}
     (question_id, asset_type, original_image_url, cropped_image_url, bbox, tikz_code, tikz_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      asset.question_id,
      asset.asset_type || 'geometry_image',
      asset.original_image_url || null,
      asset.cropped_image_url || null,
      asset.bbox ? JSON.stringify(asset.bbox) : null,
      asset.tikz_code || null,
      asset.tikz_status || 'none'
    ]
  )
  return rows[0]
}

/**
 * 获取题目的所有资源
 * @param {string} questionId
 * @returns {Array} 资源列表
 */
export const getQuestionAssets = async (questionId) => {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.QUESTION_ASSETS}
     WHERE question_id = $1
     ORDER BY created_at`,
    [questionId]
  )
  return rows
}

/**
 * 按类型获取题目的资源
 * @param {string} questionId
 * @param {string} assetType - 'geometry_image', 'chart_image', etc.
 * @returns {Array} 资源列表
 */
export const getQuestionAssetsByType = async (questionId, assetType) => {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.QUESTION_ASSETS}
     WHERE question_id = $1 AND asset_type = $2
     ORDER BY created_at`,
    [questionId, assetType]
  )
  return rows
}

/**
 * 更新题目资源的 tikz 信息
 * @param {string} assetId
 * @param {Object} upd - { tikz_code, tikz_status }
 */
export const updateQuestionAssetTikz = async (assetId, upd) => {
  const { tikz_code, tikz_status } = upd
  await query(
    `UPDATE ${TABLES.QUESTION_ASSETS}
     SET tikz_code = COALESCE($1, tikz_code),
         tikz_status = COALESCE($2, tikz_status),
         updated_at = NOW()
     WHERE id = $3`,
    [tikz_code || null, tikz_status || null, assetId]
  )
}

/**
 * 更新题目的几何图净化层数据
 * @param {string} questionId
 * @param {Object} data - { clean_geometry_image_url, clean_geometry_svg, geometry_crop_type, geometry_structure_json }
 */
export const updateQuestionAssetCleanData = async (questionId, data) => {
  const { clean_geometry_image_url, clean_geometry_svg, geometry_crop_type, geometry_structure_json } = data
  await query(
    `UPDATE ${TABLES.QUESTION_ASSETS}
     SET clean_geometry_image_url = COALESCE($1, clean_geometry_image_url),
         clean_geometry_svg = COALESCE($2, clean_geometry_svg),
         geometry_crop_type = COALESCE($3, geometry_crop_type),
         geometry_structure_json = COALESCE($4::jsonb, geometry_structure_json),
         updated_at = NOW()
     WHERE question_id = $5`,
    [
      clean_geometry_image_url || null,
      clean_geometry_svg || null,
      geometry_crop_type || null,
      geometry_structure_json != null ? JSON.stringify(geometry_structure_json) : null,
      questionId
    ]
  )
}

/**
 * 更新几何重建状态（异步 worker 专用）
 * @param {string} assetId - question_assets.id
 * @param {Object} upd - { tikz_status, tikz_json, tikz_url, tikz_code, last_error, retry_count, processed_at }
 */
export const updateGeometryReconstructionStatus = async (assetId, upd) => {
  const { tikz_status, tikz_json, tikz_url, tikz_code, last_error, retry_count, processed_at } = upd
  await query(
    `UPDATE ${TABLES.QUESTION_ASSETS}
     SET tikz_status = COALESCE($1, tikz_status),
         tikz_json = CASE WHEN $2::jsonb IS NOT NULL THEN $2::jsonb ELSE tikz_json END,
         tikz_url = COALESCE($3, tikz_url),
         tikz_code = COALESCE($4, tikz_code),
         last_error = COALESCE($5, last_error),
         retry_count = CASE WHEN $6::int IS NOT NULL THEN $6::int ELSE retry_count END,
         processed_at = COALESCE($7, processed_at),
         updated_at = NOW()
     WHERE id = $8`,
    [
      tikz_status || null,
      tikz_json != null ? JSON.stringify(tikz_json) : null,
      tikz_url || null,
      tikz_code || null,
      last_error ?? null,
      retry_count != null ? retry_count : null,
      processed_at || null,
      assetId
    ]
  )
}

/**
 * 同步更新 questions 表的反范式字段（干净 SVG + 显示类型）
 * @param {string} questionId
 * @param {string} cleanSvg - 干净 SVG 源码
 */
export const updateQuestionDenormalizedSvg = async (questionId, cleanSvg) => {
  await query(
    `UPDATE ${TABLES.QUESTIONS}
     SET clean_geometry_svg = $1,
         display_image_type = COALESCE(display_image_type, 'clean'),
         updated_at = NOW()
     WHERE id = $2`,
    [cleanSvg, questionId]
  )
}

/**
 * 获取待处理的几何重建资产（Worker 扫描用）
 * @param {number} [limit=10] - 一次最多取多少条
 * @returns {Array} 资产列表
 */
export const getPendingGeometryAssets = async (limit = 10) => {
  const { rows } = await query(
    `SELECT a.id, a.question_id, a.cropped_image_url,
            a.retry_count, a.last_error, a.tikz_status,
            q.geometry_image_url, q.image_type,
            q.student_id
     FROM ${TABLES.QUESTION_ASSETS} a
     JOIN ${TABLES.QUESTIONS} q ON q.id = a.question_id
     WHERE a.asset_type = 'geometry_image'
       AND a.tikz_status = 'pending'
     ORDER BY a.created_at ASC
     LIMIT $1`,
    [limit]
  )
  return rows
}

/**
 * 获取失败的几何重建资产（人工重新触发用）
 * @param {number} [limit=20]
 * @returns {Array} 资产列表
 */
export const getFailedGeometryAssets = async (limit = 20) => {
  const { rows } = await query(
    `SELECT a.id, a.question_id, a.cropped_image_url,
            a.retry_count, a.last_error, a.tikz_status,
            q.geometry_image_url, q.image_type
     FROM ${TABLES.QUESTION_ASSETS} a
     JOIN ${TABLES.QUESTIONS} q ON q.id = a.question_id
     WHERE a.asset_type = 'geometry_image'
       AND a.tikz_status = 'failed'
     ORDER BY a.updated_at DESC
     LIMIT $1`,
    [limit]
  )
  return rows
}

// ── 练习册 CRUD ──

export const createWorksheet = async ({ name, subject, grade }) => {
  // 迁移028后 worksheets 是 resources 上的视图，视图不含 resource_type 列，
  // INSERT 必须落实表并显式给 resource_type
  const { rows } = await query(
    `INSERT INTO ${TABLES.RESOURCES} (resource_type, name, subject, grade)
     VALUES ('worksheet', $1, $2, $3) RETURNING *`,
    [name, subject || null, grade || null]
  )
  return rows[0]
}

export const getAllWorksheets = async () => {
  const { rows } = await query(
    `SELECT w.*,
       (SELECT COUNT(*) FROM ${TABLES.WORKSHEET_ANSWERS} wa WHERE wa.worksheet_id = w.id)::int AS answer_count
     FROM ${TABLES.WORKSHEETS} w
     ORDER BY w.created_at DESC`
  )
  return rows
}

export const getWorksheetById = async (id) => {
  const { rows } = await query(
    `SELECT w.*,
       (SELECT COUNT(*) FROM ${TABLES.WORKSHEET_ANSWERS} wa WHERE wa.worksheet_id = w.id)::int AS answer_count
     FROM ${TABLES.WORKSHEETS} w
     WHERE w.id = $1`,
    [id]
  )
  return rows[0] || null
}

export const updateWorksheetStatus = async (id, status) => {
  const { rows } = await query(
    `UPDATE ${TABLES.WORKSHEETS} SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status]
  )
  return rows[0] || null
}

export const updateWorksheetPdfUrl = async (id, pdfUrl) => {
  const { rows } = await query(
    `UPDATE ${TABLES.WORKSHEETS} SET pdf_url = $2 WHERE id = $1 RETURNING *`,
    [id, pdfUrl]
  )
  return rows[0] || null
}

export const updateWorksheetQuestionPdfUrl = async (id, questionPdfUrl) => {
  const { rows } = await query(
    `UPDATE ${TABLES.WORKSHEETS} SET question_pdf_url = $2 WHERE id = $1 RETURNING *`,
    [id, questionPdfUrl]
  )
  return rows[0] || null
}

export const updateWorksheetParseStatus = async (id, { status, count = null, warning = null, error = null }) => {
  const { rows } = await query(
    `UPDATE ${TABLES.WORKSHEETS}
     SET parse_status = $2, parse_count = $3, parse_warning = $4, parse_error = $5
     WHERE id = $1 RETURNING *`,
    [id, status, count, warning, error]
  )
  return rows[0] || null
}

/**
 * 更新分批解析进度（大 PDF 的 OCR 分批路径专用）。
 * 传 null 表示清除进度（重新解析开始时 / 无页级进度的路径）。
 * 这条 UPDATE 会经由 worksheets 的 BEFORE UPDATE 触发器刷新 updated_at，
 * 是分批解析期间对"卡死判定"（isParsingStale / scanStuckWorksheetParsing）的心跳。
 */
export const updateWorksheetParseProgress = async (id, { totalPages = null, donePages = null } = {}) => {
  const { rows } = await query(
    `UPDATE ${TABLES.WORKSHEETS}
     SET parse_total_pages = $2, parse_done_pages = $3
     WHERE id = $1 RETURNING *`,
    [id, totalPages, donePages]
  )
  return rows[0] || null
}

export const updateWorksheetAnswerCount = async (id) => {
  const { rows } = await query(
    `UPDATE ${TABLES.WORKSHEETS} SET answer_count = (
       SELECT COUNT(*) FROM ${TABLES.WORKSHEET_ANSWERS} WHERE worksheet_id = $1
     ) WHERE id = $1 RETURNING *`,
    [id]
  )
  return rows[0] || null
}

export const deleteWorksheet = async (id) => {
  await query(`DELETE FROM ${TABLES.WORKSHEETS} WHERE id = $1`, [id])
}

// ── 练习单元 CRUD ──

/**
 * 批量 upsert 练习单元，返回 Map<unit_key, unit_id>。
 *
 * unit_seq 表示单元在书内的出现顺序：分批解析时按批次串行调用，
 * 新单元续接当前最大 seq，已存在的单元用 COALESCE 保住首次写入的 seq，
 * 避免续页重复出现同一标题时把顺序打乱。
 */
const upsertUnitsWithClient = async (client, resourceId, units) => {
  const map = new Map()
  const uniq = []
  const seen = new Set()
  for (const u of units || []) {
    if (!u?.unit_key || seen.has(u.unit_key)) continue
    seen.add(u.unit_key)
    uniq.push(u)
  }
  if (uniq.length === 0) return map

  const { rows: maxRows } = await client.query(
    'SELECT COALESCE(MAX(unit_seq), 0) AS m FROM resource_units WHERE resource_id = $1',
    [resourceId]
  )
  let seq = Number(maxRows[0]?.m || 0)

  const values = uniq.map((_, i) =>
    `($1, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, $${i * 5 + 6})`
  ).join(',')
  const params = [resourceId]
  for (const u of uniq) {
    params.push(u.unit_key, u.unit_title || null, ++seq, u.lesson_code || null, u.ordinal ?? null)
  }
  const { rows } = await client.query(
    `INSERT INTO resource_units (resource_id, unit_key, unit_title, unit_seq, lesson_code, ordinal)
     VALUES ${values}
     ON CONFLICT (resource_id, unit_key) DO UPDATE SET
       unit_title  = COALESCE(EXCLUDED.unit_title, resource_units.unit_title),
       unit_seq    = COALESCE(resource_units.unit_seq, EXCLUDED.unit_seq),
       lesson_code = COALESCE(EXCLUDED.lesson_code, resource_units.lesson_code),
       ordinal     = COALESCE(EXCLUDED.ordinal, resource_units.ordinal)
     RETURNING id, unit_key`,
    params
  )
  for (const r of rows) map.set(r.unit_key, r.id)
  return map
}

/** 从答案行里抽出单元并 upsert，返回 Map<unit_key, unit_id> */
const resolveUnitIds = async (client, resourceId, answers) => {
  const units = []
  for (const a of answers) {
    if (!a.unit_key) continue
    // 注意不能回退到 a.section：section 现在存的是大题组名（"一、填空题"），不是单元名
    units.push({
      unit_key: a.unit_key,
      unit_title: a.unit_title || null,
      lesson_code: a.lesson_code || null,
      ordinal: a.ordinal ?? null,
    })
  }
  return upsertUnitsWithClient(client, resourceId, units)
}

export const upsertResourceUnits = async (resourceId, units) =>
  transaction(client => upsertUnitsWithClient(client, resourceId, units))

/**
 * 把解析出的"单元→答案页范围"写回 resource_units（不重建单元，只补页范围）。
 * 调用方负责先 upsertResourceUnits 保证 unit 已存在；若 unit 不存在则忽略
 * （解析时漏了标题的题应走预埋答案路径，不会到这里）。
 */
export const upsertResourceUnitPageRanges = async (resourceId, ranges) => {
  if (!ranges || ranges.length === 0) return 0
  // 用 VALUES 一条 UPDATE：单次 round-trip；未匹配的 unit_key 跳过（LEFT JOIN 形式）
  const values = ranges.map((_, i) => `($${i * 3 + 2}::text, $${i * 3 + 3}::int, $${i * 3 + 4}::int)`).join(',')
  const params = [resourceId]
  for (const r of ranges) {
    params.push(r.unit_key, r.answer_page_start, r.answer_page_end)
  }
  const { rows } = await query(
    `UPDATE resource_units SET
       answer_page_start = v.start,
       answer_page_end   = v.end
     FROM (VALUES ${values}) AS v(unit_key, start, end)
     WHERE resource_units.resource_id = $1
       AND resource_units.unit_key    = v.unit_key`,
    params
  )
  return rows.length || 0
}

/** 清空练习册的单元（含级联删除其下答案）。重解析前调用，清掉上一轮的残留单元。 */
export const clearResourceUnits = async (resourceId) => {
  await query('DELETE FROM resource_units WHERE resource_id = $1', [resourceId])
}

export const getResourceUnits = async (resourceId) => {
  const { rows } = await query(
    `SELECT * FROM resource_units WHERE resource_id = $1
     ORDER BY unit_seq NULLS LAST, unit_key`,
    [resourceId]
  )
  return rows
}

// ── 答案 CRUD ──

// 唯一约束（迁移 032）：UNIQUE NULLS NOT DISTINCT (resource_id, unit_id, section, question_no, sub_no)
const ANSWER_CONFLICT_TARGET = '(resource_id, unit_id, section, question_no, sub_no)'

export const batchInsertAnswers = async (worksheetId, answers) => {
  if (!answers || answers.length === 0) return []
  // worksheet_answers 是 resource_answers 上的视图（answer_status='official_verified'），
  // 视图 INSERT 不支持 ON CONFLICT，且默认状态 ai_draft 会让新行从视图中消失，
  // 故直写实表并显式标记 official_verified
  const values = answers.map((_, i) =>
    `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5}, 'official_verified')`
  ).join(',')
  const params = [worksheetId]
  for (const a of answers) {
    params.push(a.question_no, a.answer, a.answer_type || 'choice', a.section || null)
  }
  const { rows } = await query(
    `INSERT INTO ${TABLES.RESOURCE_ANSWERS} (resource_id, question_no, answer, answer_type, section, answer_status)
     VALUES ${values}
     ON CONFLICT ${ANSWER_CONFLICT_TARGET}
     DO UPDATE SET answer = EXCLUDED.answer, answer_type = EXCLUDED.answer_type, answer_status = EXCLUDED.answer_status
     RETURNING *`,
    params
  )
  return rows
}

/**
 * 事务性替换练习册答案：先清空后插入，避免并发解析产生重复行
 * （一次算完的路径专用：文字版 PDF / ≤15 页小文件 / 图片解析。分批路径用
 * clearWorksheetAnswers + upsertWorksheetAnswers 增量写入。）
 */
export const replaceWorksheetAnswers = async (worksheetId, answers) => {
  return transaction(async (client) => {
    // 直写实表 resource_answers（worksheet_answers 视图不支持 ON CONFLICT），
    // 状态标 official_verified 使其对旧视图可见
    await client.query(`DELETE FROM ${TABLES.RESOURCE_ANSWERS} WHERE resource_id = $1`, [worksheetId])
    if (!answers || answers.length === 0) return []
    const unitMap = await resolveUnitIds(client, worksheetId, answers)
    const values = answers.map((_, i) =>
      `($1, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7}, $${i * 7 + 8}, 'official_verified')`
    ).join(',')
    const params = [worksheetId]
    for (const a of answers) {
      params.push(
        a.question_no, a.answer, a.answer_type || 'choice', a.section || null, a.content || null,
        a.unit_key ? (unitMap.get(a.unit_key) || null) : null,
        a.sub_no || ''
      )
    }
    const { rows } = await client.query(
      `INSERT INTO ${TABLES.RESOURCE_ANSWERS} (resource_id, question_no, answer, answer_type, section, content, unit_id, sub_no, answer_status)
       VALUES ${values}
       ON CONFLICT ${ANSWER_CONFLICT_TARGET}
       DO UPDATE SET answer = EXCLUDED.answer, answer_type = EXCLUDED.answer_type, content = EXCLUDED.content, answer_status = EXCLUDED.answer_status
       RETURNING *`,
      params
    )
    return rows
  })
}

/**
 * 清空练习册全部答案（分批解析开始前调用一次，替代 replaceWorksheetAnswers 的 DELETE 半段）
 */
export const clearWorksheetAnswers = async (worksheetId) => {
  await query(`DELETE FROM ${TABLES.RESOURCE_ANSWERS} WHERE resource_id = $1`, [worksheetId])
}

/**
 * 增量追加/覆盖练习册答案（分批解析每批调用，不清空已有行）。
 * 列集与 replaceWorksheetAnswers 的 INSERT 半段一致（含 content / unit_id / sub_no）。
 * 不用 ON CONFLICT：唯一约束里的 unit_id、section 都可能为 NULL，
 * 而 ON CONFLICT 推断在混入 NULL 时不可靠，无单元的练习册跨批会悄悄产生重复行。
 * 改为事务内"定向删除同 key 旧行 → 插入"，用 IS NOT DISTINCT FROM 对 NULL/非 NULL 行为一致：
 * 后写覆盖先写（跨批边界续答场景，后批内容更完整）。
 */
export const upsertWorksheetAnswers = async (worksheetId, answers) => {
  if (!answers || answers.length === 0) return []
  return transaction(async (client) => {
    const unitMap = await resolveUnitIds(client, worksheetId, answers)
    const unitIdOf = a => (a.unit_key ? (unitMap.get(a.unit_key) || null) : null)

    const delConds = answers.map((_, i) =>
      `(unit_id IS NOT DISTINCT FROM $${i * 4 + 2}
        AND section IS NOT DISTINCT FROM $${i * 4 + 3}
        AND question_no = $${i * 4 + 4}
        AND sub_no = $${i * 4 + 5})`
    ).join(' OR ')
    const delParams = [worksheetId]
    for (const a of answers) {
      delParams.push(unitIdOf(a), a.section || null, a.question_no, a.sub_no || '')
    }
    await client.query(
      `DELETE FROM ${TABLES.RESOURCE_ANSWERS} WHERE resource_id = $1 AND (${delConds})`,
      delParams
    )
    const values = answers.map((_, i) =>
      `($1, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7}, $${i * 7 + 8}, 'official_verified')`
    ).join(',')
    const params = [worksheetId]
    for (const a of answers) {
      params.push(
        a.question_no, a.answer, a.answer_type || 'choice', a.section || null, a.content || null,
        unitIdOf(a), a.sub_no || ''
      )
    }
    const { rows } = await client.query(
      `INSERT INTO ${TABLES.RESOURCE_ANSWERS} (resource_id, question_no, answer, answer_type, section, content, unit_id, sub_no, answer_status)
       VALUES ${values}
       RETURNING *`,
      params
    )
    return rows
  })
}

// 审核页按「单元 → 大题组 → 题号 → 子题」的书内顺序展示，故连 resource_units 取 unit_seq。
// 大题组序取 section 首字在「一二三四五六七八九十」中的位置（"一、填空题"→1），
// 否则同单元内填空/选择/解答的同题号会穿插。sub_no 按长度再按值比较（'10' 不能排在 '2' 前）。
// 未归入单元的旧数据 unit_seq 为 NULL，排在最后。
export const getWorksheetAnswers = async (worksheetId) => {
  const { rows } = await query(
    `SELECT a.*, u.unit_title, u.unit_key, u.lesson_code, u.unit_seq
     FROM ${TABLES.WORKSHEET_ANSWERS} a
     LEFT JOIN resource_units u ON u.id = a.unit_id
     WHERE a.worksheet_id = $1
     ORDER BY u.unit_seq NULLS LAST,
              NULLIF(strpos('一二三四五六七八九十', substr(a.section, 1, 1)), 0) NULLS LAST,
              a.question_no ASC,
              length(a.sub_no) ASC, a.sub_no ASC`,
    [worksheetId]
  )
  return rows
}

export const updateWorksheetAnswer = async (id, { answer, answer_type }) => {
  const { rows } = await query(
    `UPDATE ${TABLES.WORKSHEET_ANSWERS} SET answer = $2, answer_type = COALESCE($3, answer_type)
     WHERE id = $1 RETURNING *`,
    [id, answer, answer_type || null]
  )
  return rows[0] || null
}

export const deleteWorksheetAnswersByWorksheet = async (worksheetId) => {
  await query(`DELETE FROM ${TABLES.WORKSHEET_ANSWERS} WHERE worksheet_id = $1`, [worksheetId])
}

// ── 学生默认练习册 ──

export const getStudentWorksheetSetting = async (studentId, subject) => {
  const { rows } = await query(
    `SELECT s.*, w.name AS worksheet_name, w.subject AS worksheet_subject
     FROM ${TABLES.STUDENT_WORKSHEET_SETTINGS} s
     LEFT JOIN ${TABLES.WORKSHEETS} w ON w.id = s.default_worksheet_id
     WHERE s.student_id = $1 AND s.subject = $2`,
    [studentId, subject]
  )
  return rows[0] || null
}

export const upsertStudentWorksheetSetting = async (studentId, subject, worksheetId) => {
  const { rows } = await query(
    `INSERT INTO ${TABLES.STUDENT_WORKSHEET_SETTINGS} (student_id, subject, default_worksheet_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (student_id, subject)
     DO UPDATE SET default_worksheet_id = $3, updated_at = NOW()
     RETURNING *`,
    [studentId, subject, worksheetId]
  )
  return rows[0]
}

// ── Worker 用：查找单条答案 ──

export const lookupWorksheetAnswer = async (worksheetId, questionNo) => {
  // 保留重复条目场景下的一致性：若存在重复（旧版无事务解析产生），取最新一条
  // 最近一次解析的答案可靠性最高
  const { rows } = await query(
    `SELECT answer, answer_type FROM ${TABLES.WORKSHEET_ANSWERS}
     WHERE worksheet_id = $1 AND question_no = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [worksheetId, questionNo]
  )
  return rows[0] || null
}

// ── Worker 用：整册答案按章节分组（章节感知批改，见 worker processWorkbookGrading）──
// 取答案时按 (unit_key, section, question_no, sub_no) 三层定位，避免：
//   1) 多个练习单元（如"堂堂练① 19.1(1)"与"堂堂练② 19.1(2)"）的「第 1 题 = A」互相覆盖
//   2) 同一单元内"一、填空题 第 1 题"与"二、选择题 第 1 题"被扁平合并
// sub_no 进入外层 key 字符串：填空题同一题多个空需分别命中。
// unit_id=NULL 的旧数据归入一个固定的合成 unitKey，保留旧行为以兼容迁移前的答案。
// 返回：Map<unitKey, Map<sectionKey, Map<`${question_no}|${sub_no}`, row>>>
//   row 含 answer / answer_type / content / unit_id / unit_key / unit_title / unit_seq / section / sub_no
export const getWorksheetAnswersBySection = async (worksheetId) => {
  const { rows } = await query(
    `SELECT ra.section, ra.question_no, ra.answer, ra.answer_type, ra.content,
            ra.unit_id, ra.sub_no,
            ru.unit_key, ru.unit_title, ru.unit_seq,
            ru.answer_page_start, ru.answer_page_end
     FROM ${TABLES.WORKSHEET_ANSWERS} ra
     LEFT JOIN resource_units ru ON ru.id = ra.unit_id
     WHERE ra.worksheet_id = $1
     ORDER BY ru.unit_seq NULLS LAST, ra.created_at ASC`,
    [worksheetId]
  )
  const NO_UNIT = '__no_unit__'
  const result = new Map()
  for (const r of rows) {
    const unitKey = r.unit_key || NO_UNIT
    const sectionKey = r.section || ''
    const subNo = r.sub_no || ''
    const qKey = `${Number(r.question_no)}|${subNo}`
    if (!result.has(unitKey)) result.set(unitKey, new Map())
    const secMap = result.get(unitKey)
    if (!secMap.has(sectionKey)) secMap.set(sectionKey, new Map())
    // 同 key 重复时，rows 已按 created_at 升序，后写覆盖前写
    secMap.get(sectionKey).set(qKey, {
      answer: r.answer,
      standard_answer: r.answer,
      answer_type: r.answer_type,
      content: r.content || null,
      unit_id: r.unit_id,
      unit_key: r.unit_key,
      unit_title: r.unit_title,
      unit_seq: r.unit_seq,
      section: r.section,
      sub_no: subNo,
      // 单元的答案页范围（answer PDF 中该单元首页/末页号），
      // 用于 pickAnswerUnit 在标题失配时按页码兜底匹配。
      answer_page_start: r.answer_page_start ?? null,
      answer_page_end: r.answer_page_end ?? null,
    })
  }
  return result
}

// ── Worker 用：重跑任务前清空旧题目（幂等，防止恢复链路重复入队产生重复题目行）──
export const deleteQuestionsByTaskId = async (taskId) => {
  const { rowCount } = await query(
    `DELETE FROM ${TABLES.QUESTIONS} WHERE task_id = $1`,
    [taskId]
  )
  return rowCount
}

// ═══════════════════════════════════════════════
// 统一资源答案库 CRUD
// ═══════════════════════════════════════════════

export const createResource = async ({ name, type, subject, grade, examDate }) => {
  const { rows } = await query(
    `INSERT INTO ${TABLES.RESOURCES} (name, resource_type, subject, grade, exam_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, type, subject || null, grade || null, examDate || null]
  )
  return rows[0]
}

export const getAllResources = async ({ type, subject } = {}) => {
  const conditions = []
  const params = []
  let idx = 1
  if (type) {
    conditions.push(`resource_type = $${idx++}`)
    params.push(type)
  }
  if (subject) {
    conditions.push(`subject = $${idx++}`)
    params.push(subject)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await query(
    `SELECT r.*,
       (SELECT COUNT(*)::int FROM ${TABLES.RESOURCE_ANSWERS} ra WHERE ra.resource_id = r.id) AS answer_count
     FROM ${TABLES.RESOURCES} r
     ${where}
     ORDER BY r.created_at DESC`,
    params
  )
  return rows
}

export const getResourceById = async (id) => {
  const { rows } = await query(
    `SELECT r.*,
       (SELECT COUNT(*)::int FROM ${TABLES.RESOURCE_ANSWERS} ra WHERE ra.resource_id = r.id) AS answer_count
     FROM ${TABLES.RESOURCES} r WHERE r.id = $1`,
    [id]
  )
  return rows[0] || null
}

export const updateResource = async (id, updates) => {
  const setClauses = []
  const params = [id]
  let idx = 2
  for (const [key, value] of Object.entries(updates)) {
    const col = key === 'answerStatus' ? 'answer_status'
      : key === 'examDate' ? 'exam_date'
      : key === 'resourceType' ? 'resource_type'
      : key === 'parseStatus' ? 'parse_status'
      : key === 'parseCount' ? 'parse_count'
      : key === 'parseWarning' ? 'parse_warning'
      : key === 'parseError' ? 'parse_error'
      : key
    setClauses.push(`${col} = $${idx++}`)
    params.push(value)
  }
  if (setClauses.length === 0) return null
  const { rows } = await query(
    `UPDATE ${TABLES.RESOURCES} SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    params
  )
  return rows[0] || null
}

export const deleteResource = async (id) => {
  await query(`DELETE FROM ${TABLES.RESOURCES} WHERE id = $1`, [id])
}

export const getResourceAnswers = async (resourceId) => {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.RESOURCE_ANSWERS}
     WHERE resource_id = $1 ORDER BY question_no ASC`,
    [resourceId]
  )
  return rows
}

/**
 * 事务性替换资源答案
 */
export const replaceResourceAnswers = async (resourceId, answers) => {
  return transaction(async (client) => {
    await client.query(`DELETE FROM ${TABLES.RESOURCE_ANSWERS} WHERE resource_id = $1`, [resourceId])
    if (!answers || answers.length === 0) return []
    const unitMap = await resolveUnitIds(client, resourceId, answers)
    const values = answers.map((_, i) =>
      `($1, $${i * 9 + 2}, $${i * 9 + 3}, $${i * 9 + 4}, $${i * 9 + 5}, $${i * 9 + 6}, $${i * 9 + 7}, $${i * 9 + 8}, $${i * 9 + 9}, $${i * 9 + 10})`
    ).join(',')
    const params = [resourceId]
    for (const a of answers) {
      params.push(
        a.question_no,
        a.answer,
        a.answer_type || 'choice',
        a.content || null,
        a.section || null,
        a.answer_status || 'ai_draft',
        a.source || 'ai_parse',
        a.unit_key ? (unitMap.get(a.unit_key) || null) : null,
        a.sub_no || ''
      )
    }
    const { rows } = await client.query(
      `INSERT INTO ${TABLES.RESOURCE_ANSWERS}
       (resource_id, question_no, answer, answer_type, content, section, answer_status, source, unit_id, sub_no)
       VALUES ${values}
       ON CONFLICT ${ANSWER_CONFLICT_TARGET}
       DO UPDATE SET
         answer = EXCLUDED.answer,
         answer_type = EXCLUDED.answer_type,
         content = EXCLUDED.content,
         answer_status = EXCLUDED.answer_status,
         source = EXCLUDED.source
       RETURNING *`,
      params
    )
    return rows
  })
}

/**
 * 批量更新 resource_answers 状态（如 ai_draft → teacher_verified）
 */
export const updateResourceAnswerStatus = async (resourceId, answerStatus) => {
  const { rows } = await query(
    `UPDATE ${TABLES.RESOURCE_ANSWERS}
     SET answer_status = $2
     WHERE resource_id = $1
     RETURNING *`,
    [resourceId, answerStatus]
  )
  // 同步更新 resources 表聚合状态
  await query(
    `UPDATE ${TABLES.RESOURCES} SET answer_status = $2 WHERE id = $1`,
    [resourceId, answerStatus]
  )
  return rows
}

/**
 * Worker 用：批量查询答案（跳过未 verified 的）
 * ⚠️ 历史遗留：仅按 question_no IN (...) 查，多 unit 时只返回 question_no ASC 排序后的
 * 第一行。答案库批改管线（processAnswerBankGrading）已切到 getResourceAnswersBySection
 * 的 3D 单元感知结构，本函数保留为兼容旧调用方，不要再在批改链路里用。
 */
export const bulkLookupResourceAnswers = async (resourceId, questionNos) => {
  if (!questionNos || questionNos.length === 0) return []
  const placeholders = questionNos.map((_, i) => `$${i + 2}`).join(',')
  const { rows } = await query(
    `SELECT question_no, answer, answer_type, answer_status, content
     FROM ${TABLES.RESOURCE_ANSWERS}
     WHERE resource_id = $1
       AND question_no IN (${placeholders})
       AND answer_status IN ('teacher_verified', 'official_verified')
     ORDER BY question_no ASC`,
    [resourceId, ...questionNos]
  )
  return rows
}

/**
 * Worker 用：整册答案按单元分组（单元感知批改，答案库批改专用版）
 * 参照 getWorksheetAnswersBySection 的 3D Map 结构：unitKey → sectionKey → qNo|subNo → row
 *
 * 为什么必须按 (unit_id, section, question_no, sub_no) 四级定位？
 * 同一份资源（如试卷）下存在多个 unit（试卷①/试卷②/试卷③），每个 unit 的题号都从 1
 * 重新开始编号。旧 bulkLookupResourceAnswers 只按 question_no 查，多 unit 时只返回
 * question_no ASC 排序后的第一行，导致学生答对但批错（用错单元的答案比对）。
 *
 * 返回 row 含 answer / answer_type / content / unit_id / unit_key / unit_title /
 * unit_seq / section / sub_no。
 * 旧数据（unit_id=NULL）归入一个固定的合成 unitKey '__no_unit__'，保留旧行为。
 */
export const getResourceAnswersBySection = async (resourceId) => {
  const { rows } = await query(
    `SELECT ra.section, ra.question_no, ra.answer, ra.answer_type, ra.content,
            ra.unit_id, ra.sub_no,
            ru.unit_key, ru.unit_title, ru.unit_seq,
            ru.answer_page_start, ru.answer_page_end
     FROM ${TABLES.RESOURCE_ANSWERS} ra
     LEFT JOIN resource_units ru ON ru.id = ra.unit_id
     WHERE ra.resource_id = $1
       AND ra.answer_status IN ('teacher_verified', 'official_verified')
     ORDER BY ru.unit_seq NULLS LAST, ra.created_at ASC`,
    [resourceId]
  )
  const NO_UNIT = '__no_unit__'
  const result = new Map()
  for (const r of rows) {
    const unitKey = r.unit_key || NO_UNIT
    const sectionKey = r.section || ''
    const subNo = r.sub_no || ''
    const qKey = `${Number(r.question_no)}|${subNo}`
    if (!result.has(unitKey)) result.set(unitKey, new Map())
    const secMap = result.get(unitKey)
    if (!secMap.has(sectionKey)) secMap.set(sectionKey, new Map())
    // 同 key 重复时，rows 已按 created_at 升序，后写覆盖前写
    secMap.get(sectionKey).set(qKey, {
      answer: r.answer,
      standard_answer: r.answer,
      answer_type: r.answer_type,
      content: r.content || null,
      unit_id: r.unit_id,
      unit_key: r.unit_key,
      unit_title: r.unit_title,
      unit_seq: r.unit_seq,
      section: r.section,
      sub_no: subNo,
      // 单元的答案页范围（answer PDF 中该单元首页/末页号），
      // 用于 pickAnswerUnit 在标题失配时按页码兜底匹配。
      answer_page_start: r.answer_page_start ?? null,
      answer_page_end: r.answer_page_end ?? null,
    })
  }
  return result
}