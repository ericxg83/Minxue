import { randomUUID } from 'node:crypto'
import { query, TABLES, transaction } from '../config/neon.js'
import { checkQuestionCompleteness } from '../utils/questionCompleteness.js'

export const updateTaskStatus = async (taskId, status, result = null) => {
  const updateData = {
    status,
    updated_at: new Date().toISOString()
  }

  // 运维字段：从 result 提取并写入独立列（补齐前仅存于 result JSON 内）。
  // retry_count / last_error / started_at / failed_at 任一缺失则保留原值（COALESCE）。
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
         last_error = COALESCE($5, last_error),
         started_at = COALESCE($6::timestamptz, started_at),
         failed_at = COALESCE($7::timestamptz, failed_at)
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
      content: q.content || null,
      options: JSON.stringify(q.options || []),
      answer: q.answer || null,
      student_answer: q.student_answer || null,
      ai_answer: q.ai_answer || null,
      answer_source: q.answer_source || 'recognized',
      analysis: q.analysis || null,
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
        JSON.stringify(questionData.options || []),
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
      last_error || null,
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
  const { rows } = await query(
    `INSERT INTO ${TABLES.WORKSHEETS} (name, subject, grade) VALUES ($1, $2, $3) RETURNING *`,
    [name, subject || null, grade || null]
  )
  return rows[0]
}

export const getAllWorksheets = async () => {
  const { rows } = await query(
    `SELECT w.*, COUNT(wa.id)::int AS answer_count
     FROM ${TABLES.WORKSHEETS} w
     LEFT JOIN ${TABLES.WORKSHEET_ANSWERS} wa ON wa.worksheet_id = w.id
     GROUP BY w.id ORDER BY w.created_at DESC`
  )
  return rows
}

export const getWorksheetById = async (id) => {
  const { rows } = await query(
    `SELECT w.*, COUNT(wa.id)::int AS answer_count
     FROM ${TABLES.WORKSHEETS} w
     LEFT JOIN ${TABLES.WORKSHEET_ANSWERS} wa ON wa.worksheet_id = w.id
     WHERE w.id = $1 GROUP BY w.id`,
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

export const updateWorksheetParseStatus = async (id, { status, count = null, warning = null, error = null }) => {
  const { rows } = await query(
    `UPDATE ${TABLES.WORKSHEETS}
     SET parse_status = $2, parse_count = $3, parse_warning = $4, parse_error = $5
     WHERE id = $1 RETURNING *`,
    [id, status, count, warning, error]
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

// ── 答案 CRUD ──

export const batchInsertAnswers = async (worksheetId, answers) => {
  if (!answers || answers.length === 0) return []
  const values = answers.map((_, i) =>
    `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`
  ).join(',')
  const params = [worksheetId]
  for (const a of answers) {
    params.push(a.question_no, a.answer, a.answer_type || 'choice', a.section || null)
  }
  const { rows } = await query(
    `INSERT INTO ${TABLES.WORKSHEET_ANSWERS} (worksheet_id, question_no, answer, answer_type, section)
     VALUES ${values}
     ON CONFLICT (worksheet_id, section, question_no)
     DO UPDATE SET answer = EXCLUDED.answer, answer_type = EXCLUDED.answer_type
     RETURNING *`,
    params
  )
  return rows
}

/**
 * 事务性替换练习册答案：先清空后插入，避免并发解析产生重复行
 */
export const replaceWorksheetAnswers = async (worksheetId, answers) => {
  return transaction(async (client) => {
    await client.query(`DELETE FROM ${TABLES.WORKSHEET_ANSWERS} WHERE worksheet_id = $1`, [worksheetId])
    if (!answers || answers.length === 0) return []
    const values = answers.map((_, i) =>
      `($1, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, $${i * 5 + 6})`
    ).join(',')
    const params = [worksheetId]
    for (const a of answers) {
      params.push(a.question_no, a.answer, a.answer_type || 'choice', a.section || null, a.content || null)
    }
    const { rows } = await client.query(
      `INSERT INTO ${TABLES.WORKSHEET_ANSWERS} (worksheet_id, question_no, answer, answer_type, section, content)
       VALUES ${values}
       ON CONFLICT (worksheet_id, section, question_no)
       DO UPDATE SET answer = EXCLUDED.answer, answer_type = EXCLUDED.answer_type, content = EXCLUDED.content
       RETURNING *`,
      params
    )
    return rows
  })
}

export const getWorksheetAnswers = async (worksheetId) => {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.WORKSHEET_ANSWERS}
     WHERE worksheet_id = $1 ORDER BY question_no ASC`,
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
export const getWorksheetAnswersBySection = async (worksheetId) => {
  const { rows } = await query(
    `SELECT section, question_no, answer, answer_type, content FROM ${TABLES.WORKSHEET_ANSWERS}
     WHERE worksheet_id = $1
     ORDER BY created_at ASC`,
    [worksheetId]
  )
  const bySection = new Map()
  for (const r of rows) {
    const key = r.section || ''
    if (!bySection.has(key)) bySection.set(key, new Map())
    // 同章节同题号重复时保留最新（rows 按 created_at 升序，后写覆盖）
    bySection.get(key).set(r.question_no, { answer: r.answer, answer_type: r.answer_type, content: r.content || null })
  }
  return bySection
}

// ── Worker 用：重跑任务前清空旧题目（幂等，防止恢复链路重复入队产生重复题目行）──
export const deleteQuestionsByTaskId = async (taskId) => {
  const { rowCount } = await query(
    `DELETE FROM ${TABLES.QUESTIONS} WHERE task_id = $1`,
    [taskId]
  )
  return rowCount
}

// ── 重新解析 PDF 前清空旧答案（重复解析 = 整体替换；section 为 NULL 时唯一约束不生效，必须显式清空）──
export const clearWorksheetAnswers = async (worksheetId) => {
  await query(`DELETE FROM ${TABLES.WORKSHEET_ANSWERS} WHERE worksheet_id = $1`, [worksheetId])
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
    const values = answers.map((_, i) =>
      `($1, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7}, $${i * 7 + 8})`
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
        a.source || 'ai_parse'
      )
    }
    const { rows } = await client.query(
      `INSERT INTO ${TABLES.RESOURCE_ANSWERS}
       (resource_id, question_no, answer, answer_type, content, section, answer_status, source)
       VALUES ${values}
       ON CONFLICT (resource_id, section, question_no)
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