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
import { updateTaskStatus, createQuestions, batchUpdateQuestionTags, addWrongQuestions, updateQuestionAnswer, markAnswerException, findCachedQuestionByFingerprint, findSimilarQuestion, cacheQuestion, incrementQuestionUseCount } from './services/neonService.js'
import { uploadImage } from './services/ossService.js'
import { generateTextFingerprint, generatePHash, PARSER_VERSION, TEXT_SIMILARITY_THRESHOLD } from './utils/questionFingerprint.js'
import { uploadFilesWithRetry } from './services/uploadRetryManager.js'

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

  // 1. 保护已正确转义的序列 (\\, \", \n, \t)
  s = s.replace(/(\\[\\\"nrt])/g, (m) => {
    saved.push(m)
    return `__ESC_${saved.length - 1}__`
  })

  // 2. 修复字符串值内部未转义的反斜杠 (LaTeX 命令)
  s = s.replace(/"([^"]*)"/g, (_full, inner) => {
    if (inner.includes('__ESC_')) return _full
    const fixed = inner.replace(/\\/g, '\\\\')
    return `"${fixed}"`
  })

  // 3. 修复字符串内未转义换行（处理多行情况）
  s = s.replace(/"([^"]*?)\n([^"]*?)"/g, '"$1\\n$2"')
  s = s.replace(/"([^"]*?)\n([^"]*?)"/g, '"$1\\n$2"') // 二次处理嵌套换行

  // 4. 恢复保护的转义序列
  for (let i = 0; i < saved.length; i++) {
    s = s.replace(`__ESC_${i}__`, saved[i])
  }

  return s
}

/**
 * 深度修复 AI 返回的 JSON
 * 处理 LaTeX 公式中的反斜杠、未转义换行、以及多行字符串问题
 */
function deepRepairAIJson(jsonStr) {
  console.log(`   🔧 [深度修复] 开始深度修复 JSON...`)
  const origLen = jsonStr.length

  // 第一步：用占位符保护所有已正确转义的序列
  const escPlaceholders = []
  let s = jsonStr.replace(/(\\[\\\"nrtb])/g, (m) => {
    const idx = escPlaceholders.length
    escPlaceholders.push(m)
    return `__ESC_PLACEHOLDER_${idx}__`
  })

  // 第二步：保护 JSON 结构中的冒号、逗号、括号等符号，避免后续处理干扰
  // 先提取出所有 block_coordinates 对象备用（最核心数据）
  const coordRegex = /"block_coordinates"\s*:\s*\{[^}]*\}/g
  const savedCoords = []
  s = s.replace(coordRegex, (match) => {
    const idx = savedCoords.length
    savedCoords.push(match)
    return `__COORD_PLACEHOLDER_${idx}__`
  })

  // 第三步：修复字符串内部未转义的反斜杠（LaTeX 公式核心问题）
  // 使用状态机逐字符处理，避免正则的贪婪匹配问题
  let result = ''
  let inString = false
  let escape = false
  let lastQuotePos = -1
  let currentString = ''

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]

    if (!inString) {
      if (ch === '"') {
        inString = true
        escape = false
        lastQuotePos = i
        currentString = '"'
      } else {
        result += ch
      }
      continue
    }

    if (escape) {
      escape = false
      currentString += ch
      continue
    }

    if (ch === '\\') {
      escape = true
      currentString += ch
      continue
    }

    if (ch === '"') {
      // 检查是否是字符串结束符：后面必须是逗号、}、]、: 或空白
      const rest = s.substring(i + 1)
      const nextNonSpace = rest.match(/^\s*(.)/)
      const nextChar = nextNonSpace ? nextNonSpace[1] : ''

      if (nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === ':' || nextChar === '') {
        // 字符串正常结束
        inString = false
        result += currentString + ch
        continue
      } else {
        // 遇到字符串内部的引号，转义它
        currentString += '\\"'
        continue
      }
    }

    if (ch === '\n' || ch === '\r') {
      // 字符串内部的换行符，转义为 \n
      currentString += '\\n'
      continue
    }

    currentString += ch
  }

  s = result

  // 第四步：恢复 block_coordinates 占位符
  for (let i = 0; i < savedCoords.length; i++) {
    s = s.replace(`__COORD_PLACEHOLDER_${i}__`, savedCoords[i])
  }

  // 第五步：恢复转义序列占位符
  for (let i = 0; i < escPlaceholders.length; i++) {
    s = s.replace(`__ESC_PLACEHOLDER_${i}__`, escPlaceholders[i])
  }

  console.log(`   [深度修复] 修复前: ${origLen} chars, 修复后: ${s.length} chars`)
  return s
}

/**
 * 从损坏的 JSON 中尽力提取 block_coordinates
 * 当完全解析失败时，这是最后的保底手段
 */
function extractCoordsFromBrokenJson(jsonStr) {
  console.log(`   🚨 [保底提取] 尝试从损坏的 JSON 中提取坐标...`)
  const coords = []
  const coordPattern = /"block_coordinates"\s*:\s*\{\s*"x"\s*:\s*(\d+)\s*,\s*"y"\s*:\s*(\d+)\s*,\s*"width"\s*:\s*(\d+)\s*,\s*"height"\s*:\s*(\d+)\s*\}/g
  let match
  while ((match = coordPattern.exec(jsonStr)) !== null) {
    coords.push({
      x: parseInt(match[1]),
      y: parseInt(match[2]),
      width: parseInt(match[3]),
      height: parseInt(match[4])
    })
  }
  console.log(`   [保底提取] 成功提取 ${coords.length} 个坐标`)
  return coords
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

/**
 * Normalize answer string for comparison with tolerance for units, case, and formatting.
 * Returns a cleaned string that can be compared for equality.
 */
function normalizeAnswer(str) {
  if (str === null || str === undefined) return ''
  let s = String(str)

  // Full-width to half-width (includes letters, digits, punctuation)
  s = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  // Full-width space to regular space
  s = s.replace(/　/g, ' ')

  // Trim
  s = s.trim()

  // Case normalization (letters only)
  s = s.toUpperCase()

  // Strip trailing common punctuation
  s = s.replace(/[.,;:!?，。；：！？、）)\]}"'《》「」『』]+$/g, '')

  // Unit synonym replacement (Chinese → symbolic); longer patterns first
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
    // No reference answer: mark as pending for manual review instead of assuming correct
    return { isCorrect: null, unrecognized: true }
  }

  if (questionType === 'choice') {
    // Choice: exact letter match, case-insensitive
    const normStudent = String(studentAnswer).trim().toUpperCase()
    const normRef = String(referenceAnswer).trim().toUpperCase()
    return { isCorrect: normStudent === normRef, unrecognized: false }
  }

  // Fill / answer / other: normalized comparison with tolerance
  const normStudent = normalizeAnswer(studentAnswer)
  const normRef = normalizeAnswer(referenceAnswer)
  return { isCorrect: normStudent === normRef, unrecognized: false }
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
    console.log(`   🔥 [MODEL] 正在请求模型: ${AI_CONFIG.MODEL}`)
    console.log(`   发送请求到: ${AI_CONFIG.ENDPOINT}`)
    const response = await axios.post(AI_CONFIG.ENDPOINT, requestBody, {
      headers: getAIHeaders(),
      timeout: AI_CONFIG.TIMEOUT
    })

    const duration = Date.now() - startTime
    console.log(`   AI 响应耗时: ${duration}ms, status=${response.status}`)

    const content = response.data.choices[0]?.message?.content
    if (!content) throw new Error('AI 返回内容为空')

    console.log(`    [RAW_RESPONSE] AI 原始响应全文:\n${content}`)
    console.log(`   🔥 [RAW_RESPONSE_END]`)

    let jsonStr = content
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/)
    jsonStr = jsonMatch ? jsonMatch[1] : content

    // 初始化默认结构，确保后续代码不会因为 undefined 崩溃
    let parsedData = { questions: [], block_coordinates: null }

    // ===== 终极保底防御：在任何 JSON.parse 执行前，用正则死死把 block_coordinates 抠出来 =====
    // block_coordinates 是每道题内部的对象: { "x": 100, "y": 200, "width": 800, "height": 150 }
    const coordPattern = /"block_coordinates"\s*:\s*\{\s*"x"\s*:\s*(-?\d+)\s*,\s*"y"\s*:\s*(-?\d+)\s*,\s*"width"\s*:\s*(-?\d+)\s*,\s*"height"\s*:\s*(-?\d+)\s*\}/g
    const extractedCoords = []
    let cMatch
    while ((cMatch = coordPattern.exec(jsonStr)) !== null) {
      extractedCoords.push({
        x: parseInt(cMatch[1]),
        y: parseInt(cMatch[2]),
        width: parseInt(cMatch[3]),
        height: parseInt(cMatch[4])
      })
    }

    if (extractedCoords.length > 0) {
      console.log(` 【终极保底成功】强行剥离出 ${extractedCoords.length} 个真实像素坐标:`, extractedCoords)
    } else {
      console.log(`️ 正则未匹配到 block_coordinates 对象，将依赖 JSON.parse 路径`)
    }

    // ===== 接下来再去尝试解析文本内容 =====
    try {
      let cleanedStr = jsonStr.trim()
        .replace(/\r?\n/g, ' ')    // 强制把真实换行变为空格，防止断裂
        .replace(/\\+/g, '\\\\')   // 保护反斜杠

      const result = JSON.parse(cleanedStr)
      if (result && result.questions) {
        parsedData.questions = result.questions

        // 如果 JSON 解析出来的题目没有 block_coordinates，用正则提取的坐标回填
        if (extractedCoords.length > 0) {
          for (let i = 0; i < parsedData.questions.length && i < extractedCoords.length; i++) {
            if (!parsedData.questions[i].block_coordinates) {
              parsedData.questions[i].block_coordinates = extractedCoords[i]
              console.log(`   ✅ 坐标回填：第${i + 1}题补充了正则提取的坐标`)
            }
          }
        }
      }
      console.log(`✅ 题目文本解析成功，共 ${parsedData.questions.length} 道题`)
    } catch (e) {
      console.error(`️ 题目文本解析确实炸了，但没关系，我们的坐标已经安全拿到了！`)
      console.error(`   原始错误: ${e.message}`)

      // 保底动作：如果整体 JSON 炸了，用正则提取的坐标重建最小可用的 questions 数组
      if (extractedCoords.length > 0) {
        console.log(`   🔄 用正则提取的 ${extractedCoords.length} 个坐标重建 questions 数组`)
        // 重建题目数组时，必须填满数据库所需的必填字段（content 绝不能为 null）
        parsedData.questions = extractedCoords.map((c, i) => ({
          question_id: String(i + 1),
          visual_title: String(i + 1),
          content: `第${i + 1}题（题目内容解析异常，请参照原图对应框选区域）`,
          options: [],
          answer: '待校对',
          student_answer: '',
          analysis: '公式解析断裂，已启动坐标强行保底隔离',
          is_correct: null,
          confidence: 0.5,
          question_type: 'fill',
          block_coordinates: c,
          coordinates: c,
          bbox: c
        }))
        console.log(`✅ 【保底重建成功】已补全必填字段并成功注入坐标别名`)
      } else {
        // 连坐标也没拿到，给一个空数组防止后续崩溃
        parsedData.questions = []
      }
    }

    // 确保释放 BullMQ 队列锁
    if (!parsedData.block_coordinates) {
      console.error(`❌ 连保底正则都没拿到坐标，强制释放任务`)
    }

    // 强制防御拦截：如果真的什么都没拿到，也必须正常结束任务，绝对不允许卡死队列
    if (!parsedData || (!parsedData.block_coordinates && parsedData.questions.length === 0)) {
      console.error(`❌ 任务解析彻底失败，强制标记失败释放 Redis 锁`)
      throw new Error('AI_PARSE_ERROR: 无法从 AI 响应中提取任何有效数据')
    }

    const questions = parsedData.questions?.map((q, index) => {
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

      const coord = q.block_coordinates || q.coordinates || q.bbox || null

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
        block_coordinates: coord,
        coordinates: coord,    // 兼容别名
        bbox: coord,            // 兼容别名
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
              
              await cacheQuestion({
                content: fullContent,
                options: options,
                answer: finalAnswer,
                analysis: similar.analysis,
                question_type: q.question_type,
                subject: q.subject,
                ai_tags: similar.ai_tags,
                content_type: 'text'
              }, fingerprint, phash, PARSER_VERSION)
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
            await cacheQuestion({
              content: fullContent,
              options: options,
              answer: finalAnswer,
              analysis: result.analysis,
              question_type: q.question_type,
              subject: q.subject,
              content_type: 'text'
            }, fingerprint, phash, PARSER_VERSION)
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
            await cacheQuestion({
              content: fullContent,
              options: options,
              answer: finalAnswer,
              analysis: result.analysis,
              question_type: q.question_type,
              subject: q.subject,
              content_type: 'text'
            }, fingerprint, phash, PARSER_VERSION)
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
    let compressedMeta
    try {
      compressedBuffer = await compressImageBuffer(straightenedBuffer)
      // 获取压缩后的图片尺寸（AI 返回的坐标基于此尺寸）
      compressedMeta = await sharp(compressedBuffer).metadata()
      console.log(`✅ [Step 4/8] 压缩完成: ${straightenedBuffer.length} → ${compressedBuffer.length} bytes, 压缩尺寸: ${compressedMeta.width}x${compressedMeta.height}`)
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

    // ─ 坐标换算准备：计算压缩图 → 原图的缩放因子 ──
    // AI 返回的坐标是基于压缩图（最大1920x1920）的像素坐标
    // 前端渲染的是原图，所以需要将坐标换算回原图空间
    const straightenedMeta = await sharp(straightenedBuffer).metadata()
    const origWidth = straightenedMeta.width
    const origHeight = straightenedMeta.height
    const compWidth = compressedMeta.width
    const compHeight = compressedMeta.height
    const scaleX = origWidth / compWidth
    const scaleY = origHeight / compHeight
    console.log(`   [坐标换算] 压缩图 ${compWidth}x${compHeight} → 原图 ${origWidth}x${origHeight}, scaleX=${scaleX.toFixed(4)}, scaleY=${scaleY.toFixed(4)}`)

    await job.updateProgress(35)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 35 })

    console.log(` [Step 5/8] 调用 AI 视觉识别...`)
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

    // ── 坐标换算：将 AI 返回的压缩图坐标还原为原图坐标 ──
    const needScale = (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001)
    if (questions.length > 0 && needScale) {
      console.log(`   [坐标换算] 开始将 ${questions.length} 道题的坐标从压缩空间还原到原图空间...`)
      for (const q of questions) {
        if (q.block_coordinates && typeof q.block_coordinates.x === 'number') {
          const orig = q.block_coordinates
          q.block_coordinates = {
            x: Math.round(orig.x * scaleX),
            y: Math.round(orig.y * scaleY),
            width: Math.round(orig.width * scaleX),
            height: Math.round(orig.height * scaleY)
          }
        }
        // 几何配图坐标也要换算
        if (q.geometry_image?.has_image && q.geometry_image.bbox) {
          const gBbox = q.geometry_image.bbox
          q.geometry_image.bbox = {
            x: Math.round(gBbox.x * scaleX),
            y: Math.round(gBbox.y * scaleY),
            width: Math.round(gBbox.width * scaleX),
            height: Math.round(gBbox.height * scaleY)
          }
        }
      }
      console.log(`   [坐标换算] 完成`)
    }

    let wrongCount = questions.filter(q => !q.is_correct).length
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

      await job.updateProgress(80)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 80 })

      console.log(`📊 [Step 7/8] 生成AI参考答案...`)
      answerGenResult = await generateMissingAnswers(questions, compressedBuffer)
      
      let rejudgedWrong = 0
      if (answerGenResult.updated > 0 || answerGenResult.exceptions > 0 || answerGenResult.cacheHits > 0) {
        for (const q of questions) {
          if (q.answer && q.answer.trim() && q.answer !== '待人工补充' && q.answer !== '此为主观题，无唯一标准答案') {
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
              if (!judgment.isCorrect) rejudgedWrong++
            }
          }
        }
        const wrongIds = questions.filter(q => !q.is_correct).map(q => q.id)
        if (wrongIds.length > 0) {
          try {
            await addWrongQuestions(studentId, wrongIds)
            console.log(`  ✅ 错题本同步: ${wrongIds.length} 道错题（其中 ${rejudgedWrong} 道由AI答案生成判定）`)
          } catch (e) {
            console.error('错题本同步失败:', e.message)
          }
        }
        wrongCount = questions.filter(q => !q.is_correct).length
        console.log(`✅ [Step 7/8] AI答案生成完成: 生成了 ${answerGenResult.updated}/${answerGenResult.total} 道题的答案, 解析异常 ${answerGenResult.exceptions} 道, 重新判定 ${rejudgedWrong} 道错题, 当前错题数: ${wrongCount}`)
        console.log(`📦 [Cache] 缓存命中: ${answerGenResult.cacheHits} 次, 缓存未命中: ${answerGenResult.cacheMisses} 次`)
      } else {
        console.log(`✅ [Step 7/8] AI答案生成完成: 无需生成（${answerGenResult.total} 道题需要处理）`)
        if (answerGenResult.cacheHits !== undefined) {
          console.log(` [Cache] 缓存命中: ${answerGenResult.cacheHits} 次, 缓存未命中: ${answerGenResult.cacheMisses} 次`)
        }

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
