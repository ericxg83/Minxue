import { query, TABLES } from '../config/neon.js'
import { checkQuestionCompleteness } from '../utils/questionCompleteness.js'

export const updateTaskStatus = async (taskId, status, result = null) => {
  const updateData = {
    status,
    updated_at: new Date().toISOString()
  }

  if (result !== null) {
    const { rows } = await query(
      `SELECT result FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )
    const existingResult = rows[0]?.result || {}
    if (typeof existingResult === 'string') {
      updateData.result = JSON.stringify({ ...JSON.parse(existingResult), ...result })
    } else {
      updateData.result = JSON.stringify({ ...existingResult, ...result })
    }
  } else {
    updateData.result = JSON.stringify(result || {})
  }

  await query(
    `UPDATE ${TABLES.TASKS}
     SET status = $1, result = $2, updated_at = $3
     WHERE id = $4`,
    [status, updateData.result, updateData.updated_at, taskId]
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
      id: q.id,
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
      block_coordinates: q.block_coordinates ? JSON.stringify(q.block_coordinates) : null,
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
  const results = []
  for (const update of tagUpdates) {
    try {
      await query(
        `UPDATE ${TABLES.QUESTIONS}
         SET ai_tags = $1::jsonb, tags_source = 'ai', updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(update.ai_tags), update.id]
      )
      results.push({ id: update.id })
    } catch (error) {
      console.error(`更新标签失败，题目ID: ${update.id}`, error)
    }
  }
  return results
}

export const addWrongQuestions = async (studentId, questionIds, questionConfidenceMap = null, questionMap = null) => {
  if (!questionIds || questionIds.length === 0) return []

  const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.8

  // [P0-1] 按置信度阈值过滤 — 低于 0.8 的不进入错题本
  let filteredIds = questionIds
  if (questionConfidenceMap) {
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
  if (questionMap) {
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
    
    const { rows: existingRows } = await query(
      `SELECT id FROM ${TABLES.QUESTION_CACHE}
       WHERE question_fingerprint = $1 AND parser_version = $2`,
      [fingerprint, parserVersion]
    )
    
    if (existingRows.length > 0) {
      await query(
        `UPDATE ${TABLES.QUESTION_CACHE}
         SET content = $1, options = $2, answer = $3, analysis = $4,
             question_type = $5, subject = $6, ai_tags = $7, phash = $8,
             updated_at = NOW()
         WHERE question_fingerprint = $9 AND parser_version = $10`,
        [
          questionData.content || null,
          JSON.stringify(questionData.options || []),
          questionData.answer || null,
          questionData.analysis || null,
          questionData.question_type || 'choice',
          questionData.subject || null,
          JSON.stringify(questionData.ai_tags || []),
          phash,
          fingerprint,
          parserVersion
        ]
      )
      console.log(`[QuestionCache] 缓存更新成功`)
      return existingRows[0].id
    } else {
      const { rows: newRows } = await query(
        `INSERT INTO ${TABLES.QUESTION_CACHE}
         (question_fingerprint, content_type, content, options, answer, analysis,
          question_type, subject, ai_tags, phash, parser_version, use_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
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
          parserVersion,
          0
        ]
      )
      console.log(`[QuestionCache] 缓存写入成功`)
      return newRows[0].id
    }
    
    return true
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
    `SELECT * FROM ${TABLES.JUDGEMENTS}
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