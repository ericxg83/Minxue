import axios from 'axios'
import { AI_CONFIG, getAIHeaders, buildOCRPrompt, buildTaggingPrompt } from '../config/ai'

// 识别日志存储键名
const RECOGNITION_LOGS_KEY = 'ai_recognition_logs'

// 将图片转换为 base64
export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result)
    reader.onerror = (error) => reject(error)
  })
}

// 压缩图片
export const compressImage = (file, maxWidth = 1920, maxHeight = 1920, quality = 0.8) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (e) => {
      const img = new Image()
      img.src = e.target.result
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        // 计算缩放比例
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height)
          width *= ratio
          height *= ratio
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        // 转换为压缩后的 base64
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality)
        resolve(compressedBase64)
      }
      img.onerror = reject
    }
    reader.onerror = reject
  })
}

// 记录识别日志到本地存储
const logRecognition = (logEntry) => {
  try {
    const logs = JSON.parse(localStorage.getItem(RECOGNITION_LOGS_KEY) || '[]')
    logs.unshift({
      ...logEntry,
      timestamp: new Date().toISOString()
    })
    // 只保留最近100条日志
    if (logs.length > 100) {
      logs.pop()
    }
    localStorage.setItem(RECOGNITION_LOGS_KEY, JSON.stringify(logs))
  } catch (error) {
    console.error('记录日志失败:', error)
  }
}

// 获取识别日志
export const getRecognitionLogs = () => {
  try {
    return JSON.parse(localStorage.getItem(RECOGNITION_LOGS_KEY) || '[]')
  } catch {
    return []
  }
}

// 清空识别日志
export const clearRecognitionLogs = () => {
  localStorage.removeItem(RECOGNITION_LOGS_KEY)
}

// 调用 AI 接口识别题目（带重试机制）
export const recognizeQuestions = async (imageBase64, studentId, taskId, retryCount = 0) => {
  const prompt = buildOCRPrompt()
  const startTime = Date.now()

  // 确保 base64 图片包含 data URI 前缀
  const imageUrl = imageBase64.startsWith('data:') 
    ? imageBase64 
    : `data:image/jpeg;base64,${imageBase64}`

  // 使用 OpenAI 兼容格式
  const requestBody = {
    model: AI_CONFIG.MODEL,
    messages: [
      {
        role: 'system',
        content: prompt
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: imageUrl
            }
          },
          {
            type: 'text',
            text: '请识别这张作业图片中的所有题目，并返回JSON格式结果。'
          }
        ]
      }
    ],
    temperature: 0.3,
    max_tokens: 4000
  }

  try {
    console.log('开始调用AI API，模型:', AI_CONFIG.MODEL)
    const response = await axios.post(
      AI_CONFIG.ENDPOINT,
      requestBody,
      {
        headers: getAIHeaders(),
        timeout: AI_CONFIG.TIMEOUT
      }
    )
    console.log('AI API调用成功，状态:', response.status)

    const duration = Date.now() - startTime

    // 解析 AI 返回的内容
    const content = response.data.choices[0]?.message?.content
    if (!content) {
      throw new Error('AI 返回内容为空')
    }

    // 提取 JSON 部分
    let jsonStr = content
    // 如果内容包含 markdown 代码块，提取其中的 JSON
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      content.match(/```\n?([\s\S]*?)\n?```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1]
    }

    const result = JSON.parse(jsonStr)

    // 为每个题目添加额外信息，并校验答案正确性
    const questions = result.questions?.map((q, index) => {
      // 后处理：校验 is_correct 的准确性
      let isCorrect = false
      const studentAnswerStr = String(q.student_answer || '').trim()
      const hasStudentAnswer = studentAnswerStr !== '' && studentAnswerStr !== '未作答'
      
      // 如果学生未作答，直接判定为错误
      if (!hasStudentAnswer) {
        isCorrect = false
      }
      // 如果是选择题，进行答案比对校验
      else if (q.question_type === 'choice' && q.answer && q.student_answer) {
        const normalizedAnswer = String(q.answer).trim().toUpperCase()
        const normalizedStudentAnswer = String(q.student_answer).trim().toUpperCase()
        // 重新计算 is_correct，确保准确性
        isCorrect = normalizedAnswer === normalizedStudentAnswer
      }
      // 如果是填空题，进行答案比对校验
      else if (q.question_type === 'fill' && q.answer && q.student_answer) {
        const normalizedAnswer = String(q.answer).trim()
        const normalizedStudentAnswer = String(q.student_answer).trim()
        isCorrect = normalizedAnswer === normalizedStudentAnswer
      }
      // 解答题：如果有作答且AI认为正确，信任AI判断；否则以AI返回的为准
      else {
        isCorrect = q.is_correct || false
      }
      
      return {
        id: `q-${taskId}-${index}`,
        task_id: taskId,
        student_id: studentId,
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

    // 记录成功日志
    logRecognition({
      type: 'success',
      taskId,
      studentId,
      questionCount: questions.length,
      duration,
      retryCount
    })

    return {
      success: true,
      questions,
      rawResponse: content,
      duration
    }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error.response?.data?.message || error.message || '未知错误'
    
    // 详细记录错误信息
    console.error('AI API 错误详情:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      errorCode: error.code,
      errorMessage: error.message,
      errorStack: error.stack,
      requestBody: requestBody
    })

    // 记录失败日志
    logRecognition({
      type: 'error',
      taskId,
      studentId,
      error: errorMessage,
      duration,
      retryCount
    })

    // 如果是网络错误或超时，且未达到最大重试次数，则自动重试
    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const shouldRetry = isNetworkError && retryCount < AI_CONFIG.MAX_RETRIES

    if (shouldRetry) {
      console.log(`识别失败，${retryCount + 1}秒后自动重试 (${retryCount + 1}/${AI_CONFIG.MAX_RETRIES})...`)
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000))
      return recognizeQuestions(imageBase64, studentId, taskId, retryCount + 1)
    }

    console.error('AI 识别失败:', error)
    return {
      success: false,
      error: errorMessage,
      questions: [],
      duration,
      shouldRetry: isNetworkError && retryCount >= AI_CONFIG.MAX_RETRIES
    }
  }
}

// 重试机制封装（供外部调用）
export const recognizeQuestionsWithRetry = async (imageBase64, studentId, taskId) => {
  return recognizeQuestions(imageBase64, studentId, taskId, 0)
}

// 保存识别结果到本地数据库
export const saveRecognitionResult = (taskId, studentId, questions) => {
  try {
    const storageKey = `recognition_results_${studentId}`
    const existing = JSON.parse(localStorage.getItem(storageKey) || '[]')

    const resultEntry = {
      id: `rec-${Date.now()}`,
      task_id: taskId,
      student_id: studentId,
      questions: questions.map(q => ({
        question_id: q.id,
        question_text: q.content,
        question_type: q.question_type,
        options: q.options,
        answer: q.answer,
        student_answer: q.student_answer,
        is_correct: q.is_correct,
        status: q.is_correct ? '识别成功' : '识别成功',
        exam_date: new Date().toISOString()
      })),
      created_at: new Date().toISOString()
    }

    existing.unshift(resultEntry)

    // 只保留最近50条记录
    if (existing.length > 50) {
      existing.pop()
    }

    localStorage.setItem(storageKey, JSON.stringify(existing))
    return { success: true }
  } catch (error) {
    console.error('保存识别结果失败:', error)
    return { success: false, error: error.message }
  }
}

// 获取本地存储的识别结果
export const getRecognitionResults = (studentId) => {
  try {
    const storageKey = `recognition_results_${studentId}`
    return JSON.parse(localStorage.getItem(storageKey) || '[]')
  } catch {
    return []
  }
}

// 生成二维码内容（用于学生重练）
export const generateQRCodeContent = (studentId, questionIds) => {
  const data = {
    type: 'training',
    studentId,
    questionIds,
    timestamp: Date.now()
  }
  return JSON.stringify(data)
}

// 解析二维码内容
export const parseQRCodeContent = (content) => {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

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

export const generateTagsForQuestion = async (questionContent, retryCount = 0) => {
  if (!questionContent || !questionContent.trim()) {
    return { success: true, tags: ['未分类'] }
  }

  const prompt = buildTaggingPrompt()
  const startTime = Date.now()

  const requestBody = {
    model: AI_CONFIG.MODEL,
    messages: [
      {
        role: 'system',
        content: prompt
      },
      {
        role: 'user',
        content: `请分析以下题目，提取知识点标签：\n\n${questionContent}`
      }
    ],
    temperature: 0.2,
    max_tokens: 500
  }

  try {
    console.log('开始调用AI生成标签，题目:', questionContent.substring(0, 50) + '...')
    const response = await axios.post(
      AI_CONFIG.ENDPOINT,
      requestBody,
      {
        headers: getAIHeaders(),
        timeout: 30000
      }
    )

    const content = response.data.choices[0]?.message?.content
    if (!content) {
      throw new Error('AI 返回内容为空')
    }

    let jsonStr = content
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      content.match(/```\n?([\s\S]*?)\n?```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1]
    }

    const result = JSON.parse(jsonStr)
    const rawTags = result.tags || []
    const tags = deduplicateTags(rawTags)

    const duration = Date.now() - startTime
    console.log(`标签生成完成，耗时 ${duration}ms，标签:`, tags)

    logRecognition({
      type: 'tag_success',
      questionContent: questionContent.substring(0, 50),
      tags,
      duration,
      retryCount
    })

    return { success: true, tags, duration }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error.response?.data?.message || error.message || '未知错误'
    console.error('AI 标签生成失败:', errorMessage)

    logRecognition({
      type: 'tag_error',
      questionContent: questionContent.substring(0, 50),
      error: errorMessage,
      duration,
      retryCount
    })

    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const shouldRetry = isNetworkError && retryCount < AI_CONFIG.MAX_RETRIES

    if (shouldRetry) {
      console.log(`标签生成失败，${retryCount + 1}秒后自动重试 (${retryCount + 1}/${AI_CONFIG.MAX_RETRIES})...`)
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000))
      return generateTagsForQuestion(questionContent, retryCount + 1)
    }

    return { success: true, tags: ['未分类'], duration }
  }
}

export const generateTagsForQuestions = async (questions) => {
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
      return {
        questionId: q.id,
        tags: tagResult.tags
      }
    })

    const batchResults = await Promise.all(tagPromises)
    results.push(...batchResults)
  }

  return results
}
