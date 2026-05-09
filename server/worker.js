import axios from 'axios'
import sharp from 'sharp'
import { query, TABLES, TASK_STATUS } from './config/neon.js'
import { AI_CONFIG, getAIHeaders, buildOCRPrompt, buildTaggingPrompt } from './config/ai.js'

const TAG_SYNONYM_MAP = {
  '几何-三角形': '三角形',
  '直角三角形-勾股定理': '勾股定理',
  '方程与不等式-一元二次方程': '一元二次方程',
  '函数-二次函数': '二次函数',
  '函数-一次函数': '一次函数',
  '函数-反比例函数': '反比例函数',
  '抛物线': '二次函数',
  '三角函数-正弦定理': '正弦定理',
  '三角函数-余弦定理': '余弦定理',
  '力学-牛顿第一定律': '牛顿第一定律',
  '力学-牛顿第二定律': '牛顿第二定律',
  '力学-牛顿第三定律': '牛顿第三定律',
  '电学-欧姆定律': '欧姆定律',
  '化学-氧化还原反应': '氧化还原反应',
  '化学-酸碱中和': '酸碱中和',
}

const deduplicateTags = (tags) => {
  if (!Array.isArray(tags)) return ['未分类']
  const normalized = tags
    .map(tag => String(tag).trim())
    .filter(tag => tag.length > 0)
    .map(tag => TAG_SYNONYM_MAP[tag] || tag)
  const seen = new Set()
  const unique = []
  for (const tag of normalized) {
    const lower = tag.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      unique.push(tag)
    }
  }
  return unique.length > 0 ? unique : ['未分类']
}

const compressImageBuffer = async (imageBuffer) => {
  try {
    const compressed = await sharp(imageBuffer)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    return compressed
  } catch (error) {
    console.error('图片压缩失败:', error)
    throw new Error('图片压缩失败: ' + error.message)
  }
}

const bufferToBase64 = (buffer) => {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`
}

const downloadImage = async (imageUrl) => {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    })
    return Buffer.from(response.data)
  } catch (error) {
    console.error('下载图片失败:', error)
    throw new Error('下载图片失败: ' + error.message)
  }
}

// ==================== Neon 数据操作 ====================

const updateTaskStatus = async (taskId, status, result = null) => {
  if (result !== null) {
    const { rows: existing } = await query(
      `SELECT result FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )
    // 解析已存储的 JSON 字符串
    let existingResult = {}
    if (existing[0]?.result) {
      try {
        existingResult = typeof existing[0].result === 'string'
          ? JSON.parse(existing[0].result)
          : existing[0].result
      } catch {
        existingResult = {}
      }
    }
    const mergedResult = {
      ...existingResult,
      ...result
    }
    await query(
      `UPDATE ${TABLES.TASKS} SET status = $1, result = $2, updated_at = NOW() WHERE id = $3`,
      [status, JSON.stringify(mergedResult), taskId]
    )
  } else {
    await query(
      `UPDATE ${TABLES.TASKS} SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, taskId]
    )
  }
}

const createQuestions = async (questions) => {
  const created = []
  for (const q of questions) {
    let statusValue = 'pending'
    if (q.status === 'wrong' || !q.is_correct) {
      statusValue = 'wrong'
    } else if (q.status === 'mastered') {
      statusValue = 'mastered'
    }

    const { rows } = await query(
      `INSERT INTO ${TABLES.QUESTIONS}
       (task_id, student_id, content, options, answer, analysis, question_type, subject, is_correct, status, image_url, ai_tags, manual_tags, tags_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [q.task_id, q.student_id, q.content || null, JSON.stringify(q.options || []),
       q.answer || null, q.analysis || null, q.question_type || 'choice',
       q.subject || null, q.is_correct !== undefined ? q.is_correct : true,
       statusValue, q.image_url || null, JSON.stringify(q.ai_tags || []),
       JSON.stringify(q.manual_tags || []), q.tags_source || 'ai']
    )
    created.push(rows[0])
  }
  return created
}

const batchUpdateQuestionTags = async (tagUpdates) => {
  const results = []
  for (const update of tagUpdates) {
    try {
      const { rows } = await query(
        `UPDATE ${TABLES.QUESTIONS} SET ai_tags = $1, tags_source = 'ai', updated_at = NOW() WHERE id = $2 RETURNING *`,
        [JSON.stringify(update.ai_tags || []), update.id]
      )
      if (rows.length > 0) results.push(rows[0])
    } catch (error) {
      console.error(`更新标签失败，题目ID: ${update.id}`, error)
    }
  }
  return results
}

const addWrongQuestions = async (studentId, questionIds) => {
  const { rows: existing } = await query(
    `SELECT question_id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = ANY($2)`,
    [studentId, questionIds]
  )

  const existingIds = new Set((existing || []).map(e => e.question_id))
  const newIds = questionIds.filter(id => !existingIds.has(id))

  if (newIds.length === 0) return []

  const created = []
  for (const questionId of newIds) {
    const { rows } = await query(
      `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id, status, error_count, added_at, last_wrong_at)
       VALUES ($1, $2, 'pending', 1, NOW(), NOW()) RETURNING *`,
      [studentId, questionId]
    )
    created.push(rows[0])
  }
  return created
}

// ==================== AI 识别 ====================

const recognizeQuestions = async (imageBase64, taskId, retryCount = 0) => {
  const prompt = buildOCRPrompt()
  const startTime = Date.now()

  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`

  const requestBody = {
    model: AI_CONFIG.MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: '请识别这张作业图片中的所有题目，并返回JSON格式结果。' }
        ]
      }
    ],
    temperature: 0.3,
    max_tokens: 4000
  }

  try {
    const response = await axios.post(AI_CONFIG.ENDPOINT, requestBody, {
      headers: getAIHeaders(),
      timeout: AI_CONFIG.TIMEOUT
    })

    const duration = Date.now() - startTime
    const content = response.data.choices[0]?.message?.content
    if (!content) throw new Error('AI 返回内容为空')

    let jsonStr = content
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      content.match(/```\n?([\s\S]*?)\n?```/)
    if (jsonMatch) jsonStr = jsonMatch[1]

    const result = JSON.parse(jsonStr)

    const questions = result.questions?.map((q, index) => {
      let isCorrect = false
      const studentAnswerStr = String(q.student_answer || '').trim()
      const hasStudentAnswer = studentAnswerStr !== '' && studentAnswerStr !== '未作答'

      if (!hasStudentAnswer) {
        isCorrect = false
      } else if (q.question_type === 'choice' && q.answer && q.student_answer) {
        const normalizedAnswer = String(q.answer).trim().toUpperCase()
        const normalizedStudentAnswer = String(q.student_answer).trim().toUpperCase()
        isCorrect = normalizedAnswer === normalizedStudentAnswer
      } else if (q.question_type === 'fill' && q.answer && q.student_answer) {
        const normalizedAnswer = String(q.answer).trim()
        const normalizedStudentAnswer = String(q.student_answer).trim()
        isCorrect = normalizedAnswer === normalizedStudentAnswer
      } else {
        isCorrect = q.is_correct || false
      }

      return {
        id: `q-${taskId}-${index}`,
        task_id: taskId,
        content: q.content || '',
        options: q.options || [],
        answer: q.answer || '',
        student_answer: q.student_answer || '',
        is_correct: isCorrect,
        question_type: q.question_type || 'answer',
        subject: q.subject || '数学',
        status: isCorrect ? 'correct' : 'wrong',
        confidence: q.confidence || 0,
        analysis: q.analysis || '',
        created_at: new Date().toISOString()
      }
    }) || []

    return { success: true, questions, duration }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error.response?.data?.message || error.message || '未知错误'

    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const shouldRetry = isNetworkError && retryCount < AI_CONFIG.MAX_RETRIES

    if (shouldRetry) {
      console.log(`识别失败，${retryCount + 1}秒后重试 (${retryCount + 1}/${AI_CONFIG.MAX_RETRIES})...`)
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000))
      return recognizeQuestions(imageBase64, taskId, retryCount + 1)
    }

    return {
      success: false,
      error: errorMessage,
      questions: [],
      duration,
      shouldRetry: isNetworkError && retryCount >= AI_CONFIG.MAX_RETRIES
    }
  }
}

const generateTagsForQuestion = async (questionContent, retryCount = 0) => {
  if (!questionContent || !questionContent.trim()) {
    return { success: true, tags: ['未分类'] }
  }

  const prompt = buildTaggingPrompt()

  const requestBody = {
    model: AI_CONFIG.MODEL,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `请分析以下题目，提取知识点标签：\n\n${questionContent}` }
    ],
    temperature: 0.2,
    max_tokens: 500
  }

  try {
    const response = await axios.post(AI_CONFIG.ENDPOINT, requestBody, {
      headers: getAIHeaders(),
      timeout: 30000
    })

    const content = response.data.choices[0]?.message?.content
    if (!content) throw new Error('AI 返回内容为空')

    let jsonStr = content
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      content.match(/```\n?([\s\S]*?)\n?```/)
    if (jsonMatch) jsonStr = jsonMatch[1]

    const result = JSON.parse(jsonStr)
    const rawTags = result.tags || []
    const tags = deduplicateTags(rawTags)

    return { success: true, tags }
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message || '未知错误'
    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const shouldRetry = isNetworkError && retryCount < AI_CONFIG.MAX_RETRIES

    if (shouldRetry) {
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000))
      return generateTagsForQuestion(questionContent, retryCount + 1)
    }

    return { success: true, tags: ['未分类'] }
  }
}

const generateTagsForQuestions = async (questions) => {
  if (!questions || questions.length === 0) return []

  const batchSize = 3
  const results = []

  for (let i = 0; i < questions.length; i += batchSize) {
    const batch = questions.slice(i, i + batchSize)
    const tagPromises = batch.map(async (q) => {
      const content = q.content || ''
      const options = (q.options || []).join('；')
      const fullContent = options ? `${content}\n选项：${options}` : content
      const tagResult = await generateTagsForQuestion(fullContent)
      return { questionId: q.id, tags: tagResult.tags }
    })
    const batchResults = await Promise.all(tagPromises)
    results.push(...batchResults)
  }

  return results
}

// ==================== 任务处理器 ====================

export const processTask = async (job) => {
  const { taskId, studentId, imageUrl, originalName } = job.data
  const startTime = Date.now()

  console.log(`🔄 开始处理任务: ${taskId} (${originalName})`)

  try {
    await job.updateProgress(5)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, {
      progress: 5,
      startedAt: new Date().toISOString()
    })

    console.log(`📥 下载图片: ${imageUrl}`)
    let imageBuffer
    try {
      imageBuffer = await downloadImage(imageUrl)
    } catch (downloadError) {
      console.warn('从URL下载失败:', downloadError.message)
      throw new Error('下载图片失败: ' + downloadError.message)
    }

    await job.updateProgress(15)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 15 })

    console.log(`🗜️ 压缩图片...`)
    let compressedBuffer
    try {
      compressedBuffer = await compressImageBuffer(imageBuffer)
      console.log(`压缩完成: ${imageBuffer.length} → ${compressedBuffer.length} bytes`)
    } catch (compressError) {
      console.error('图片压缩失败:', compressError)
      await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
        error: '图片压缩失败: ' + compressError.message,
        duration: Date.now() - startTime
      })
      throw compressError
    }

    await job.updateProgress(25)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 25 })

    const imageBase64 = bufferToBase64(compressedBuffer)

    await job.updateProgress(30)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 30 })

    console.log(`🤖 调用AI识别...`)
    const ocrResult = await recognizeQuestions(imageBase64, taskId)

    if (!ocrResult.success) {
      await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
        error: ocrResult.error || '识别失败',
        shouldRetry: ocrResult.shouldRetry,
        duration: Date.now() - startTime
      })
      throw new Error(ocrResult.error || 'AI识别失败')
    }

    await job.updateProgress(70)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 70 })

    const questions = ocrResult.questions || []
    const wrongCount = questions.filter(q => !q.is_correct).length

    if (questions.length > 0) {
      console.log(`📝 保存 ${questions.length} 道题目到数据库...`)

      const questionsWithStudentId = questions.map(q => ({
        ...q,
        student_id: studentId
      }))

      try {
        await createQuestions(questionsWithStudentId)
        console.log(`✅ 题目保存成功`)
      } catch (saveError) {
        console.error('保存题目失败:', saveError)
      }

      await job.updateProgress(80)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 80 })

      console.log(`🏷️ 生成AI标签...`)
      try {
        const tagResults = await generateTagsForQuestions(questions)
        const tagMap = {}
        for (const tr of tagResults) {
          tagMap[tr.questionId] = tr.tags
        }

        for (const q of questions) {
          const tags = tagMap[q.id] || ['未分类']
          q.ai_tags = tags
          q.tags_source = 'ai'
        }

        const tagUpdates = questions.map(q => ({
          id: q.id,
          ai_tags: q.ai_tags
        }))
        await batchUpdateQuestionTags(tagUpdates)
        console.log(`✅ AI标签保存成功`)
      } catch (tagError) {
        console.error('AI标签生成失败（不影响主流程）:', tagError)
        for (const q of questions) {
          q.ai_tags = ['未分类']
          q.tags_source = 'ai'
        }
      }

      await job.updateProgress(90)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 90 })

      // 注意：不再自动加入错题本
      // 题目会在"待确认"页面显示，由用户审核后手动选择加入错题本
    }

    await job.updateProgress(100)
    const duration = Date.now() - startTime

    await updateTaskStatus(taskId, TASK_STATUS.DONE, {
      questionCount: questions.length,
      wrongCount: wrongCount,
      duration: duration,
      completedAt: new Date().toISOString()
    })

    console.log(`🎉 任务完成: ${taskId}，发现 ${questions.length} 题，${wrongCount} 道错题，耗时 ${Math.round(duration / 1000)}s`)

    return {
      taskId,
      questionCount: questions.length,
      wrongCount,
      duration
    }
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`💥 任务处理失败: ${taskId}`, error.message)

    try {
      await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
        error: error.message || '处理失败',
        duration: duration,
        failedAt: new Date().toISOString()
      })
    } catch (updateError) {
      console.error('更新任务失败状态时出错:', updateError)
    }

    throw error
  }
}
