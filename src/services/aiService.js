import axios from 'axios'
import { AI_CONFIG, getAIHeaders, buildOCRPrompt } from '../config/ai'
import { enhanceImageFromDataURL } from '../utils/imageEnhancer'
import { judgeAnswer } from '../utils/answerJudge'
import { logRecognition } from './recognitionStorage'

// 图片工具
export { fileToBase64, compressImage } from '../utils/imageUtils'

// 识别日志与本地结果存储
export { getRecognitionLogs, clearRecognitionLogs, saveRecognitionResult, getRecognitionResults } from './recognitionStorage'

// 二维码内容生成/解析
export { generateQRCodeContent, parseQRCodeContent } from './qrContent'

// AI 标签生成
export { generateTagsForQuestion, generateTagsForQuestions } from './taggingService'

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
    console.debug('开始调用AI API，模型:', AI_CONFIG.MODEL)
    const response = await axios.post(
      AI_CONFIG.ENDPOINT,
      requestBody,
      {
        headers: getAIHeaders(),
        timeout: AI_CONFIG.TIMEOUT
      }
    )
    console.debug('AI API调用成功，状态:', response.status)

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
      let isCorrect = judgment.isCorrect
      const unrecognized = judgment.unrecognized

      // 老师红勾仅兜底：比对无法判定(null)时判对，不覆盖比对判错的结果
      const hasManualCheckmark = q.has_manual_checkmark === true
      if (hasManualCheckmark && isCorrect === null) {
        isCorrect = true
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
        unrecognized: unrecognized,
        has_manual_checkmark: hasManualCheckmark,
        question_type: q.question_type || 'answer',
        subject: q.subject || '数学',
        status: isCorrect === true ? 'correct' : (isCorrect === false ? 'wrong' : 'pending'),
        confidence: q.confidence || 0,
        analysis: q.analysis || '',
        // ─ 多模态切题字段 ──
        geometry_image: q.geometry_image || null,
        // 页面理解字段
        question_number: q.question_number || null,
        text_bbox: q.text_bbox || null,
        image_type: q.image_type || null,
        image_bbox: q.image_bbox || null,
        // 原始图片 dataURL (用于后续裁剪增强)
        _original_image_url: imageDataURL,
        created_at: new Date().toISOString()
      }
    }) || []

    // ─ 多模态处理: 对含配图的题目进行裁剪+二值化增强 ─
    const enhancedQuestions = await enhanceGeometryImages(questions)

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
      console.debug(`识别失败，${retryCount + 1}秒后自动重试 (${retryCount + 1}/${AI_CONFIG.MAX_RETRIES})...`)
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
 * 批量处理含几何配图的题目：裁剪 + 二值化增强
 * @param {Array} questions - 题目数组
 * @returns {Promise<Array>} 处理后的题目数组
 */
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
          console.debug(`[几何图] ${question.id} 增强完成: ${bbox.width}x${bbox.height}`)
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

    console.debug(`几何图增强完成: ${cropW}x${cropH}`)
    return enhancedDataURL
  } catch (error) {
    console.error('几何图裁剪/增强失败:', error)
    return null
  }
}
