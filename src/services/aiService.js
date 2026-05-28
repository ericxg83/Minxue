import axios from 'axios'
import { AI_CONFIG, getAIHeaders, buildOCRPrompt, buildTaggingPrompt } from '../config/ai'
import { enhanceImageFromDataURL } from '../utils/imageEnhancer'
import {
  detectImageBlocks,
  bindImagesToQuestions,
  generateThumbnail,
  processGeometryImage
} from '../utils/questionImageUtils'

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

// ── Answer comparison utilities ──

/**
 * Normalize answer string for comparison with tolerance for units, case, and formatting.
 */
function normalizeAnswer(str) {
  if (str === null || str === undefined) return ''
  let s = String(str)

  // Full-width to half-width
  s = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  s = s.replace(/　/g, ' ')

  s = s.trim()
  s = s.toUpperCase()

  // Strip trailing common punctuation
  s = s.replace(/[.,;:!?，。；：！？、）)\]}"'《》「」『』]+$/g, '')

  // Unit synonym replacement
  const unitPairs = [
    ['小时', 'H'], ['時', 'H'],
    ['分钟', 'MIN'], ['分鐘', 'MIN'],
    ['秒钟', 'S'], ['秒鐘', 'S'],
    ['厘米', 'CM'], ['毫米', 'MM'],
    ['千克', 'KG'], ['公里', 'KM'],
    ['毫升', 'ML'],
    ['度', '°'],
    ['米', 'M'], ['时', 'H'], ['時', 'H'],
    ['分', 'MIN'], ['秒', 'S'],
    ['克', 'G'], ['升', 'L'],
  ]
  for (const [cn, sym] of unitPairs) {
    s = s.replace(new RegExp(cn, 'g'), sym)
  }

  // Remove all whitespace
  s = s.replace(/\s+/g, '')

  return s
}

/**
 * Compare student answer against reference answer with tolerance.
 * Returns { isCorrect: boolean, unrecognized: boolean }
 */
function judgeAnswer(studentAnswer, referenceAnswer, questionType) {
  const rawAnswer = String(studentAnswer || '').trim()
  const hasAnswer = rawAnswer !== '' && rawAnswer !== '未作答'

  if (!hasAnswer) {
    return { isCorrect: null, unrecognized: true }
  }

  if (!referenceAnswer) {
    return { isCorrect: true, unrecognized: false }
  }

  if (questionType === 'choice') {
    const normStudent = String(studentAnswer).trim().toUpperCase()
    const normRef = String(referenceAnswer).trim().toUpperCase()
    return { isCorrect: normStudent === normRef, unrecognized: false }
  }

  const normStudent = normalizeAnswer(studentAnswer)
  const normRef = normalizeAnswer(referenceAnswer)
  return { isCorrect: normStudent === normRef, unrecognized: false }
}

// 调用 AI 接口识别题目（带重试机制）
export const recognizeQuestions = async (imageBase64, studentId, taskId, retryCount = 0) => {
  const prompt = buildOCRPrompt()
  const startTime = Date.now()

  // 确保 base64 图片包含 data URI 前缀
  const imageDataURL = imageBase64.startsWith('data:') 
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
              url: imageDataURL
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

    // 为每个题目添加额外信息，并用标准化比对校验答案正确性
    const questions = result.questions?.map((q, index) => {
      const judgment = judgeAnswer(q.student_answer, q.answer, q.question_type)
      const isCorrect = judgment.isCorrect
      const unrecognized = judgment.unrecognized

      return {
        id: `q-${taskId}-${index}`,
        task_id: taskId,
        student_id: studentId,
        content: q.content || '',
        options: q.options || [],
        answer: q.answer || '',
        student_answer: q.student_answer || '',
        is_correct: isCorrect,
        unrecognized: unrecognized,
        question_type: q.question_type || 'answer',
        subject: q.subject || '数学',
        status: isCorrect === true ? 'correct' : (isCorrect === false ? 'wrong' : 'pending'),
        confidence: q.confidence || 0,
        analysis: q.analysis || '',
        // ─ 多模态切题字段 ──
        geometry_image: q.geometry_image || null,
        // 原始图片 dataURL (用于后续裁剪增强)
        _original_image_url: imageDataURL,
        created_at: new Date().toISOString()
      }
    }) || []

    // ─ 多模态处理: 对含配图的题目进行裁剪+二值化增强 ─
    let enhancedQuestions = await enhanceGeometryImages(questions)

    // ─ 图片块检测和绑定 ─
    enhancedQuestions = await detectAndBindImages(enhancedQuestions, imageDataURL)

    // 记录成功日志
    logRecognition({
      type: 'success',
      taskId,
      studentId,
      questionCount: enhancedQuestions.length,
      duration,
      retryCount
    })

    return {
      success: true,
      questions: enhancedQuestions,
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

// ── 几何配图处理 ──

/**
 * 检测并绑定图片到题目
 * 1. 检测试卷图片中的图片块
 * 2. 生成缩略图
 * 3. 将图片块绑定到题目
 * 4. 更新题目对象，添加 images 字段
 * 
 * @param {Array} questions - 题目数组
 * @param {string} imageDataURL - 原始试卷图片 dataURL
 * @returns {Promise<Array>} 更新后的题目数组
 */
async function detectAndBindImages(questions, imageDataURL) {
  if (!questions || questions.length === 0) return questions
  
  console.log('[图片处理] 开始检测，题目数量:', questions.length)
  console.log('[图片处理] 原始图片尺寸:', await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`)
    img.onerror = () => resolve('加载失败')
    img.src = imageDataURL
  }))

  try {
    // 加载试卷图片
    const examImage = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = imageDataURL
    })
    
    // 检测图片块
    const imageBlocks = await detectImageBlocks(examImage, questions)
    console.log('[图片处理] 检测到图片块数量:', imageBlocks.length)
    if (imageBlocks.length > 0) {
      console.log('[图片处理] 图片块详情:', imageBlocks.map(b => ({
        bbox: b.bbox,
        thumbnail_length: b.thumbnail?.length || 0
      })))
    }
    
    // 绑定图片到题目
    const questionImageMap = bindImagesToQuestions(questions, imageBlocks, examImage)
    console.log('[图片处理] 绑定结果 Map 大小:', questionImageMap.size)
    
    // 更新题目对象
    const updatedQuestions = questions.map(q => {
      const question = { ...q }
      
      // 添加自动检测的图片
      const detectedImages = questionImageMap.get(q.id)
      if (detectedImages && detectedImages.length > 0) {
        question.images = detectedImages.map(img => ({
          thumbnail: img.thumbnail,
          full_image: img.fullImage,
          bbox: img.imageBlock.bbox,
          source: 'auto'
        }))
        console.log(`[图片处理] 题目 ${q.id} 绑定 ${question.images.length} 张图片`)
      }
      
      // 如果有 AI 检测的 geometry_image，也添加到 images 数组
      if (question.geometry_image?.has_image && question.geometry_image.bbox) {
        if (!question.images) question.images = []
        
        const geoImage = await processGeometryImage(question, examImage)
        if (geoImage) {
          question.images.push({
            thumbnail: geoImage.thumbnail,
            full_image: geoImage.fullImage,
            bbox: geoImage.bbox,
            source: 'ai'
          })
          console.log(`[图片处理] 题目 ${q.id} AI几何图已添加`)
        }
      }
      
      // 为向后兼容，保留 enhanced_geometry_image 为第一张图片
      if (question.images && question.images.length > 0) {
        question.enhanced_geometry_image = question.images[0].full_image
        question.geometry_image_url = question.images[0].full_image
      }
      
      return question
    })
    
    const imageCount = updatedQuestions.reduce((sum, q) => sum + (q.images?.length || 0), 0)
    console.log(`[图片处理] 共检测到 ${imageCount} 张图片，已绑定到题目`)
    
    return updatedQuestions
  } catch (error) {
    console.error('[图片处理] 失败:', error)
    return questions
  }
}

/**
 * 手动添加图片到题目
 * @param {string} questionId - 题目 ID
 * @param {File|string} imageFile - 图片文件或 dataURL
 * @param {Object} bbox - 图片边界框（可选）
 * @returns {Promise<Object>} 处理后的图片信息
 */
export async function addImageToQuestion(questionId, imageFile, bbox = null) {
  try {
    let dataURL
    if (imageFile instanceof File) {
      dataURL = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(imageFile)
      })
    } else {
      dataURL = imageFile
    }
    
    // 生成缩略图
    const thumbnail = await generateThumbnailFromDataURL(dataURL, 150)
    
    return {
      question_id: questionId,
      thumbnail,
      full_image: dataURL,
      bbox,
      source: 'manual'
    }
  } catch (error) {
    console.error('[手动添加图片] 失败:', error)
    throw error
  }
}

/**
 * 从 dataURL 生成缩略图
 */
async function generateThumbnailFromDataURL(dataURL, maxSize) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(maxSize / img.naturalWidth, maxSize / img.naturalHeight, 1)
      
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      const ctx = canvas.getContext('2d')
      
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = reject
    img.src = dataURL
  })
}
async function enhanceGeometryImages(questions) {
  const enhanced = []
  const cache = new Map() // bbox 去重缓存 (一图多题共用同一增强结果)

  for (const q of questions) {
    // 深拷贝避免修改原对象
    const question = { ...q }

    if (question.geometry_image?.has_image && question.geometry_image.bbox) {
      // 生成 bbox 的 cache key (一图多题共用)
      const cacheKey = JSON.stringify(question.geometry_image.bbox)

      if (cache.has(cacheKey)) {
        // 复用已增强的图片 (一图多题场景)
        question.enhanced_geometry_image = cache.get(cacheKey)
      } else {
        // 裁剪并增强
        const bbox = question.geometry_image.bbox
        const enhancedDataURL = await cropAndEnhanceGeometryImage(
          question._original_image_url,
          bbox
        )

        if (enhancedDataURL) {
          question.enhanced_geometry_image = enhancedDataURL
          cache.set(cacheKey, enhancedDataURL)
          console.log(`[几何图] ${question.id} 增强完成: ${bbox.width}x${bbox.height}`)
        } else {
          console.warn(`[几何图] ${question.id} 增强失败`)
        }
      }
    }

    // 清理临时字段 (不发送到服务端)
    delete question._original_image_url
    enhanced.push(question)
  }

  return enhanced
}

/**
 * 从原始图片 dataURL 中裁剪指定区域并应用二值化增强
 * @param {string} imageDataURL - 原始图片的 dataURL
 * @param {Object} bbox - {x, y, width, height} 裁剪区域
 * @returns {Promise<string|null>} 增强后的图片 dataURL，失败返回 null
 */
async function cropAndEnhanceGeometryImage(imageDataURL, bbox) {
  try {
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) {
      console.warn('几何图 bbox 无效，跳过处理')
      return null
    }

    // 1. 加载图片获取尺寸
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = imageDataURL
    })

    const origW = img.naturalWidth || img.width
    const origH = img.naturalHeight || img.height

    // 2. 外扩裁剪 (padding = 25px)
    const padding = 25
    const x1 = Math.max(0, bbox.x - padding)
    const y1 = Math.max(0, bbox.y - padding)
    const x2 = Math.min(origW, bbox.x + bbox.width + padding)
    const y2 = Math.min(origH, bbox.y + bbox.height + padding)
    const cropW = x2 - x1
    const cropH = y2 - y1

    if (cropW <= 0 || cropH <= 0) {
      console.warn('裁剪区域无效')
      return null
    }

    // 3. 裁剪
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = cropW
    cropCanvas.height = cropH
    const cropCtx = cropCanvas.getContext('2d')
    cropCtx.drawImage(img, x1, y1, cropW, cropH, 0, 0, cropW, cropH)
    const croppedDataURL = cropCanvas.toDataURL('image/png')

    // 4. 应用自适应二值化增强 (对应 Python 版的 ImageEnhancer.enhance_pipeline)
    const enhancedDataURL = await enhanceImageFromDataURL(croppedDataURL, {
      blockSize: 41,
      c: 3,
      borderSize: 5
    })

    console.log(`几何图增强完成: ${cropW}x${cropH}`)
    return enhancedDataURL
  } catch (error) {
    console.error('几何图裁剪/增强失败:', error)
    return null
  }
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
