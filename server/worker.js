import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '.env') })

import crypto from 'crypto'
import axios from 'axios'
import sharp from 'sharp'
import { TABLES, TASK_STATUS } from './config/neon.js'
import { query } from './config/neon.js'
import { AI_CONFIG, getAIHeaders, buildOCRPrompt, buildTaggingPrompt, buildAnswerGenerationPrompt } from './config/ai.js'
import { updateTaskStatus, createQuestions, batchUpdateQuestionTags, addWrongQuestions, createJudgement, getLatestJudgement, updateQuestionAnswer, markAnswerException, findCachedQuestionByFingerprint, findSimilarQuestion, cacheQuestion, incrementQuestionUseCount, updateQuestionCacheId } from './services/neonService.js'
import { uploadImage } from './services/ossService.js'
import { generateTextFingerprint, generatePHash, PARSER_VERSION, TEXT_SIMILARITY_THRESHOLD } from './utils/questionFingerprint.js'
import { uploadFilesWithRetry } from './services/uploadRetryManager.js'
import { judgeAnswer } from './services/judgeService.js'

// ── 多模态切题引擎：几何图处理 ──
// 使用 Sharp 进行裁剪和图像增强（替代浏览器端的 Canvas/OpenCV）

/**
 * 裁剪几何图并上传到 OSS
 * @param {Buffer} imageBuffer - 原始试卷图片 buffer
 * @param {Object} bbox - {x, y, width, height}
 * @param {string} studentId - 学生ID
 * @returns {Promise<string|null>} OSS URL 或 null
 */
async function cropAndUploadGeometryImage(imageBuffer, bbox, studentId, questionId) {
  try {
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) return null

    const padding = 25
    const left = Math.max(0, bbox.x - padding)
    const top = Math.max(0, bbox.y - padding)
    const right = Math.min(bbox.x + bbox.width + padding, await getImageWidth(imageBuffer))
    const bottom = Math.min(bbox.y + bbox.height + padding, await getImageHeight(imageBuffer))
    const width = right - left
    const height = bottom - top

    if (width <= 0 || height <= 0) return null

    // 裁剪
    const cropped = await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .toBuffer()

    // 上传到 OSS
    const fileName = `geometry_${studentId}_${questionId}.png`
    const ossUrl = await uploadImage(cropped, fileName, studentId)
    console.log(`   [几何图] 裁剪上传成功: ${width}x${height} → ${ossUrl}`)
    return ossUrl
  } catch (error) {
    console.error(`  ⚠️ [几何图] 裁剪上传失败:`, error.message)
    return null
  }
}

async function getImageWidth(buffer) {
  const meta = await sharp(buffer).metadata()
  return meta.width
}

async function getImageHeight(buffer) {
  const meta = await sharp(buffer).metadata()
  return meta.height
}

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

/**
 * JSON 自动修复 — 处理 AI 返回的畸形 JSON
 * 常见问题: 未转义反斜杠(\frac → \\frac)、未转义双引号、字符串内换行
 */
function repairAIJson(jsonStr) {
  const saved = []
  let s = jsonStr

  // 1. 保护已正确转义的序列 (\\, \", \/, \n, \t, \uXXXX)
  s = s.replace(/(\\[\\\"\/nrt]|\\u[0-9a-fA-F]{4})/g, (m) => {
    saved.push(m)
    return `__ESC_${saved.length - 1}__`
  })

  // 2. 修复字符串值内部未转义的反斜杠 (LaTeX 命令)
  s = s.replace(/"([^"]*)"/g, (_full, inner) => {
    if (inner.includes('__ESC_')) return _full
    const fixed = inner.replace(/\\/g, '\\\\')
    return `"${fixed}"`
  })

  // 3. 修复字符串内未转义换行
  s = s.replace(/"([^"]*?)\n([^"]*?)"/g, '"$1\\n$2"')

  // 4. 恢复保护的转义序列
  for (let i = 0; i < saved.length; i++) {
    s = s.replace(`__ESC_${i}__`, saved[i])
  }

  return s
}

const deskewImage = async (imageBuffer) => {
  try {
    const metadata = await sharp(imageBuffer).metadata()
    console.log(`   原图信息: ${metadata.width}x${metadata.height}, format=${metadata.format}, orientation=${metadata.orientation || 'none'}`)

    const straightened = await sharp(imageBuffer)
      .rotate()
      .normalize()
      .toBuffer()

    return straightened
  } catch (error) {
    console.error('透视拉直失败，使用原图继续:', error.message)
    return imageBuffer
  }
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

/**
 * Determine the source of the student answer: did the AI find actual
 * handwriting, or did it see a blank line / fill-in placeholder?
 * Returns 'blank' when AI likely saw empty/placeholder, otherwise 'recognized'.
 */
function determineAnswerSource(rawStudentAnswer) {
  const trimmed = String(rawStudentAnswer || '').trim()
  if (!trimmed || trimmed === '未作答') return 'blank'
  // AI commonly returns "____" for fill-in-blank when it reads the
  // printed blank line instead of actual student handwriting
  const stripped = trimmed.replace(/\s/g, '')
  if (/^_+$/.test(stripped)) return 'blank'
  return 'recognized'
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
    max_tokens: 8192
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
    console.log(`   AI 响应总长度: ${content.length} 字符`)

    let jsonStr = content
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      content.match(/```\n?([\s\S]*?)\n?```/)
    if (jsonMatch) jsonStr = jsonMatch[1]

    let result
    try {
      result = JSON.parse(jsonStr)
    } catch (parseError) {
      console.warn(`⚠️  AI JSON 解析失败，尝试自动修复...`)
      console.warn(`   原始错误: ${parseError.message}`)

      // 尝试截断修复：如果 JSON 末尾被截断，尝试闭合未完成的字符串和结构
      let repaired = repairAIJson(jsonStr)
      // 如果错误是 "Unterminated string"，尝试在末尾补上闭合引号
      if (parseError.message.includes('Unterminated string')) {
        repaired = repaired.replace(/("[^"]*)$/, '$1"')
        // 尝试闭合未闭合的花括号和方括号
        const openBraces = (repaired.match(/\{/g) || []).length
        const closeBraces = (repaired.match(/\}/g) || []).length
        const openBrackets = (repaired.match(/\[/g) || []).length
        const closeBrackets = (repaired.match(/\]/g) || []).length
        for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}'
        for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']'
      }

      console.log(`   修复后 JSON (前200字): ${repaired.substring(0, 200)}...`)
      try {
        result = JSON.parse(repaired)
        console.log(`✅ JSON 自动修复成功！`)
      } catch (repairError) {
        console.error(`❌ JSON 自动修复仍然失败: ${repairError.message}`)
        console.error(`   原始 JSON (前500字): ${jsonStr.substring(0, 500)}`)
        throw new Error(`AI 返回的 JSON 格式错误，无法解析。原始错误: ${parseError.message}`)
      }
    }

    const questions = result.questions?.map((q, index) => {
      const rawStudentAnswer = q.student_answer || ''
      const answerSource = determineAnswerSource(rawStudentAnswer)
      const aiAnswer = rawStudentAnswer
      const cleanedStudentAnswer = answerSource === 'blank' ? '' : rawStudentAnswer

      // Check if the paper has manual checkmark (✓) — skip AI grading for these
      const hasManualCheckmark = q.has_manual_checkmark === true

      let isCorrect, status
      if (hasManualCheckmark) {
        // Paper already has a ✓ mark — mark as correct, no AI grading needed
        isCorrect = true
        status = 'correct'
      } else {
        // No manual mark — use normal AI judgment
        const judgment = judgeAnswer(cleanedStudentAnswer, q.answer, q.question_type)
        isCorrect = judgment.isCorrect
        status = isCorrect === true ? 'correct' : (isCorrect === false ? 'wrong' : 'pending')
      }

      return {
        id: crypto.randomUUID(),
        task_id: taskId,
        content: q.content || '',
        options: q.options || [],
        answer: q.answer || '',
        student_answer: cleanedStudentAnswer,
        ai_answer: aiAnswer,
        answer_source: answerSource,
        is_correct: isCorrect,
        question_type: q.question_type || 'answer',
        subject: q.subject || '数学',
        status: status,
        confidence: q.confidence || 0,
        analysis: q.analysis || '',
        block_coordinates: q.block_coordinates || null,
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

    let result
    try {
      result = JSON.parse(jsonStr)
    } catch (parseError) {
      console.warn(`⚠️  AI JSON 解析失败，尝试自动修复...`)
      console.warn(`   原始错误: ${parseError.message}`)
      const repaired = repairAIJson(jsonStr)
      console.log(`   修复后 JSON (前200字): ${repaired.substring(0, 200)}...`)
      try {
        result = JSON.parse(repaired)
        console.log(`✅ JSON 自动修复成功！`)
      } catch (repairError) {
        console.error(`❌ JSON 自动修复仍然失败: ${repairError.message}`)
        console.error(`   原始 JSON (前500字): ${jsonStr.substring(0, 500)}`)
        throw new Error(`AI 返回的 JSON 格式错误，无法解析。原始错误: ${parseError.message}`)
      }
    }
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

/**
 * Extract the final answer letter from analysis text.
 * AI sometimes puts wrong value in answer field but analysis text is correct.
 * Patterns: "因此只有④正确，应选A" / "正确答案是D" / "故选 B" / "选C"
 */
function extractAnswerFromAnalysis(answer, analysis, options) {
  if (!analysis) return answer

  // 精确匹配模式（高优先级）
  const precisePatterns = [
    /因此\s*(?:只有|仅)[^.，,]*?正确答案[是为：：]?\s*([A-D])/i,
    /综上所述[^.，,]*?应选\s*([A-D])/i,
    /故选\s*([A-D])\s*(?:项)?[，,.。]?$/m,
    /应选\s*([A-D])\s*选项/i,
  ]

  for (const pattern of precisePatterns) {
    const match = analysis.match(pattern)
    if (match) {
      const extracted = match[1].toUpperCase()
      console.log(`   [AnswerExtraction] 精确匹配: ${extracted}`)
      return extracted
    }
  }

  // 一般匹配模式
  const generalPatterns = [
    /正确答案[是为：：]?\s*([A-D])/i,
    /答案[是为：：]?\s*([A-D])/i,
  ]

  for (const pattern of generalPatterns) {
    const match = analysis.match(pattern)
    if (match) {
      const extracted = match[1].toUpperCase()
      if (extracted !== answer) {
        console.log(`   [AnswerExtraction] 一般匹配: ${extracted} (原: ${answer})`)
        return extracted
      }
    }
  }

  return answer
}

/**
 * Generate a single answer for a question via text-only AI call.
 */
const generateAnswerForQuestion = async (questionContent, retryCount = 0) => {
  if (!questionContent || !questionContent.trim()) {
    return { success: true, answer: '', analysis: '' }
  }

  const prompt = buildAnswerGenerationPrompt()

  const requestBody = {
    model: AI_CONFIG.MODEL,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `请计算以下题目的标准答案：\n\n${questionContent}` }
    ],
    temperature: 0.2,
    max_tokens: 1000
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

    let result
    try {
      result = JSON.parse(jsonStr)
    } catch (parseError) {
      console.warn(`⚠️  AI JSON 解析失败，尝试自动修复...`)
      console.warn(`   原始错误: ${parseError.message}`)
      const repaired = repairAIJson(jsonStr)
      console.log(`   修复后 JSON (前200字): ${repaired.substring(0, 200)}...`)
      try {
        result = JSON.parse(repaired)
        console.log(`✅ JSON 自动修复成功！`)
      } catch (repairError) {
        console.error(`❌ JSON 自动修复仍然失败: ${repairError.message}`)
        console.error(`   原始 JSON (前500字): ${jsonStr.substring(0, 500)}`)
        throw new Error(`AI 返回的 JSON 格式错误，无法解析。原始错误: ${parseError.message}`)
      }
    }

    return {
      success: true,
      answer: result.answer || '',
      analysis: result.analysis || ''
    }
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message || '未知错误'
    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const shouldRetry = isNetworkError && retryCount < AI_CONFIG.MAX_RETRIES

    if (shouldRetry) {
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000))
      return generateAnswerForQuestion(questionContent, retryCount + 1)
    }

    return { success: true, answer: '', analysis: '' }
  }
}

/**
 * Check if the AI-generated answer is valid and not abnormal.
 * Returns { isValid: boolean, reason?: string }
 */
function validateAIAnswer(answer, analysis) {
  if (!answer || answer.trim() === '') {
    return { isValid: false, reason: '答案为空' }
  }
  if (answer === '待人工补充' || answer === '此为主观题，无唯一标准答案') {
    return { isValid: false, reason: 'AI标记需要人工补充' }
  }
  if (analysis && analysis.length < 10 && answer.length > 100) {
    return { isValid: false, reason: '答案过长且解析过短，疑似异常' }
  }
  if (/^[\s_]+$/.test(answer)) {
    return { isValid: false, reason: '答案仅包含空白或下划线' }
  }
  return { isValid: true }
}

/**
 * Generate reference answers for ALL questions via AI calculation.
 * OCR may confuse student's selected answer with the reference answer,
 * so reference answers should always come from AI calculation based on question content.
 */
const generateMissingAnswers = async (questions, imageBuffer = null) => {
  if (!questions || questions.length === 0) return { updated: 0, total: 0, exceptions: 0, cacheHits: 0, cacheMisses: 0 }

  const needAnswer = questions.filter(q => true)
  if (needAnswer.length === 0) {
    console.log('   所有题目已有参考答案，跳过生成')
    return { updated: 0, total: 0, exceptions: 0, cacheHits: 0, cacheMisses: 0 }
  }

  console.log(`   需要生成答案: ${needAnswer.length}/${questions.length} 道题`)

  let phash = null
  if (imageBuffer) {
    try {
      phash = await generatePHash(imageBuffer)
    } catch (err) {
      console.error('   生成感知哈希失败:', err.message)
    }
  }

  const batchSize = 3
  let updatedCount = 0
  let emptyCount = 0
  let placeholderCount = 0
  let exceptionCount = 0
  let cacheHitCount = 0
  let cacheMissCount = 0

  for (let i = 0; i < needAnswer.length; i += batchSize) {
    const batch = needAnswer.slice(i, i + batchSize)
    const promises = batch.map(async (q) => {
      const content = q.content || ''
      const options = q.options || []
      const fullContent = options.length > 0 ? `${content}\n选项：${options.join('；')}` : content
      const fingerprint = generateTextFingerprint(content, options, q.question_type)

      if (!fingerprint) {
        console.log(`     题目 ${q.id.substring(0, 8)}: 指纹生成失败，跳过缓存`)
      } else {
        const cached = await findCachedQuestionByFingerprint(fingerprint, PARSER_VERSION)
        
        if (cached && cached.answer && cached.answer !== '待人工补充' && cached.answer !== '此为主观题，无唯一标准答案') {
          cacheHitCount++
          console.log(`     题目 ${q.id.substring(0, 8)}: ✅ 缓存命中 - 复用AI解析结果`)
          
          let finalAnswer = extractAnswerFromAnalysis(cached.answer, cached.analysis, q.options)
          try {
            await updateQuestionAnswer(q.id, finalAnswer, cached.analysis)
            q.answer = finalAnswer
            if (cached.analysis) q.analysis = cached.analysis
            updatedCount++
            
            await incrementQuestionUseCount(fingerprint, PARSER_VERSION)
            // 设置 cache_id 指向权威缓存条目
            q.cache_id = cached.id
            await updateQuestionCacheId(q.id, cached.id)
          } catch (err) {
            console.error(`     题目 ${q.id.substring(0, 8)}: 缓存答案写入失败`, err.message)
            exceptionCount++
          }
          return
        } else if (cached) {
          console.log(`     题目 ${q.id.substring(0, 8)}: 缓存命中但答案无效，重新调用AI`)
        } else {
          const similar = await findSimilarQuestion(fullContent, q.subject || '数学', TEXT_SIMILARITY_THRESHOLD)
          
          if (similar && similar.answer) {
            cacheHitCount++
            console.log(`     题目 ${q.id.substring(0, 8)}: ✅ 相似题目匹配 (${(similar.similarity * 100).toFixed(1)}%) - 复用答案`)
            
            let finalAnswer = extractAnswerFromAnalysis(similar.answer, similar.analysis, q.options)
            try {
              await updateQuestionAnswer(q.id, finalAnswer, similar.analysis)
              q.answer = finalAnswer
              if (similar.analysis) q.analysis = similar.analysis
              updatedCount++
              
              const cacheId = await cacheQuestion({
                content: fullContent,
                options: options,
                answer: finalAnswer,
                analysis: similar.analysis,
                question_type: q.question_type,
                subject: q.subject,
                ai_tags: similar.ai_tags,
                content_type: 'text'
              }, fingerprint, phash, PARSER_VERSION)
              if (cacheId) {
                q.cache_id = cacheId
                await updateQuestionCacheId(q.id, cacheId)
              }
            } catch (err) {
              console.error(`     题目 ${q.id.substring(0, 8)}: 相似答案写入失败`, err.message)
              exceptionCount++
            }
            return
          }
        }
      }

      cacheMissCount++
      const result = await generateAnswerForQuestion(fullContent)

      const validation = validateAIAnswer(result.answer, result.analysis)
      
      if (!validation.isValid) {
        exceptionCount++
        console.log(`     题目 ${q.id.substring(0, 8)}: 解析异常 - ${validation.reason}`)
        try {
          await markAnswerException(q.id, validation.reason)
        } catch (err) {
          console.error(`     题目 ${q.id.substring(0, 8)}: 异常标记写入失败`, err.message)
        }
        return
      }

      if (result.answer && result.answer !== '待人工补充' && result.answer !== '此为主观题，无唯一标准答案') {
        const oldAnswer = q.answer
        let finalAnswer = extractAnswerFromAnalysis(result.answer, result.analysis, q.options)
        try {
          await updateQuestionAnswer(q.id, finalAnswer, result.analysis, true)
          q.answer = finalAnswer
          if (result.analysis) q.analysis = result.analysis
          updatedCount++
          console.log(`     题目 ${q.id.substring(0, 8)}: 答案 ${oldAnswer || '(空)'} → ${finalAnswer}`)

          if (fingerprint) {
            const cacheId = await cacheQuestion({
              content: fullContent,
              options: options,
              answer: finalAnswer,
              analysis: result.analysis,
              question_type: q.question_type,
              subject: q.subject,
              content_type: 'text'
            }, fingerprint, phash, PARSER_VERSION)
            if (cacheId) {
              q.cache_id = cacheId
              await updateQuestionCacheId(q.id, cacheId)
            }
          }
        } catch (err) {
          console.error(`     题目 ${q.id.substring(0, 8)}: 答案写入失败`, err.message)
          exceptionCount++
          try {
            await markAnswerException(q.id, '答案写入失败: ' + err.message)
          } catch (markErr) {
            console.error(`     题目 ${q.id.substring(0, 8)}: 异常标记写入失败`, markErr.message)
          }
        }
      } else if (result.answer) {
        let finalAnswer = extractAnswerFromAnalysis(result.answer, result.analysis, q.options)
        placeholderCount++
        try {
          await updateQuestionAnswer(q.id, finalAnswer, result.analysis)
          q.answer = finalAnswer
          if (result.analysis) q.analysis = result.analysis
          console.log(`     题目 ${q.id.substring(0, 8)}: ${finalAnswer}`)

          if (fingerprint) {
            const cacheId = await cacheQuestion({
              content: fullContent,
              options: options,
              answer: finalAnswer,
              analysis: result.analysis,
              question_type: q.question_type,
              subject: q.subject,
              content_type: 'text'
            }, fingerprint, phash, PARSER_VERSION)
            if (cacheId) {
              q.cache_id = cacheId
              await updateQuestionCacheId(q.id, cacheId)
            }
          }
        } catch (err) {
          console.error(`     题目 ${q.id.substring(0, 8)}: 答案写入失败`, err.message)
          exceptionCount++
          try {
            await markAnswerException(q.id, '答案写入失败: ' + err.message)
          } catch (markErr) {
            console.error(`     题目 ${q.id.substring(0, 8)}: 异常标记写入失败`, markErr.message)
          }
        }
      } else {
        emptyCount++
        console.log(`     题目 ${q.id.substring(0, 8)}: AI 无法生成答案（可能需要参考图片）`)
        exceptionCount++
        try {
          await markAnswerException(q.id, 'AI无法生成答案')
        } catch (err) {
          console.error(`     题目 ${q.id.substring(0, 8)}: 异常标记写入失败`, err.message)
        }
      }
    })

    await Promise.all(promises)
  }

  return { updated: updatedCount, total: needAnswer.length, empty: emptyCount, placeholder: placeholderCount, exceptions: exceptionCount, cacheHits: cacheHitCount, cacheMisses: cacheMissCount }
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

  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
    console.error(`\n💥 [Worker] taskId=${taskId} — imageUrl 无效: ${String(imageUrl).substring(0, 100)}`)
    console.error(`  原因: 上传流程未成功完成或 URL 格式错误`)
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
      error: '文件上传未成功完成，无法生成边界框',
      errorType: 'UPLOAD_NOT_COMPLETED',
      failedAt: new Date().toISOString(),
    })
    throw new Error('文件上传未成功完成')
  }

  console.log(`\n🔥 [Worker] ==========================================`)
  console.log(`🔥🔥 [Worker] 开始处理任务:`)
  console.log(`   taskId: ${taskId}`)
  console.log(`   studentId: ${studentId}`)
  console.log(`   imageUrl (resolved): ${imageUrl}`)
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

    console.log(`📊 [Step 3/8] 透视拉直图片...`)
    let straightenedBuffer
    try {
      straightenedBuffer = await deskewImage(imageBuffer)
      console.log(`✅ [Step 3/8] 透视拉直完成`)
    } catch (deskewError) {
      console.warn('透视拉直失败，使用原图继续:', deskewError.message)
      straightenedBuffer = imageBuffer
    }

    await job.updateProgress(20)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 20 })

    console.log(`📊 [Step 4/8] 压缩图片...`)
    let compressedBuffer
    try {
      compressedBuffer = await compressImageBuffer(straightenedBuffer)
      console.log(`✅ [Step 4/8] 压缩完成: ${straightenedBuffer.length} → ${compressedBuffer.length} bytes (${Math.round(compressedBuffer.length/straightenedBuffer.length*100)}%)`)
    } catch (compressError) {
      console.error('图片压缩失败:', compressError)
      await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
        error: '图片压缩失败: ' + compressError.message,
        duration: Date.now() - startTime
      })
      throw compressError
    }

    await job.updateProgress(30)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 30 })

    const imageBase64 = bufferToBase64(compressedBuffer)

    await job.updateProgress(35)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 35 })

    console.log(`📊 [Step 5/8] 调用 AI 视觉识别...`)
    const ocrResult = await recognizeQuestions(imageBase64, taskId)

    if (!ocrResult.success) {
      console.error(`❌ [Step 5/8] AI 识别失败: ${ocrResult.error}`)
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
    let wrongCount = questions.filter(q => q.is_correct === false).length
    let answerGenResult = { updated: 0, total: 0, empty: 0, placeholder: 0, exceptions: 0, cacheHits: 0, cacheMisses: 0 }

    console.log(`✅ [Step 5/8] AI 识别成功: ${questions.length} 道题, ${wrongCount} 道错题, 耗时 ${Math.round(ocrResult.duration/1000)}s`)

    if (questions.length > 0) {
      console.log(`📊 [Step 6/8] 保存题目到数据库...`)

      // ── 多模态切题：处理几何配图 ─
      const geometryImageCache = new Map() // bbox 去重缓存 (一图多题)

      for (const q of questions) {
        if (q.geometry_image?.has_image && q.geometry_image.bbox) {
          console.log(`   [几何图] ${q.id}: 检测到配图, bbox=${JSON.stringify(q.geometry_image.bbox)}`)
          const bbox = q.geometry_image.bbox
          const cacheKey = JSON.stringify(bbox)
          if (geometryImageCache.has(cacheKey)) {
            q.geometry_image_url = geometryImageCache.get(cacheKey)
          } else {
            q.geometry_image_url = await cropAndUploadGeometryImage(compressedBuffer, bbox, studentId, q.id)
            if (q.geometry_image_url) {
              geometryImageCache.set(cacheKey, q.geometry_image_url)
            }
          }
        } else if (q.content && (q.content.includes('如图') || q.content.includes('图1') || q.content.includes('图示'))) {
          console.log(`   ⚠️ [几何图] ${q.id}: 题干含"如图"关键词但未返回 geometry_image, content=${q.content.substring(0, 60)}`)
        }
      }

      const questionsWithStudentId = questions.map(q => ({
        ...q,
        student_id: studentId
      }))

      await createQuestions(questionsWithStudentId)
      console.log(`✅ [Step 6/8] 题目保存成功 (含 ${geometryImageCache.size} 张几何配图)`)

      // [P0-1] 初始错题同步 — 仅当 OCR 有参考答案且判错时才同步
      const ocrWrongIds = questionsWithStudentId.filter(q => q.is_correct === false && q.answer).map(q => q.id)
      if (ocrWrongIds.length > 0) {
        try {
          const confidenceMap = new Map(questionsWithStudentId.map(q => [q.id, q.confidence]))
          await addWrongQuestions(studentId, ocrWrongIds, confidenceMap)
          console.log(`  ✅ 错题本初始同步: ${ocrWrongIds.length} 道错题 (OCR后)`)
        } catch (e) {
          console.error('  ⚠️ 错题本初始同步失败:', e.message)
        }
      } else {
        console.log('  ℹ️ 无错题需要初始同步')
      }

      // [Shadow Mode] 追加写入 AI OCR 判定记录
      try {
        const judgementPromises = questionsWithStudentId.map(q =>
          createJudgement({
            questionId: q.id,
            studentId: q.student_id,
            source: 'ai_ocr',
            confidence: q.confidence ?? null,
            isCorrect: q.is_correct ?? null,
            content: q.content ?? null,
            answer: q.answer ?? null,
            studentAnswer: q.student_answer ?? null,
            analysis: q.analysis ?? null,
            metadata: { question_type: q.question_type, originalIsCorrect: q.is_correct }
          }).catch(e => console.error(`[Shadow] judgements写入失败 (OCR) q=${q.id?.substring(0,8)}:`, e.message))
        )
        await Promise.allSettled(judgementPromises)
        console.log(`  [Shadow] AI OCR判定记录已追加: ${questionsWithStudentId.length} 条`)
      } catch (e) {
        console.error('  [Shadow] AI OCR判定记录写入异常:', e.message)
      }
await job.updateProgress(80)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 80 })

      console.log(`📊 [Step 7/8] 生成AI参考答案...`)
      answerGenResult = await generateMissingAnswers(questions, compressedBuffer)
      
      let rejudgedWrong = 0
      // 始终执行重判定，确保 OCR 阶段错误的 is_correct 可以被纠正
      for (const q of questions) {
          if (q.answer && q.answer.trim() && q.answer !== '待人工补充' && q.answer !== '此为主观题，无唯一标准答案') {
            // [P0-1d] 检查人工复核判定，若存在则优先使用，跳过AI重判定
            const manualJudgement = await getLatestJudgement(q.id, studentId).catch(() => null)
            if (manualJudgement && manualJudgement.source === 'manual_review' && manualJudgement.is_correct !== null) {
              if (manualJudgement.is_correct !== q.is_correct) {
                q.is_correct = manualJudgement.is_correct
                try {
                  await query(
                    `UPDATE questions SET is_correct = $1, updated_at = NOW() WHERE id = $2`,
                    [manualJudgement.is_correct, q.id]
                  )
                } catch (e) {
                  console.error(`      更新题目 ${q.id.substring(0, 8)} is_correct 失败:`, e.message)
                }
                if (manualJudgement.is_correct === false) rejudgedWrong++
                console.log(`  [P0-1d] 人工判定覆盖AI重判定: q=${q.id.substring(0, 8)}, is_correct=${manualJudgement.is_correct}`)
              }
              continue
            }

            const originalCorrect = q.is_correct
            const judgment = judgeAnswer(q.student_answer, q.answer, q.question_type)
            if (judgment.isCorrect !== originalCorrect) {
              q.is_correct = judgment.isCorrect
              try {
                await query(
                  `UPDATE questions SET is_correct = $1, updated_at = NOW() WHERE id = $2`,
                  [judgment.isCorrect, q.id]
                )
              } catch (e) {
                console.error(`      更新题目 ${q.id.substring(0, 8)} is_correct 失败:`, e.message)
              }
              if (judgment.isCorrect === false) rejudgedWrong++
            }
          }
        }
        const wrongIds = questions.filter(q => q.is_correct === false && q.answer && q.answer.trim() && q.answer !== '待人工补充' && q.answer !== '此为主观题，无唯一标准答案').map(q => q.id)
        if (wrongIds.length > 0) {
          try {
            const confidenceMap = new Map(questions.map(q => [q.id, q.confidence]))
            await addWrongQuestions(studentId, wrongIds, confidenceMap)
            console.log(`  ✅ 错题本同步: ${wrongIds.length} 道错题（其中 ${rejudgedWrong} 道由AI答案生成判定）`)
          } catch (e) {
            console.error('错题本同步失败:', e.message)
          }
        }
                // [Shadow Mode] 追加写入 AI 答案生成判定记录
        try {
          const rejudgePromises = questions.map(q =>
            createJudgement({
              questionId: q.id,
              studentId: studentId,
              source: 'ai_answer_gen',
              confidence: q.confidence ?? null,
              isCorrect: q.is_correct ?? null,
              content: q.content ?? null,
              answer: q.answer ?? null,
              studentAnswer: q.student_answer ?? null,
              aiAnswer: q.ai_answer ?? null,
              analysis: q.analysis ?? null,
              metadata: { question_type: q.question_type }
            }).catch(e => console.error(`[Shadow] judgements写入失败 (AI答案) q=${q.id?.substring(0,8)}:`, e.message))
          )
          await Promise.allSettled(rejudgePromises)
          console.log(`  [Shadow] AI答案生成判定记录已追加: ${questions.length} 条`)
        } catch (e) {
          console.error('  [Shadow] AI答案生成判定记录写入异常:', e.message)
        }
        wrongCount = questions.filter(q => q.is_correct === false).length
        console.log(`✅ [Step 7/8] AI答案生成完成: 生成了 ${answerGenResult.updated}/${answerGenResult.total} 道题的答案, 解析异常 ${answerGenResult.exceptions} 道, 重新判定 ${rejudgedWrong} 道错题, 当前错题数: ${wrongCount}`)
        console.log(`📦 [Cache] 缓存命中: ${answerGenResult.cacheHits} 次, 缓存未命中: ${answerGenResult.cacheMisses} 次`)

        // 降级处理：如果没有任何答案生成且没有缓存命中，标记需要人工复核
        if (answerGenResult.updated === 0 && answerGenResult.cacheHits === 0 && answerGenResult.total > 0) {
          console.warn(`  ⚠️ 未生成任何参考答案，标记所有题目需要人工复核`)
          for (const q of questions) {
            if (!q.answer || !q.answer.trim()) {
              try {
                await markAnswerException(q.id, 'OCR答案待人工确认，AI未生成参考答案')
              } catch (e) {
                // ignore
              }
            }
          }
        }

      await job.updateProgress(85)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 85 })

      console.log(`📊 [Step 8/8] 生成AI标签...`)
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
      console.log(`✅ [Step 8/8] AI标签保存成功`)

      await job.updateProgress(90)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 90 })
    } else {
      console.log(`⚠️  AI 未识别到任何题目`)
    }

    await job.updateProgress(100)
    const duration = Date.now() - startTime

    await updateTaskStatus(taskId, TASK_STATUS.DONE, {
      questionCount: questions.length,
      wrongCount: wrongCount,
      duration: duration,
      completedAt: new Date().toISOString(),
      answerExceptions: answerGenResult.exceptions || 0,
      cacheHits: answerGenResult.cacheHits || 0,
      cacheMisses: answerGenResult.cacheMisses || 0
    })

    console.log(`\n🎉🎉 [Worker] ==========================================`)
    console.log(`🎉🎉 [Worker] 任务完成:`)
    console.log(`   taskId: ${taskId}`)
    console.log(`   题目数: ${questions.length}`)
    console.log(`   错题数: ${wrongCount}`)
    console.log(`   缓存命中: ${answerGenResult.cacheHits || 0} 次`)
    console.log(`   总耗时: ${Math.round(duration / 1000)}s`)
    console.log(`🎉🎉🎉 ==========================================\n`)

    return {
      taskId,
      questionCount: questions.length,
      wrongCount,
      duration,
      cacheHits: answerGenResult?.cacheHits || 0,
      cacheMisses: answerGenResult?.cacheMisses || 0
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
