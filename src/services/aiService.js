import axios from 'axios'
import { AI_CONFIG, getAIHeaders, buildOCRPrompt, buildTaggingPrompt } from '../config/ai'
import { enhanceImageFromDataURL } from '../utils/imageEnhancer'

// 识别日志存储键名
const RECOGNITION_LOGS_KEY = 'ai_recognition_logs'

// Phase 2: 复用 canvas，减少内存分配
let sharedCanvas = null
const getSharedCanvas = () => {
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas')
  }
  return sharedCanvas
}

// 将图片转换为 base64
export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result)
    reader.onerror = (error) => reject(error)
  })
}

// 压缩图片（Phase 2优化：复用 canvas）
export const compressImage = (file, maxWidth = 1920, maxHeight = 1920, quality = 0.8) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (e) => {
      const img = new Image()
      img.src = e.target.result
      img.onload = () => {
        const canvas = getSharedCanvas()
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
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
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
 * 收窄过程型答案到最终结果，避免 "=√4=2" 与 "2" 直接比对失败。
 * 优先级：最右 = 右侧 → 分号末段 → 逗号末段。
 */
function narrowToFinalAnswer(s) {
  if (s == null) return ''
  let str = String(s).trim()
  // Full-width ＝ → half-width = (before = check)
  str = str.replace(/＝/g, '=')
  if (str.includes('=')) str = str.slice(str.lastIndexOf('=') + 1).trim()
  else if (str.includes(';') || str.includes('；')) str = str.split(/[;；]/).pop().trim()
  else if (str.includes(',') || str.includes('，')) str = str.split(/[,，]/).pop().trim()
  // "答:" (answer marker) 之后才是最终答案，取其后内容
  // e.g. "4/9 答:占全班4/9。" → "占全班4/9。"
  const ansIdx = str.search(/答[:：]/)
  if (ansIdx >= 0) {
    const beforeAns = str.slice(0, ansIdx).trim()
    const afterAns = str.slice(ansIdx + 1).replace(/^[:：]/, '').trim()
    // 当 "答:" 后是短叙述残句（无分数、≤6 字符，如 "还剩1元。"，学生笔误留下的
    // 中间过程残句），而 "=" 已收窄出含数字的完整结果（如 "35(元)"）时，
    // 真实答案在收窄结果里，保留收窄结果，避免把正确过程答案误判为错。
    // 反之 "答:" 后是完整答案（如 "多看12页，少看1/16。"）时保留 "答:" 内容。
    const isNarrativeResidue = afterAns.length <= 6 && !afterAns.includes('/')
    if (isNarrativeResidue && /\d/.test(beforeAns)) str = beforeAns
    else str = afterAns
  }
  return str
}

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

  // Remove parentheses around units: "4.8(时)" → "4.8时" (before trailing punct strip)
  s = s.replace(/[（(]([^）)]+)[）)]/g, '$1')

  // Strip trailing common punctuation
  s = s.replace(/[.,;:!?，。；：！？、）)\]}>"'《》「」『』]+$/g, '')

  // Unit synonym replacement (order matters: longer units first)
  const unitPairs = [
    ['小时', 'H'], ['小時', 'H'],
    ['分钟', 'MIN'], ['分鐘', 'MIN'],
    ['秒钟', 'S'], ['秒鐘', 'S'],
    ['厘米', 'CM'], ['毫米', 'MM'],
    ['千米', 'KM'], ['公里', 'KM'],
    ['千克', 'KG'], ['公斤', 'KG'],
    ['毫升', 'ML'],
    ['时', 'H'], ['時', 'H'],
    ['分', 'MIN'],
    ['秒', 'S'],
    ['米', 'M'],
    ['升', 'L'],
    ['度', '°'],
    ['克', 'G'],
  ]
  for (const [cn, sym] of unitPairs) {
    s = s.replace(new RegExp(cn, 'g'), sym)
  }

  // Unicode fraction symbols → /n form (must run BEFORE mixed-fraction rules)
  // Insert space before Unicode fraction when preceded by digit (so "218¾" → "218 ¾")
  s = s.replace(/(\d)([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒])/g, '$1 $2')
  const unicodeFracs = {
    '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4',
    '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
    '⅙': '1/6', '⅚': '5/6', '⅐': '1/7',
    '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
    '⅑': '1/9', '⅒': '1/10',
  }
  for (const [sym, frac] of Object.entries(unicodeFracs)) {
    s = s.replace(new RegExp(sym, 'g'), frac)
  }

  // LaTeX fraction: \frac{n}{d} → n/d (前后加空格便于混合数规则识别)
  // (toUpperCase 会把 \frac 变 \FRAC，故用 i 标志)
  s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/gi, ' $1/$2 ')
  // LaTeX 运算符: \div → /, \times → *, \cdot → *
  s = s.replace(/\\div/gi, '/')
  s = s.replace(/\\times/gi, '*')
  s = s.replace(/\\cdot/gi, '*')
  // LaTeX display markers $ $ \( \) → 移除
  s = s.replace(/\$|\\[()]/g, '')

  // Mixed number with space: "146 3/4" → "146+3/4" (before whitespace removal)
  s = s.replace(/(\d+)\s+(\d+\/\d+)/g, '$1+$2')

  // Convert Chinese mixed fraction to standard format: "12又1/3" → "12+1/3"
  s = s.replace(/(\d+)又([+-]?\d+\/\d+)/g, '$1+$2')

  // Remove all whitespace
  s = s.replace(/\s+/g, '')

  return s
}

/**
 * 单位换算基准表：时间→秒，长度→米，重量→克，容量→毫升，角度→度。
 */
const UNIT_BASE = {
  H: 3600, MIN: 60, S: 1,
  KM: 1000, M: 1, CM: 0.01, MM: 0.001,
  KG: 1000, G: 1,
  L: 1000, ML: 1,
  '°': 1,
}

/**
 * 把"数值+单位"解析为换算到基准后的纯数值；失败返回 null。
 */
function parseValueWithUnit(s) {
  const m = String(s).match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Z°]+)$/)
  if (m && UNIT_BASE[m[2]]) {
    return parseFloat(m[1]) * UNIT_BASE[m[2]]
  }
  let expr = String(s).replace(/[^0-9+\-*/().]/g, '')
  if (!expr) return null
  expr = expr.replace(/^[+\-*/]+|[+\-*/]+$/g, '')
  if (!expr) return null
  try {
    const v = eval(expr)
    return isFinite(v) ? v : null
  } catch {
    return null
  }
}

/**
 * Try numeric equivalence with unit tolerance:
 * "1/2" vs "0.5", "12+1/3" vs "37/3", "120S" vs "2MIN", "3KM" vs "3000M"
 */
function isNumericEquivalent(a, b) {
  const numA = parseValueWithUnit(a)
  const numB = parseValueWithUnit(b)
  if (numA == null || numB == null) return false
  return Math.abs(numA - numB) < 1e-9
}

/**
 * Check if two math expressions are numerically equivalent
 * by substituting test values for variables and comparing results.
 * Handles implicit multiplication, ^ exponentiation, and equation prefix.
 */
function isMathEquivalent(expr1, expr2) {
  if (!expr1 || !expr2) return false

  try {
    // Prepare expression for JS evaluation
    const prep = (s) => {
      // Strip equation prefix: "y = 2x - 4" → "2x - 4", "f(x)=..." → "..."
      const eqIdx = s.indexOf('=')
      if (eqIdx > 0) s = s.substring(eqIdx + 1)
      s = s.trim()
      // ^ → **  (exponentiation)
      s = s.replace(/\^/g, '**')
      // √ 开方 → **0.5：√4 → (4)**0.5，√(1/3) → ((1/3))**0.5
      // 用 **0.5 而非 Math.sqrt，避免后续 toLowerCase 把 Math 变成 math 导致 ReferenceError。
      // 先处理括号形式（内容可含运算符），再处理纯数字。
      s = s.replace(/√\(([^()]*)\)/g, '(($1))**0.5')
      s = s.replace(/√([0-9]+(?:\.[0-9]+)?)/g, '(($1))**0.5')
      // Insert * for implicit multiplication: "2x" → "2*x", "2(" → "2*(", ")(" → ")*("
      s = s.replace(/(\d)([a-zA-Z(])/g, '$1*$2')
      s = s.replace(/([a-zA-Z)])(\d)/g, '$1*$2')
      s = s.replace(/\)\(/g, ')*(')
      return s
    }

    let e1 = prep(expr1).toLowerCase()
    let e2 = prep(expr2).toLowerCase()

    // Extract single-letter variables (not adjacent to another letter, exclude e/pi)
    const allText = e1 + ' ' + e2
    const varSet = new Set()
    const varRe = /(?<![a-z])([a-df-z])(?![a-z])/gi
    let m
    while ((m = varRe.exec(allText)) !== null) {
      varSet.add(m[1].toLowerCase())
    }
    // Remove common function-name letters that slip through
    const funcLetters = new Set(['s', 'i', 'n', 'c', 'o', 't', 'a', 'g', 'l', 'e', 'x', 'p', 'r', 'm', 'u', 'v'])
    for (const fl of funcLetters) {
      if (varSet.has(fl)) {
        // Only remove if the letter ONLY appears in function words, not as standalone variable
        // Keep if it appears as standalone
        const standaloneRe = new RegExp(`(?<![a-z])${fl}(?![a-z])`, 'g')
        const inE1 = (e1.match(standaloneRe) || []).length
        const inE2 = (e2.match(standaloneRe) || []).length
        if (inE1 === 0 && inE2 === 0) varSet.delete(fl)
      }
    }

    if (varSet.size === 0) {
      // No variables — compare as literal numbers
      const fn1 = new Function(`"use strict"; return (${e1})`)
      const fn2 = new Function(`"use strict"; return (${e2})`)
      return Math.abs(fn1() - fn2()) < 1e-9
    }

    // Test with diverse values; all must match
    // 注意：若所有测试点都因表达式非法而跳过（continue），说明两边根本不是可评估的
    // 数学表达式，此时应判"不等"而非"相等"，否则会把含中文/乱字符的答案误判为对。
    const testVals = [0, 1, 2, -1, 0.5, 3, -2, 5, 0.25, 10]
    let evaluatedCount = 0
    for (const v of testVals) {
      let s1 = e1; let s2 = e2
      for (const vn of varSet) {
        const re = new RegExp(`(?<![a-z])(${vn})(?![a-z])`, 'g')
        s1 = s1.replace(re, `(${v})`)
        s2 = s2.replace(re, `(${v})`)
      }
      try {
        const fn1 = new Function(`"use strict"; return (${s1})`)
        const fn2 = new Function(`"use strict"; return (${s2})`)
        evaluatedCount++
        if (Math.abs(fn1() - fn2()) > 1e-9) return false
      } catch {
        continue // skip test values that cause math errors (e.g. division by zero)
      }
    }
    return evaluatedCount > 0
  } catch {
    return false
  }
}

/** Normalize judge (true/false) answer to a canonical form: 'T' or 'F' */
function normalizeJudgeAnswer(str) {
  if (!str) return ''
  const s = String(str).trim()
  if (/^[✓√✔vV]$/.test(s)) return 'T'
  if (/^(正确|对|是|true|yes|T)$/i.test(s)) return 'T'
  if (/^[✗✘×xX]$/.test(s)) return 'F'
  if (/^(错误|错|否|false|no|F)$/i.test(s)) return 'F'
  return s.toUpperCase()
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
    // 去包裹的括号/全角括号："(C)" / "（C）" / " C " 统一为 "C" 再比较
    const cleanChoice = (s) => String(s || '').trim().toUpperCase().replace(/^[（(]|[)）]$/g, '')
    return { isCorrect: cleanChoice(studentAnswer) === cleanChoice(referenceAnswer), unrecognized: false }
  }

  if (questionType === 'judge') {
    // Judge: 同样去括号/全角括号（"（√）" / "(×)" → "√" / "×"），再走 T/F 归一化
    const cleanJudge = (s) => String(s || '').trim().replace(/^[（(]|[)）]$/g, '')
    const normStudent = normalizeJudgeAnswer(cleanJudge(studentAnswer))
    const normRef = normalizeJudgeAnswer(cleanJudge(referenceAnswer))
    return { isCorrect: normStudent === normRef, unrecognized: false }
  }

  // Fill / answer / other: normalized comparison with tolerance
  const narrowedStudent = narrowToFinalAnswer(studentAnswer)
  const normStudent = normalizeAnswer(narrowedStudent)
  const normRef = normalizeAnswer(referenceAnswer)

  // String-level match
  if (normStudent === normRef) {
    return { isCorrect: true, unrecognized: false }
  }

  // Try numeric equivalence (handles "1/2" vs "0.5", "12.0" vs "12", units)
  if (isNumericEquivalent(normStudent, normRef)) {
    return { isCorrect: true, unrecognized: false }
  }

  // String mismatch — try mathematical equivalence
  // (handles cases like "2x-4" vs "2(x-2)" which are the same but differ textually)
  if (isMathEquivalent(narrowedStudent, referenceAnswer)) {
    return { isCorrect: true, unrecognized: false }
  }

  // Fallback: compare numeric values from original input.
  // 先做轻量 LaTeX 转换（保留分隔符），再两遍解析数值。
  const extractNumericValues = (raw) => {
    let s = String(raw || '')
    s = s.replace(/\\div/gi, '/')
    s = s.replace(/\\times/gi, '*')
    s = s.replace(/\\cdot/gi, '*')
    s = s.replace(/\$|\\[()]/g, '')
    s = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))

    const vals = []

    // Pass 0: LaTeX 带分数：数字 + \frac{分子}{分母} → 混合数 (e.g., 4\frac{2}{3} → 4.666...)
    s = s.replace(/(\d+(?:\.\d+)?)\\frac\{([^}]+)\}\{([^}]+)\}/gi, (match, whole, num, den) => {
      const wholeNum = parseFloat(whole)
      const numNum = parseInt(num, 10)
      const denNum = parseInt(den, 10)
      if (numNum < denNum) {
        vals.push(wholeNum + numNum / denNum)
        return ' '.repeat(match.length)
      }
      return match
    })

    // Pass 0.5: 普通 \frac{n}{d} → n/d (剩余的 LaTeX 分数)
    s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/gi, '($1/$2)')

    const mixedRe = /(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)/g
    let cleaned = s.replace(mixedRe, (match, whole, num, den) => {
      if (parseInt(num, 10) < parseInt(den, 10)) {
        vals.push(parseFloat(whole) + parseInt(num, 10) / parseInt(den, 10))
        return ' '.repeat(match.length)
      }
      return match
    })
    cleaned = cleaned.replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, (match, n, d) => {
      vals.push(parseFloat(n) / parseFloat(d))
      return ' '.repeat(match.length)
    })
    const numRe = /\d+(?:\.\d+)?/g
    let nm
    while ((nm = numRe.exec(cleaned)) !== null) {
      vals.push(parseFloat(nm[0]))
    }
    return vals.filter(v => isFinite(v)).sort((a, b) => a - b)
  }
  const studentNums = extractNumericValues(studentAnswer)
  const refNums = extractNumericValues(referenceAnswer)
  if (studentNums.length > 0 && refNums.length > 0 && studentNums.length === refNums.length &&
      studentNums.every((v, i) => Math.abs(v - refNums[i]) < 1e-9)) {
    return { isCorrect: true, unrecognized: false }
  }

  return { isCorrect: false, unrecognized: false }
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
    console.debug('开始调用AI生成标签，题目:', questionContent.substring(0, 50) + '...')
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
    console.debug(`标签生成完成，耗时 ${duration}ms，标签:`, tags)

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
      console.debug(`标签生成失败，${retryCount + 1}秒后自动重试 (${retryCount + 1}/${AI_CONFIG.MAX_RETRIES})...`)
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
