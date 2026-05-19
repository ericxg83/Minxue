import { query, TABLES } from '../config/neon.js'

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
      ai_tags: JSON.stringify(q.ai_tags || []),
      manual_tags: JSON.stringify(q.manual_tags || []),
      tags_source: q.tags_source || 'ai',
      block_coordinates: q.block_coordinates ? JSON.stringify(q.block_coordinates) : null,
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

export const addWrongQuestions = async (studentId, questionIds) => {
  if (!questionIds || questionIds.length === 0) return []

  const { rows: existing } = await query(
    `SELECT question_id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = ANY($2)`,
    [studentId, questionIds]
  )
  const existingIds = new Set(existing.map(e => e.question_id))
  const newIds = questionIds.filter(id => !existingIds.has(id))

  if (newIds.length === 0) return []

  const values = newIds.map((_, i) => `($1, $${i + 2}, 'pending', 1, NOW(), NOW(), NOW())`).join(',')
  const params = [studentId, ...newIds]

  await query(
    `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id, status, error_count, added_at, last_wrong_at, created_at) VALUES ${values} ON CONFLICT DO NOTHING`,
    params
  )

  return newIds.map(id => ({ question_id: id }))
}

export const updateQuestionAnswer = async (questionId, answer, analysis) => {
  if (!answer && !analysis) return

  let analysisClause = ''
  const params = [answer || null, questionId]

  if (analysis && analysis.trim()) {
    analysisClause = ', analysis = CASE WHEN (analysis IS NULL OR analysis = \'\') THEN $3 ELSE analysis END'
    params.splice(1, 0, analysis)
  }

  await query(
    `UPDATE ${TABLES.QUESTIONS}
     SET answer = COALESCE(NULLIF($1, ''), answer),
         updated_at = NOW()
         ${analysisClause}
     WHERE id = $2`,
    params
  )
}

export const markAnswerException = async (questionId, reason) => {
  try {
    await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET result = COALESCE(result, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify({ answer_exception: true, exception_reason: reason, exception_time: new Date().toISOString() }), questionId]
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
    } else {
      await query(
        `INSERT INTO ${TABLES.QUESTION_CACHE}
         (question_fingerprint, content_type, content, options, answer, analysis,
          question_type, subject, ai_tags, phash, parser_version, use_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
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
