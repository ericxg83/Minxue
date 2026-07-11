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
import { AI_CONFIG, getAIHeaders, buildOCRPrompt, buildTaggingPrompt, buildAnswerGenerationPrompt, buildGeometryReconstructionPrompt, getCurrentTextModel, getCurrentVLModel, rotateTextModel, rotateVLModel, TEXT_MODELS, VL_MODELS, callTextCompletion, callVisionCompletion } from './config/ai.js'
import { parseGeometryStructure, renderGeometrySvg, isEmptyStructure } from './utils/geometrySvg.js'
import { updateTaskStatus, createQuestions, batchUpdateQuestionTags, addWrongQuestions, createJudgement, getLatestJudgement, updateQuestionAnswer, markAnswerException, findCachedQuestionByFingerprint, findSimilarQuestion, cacheQuestion, incrementQuestionUseCount, updateQuestionCacheId, createQuestionAsset, updateQuestionAssetCleanData } from './services/neonService.js'
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

/**
 * 从 URL 下载图片为 Buffer
 * @param {string} url
 * @returns {Promise<Buffer|null>}
 */
async function downloadImageBuffer(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
    return Buffer.from(resp.data)
  } catch (error) {
    console.error(`   ⚠️ [下载] 图片下载失败: ${error.message}`)
    return null
  }
}

/**
 * 几何重建：从原始裁剪图识别结构化几何数据，服务端渲染成干净 SVG。
 *
 * 不做任何图像清理（灰度化/二值化/滤镜）。视觉模型只负责"读懂"几何结构，
 * 输出点/线/圆/标注的结构化 JSON；服务端确定性地把 JSON 渲染成白底黑线 SVG，
 * 天然去除中文/题号/笔迹/水印/草稿。
 *
 * @param {Buffer} imageBuffer - 原始裁剪几何图 buffer
 * @param {string} questionId - 题目 ID（用于日志）
 * @returns {Promise<{svg: string, structure: object}|null>}
 */
async function reconstructGeometrySvg(imageBuffer, questionId) {
  const shortId = questionId.substring(0, 8)
  try {
    const base64 = imageBuffer.toString('base64')
    const dataURL = `data:image/png;base64,${base64}`

    const result = await callVisionCompletion({
      imageDataURL: dataURL,
      systemPrompt: buildGeometryReconstructionPrompt(),
      userText: '请识别这张几何图中的纯几何结构（点/线/圆/标注），只输出结构化 JSON。',
      temperature: 0.1,
      maxTokens: 2048
    })

    const structure = parseGeometryStructure(result.content)
    if (!structure) {
      console.warn(`   ⚠️ [几何重建] ${shortId}: 未能解析出几何结构 JSON`)
      return null
    }
    if (isEmptyStructure(structure)) {
      console.warn(`   ⚠️ [几何重建] ${shortId}: 未识别到有效几何结构（空）`)
      return null
    }

    const svg = renderGeometrySvg(structure)
    if (!svg) {
      console.warn(`   ⚠️ [几何重建] ${shortId}: 结构渲染 SVG 失败`)
      return null
    }
    return { svg, structure }
  } catch (error) {
    console.error(`   ⚠️ [几何重建] ${shortId} 失败:`, error.message)
    return null
  }
}

/**
 * 处理单个几何图的重建流水线：下载 → 视觉模型识别几何结构 → 服务端渲染干净 SVG → 入库
 *
 * 几何重建（第三阶段），替代图片清理方案：
 *   下载原始裁剪图 → 视觉模型输出结构化 JSON → renderGeometrySvg() 确定性渲染 SVG →
 *   存入 clean_geometry_svg 字段（白底黑线，仅含几何元素）。
 *   clean_geometry_svg 作为后续 TikZ 生成的输入。
 *
 * @param {Object} q - 题目对象（含 geometry_image_url、id）
 * @param {string} studentId - 学生 ID
 */
async function processGeometryCleaning(q, studentId) {
  if (!q.geometry_image_url) return

  const shortId = q.id.substring(0, 8)
  console.log(`   [几何重建] ${shortId}: 开始识别几何结构...`)

  // 1. 下载裁剪好的几何图
  const rawBuffer = await downloadImageBuffer(q.geometry_image_url)
  if (!rawBuffer) {
    console.warn(`   ⚠️ [几何重建] ${shortId}: 下载失败，跳过`)
    return
  }

  // 2. 视觉模型识别几何结构 → 服务端渲染干净 SVG
  let svg = null
  try {
    const result = await reconstructGeometrySvg(rawBuffer, q.id)
    if (!result) {
      console.warn(`   ⚠️ [几何重建] ${shortId}: 重建失败，跳过`)
      return
    }
    svg = result.svg
    const st = result.structure
    console.log(
      `   [几何重建] ${shortId}: 识别到 ${st.points.length} 点 / ${st.segments.length} 线 / ${st.circles.length} 圆，SVG ${svg.length} 字符`
    )
  } catch (error) {
    console.error(`   ⚠️ [几何重建] ${shortId}: 重建异常:`, error.message)
    return
  }

  // 3. 存入 question_assets 表（clean_geometry_svg 存干净 SVG 源码）
  try {
    await updateQuestionAssetCleanData(q.id, {
      clean_geometry_svg: svg,
      geometry_crop_type: 'clean_geometry'
    })
    console.log(`   [几何重建] ${shortId}: 数据入库成功`)
  } catch (error) {
    console.error(`   ⚠️ [几何重建] ${shortId}: 入库失败:`, error.message)
  }

  // 4. 反范式写入 questions 表
  try {
    await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET clean_geometry_svg = $1,
           display_image_type = COALESCE(display_image_type, 'clean'),
           updated_at = NOW()
       WHERE id = $2`,
      [svg, q.id]
    )
    console.log(`   [几何重建] ${shortId}: questions 表更新成功`)
  } catch (error) {
    console.warn(`   ⚠️ [几何重建] ${shortId}: questions 表写入失败:`, error.message)
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

/**
 * 将 Qwen3-VL 返回的【归一化 0-1000】bbox 换算为目标图片的实际像素坐标。
 *
 * ⚠️ 关键：Qwen3-VL 系列 grounding 输出的坐标是相对整张图片的 0-1000 归一化值，
 * 不是绝对像素（官方基准：绝对像素格式得分 0，1000-base 最可靠）。若直接当像素用，
 * 会把页面底部 (y≈750) 的配图裁到中上部 → 张冠李戴裁到邻题。此处统一换算修正。
 *
 * @param {Object} bbox - {x, y, width, height}，取值 0-1000
 * @param {number} imgW - 目标图片实际宽度(px)
 * @param {number} imgH - 目标图片实际高度(px)
 * @returns {Object|null} 像素坐标 {x, y, width, height}
 */
function denormalizeBbox(bbox, imgW, imgH) {
  if (!bbox || typeof bbox !== 'object') return bbox
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0)
  const clamp = (v) => Math.max(0, Math.min(1000, n(v)))
  return {
    ...bbox,
    x: Math.round(clamp(bbox.x) / 1000 * imgW),
    y: Math.round(clamp(bbox.y) / 1000 * imgH),
    width: Math.round(clamp(bbox.width) / 1000 * imgW),
    height: Math.round(clamp(bbox.height) / 1000 * imgH),
  }
}

/**
 * 将几何配图 bbox 收紧到本题范围内，避免 AI 把相邻题目（题号/题干/下一道配图）圈进来。
 *
 * 常见错误：AI 返回的 image_bbox 高度过大，纵向跨越到下一题。此处用本题 block_coordinates
 * 作为硬边界做交集裁剪，并对明显异常（高度过大）的框做保守收缩。全部使用 0-1000 归一化坐标。
 *
 * @param {Object} imageBbox - 配图 bbox（归一化 0-1000）
 * @param {Object|null} blockBox - 本题 block_coordinates（归一化 0-1000），无则返回原值
 * @returns {Object} 收紧后的 bbox（归一化 0-1000）
 */
function clampImageBboxToBlock(imageBbox, blockBox) {
  if (!imageBbox || typeof imageBbox !== 'object') return imageBbox
  if (!blockBox || typeof blockBox !== 'object') return imageBbox

  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d)

  const ix = num(imageBbox.x)
  const iy = num(imageBbox.y)
  const iw = num(imageBbox.width)
  const ih = num(imageBbox.height)
  if (iw <= 0 || ih <= 0) return imageBbox

  const bx = num(blockBox.x)
  const by = num(blockBox.y)
  const bw = num(blockBox.width)
  const bh = num(blockBox.height)
  if (bw <= 0 || bh <= 0) return imageBbox

  // 与本题 block 求交集（本题 block 略放宽一点，避免把贴边的顶点字母裁掉）
  const pad = 10 // 归一化 0-1000 下约 1%
  const blkLeft = bx - pad
  const blkTop = by - pad
  const blkRight = bx + bw + pad
  const blkBottom = by + bh + pad

  const left = Math.max(ix, blkLeft)
  const top = Math.max(iy, blkTop)
  const right = Math.min(ix + iw, blkRight)
  const bottom = Math.min(iy + ih, blkBottom)

  let nx = left
  let ny = top
  let nw = right - left
  let nh = bottom - top

  // 交集无效（AI 框完全在 block 之外）→ 保底用 block 自身范围，避免裁到别处
  if (nw <= 0 || nh <= 0) {
    nx = bx; ny = by; nw = bw; nh = bh
  }

  const clamp01000 = (v) => Math.max(0, Math.min(1000, Math.round(v)))
  const result = {
    ...imageBbox,
    x: clamp01000(nx),
    y: clamp01000(ny),
    width: clamp01000(nw),
    height: clamp01000(nh),
  }

  if (result.x !== ix || result.y !== iy || result.width !== iw || result.height !== ih) {
    console.log(`   [几何图] bbox 越界收紧: ${JSON.stringify({ x: ix, y: iy, width: iw, height: ih })} → ${JSON.stringify({ x: result.x, y: result.y, width: result.width, height: result.height })}`)
  }
  return result
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
 * 归一化 AI 返回的难度值为 1-5 的整数；无法解析时返回 null（表示未判定，交由回填重试）。
 */
const normalizeDifficulty = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return null
  if (n < 1) return 1
  if (n > 5) return 5
  return n
}

/**
 * JSON 自动修复 — 处理 AI 返回的畸形 JSON
 * 常见问题: 未转义反斜杠(\frac → \\frac)、未转义双引号、字符串内换行
 */
export function repairAIJson(jsonStr) {
  // 逐字符状态机：只在「字符串内部」做修复，避免破坏结构。
  // 处理三类畸形：
  //   1. 非法反斜杠转义（LaTeX 单反斜杠命令，如 \angle \circ \triangle）→ 双写为 \\
  //   2. 字符串内的裸控制字符（真实换行/回车/制表符）→ 转义为 \n \r \t
  //   3. 字符串内未转义的双引号（后面不是 , } ] : 或结尾）→ 转义为 \"
  // 合法的 JSON 转义（\" \\ \/ \b \f \n \r \t \uXXXX）原样保留。
  let out = ''
  let inString = false

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i]

    if (!inString) {
      out += ch
      if (ch === '"') inString = true
      continue
    }

    // ── 字符串内部 ──
    if (ch === '\\') {
      const next = jsonStr[i + 1]
      if (next === '"' || next === '\\' || next === '/') {
        out += ch + next // 无歧义的合法转义，保留
        i++
      } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(jsonStr.substr(i + 2, 4))) {
        out += ch // 合法 \uXXXX
      } else if (next !== undefined && 'bfnrt'.includes(next)) {
        // \b \f \n \r \t 与 LaTeX 命令(\frac \theta \nu \rho \beta \triangle...)开头冲突。
        // 判据：转义字母后若还跟字母 → LaTeX 命令，双写反斜杠；否则视为真正的 JSON 转义。
        const after = jsonStr[i + 2]
        if (after !== undefined && /[a-zA-Z]/.test(after)) {
          out += '\\\\' // LaTeX 单反斜杠命令 → 字面反斜杠
        } else {
          out += ch + next // 真正的 \n \t 等
          i++
        }
      } else {
        out += '\\\\' // 其它非法转义(\a \c \s ...) → 字面反斜杠，双写
      }
    } else if (ch === '"') {
      // 判断这个引号是「真正的闭合引号」还是「字符串内的字面引号」
      const rest = jsonStr.slice(i + 1)
      if (/^\s*[,}\]:]/.test(rest) || /^\s*$/.test(rest)) {
        out += ch
        inString = false
      } else {
        out += '\\"' // 字面引号，转义
      }
    } else if (ch === '\n') {
      out += '\\n'
    } else if (ch === '\r') {
      out += '\\r'
    } else if (ch === '\t') {
      out += '\\t'
    } else {
      out += ch
    }
  }

  return out
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

  try {
    console.log(`   发送请求到: ${AI_CONFIG.ENDPOINT} (model=${getCurrentVLModel()})`)
    // 主 API（ModelScope）→ 配额耗尽(429)时内置回退到备用视觉 API
    const { content, usedBackup } = await callVisionCompletion({
      imageDataURL: imageUrl,
      systemPrompt: prompt,
      userText: '请识别这张作业图片中的所有题目，并返回JSON格式结果。',
      temperature: 0.3,
      maxTokens: 8192
    })

    const duration = Date.now() - startTime
    console.log(`   AI 响应耗时: ${duration}ms${usedBackup ? ' (备用 API)' : ''}`)

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

    // 兼容两种返回格式：对象 {"questions": [...]} 或纯数组 [...]
    // 部分模型（如 Qwen3-VL-30B-A3B-Instruct）会直接返回题目数组，而非包裹在 questions 字段里。
    const questionsArray = Array.isArray(result)
      ? result
      : (Array.isArray(result?.questions) ? result.questions : [])
    if (questionsArray.length === 0) {
      console.warn(`⚠️  解析出 0 道题（result 类型: ${Array.isArray(result) ? 'array' : typeof result}，keys: ${result && !Array.isArray(result) ? Object.keys(result).join(',') : 'N/A'}）`)
    }

    const questions = questionsArray.map((q, index) => {
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
        question_number: q.question_number || null,
        text_bbox: q.text_bbox || null,
        image_type: q.image_type || null,
        image_bbox: q.image_bbox || null,
        geometry_image: q.geometry_image || null,
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

    // 配额耗尽 → 此处说明主 API 429 且备用 API 也失败（callVisionCompletion 已尝试回退）。
    // 轮换到下一个 VL 模型供后续任务使用，当前任务返回失败。
    if (error.response?.status === 429) {
      const nextModel = rotateVLModel()
      if (nextModel) {
        console.log(`  模型配额耗尽且备用不可用，下一个任务将使用 ${nextModel}`)
      } else {
        console.error(`  所有视觉模型配额已耗尽，且备用 API 不可用`)
      }
      return {
        success: false,
        error: errorMessage,
        questions: [],
        duration: Date.now() - startTime,
        shouldRetry: false
      }
    }

    // 模型不可用（400/404，或 ModelScope "has no provider supported" / "not found"）
    // → 立即轮换到下一个 VL 模型并在本次任务内重试；轮完所有模型才放弃。
    const status = error.response?.status
    const bodyText = JSON.stringify(error.response?.data || '').toLowerCase()
    const isModelUnavailable =
      (status === 400 || status === 404) &&
      (bodyText.includes('no provider') ||
       bodyText.includes('not found') ||
       bodyText.includes('does not exist') ||
       bodyText.includes('has no provider supported'))

    if (isModelUnavailable) {
      const failedModel = getCurrentVLModel()
      const nextModel = rotateVLModel()
      if (nextModel && nextModel !== failedModel) {
        console.warn(`  ⚠️ 视觉模型 ${failedModel} 当前无可用服务商，切换到 ${nextModel} 并重试...`)
        return recognizeQuestions(imageBase64, taskId, retryCount)
      }
      console.error(`  ❌ 所有视觉模型均无可用服务商，请更新 AI_MODEL / VL_MODELS 配置`)
      return {
        success: false,
        error: `视觉模型不可用: ${errorMessage}`,
        questions: [],
        duration: Date.now() - startTime,
        shouldRetry: false
      }
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

export const generateTagsForQuestion = async (questionContent, subject = null, retryCount = 0) => {
  if (!questionContent || !questionContent.trim()) {
    return { success: true, tags: ['未分类'], difficulty: null }
  }

  const prompt = buildTaggingPrompt(subject)

  try {
    const { content } = await callTextCompletion({
      systemContent: prompt,
      userContent: `请分析以下题目，提取知识点标签：\n\n${questionContent}`,
      temperature: 0.2,
      maxTokens: 500
    })

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
    const difficulty = normalizeDifficulty(result.difficulty)

    return { success: true, tags, difficulty }
  } catch (error) {
    // callTextCompletion 内部已完成"主API→备用API"切换，
    // 两家都失败时不再写「未分类」（否则该题将永远无法被回填），
    // 而是返回 tags:null，让题目保持 ai_tags=NULL，由每日回填任务持续重试。
    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const shouldRetry = isNetworkError && retryCount < AI_CONFIG.MAX_RETRIES

    if (shouldRetry) {
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000))
      return generateTagsForQuestion(questionContent, subject, retryCount + 1)
    }

    return { success: false, tags: null, difficulty: null }
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
      const tagResult = await generateTagsForQuestion(fullContent, q.subject)
      return { questionId: q.id, tags: tagResult.tags, difficulty: tagResult.difficulty }
    })
    const batchResults = await Promise.all(tagPromises)
    results.push(...batchResults)
  }

  return results
}

/**
 * Extract the final answer from analysis text.
 * AI sometimes puts wrong/unsimplified value in answer field but analysis text is correct.
 * For choice questions: extracts A/B/C/D letter.
 * For non-choice questions: extracts answer from explicit markers (答案为/答案是/最终答案/正确答案是).
 */
export function extractAnswerFromAnalysis(answer, analysis, options) {
  if (!analysis) return answer

  // ── Choice question patterns (A/B/C/D) ──
  if (options && options.length > 0) {
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
  }

  // ── Non-choice / general: extract from explicit answer markers ──
  // AI sometimes puts unsimplified LaTeX (e.g. \\frac{30}{\\sqrt{3}}) in answer field
  // while analysis has the correct simplified result (e.g. "15").
  // Look only in tail (last 300 chars) to favor final result over intermediate steps.
  // Note: do NOT use commas (，,) as delimiters — multi-part answers like
  // "每个盲盒50元，每个杯子30元" contain commas within the answer itself.
  // Only sentence-ending punctuation (。！？.!? + newline) should terminate the capture.
  const tail = analysis.length > 300 ? analysis.substring(analysis.length - 300) : analysis
  const answerMarkerPatterns = [
    /因此正确答案是[：:]\s*([^\n。！？.!?]+)/i,
    /正确答案是[：:]\s*([^\n。！？.!?]+)/i,
    /答案为[：:]\s*([^\n。！？.!?]+)/i,
    /答案是[：:]\s*([^\n。！？.!?]+)/i,
    /最终答案[：:]\s*([^\n。！？.!?]+)/i,
  ]

  for (const pattern of answerMarkerPatterns) {
    const match = tail.match(pattern)
    if (match) {
      let extracted = match[1].trim()
      // Trim trailing commas/punctuation that may remain after removing them from delimiters
      extracted = extracted.replace(/[，,；;、]+$/, '').trim()
      if (extracted && extracted !== answer) {
        console.log(`   [AnswerExtraction] 答案标记匹配: ${extracted} (原: ${answer})`)
        return extracted
      }
    }
  }

  return answer
}

/**
 * Generate a single answer for a question via text-only AI call.
 */
export const generateAnswerForQuestion = async (questionContent, retryCount = 0) => {
  if (!questionContent || !questionContent.trim()) {
    return { success: true, answer: '', analysis: '' }
  }

  const prompt = buildAnswerGenerationPrompt()

  try {
    const { content } = await callTextCompletion({
      systemContent: prompt,
      userContent: `请计算以下题目的标准答案：\n\n${questionContent}`,
      temperature: 0.2,
      maxTokens: 2048
    })

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

      // 优先尝试修复截断问题 (Unterminated string / Unexpected end)
      if (parseError.message.includes('Unterminated string') || parseError.message.includes('Unexpected end')) {
        try {
          let truncFixed = jsonStr.replace(/("[^"]*)$/, '$1"')
          const openBraces = (truncFixed.match(/\{/g) || []).length
          const closeBraces = (truncFixed.match(/\}/g) || []).length
          const openBrackets = (truncFixed.match(/\[/g) || []).length
          const closeBrackets = (truncFixed.match(/\]/g) || []).length
          for (let i = 0; i < openBraces - closeBraces; i++) truncFixed += '}'
          for (let i = 0; i < openBrackets - closeBrackets; i++) truncFixed += ']'
          result = JSON.parse(truncFixed)
          console.log(`✅ JSON 截断修复成功！`)
        } catch (truncError) {
          console.warn(`   截断修复失败: ${truncError.message}，尝试 repairAIJson...`)
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
      } else {
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
    }

    return {
      success: true,
      answer: result.answer || '',
      analysis: result.analysis || '',
      subject: result.subject || null
    }
  } catch (error) {
    // callTextCompletion 内部已完成"主API→备用API"切换，
    // 两家都失败（限流/网络）时才到这里，按原逻辑重试或返回空
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
export function validateAIAnswer(answer, analysis) {
  if (!answer || answer.trim() === '') {
    return { isValid: false, reason: '答案为空' }
  }
  const trimmed = answer.trim()
  if (trimmed === '待人工补充' || trimmed === '此为主观题，无唯一标准答案' || trimmed === '-') {
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
 * Save subject to question in DB and update in-memory object.
 * Only updates when current subject is NULL/empty to preserve manual edits.
 */
const saveQuestionSubject = async (q, subject) => {
  if (subject && subject.trim()) {
    q.subject = subject.trim()
    try {
      await query(
        `UPDATE ${TABLES.QUESTIONS} SET subject = $1, updated_at = NOW() WHERE id = $2 AND (subject IS NULL OR subject = '')`,
        [subject.trim(), q.id]
      )
    } catch (err) {
      console.error(`     题目 ${q.id.substring(0, 8)}: 学科更新失败`, err.message)
    }
  }
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

            // 🔧 如果从解析提取的答案与缓存不同，同步更新缓存以防止后续合并时读取到错误值
            if (finalAnswer !== cached.answer) {
              await query(
                `UPDATE ${TABLES.QUESTION_CACHE} SET answer = $1, updated_at = NOW() WHERE id = $2`,
                [finalAnswer, cached.id]
              )
              console.log(`     题目 ${q.id.substring(0, 8)}: 缓存答案同步更新 ${cached.answer} → ${finalAnswer}`)
            }

            // 同步学科（从缓存恢复到题目）
            await saveQuestionSubject(q, cached.subject)

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
              // 同步学科
              await saveQuestionSubject(q, similar.subject)
              
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
        // 即使AI答案无效，也尝试从分析文本中提取答案，并保存分析内容
        if (result.analysis && result.analysis.trim()) {
          const extracted = extractAnswerFromAnalysis(result.answer, result.analysis, q.options)
          if (extracted && extracted !== '-' && extracted !== result.answer) {
            try {
              await updateQuestionAnswer(q.id, extracted, result.analysis, true)
              q.answer = extracted
              q.analysis = result.analysis
              updatedCount++
              await saveQuestionSubject(q, result.subject)
              console.log(`     题目 ${q.id.substring(0, 8)}: 从分析文本提取答案: ${extracted}`)
              return
            } catch (err) {
              console.error(`     题目 ${q.id.substring(0, 8)}: 提取答案写入失败`, err.message)
            }
          }
          // 提取失败或答案未变更，至少保存分析文本
          try {
            await query(
              `UPDATE questions SET analysis = $1, updated_at = NOW() WHERE id = $2`,
              [result.analysis, q.id]
            )
            q.analysis = result.analysis
            await saveQuestionSubject(q, result.subject)
            console.log(`     题目 ${q.id.substring(0, 8)}: 答案无效(${validation.reason})，已保存分析文本`)
          } catch (err) {
            console.error(`     题目 ${q.id.substring(0, 8)}: 分析文本保存失败`, err.message)
          }
        }
        exceptionCount++
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
          await saveQuestionSubject(q, result.subject)
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
          await saveQuestionSubject(q, result.subject)
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

      // ── 坐标存储策略：block_coordinates / text_bbox 保持 AI 返回的 0-1000 归一化坐标直接入库 ──
      // 前端按图片实际显示尺寸(naturalWidth/naturalHeight)换算像素，彻底与分辨率解耦，
      // 无论展示原图还是压缩图，overlay 都能精准对齐。
      // 几何图裁剪需要 compressedBuffer 的像素坐标，故仅在裁剪处把 image bbox 局部换算，
      // 不影响入库的归一化值。
      let _compW = 0, _compH = 0
      try {
        const _meta = await sharp(compressedBuffer).metadata()
        _compW = _meta.width; _compH = _meta.height
      } catch (e) {
        console.warn(`   ⚠️ [坐标] 读取压缩图尺寸失败: ${e.message}`)
      }

      // ── 多模态切题：处理几何配图 ─
      const geometryImageCache = new Map() // bbox 去重缓存 (一图多题)

      for (const q of questions) {
        // 优先使用新格式 image_bbox/image_type，向后兼容旧格式 geometry_image
        const hasImage = q.image_type && q.image_type !== 'none'
        const hasLegacyImage = q.geometry_image?.has_image && q.geometry_image.bbox
        const imageBbox = q.image_bbox || (q.geometry_image?.bbox || null)
        const imageType = q.image_type || (hasLegacyImage ? 'geometry' : null)
        // 确保 q.image_type 在后续步骤（如几何图净化层）中可读
        if (!q.image_type && imageType) q.image_type = imageType

        if (hasImage || hasLegacyImage) {
          const bbox = imageBbox
          if (!bbox) {
            if (q.content && (q.content.includes('如图') || q.content.includes('图1') || q.content.includes('图示'))) {
              console.log(`   ⚠️ [几何图] ${q.id}: 题干含"如图"关键词但未返回 bbox`)
            }
            continue
          }
          console.log(`   [${imageType || 'geometry'}] ${q.id}: 检测到配图, bbox(归一化)=${JSON.stringify(bbox)}`)
          // 越界收紧：用本题 block_coordinates 作硬边界，防止 bbox 跨到相邻题目
          const safeBbox = clampImageBboxToBlock(bbox, q.block_coordinates)
          // bbox 为 0-1000 归一化坐标；裁剪需换算为 compressedBuffer 像素坐标（仅局部使用，不写回 q）
          const pixelBbox = (_compW && _compH) ? denormalizeBbox(safeBbox, _compW, _compH) : safeBbox
          const cacheKey = JSON.stringify(safeBbox)
          if (geometryImageCache.has(cacheKey)) {
            q.geometry_image_url = geometryImageCache.get(cacheKey)
          } else {
            q.geometry_image_url = await cropAndUploadGeometryImage(compressedBuffer, pixelBbox, studentId, q.id)
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

      // ── 页面理解：将裁剪后的几何图保存到 question_assets ──
      let assetCount = 0
      for (const q of questions) {
        if (q.geometry_image_url) {
          try {
            const imageType = q.image_type || 'geometry'
            const imageBbox = q.image_bbox || (q.geometry_image?.bbox || null)
            await createQuestionAsset({
              question_id: q.id,
              asset_type: imageType === 'chart' ? 'chart_image' : 'geometry_image',
              original_image_url: imageUrl,
              cropped_image_url: q.geometry_image_url,
              bbox: imageBbox,
              tikz_status: imageType === 'geometry' ? 'pending' : 'none'
            })
            assetCount++
          } catch (e) {
            console.error(`   ⚠️ [question_assets] 保存失败 q=${q.id.substring(0, 8)}:`, e.message)
          }
        }
      }
      if (assetCount > 0) {
        console.log(`   ✅ [question_assets] 已保存 ${assetCount} 条资源记录（其中 geometry 类型标记为 tikz_status=pending）`)
      }

      // ── 几何图净化层：截图 → 干净几何图 → 几何结构JSON ──
      // 对每道有几何配图的题目，执行：
      //   1. 下载裁剪后的几何图
      //   2. Sharp 净化（灰度 + 二值化 → 白底黑线）
      //   3. 上传净化图到 OSS
      //   4. VL 模型分析几何结构（点、线、标签等）
      //   5. 存入 question_assets 表
      // 设计为"尽力而为"：任一环节失败不阻塞主流程，仅记录日志。
      const geometryCleaningPromises = questions
        .filter(q => q.geometry_image_url && q.image_type !== 'chart')
        .map(q => processGeometryCleaning(q, studentId).catch(err => {
          console.error(`   ⚠️ [几何净化] ${q.id.substring(0, 8)} 处理异常:`, err.message)
        }))

      if (geometryCleaningPromises.length > 0) {
        console.log(`📊 [几何图净化层] 开始处理 ${geometryCleaningPromises.length} 张几何图...`)
        await Promise.allSettled(geometryCleaningPromises)
        console.log(`✅ [几何图净化层] 完成`)
      }

      // [P0-1] 初始错题同步 — 仅当 OCR 有参考答案且判错时才同步
      const ocrWrongIds = questionsWithStudentId.filter(q => q.is_correct === false && q.answer).map(q => q.id)
      if (ocrWrongIds.length > 0) {
        try {
          const confidenceMap = new Map(questionsWithStudentId.map(q => [q.id, q.confidence]))
          const questionMap = new Map(questionsWithStudentId.map(q => [q.id, q]))
          await addWrongQuestions(studentId, ocrWrongIds, confidenceMap, questionMap)
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
            const questionMap = new Map(questions.map(q => [q.id, q]))
            await addWrongQuestions(studentId, wrongIds, confidenceMap, questionMap)
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
      const difficultyMap = {}
      for (const tr of tagResults) {
        tagMap[tr.questionId] = tr.tags
        difficultyMap[tr.questionId] = tr.difficulty
      }

      for (const q of questions) {
        const tags = tagMap[q.id]
        if (tags && tags.length > 0) {
          // 成功识别 → 保存标签
          q.ai_tags = tags
          q.tags_source = 'ai'
        } else {
          // 识别失败（主备 API 都挂了）→ 保留 ai_tags 为 NULL，
          // 不写「未分类」，让每日回填任务后续能重新捞起该题重试。
          q.ai_tags = null
          q.tags_source = null
        }
        q.difficulty = difficultyMap[q.id] ?? null
      }

      const tagUpdates = questions.map(q => ({
        id: q.id,
        ai_tags: q.ai_tags,
        difficulty: q.difficulty
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
