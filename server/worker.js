import axios from 'axios'
import sharp from 'sharp'
import { TABLES, TASK_STATUS } from './config/neon.js'
import { AI_CONFIG, getAIHeaders, buildOCRPrompt, buildTaggingPrompt } from './config/ai.js'
import { updateTaskStatus, createQuestions, batchUpdateQuestionTags, addWrongQuestions } from './services/neonService.js'
import { uploadImage } from './services/ossService.js'

// AI 密钥校验
const AI_KEY = AI_CONFIG.API_KEY
if (!AI_KEY) {
  console.error('❌❌❌ [AI Config] AI_API_KEY 未设置！AI 识别将无法工作！')
} else {
  const maskedKey = AI_KEY.substring(0, 6) + '...' + AI_KEY.substring(AI_KEY.length - 4)
  console.log(`🔑 [AI Config] API Key 已加载: ${maskedKey}`)
}
console.log(`🤖 [AI Config] Model: ${AI_CONFIG.MODEL}`)
console.log(`🔗 [AI Config] Endpoint: ${AI_CONFIG.ENDPOINT}`)

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
    console.log(`   正在下载图片: ${imageUrl.substring(0, 80)}...`)
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    })
    console.log(`   图片下载成功: ${Buffer.from(response.data).length} bytes`)
    return Buffer.from(response.data)
  } catch (error) {
    console.error('下载图片失败:', error)
    throw new Error('下载图片失败: ' + error.message)
  }
}

const recognizeQuestions = async (imageBase64, taskId, retryCount = 0) => {
  const prompt = buildOCRPrompt()
  const startTime = Date.now()

  console.log(`   🤖 开始调用 AI 视觉识别 (重试 ${retryCount}/${AI_CONFIG.MAX_RETRIES})...`)
  console.log(`   图片 Base64 长度: ${imageBase64.length} chars`)

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
    console.log(`   发送请求到: ${AI_CONFIG.ENDPOINT}`)
    const response = await axios.post(AI_CONFIG.ENDPOINT, requestBody, {
      headers: getAIHeaders(),
      timeout: AI_CONFIG.TIMEOUT
    })

    const duration = Date.now() - startTime
    console.log(`   AI 响应耗时: ${duration}ms, status=${response.status}`)

    const content = response.data.choices[0]?.message?.content
    if (!content) throw new Error('AI 返回内容为空')

    console.log(`   AI 原始响应 (前300字): ${content.substring(0, 300)}...`)

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

    console.log(`   识别完成: ${questions.length} 道题`)
    return { success: true, questions, duration }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error.response?.data?.message || error.message || '未知错误'
    console.error(`   AI 识别失败: ${errorMessage}`)
    if (error.response) {
      console.error(`   HTTP status: ${error.response.status}`)
      console.error(`   响应体: ${JSON.stringify(error.response.data).substring(0, 300)}`)
    }

    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const shouldRetry = isNetworkError && retryCount < AI_CONFIG.MAX_RETRIES

    if (shouldRetry) {
      console.log(`   ${retryCount + 1}秒后重试 (${retryCount + 1}/${AI_CONFIG.MAX_RETRIES})...`)
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

export const processTask = async (job) => {
  const { taskId, studentId, imageUrl: rawImageUrl, originalName } = job.data
  const startTime = Date.now()

  // Defensive: imageUrl from DB might be string URL, JSON object string, or object
  let imageUrl
  if (typeof rawImageUrl === 'string') {
    // Could be plain URL or JSON string from old object serialization
    if (rawImageUrl.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawImageUrl)
        imageUrl = parsed.url || parsed.ossPath || ''
      } catch (e) {
        imageUrl = rawImageUrl // fallback: assume it's a URL
      }
    } else {
      imageUrl = rawImageUrl // normal URL string
    }
  } else if (typeof rawImageUrl === 'object' && rawImageUrl !== null) {
    imageUrl = rawImageUrl.url || rawImageUrl.ossPath || ''
  } else {
    imageUrl = String(rawImageUrl || '')
  }

  console.log(`\n🔥 [Worker] ==========================================`)
  console.log(`🔥🔥 [Worker] 开始处理任务:`)
  console.log(`   taskId: ${taskId}`)
  console.log(`   studentId: ${studentId}`)
  console.log(`   imageUrl (resolved): ${imageUrl}`)
  console.log(`   imageUrl (raw): ${typeof rawImageUrl} ${String(rawImageUrl).substring(0, 100)}`)
  console.log(`   originalName: ${originalName}`)
  console.log(`🔥🔥 ==========================================\n`)

  try {
    console.log(`📊 [Step 1/6] 更新任务状态为 PROCESSING...`)
    await job.updateProgress(5)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, {
      progress: 5,
      startedAt: new Date().toISOString()
    })
    console.log(`✅ [Step 1/6] 状态更新完成`)

    console.log(`📊 [Step 2/6] 从 OSS 下载图片...`)
    let imageBuffer
    try {
      imageBuffer = await downloadImage(imageUrl)
    } catch (downloadError) {
      console.error('下载图片失败:', downloadError.message)
      throw new Error('下载图片失败: ' + downloadError.message)
    }
    console.log(`✅ [Step 2/6] 图片下载完成: ${imageBuffer.length} bytes`)

    await job.updateProgress(15)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 15 })

    console.log(`📊 [Step 3/6] 压缩图片...`)
    let compressedBuffer
    try {
      compressedBuffer = await compressImageBuffer(imageBuffer)
      console.log(`✅ [Step 3/6] 压缩完成: ${imageBuffer.length} → ${compressedBuffer.length} bytes (${Math.round(compressedBuffer.length/imageBuffer.length*100)}%)`)
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

    console.log(`📊 [Step 4/6] 调用 AI 视觉识别...`)
    const ocrResult = await recognizeQuestions(imageBase64, taskId)

    if (!ocrResult.success) {
      console.error(`❌ [Step 4/6] AI 识别失败: ${ocrResult.error}`)
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

    console.log(`✅ [Step 4/6] AI 识别成功: ${questions.length} 道题, ${wrongCount} 道错题, 耗时 ${Math.round(ocrResult.duration/1000)}s`)

    if (questions.length > 0) {
      console.log(`📊 [Step 5/6] 保存题目到数据库...`)

      const questionsWithStudentId = questions.map(q => ({
        ...q,
        student_id: studentId
      }))

      await createQuestions(questionsWithStudentId)
      console.log(`✅ [Step 5/6] 题目保存成功`)

      await job.updateProgress(80)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 80 })

      console.log(`📊 [Step 6/6] 生成AI标签...`)
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
      console.log(`✅ [Step 6/6] AI标签保存成功`)

      await job.updateProgress(90)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 90 })

      const wrongQuestionIds = questions
        .filter(q => !q.is_correct)
        .map(q => q.id)

      if (wrongQuestionIds.length > 0) {
        console.log(` 添加 ${wrongQuestionIds.length} 道错题到错题本...`)
        try {
          await addWrongQuestions(studentId, wrongQuestionIds)
          console.log(`✅ 错题添加成功`)
        } catch (wrongError) {
          console.error('添加错题失败（不影响主流程）:', wrongError)
        }
      }
    } else {
      console.log(`⚠️  AI 未识别到任何题目`)
    }

    await job.updateProgress(100)
    const duration = Date.now() - startTime

    await updateTaskStatus(taskId, TASK_STATUS.DONE, {
      questionCount: questions.length,
      wrongCount: wrongCount,
      duration: duration,
      completedAt: new Date().toISOString()
    })

    console.log(`\n🎉🎉 [Worker] ==========================================`)
    console.log(`🎉🎉 [Worker] 任务完成:`)
    console.log(`   taskId: ${taskId}`)
    console.log(`   题目数: ${questions.length}`)
    console.log(`   错题数: ${wrongCount}`)
    console.log(`   总耗时: ${Math.round(duration / 1000)}s`)
    console.log(`🎉🎉🎉 ==========================================\n`)

    return {
      taskId,
      questionCount: questions.length,
      wrongCount,
      duration
    }
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`\n💥💥💥 [Worker] ==========================================`)
    console.error(`💥💥💥 [Worker] 任务处理失败:`)
    console.error(`   taskId: ${taskId}`)
    console.error(`   错误: ${error.message}`)
    console.error(`   堆栈: ${error.stack}`)
    console.error(`💥💥 ==========================================\n`)

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
