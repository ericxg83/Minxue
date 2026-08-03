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
import { AI_CONFIG, getAIHeaders, buildOCRPrompt, buildAnswerGenerationPrompt, getCurrentTextModel, getCurrentVLModel, rotateTextModel, rotateVLModel, TEXT_MODELS, VL_MODELS, callTextCompletion, callVisionCompletion } from './config/ai.js'
import { updateTaskStatus, createQuestions, batchUpdateQuestionTags, addWrongQuestions, createJudgement, updateQuestionAnswer, markAnswerException, findCachedQuestionByFingerprint, cacheQuestion, incrementQuestionUseCount, updateQuestionCacheId, createQuestionAsset, lookupWorksheetAnswer, getWorksheetAnswersBySection, deleteQuestionsByTaskId, bulkLookupResourceAnswers, getResourceAnswersBySection, getResourceById, addSelfContainedWrongQuestion } from './services/neonService.js'
import { uploadImage } from './services/ossService.js'
import { cropAndUploadQuestionRegion } from './utils/cropAndUpload.js'
import { generateTextFingerprint, generatePHash, PARSER_VERSION, TEXT_SIMILARITY_THRESHOLD } from './utils/questionFingerprint.js'
import { uploadFilesWithRetry } from './services/uploadRetryManager.js'
import { judgeAnswer } from './services/judgeService.js'
import { normalizeSectionName, splitSubAnswers, splitOcrQuestionsBySubNo } from './services/answerParseService.js'
import { classifyQuestionLocally } from './utils/localTagger.js'
import { NON_RETRYABLE_ERROR_PATTERNS } from './pendingTaskRecovery.js'
import { isValidImageBuffer, checkImageResolution } from './utils/imageValidator.js'

// ── 多模态切题引擎：几何图处理 ──
// 使用 Sharp 进行裁剪和图像增强（替代浏览器端的 Canvas/OpenCV）

/**
 * 估算图像倾斜角（投影廓线法）。
 * 对灰度像素在 [-maxDeg, +maxDeg] 内逐档旋转，取「行方向投影方差」最大的角度：
 * 线条图水平对齐时，暗像素会集中到少数几行，行投影方差最大。
 * 纯 JS，无 opencv 依赖；仅用于轻度纠偏（±maxDeg 内）。
 *
 * @param {Buffer} grayRaw - 灰度原始像素 (Uint8, 每像素 1 通道)
 * @param {number} w
 * @param {number} h
 * @param {number} maxDeg - 搜索范围（默认 6°）
 * @param {number} step - 搜索步长（默认 0.5°）
 * @returns {number} 建议旋转角度（度）
 */
function estimateSkewAngle(grayRaw, w, h, maxDeg = 6, step = 0.5) {
  const DARK = 160 // 低于此灰度算「暗像素」（线条/笔迹）
  const cx = w / 2, cy = h / 2
  let bestAngle = 0
  let bestScore = -1

  for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += step) {
    const rad = (deg * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    const rowDark = new Float64Array(h)
    const sx = w > 400 ? 2 : 1 // 大图跳采提速
    const sy = h > 400 ? 2 : 1
    for (let y = 0; y < h; y += sy) {
      const dy = y - cy
      for (let x = 0; x < w; x += sx) {
        if (grayRaw[y * w + x] >= DARK) continue
        const dx = x - cx
        const ry = Math.round(cy + dx * sin + dy * cos)
        if (ry >= 0 && ry < h) rowDark[ry] += 1
      }
    }
    let mean = 0
    for (let i = 0; i < h; i++) mean += rowDark[i]
    mean /= h
    let variance = 0
    for (let i = 0; i < h; i++) {
      const d = rowDark[i] - mean
      variance += d * d
    }
    if (variance > bestScore) {
      bestScore = variance
      bestAngle = deg
    }
  }
  return bestAngle
}

/**
 * 估算局部纸张背景（低频亮度场）。
 * 粗网格均值池化（block 平均）+ 最近邻上采样：抹掉细几何线条，
 * 只保留纸面亮度 + 拍摄阴影的大尺度渐变，作为每个像素的"白底"基准。
 * 最近邻 + 均值池化不会像插值那样把阴影极值压向中灰，阴影归一化才准确。
 *
 * @param {Uint8Array} grayRaw 灰度原始像素
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array}
 */
function estimatePaperBackground(grayRaw, w, h) {
  const GRID = 32 // 背景网格分辨率（cell 越大越宽容线条，越平滑阴影）
  const cw = Math.ceil(w / GRID)
  const ch = Math.ceil(h / GRID)
  const gw = Math.ceil(w / cw)
  const gh = Math.ceil(h / ch)
  const grid = new Float32Array(gw * gh)
  const cnt = new Int32Array(gw * gh)
  for (let y = 0; y < h; y++) {
    const gy = (y / ch) | 0
    for (let x = 0; x < w; x++) {
      const gx = (x / cw) | 0
      const gi = gy * gw + gx
      grid[gi] += grayRaw[y * w + x]
      cnt[gi] += 1
    }
  }
  const bg = new Uint8Array(w * h)
  const lastGx = gw - 1, lastGy = gh - 1
  for (let y = 0; y < h; y++) {
    const gy = Math.min((y / ch) | 0, lastGy)
    for (let x = 0; x < w; x++) {
      const gx = Math.min((x / cw) | 0, lastGx)
      const gi = gy * gw + gx
      bg[y * w + x] = cnt[gi] ? Math.round(grid[gi] / cnt[gi]) : 255
    }
  }
  return bg
}

/**
 * 去除孤立椒盐噪点（保边）：仅当某像素是 3x3 邻域内的"极端离群点"
 * （与全部 8 个邻居都明显不同）时才视为噪点并替换为邻域中值。
 * 连通的几何线条像素至少与某个邻居同色，不会被判定为离群 → 细线完整保留；
 * 而单点噪点（死点/扫描噪点）因四周皆异色而被抹除。
 * 边缘像素直接拷贝。
 *
 * @param {Uint8Array} src 单通道灰度
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array}
 */
function removeIsolatedSpecks(src, w, h) {
  const T = 40 // 与邻居差异超过此值才视为离群噪点
  const dst = new Uint8Array(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        dst[i] = src[i]
        continue
      }
      const v = src[i]
      const nb = [
        src[i - w - 1], src[i - w], src[i - w + 1],
        src[i - 1], src[i + 1],
        src[i + w - 1], src[i + w], src[i + w + 1],
      ]
      let mn = 255, mx = 0
      for (let k = 0; k < 9; k++) { if (nb[k] < mn) mn = nb[k]; if (nb[k] > mx) mx = nb[k] }
      if (v < mn - T || v > mx + T) {
        const sorted = nb.slice().sort((p, q) => p - q)
        dst[i] = sorted[4]
      } else {
        dst[i] = v
      }
    }
  }
  return dst
}

/**
 * 几何图像素级净化（无阈值）：阴影归一化 + 软白底映射。
 *
 * 核心：用局部背景亮度归一化，消除整片阴影；再用软映射把线条平滑推向深色
 * （不硬切 0/255），保留抗锯齿边缘 → 教材插图效果，而非纯黑白 mask。
 *
 *   ratio    = gray / bg            // 纸面≈1，线条<1（阴影区 bg 低，纸面仍归一为≈1）
 *   strength = 1 - ratio            // 0=纸面(白)，1=纯黑线条
 *   out      = 255 - strength^γ * depth   // 软映射，线条最暗≈255-depth（保留灰阶，不死黑）
 *
 * @param {Uint8Array} grayRaw 灰度原始像素
 * @param {Uint8Array} bg 局部背景亮度场（同尺寸）
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array} 净化后的灰度像素（背景≈白，线条平滑深色）
 */
function cleanGeometryPixels(grayRaw, bg, w, h) {
  const lineDepth = 235   // 线条最暗约 255-235 = 20（保留灰阶，避免死黑，教材风）
  const gamma = 0.8       // <1：略微加深细线 / 浅铅笔痕，又不至于过黑
  const out = new Uint8Array(grayRaw.length)
  for (let i = 0; i < grayRaw.length; i++) {
    const b = bg[i] || 1
    const ratio = grayRaw[i] / b
    let strength = 1 - ratio
    if (strength < 0) strength = 0
    else if (strength > 1) strength = 1
    out[i] = Math.round(255 - Math.pow(strength, gamma) * lineDepth)
  }
  return out
}

/**
 * 几何配图净化：自适应背景校正 / 去灰底阴影 / 保边去噪 / 白背景 / 轻度纠偏。
 *
 * 处理链（全部基于 sharp，无 opencv，最终输出非二值 mask，接近教材插图）：
 *   1. 灰度化，取出原始像素
 *   2. 自适应背景估计：大幅降采样→上采样，得到局部纸面+阴影的低频亮度场
 *   3. 3x3 中值保边去噪（去椒盐噪点 / 浅笔迹，保留细线）
 *   4. 阴影归一化 + 软白底映射（按局部背景亮度归一化消除整片阴影；
 *      线条平滑推向深色，不硬切 0/255，保留抗锯齿边缘）
 *   5. 投影廓线法估算倾斜角 → 轻度旋转纠偏（白底填充）
 *   6. trim 去掉纠偏后四周多余白边
 *
 * 失败时返回原 buffer，绝不阻断主流程。
 *
 * @param {Buffer} buffer - 已裁剪的配图 PNG buffer
 * @returns {Promise<Buffer>}
 */
async function cleanGeometryCrop(buffer) {
  try {
    // ── 1. 灰度原始像素 ──
    const { data: grayRaw, info } = await sharp(buffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const w = info.width, h = info.height
    if (!w || !h) throw new Error('空图像')

    // ── 2. 自适应背景估计（局部纸面 + 阴影低频场）──
    const bg = await estimatePaperBackground(grayRaw, w, h)

    // ── 3~4. 去孤立噪点 + 阴影归一化 + 软白底映射（无阈值）──
    const denoised = removeIsolatedSpecks(grayRaw, w, h)
    const clean = cleanGeometryPixels(denoised, bg, w, h)

    // ── 5. 估算倾斜角（用净化后的灰度像素）──
    let angle = 0
    try {
      angle = estimateSkewAngle(clean, w, h)
    } catch (e) {
      console.warn(`   ⚠️ [几何图净化] 倾斜估算失败，跳过纠偏: ${e.message}`)
    }

    // ── 5~6. 轻度纠偏（白底填充）+ trim 去白边 ──
    let img = sharp(clean, { raw: { width: w, height: h, channels: 1 } }).png()
    if (Math.abs(angle) >= 0.5) {
      img = img.rotate(angle, { background: '#ffffff' })
      console.log(`   [几何图净化] 纠偏 ${angle.toFixed(1)}°`)
    }
    const out = await img
      .flatten({ background: '#ffffff' })
      .trim({ threshold: 10 })    // 去掉旋转/裁剪残留的四周白边
      .png()
      .toBuffer()

    return out
  } catch (error) {
    console.warn(`   ⚠️ [几何图净化] 失败，使用未净化图继续: ${error.message}`)
    return buffer
  }
}

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

    // ── 1. padding 20% ──
    // 原始固定 padding=25px 在小图（~200px）上不够 → AI 识别困难。
    // 改为按 bbox 尺寸动态计算 20% padding，保证小图有足够上下文。
    const imgW = await getImageWidth(imageBuffer)
    const imgH = await getImageHeight(imageBuffer)
    const padX = Math.round(bbox.width * 0.20)
    const padY = Math.round(bbox.height * 0.20)

    const left = Math.max(0, bbox.x - padX)
    const top = Math.max(0, bbox.y - padY)
    const right = Math.min(bbox.x + bbox.width + padX, imgW)
    const bottom = Math.min(bbox.y + bbox.height + padY, imgH)
    let width = right - left
    let height = bottom - top

    if (width <= 0 || height <= 0) return null

    // ── 2. 输出图片最小尺寸 800px ──
    // 原始 212x223 对 Vision 模型太小 → 按比例放大至短边 >= 800px
    const MIN_SIZE = 800
    let resizeOpts = null
    if (width < MIN_SIZE || height < MIN_SIZE) {
      const scale = Math.max(MIN_SIZE / width, MIN_SIZE / height)
      const newW = Math.round(width * scale)
      const newH = Math.round(height * scale)
      // 避免放大超大图（上限 2400px）
      if (newW <= 2400 && newH <= 2400) {
        resizeOpts = { width: newW, height: newH }
      }
    }

    // ── 3. 裁剪 + 可选放大 ──
    let pipeline = sharp(imageBuffer).extract({ left, top, width, height })
    if (resizeOpts) {
      pipeline = pipeline.resize(resizeOpts.width, resizeOpts.height, { fit: 'fill' })
    }
    let cropped = await pipeline.png().toBuffer()

    // ── 4. 配图净化：去灰底 / 去浅笔迹 / 白背景 / 轻度纠偏 ──
    // 可用 GEOMETRY_CLEAN=0 关闭（回退到未净化裁剪图）。净化失败内部已兜底返回原图。
    if (process.env.GEOMETRY_CLEAN !== '0') {
      cropped = await cleanGeometryCrop(cropped)
    }

    const outMeta = await sharp(cropped).metadata()
    const outW = outMeta.width || (resizeOpts ? resizeOpts.width : width)
    const outH = outMeta.height || (resizeOpts ? resizeOpts.height : height)

    // 上传到 OSS
    const fileName = `geometry_${studentId}_${questionId}.png`
    const ossUrl = await uploadImage(cropped, fileName, studentId)
    console.log(`   [几何图] 裁剪+净化上传成功: ${width}x${height} → ${outW}x${outH} → ${ossUrl}`)
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
 * JSON 自动修复 — 处理 AI 返回的畸形 JSON
 * 常见问题: 未转义反斜杠(\frac → \\frac)、未转义双引号、字符串内换行、
 *           block_coordinates 被 AI 写成裸元组 (60, 200, 650, 27) 或
 *           半对象半元组 { "x": 60, 200, 650, 27 }
 */
export function repairAIJson(jsonStr) {
  // 1) 先处理「裸元组 / 半对象」形式的 block_coordinates。
  //    模式 A: "block_coordinates": 60, 200, 650, 27          → 4 个裸数字
  //    模式 B: "block_coordinates": [60, 200, 650, 27]        → 数组形式（合法，但统一转对象更稳）
  //    模式 C: "block_coordinates": {"x": 60, 200, 650, 27}   → 半对象
  //    模式 D: "block_coordinates": {"x":60,"y":200,...}      → 正常对象，跳过
  //    模式 E: "block_coordinates": {"x": 60, "y": 200, "width": 650, "height": 27}  → 正常对象
  // 统一策略：先做一次宽松匹配（不限定 "x": 前缀），命中 A/B/C 任一形式都转成标准对象。
  // 注意：不要用 \}? 吞掉闭合大括号 —— 那样会破坏外层对象结构。
  // 这里用 (?=\s*[\},]) 前瞻，只在接下来是 } 或 , 时才匹配，且不消耗字符。
  let pre = jsonStr.replace(
    /"block_coordinates"\s*:\s*\{?(?:\s*"?[a-zA-Z_]+"?\s*:\s*)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?=\s*[\},])/g,
    (m, x, y, w, h) => `"block_coordinates": {"x": ${x}, "y": ${y}, "width": ${w}, "height": ${h}}`
  )
  //    模式 B 数组形式（保险起见再跑一次），数组的 ] 是必需的，所以可以直接匹配。
  pre = pre.replace(
    /"block_coordinates"\s*:\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g,
    (m, x, y, w, h) => `"block_coordinates": {"x": ${x}, "y": ${y}, "width": ${w}, "height": ${h}}`
  )

  // 逐字符状态机：只在「字符串内部」做修复，避免破坏结构。
  // 处理三类畸形：
  //   1. 非法反斜杠转义（LaTeX 单反斜杠命令，如 \angle \circ \triangle）→ 双写为 \\
  //   2. 字符串内的裸控制字符（真实换行/回车/制表符）→ 转义为 \n \r \t
  //   3. 字符串内未转义的双引号（后面不是 , } ] : 或结尾）→ 转义为 \"
  // 合法的 JSON 转义（\" \\ \/ \b \f \n \r \t \uXXXX）原样保留。
  let out = ''
  let inString = false

  for (let i = 0; i < pre.length; i++) {
    const ch = pre[i]

    if (!inString) {
      out += ch
      if (ch === '"') inString = true
      continue
    }

    // ── 字符串内部 ──
    if (ch === '\\') {
      const next = pre[i + 1]
      if (next === '"' || next === '\\' || next === '/') {
        out += ch + next // 无歧义的合法转义，保留
        i++
      } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(pre.substr(i + 2, 4))) {
        out += ch // 合法 \uXXXX
      } else if (next !== undefined && 'bfnrt'.includes(next)) {
        // \b \f \n \r \t 与 LaTeX 命令(\frac \theta \nu \rho \beta \triangle...)开头冲突。
        // 判据：转义字母后若还跟字母 → LaTeX 命令，双写反斜杠；否则视为真正的 JSON 转义。
        const after = pre[i + 2]
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
      const rest = pre.slice(i + 1)
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
    const buf = Buffer.from(response.data)
    console.log(`   图片下载成功: ${buf.length} bytes`)

    // ── 魔数校验：OSS 404 / 403 / 鉴权失败会返回 XML/HTML 错误页（约 3000-4000 bytes），
    //    axios 仍按 2xx/3xx 视为成功，AI 拿去调视觉模型会立即被视觉模型拒掉。
    //    在这里直接拦下，给出明确错误，避免被 AI 误判为"模型问题"反复重试。
    const validation = isValidImageBuffer(buf)
    if (!validation.ok) {
      const head = buf.slice(0, 80).toString('utf8').replace(/[^\x20-\x7E]/g, '?')
      console.error(`   ❌ 下载内容非图片: ${buf.length} bytes, 头80字符="${head}", reason=${validation.reason}`)
      throw new Error(`下载图片失败: 返回内容不是图片（${buf.length} bytes, ${validation.reason}），URL 可能已失效或 OSS 返回了错误页`)
    }

    // ── 分辨率校验：拦截"AI 必失败"的极小图。
    //   3116 bytes 的合法 JPEG 实际像素通常只有 ~80x80，sharp 放大到 1800x1800
    //   并不能"创造"信息（只是把模糊块拉伸），AI 视觉模型（8B/235B/Agnes）看到
    //   后一律说"图片是空白 / Unable to identify"，反复重试只浪费配额 + 刷 429。
    //   在下载层就拦下，给出"请重新上传更清晰的图片"友好提示，
    //   让 NON_RETRYABLE 黑名单把它永久标记为不可重试。
    const resCheck = await checkImageResolution(buf)
    if (!resCheck.ok) {
      const { width, height } = resCheck.resolution || {}
      console.error(`   ❌ 图片分辨率过低: ${width}×${height} < ${resCheck.min}, 文件大小 ${buf.length} bytes`)
      throw new Error(`图片分辨率过低（${width}×${height}），请重新上传更清晰的图片（建议宽度≥1200像素，文件≥100KB）`)
    }

    return buf
  } catch (error) {
    console.error('下载图片失败:', error.message || error)
    throw new Error('下载图片失败: ' + (error.message || '未知错误'))
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

    // ── 空结果处理：AI 成功但返回 0 题 ──
    // 真实日志里 Qwen3-VL 偶发返回 {"questions": []}（图模糊 / 文档裁切丢内容 / 模型抽风）。
    // 重试一次：若仍为空就切换到下一个 VL 模型再试，最后兜底返回空让上层标"未识别"。
    if (questions.length === 0 && retryCount < AI_CONFIG.MAX_RETRIES) {
      console.warn(`   ⚠️  本次识别返回 0 道题，准备重试 (${retryCount + 1}/${AI_CONFIG.MAX_RETRIES})...`)
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000))
      return recognizeQuestions(imageBase64, taskId, retryCount + 1)
    }
    if (questions.length === 0) {
      const nextModel = rotateVLModel()
      if (nextModel) {
        console.warn(`   ⚠️  已达重试上限仍为 0 题，轮换到模型 ${nextModel} 兜底...`)
        return recognizeQuestions(imageBase64, taskId, 0)
      }
      console.error(`   ❌ 所有视觉模型均返回 0 道题`)
    }

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

// 标签生成已改为本地规则分类（零 LLM / 零 API），治理 429 限流。
// 保留导出签名兼容旧调用方；难度统一 3，留待每日回填任务用 LLM 修正。
export const generateTagsForQuestion = async (questionContent, subject = null) => {
  if (!questionContent || !questionContent.trim()) {
    return { success: true, tags: ['未分类'], difficulty: null }
  }
  const { tags, difficulty } = classifyQuestionLocally(questionContent, subject)
  return { success: true, tags: deduplicateTags(tags), difficulty }
}

const generateTagsForQuestions = async (questions) => {
  if (!questions || questions.length === 0) return []

  // 纯本地计算，无需 batch / 并发 / 网络
  return questions.map((q) => {
    const content = q.content || ''
    const options = (q.options || []).join('；')
    const fullContent = options ? `${content}\n选项：${options}` : content
    const { tags, difficulty } = classifyQuestionLocally(fullContent, q.subject)
    return { questionId: q.id, tags: deduplicateTags(tags), difficulty }
  })
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
  // Look only in tail (last 800 chars) to favor final result over intermediate steps.
  // Note: do NOT use commas (，,) as delimiters — multi-part answers like
  // "每个盲盒50元，每个杯子30元" contain commas within the answer itself.
  // Only sentence-ending punctuation (。！？.!? + newline) should terminate the capture.
  const tail = analysis.length > 800 ? analysis.substring(analysis.length - 800) : analysis
  const answerMarkerPatterns = [
    // "所以正确答案：14和2310" (no "是" after "正确答案")
    /(?:所以|因此|故)正确答案[：:]?\s*([^\n。！？.!?]+)/i,
    // "因此正确答案是：14和2310"
    /因此正确答案是[：:]?\s*([^\n。！？.!?]+)/i,
    // "正确答案是：14和2310"
    /正确答案是[：:]?\s*([^\n。！？.!?]+)/i,
    // "正确答案：14和2310" (no "是")
    /正确答案[：:]?\s*([^\n。！？.!?]+)/i,
    // "答案为：14和2310"
    /答案为[：:]?\s*([^\n。！？.!?]+)/i,
    // "故答案为：14和2310"
    /故答案为[：:]?\s*([^\n。！？.!?]+)/i,
    // "答案是：14和2310" (with or without colon)
    /答案是[：:]?\s*([^\n。！？.!?]+)/i,
    // "最终答案：14和2310"
    /最终答案[：:]?\s*([^\n。！？.!?]+)/i,
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

  // ⚡ 优化：大幅提高并行度。withAiLimit 全局信号量（默认2）已限制 AI 并发数，
  // 因此加大 batch 可让更多题目同时发起指纹查询，消除 for 循环批间等待。
  // 同时移除耗时的 findSimilarQuestion（加载50条+编辑距离计算），直接走 AI 调用。
  const batchSize = Math.min(needAnswer.length, 20)
  let updatedCount = 0
  let emptyCount = 0
  let placeholderCount = 0
  let exceptionCount = 0
  let cacheHitCount = 0
  let cacheMissCount = 0

  // 辅助函数：非关键 DB 写入 fire-and-forget，不阻塞主流程
  const fireForget = (fn, label) => {
    fn().catch(err => console.error(`     [fire-forget] ${label}: ${err.message}`))
  }

  for (let i = 0; i < needAnswer.length; i += batchSize) {
    const batch = needAnswer.slice(i, i + batchSize)
    const promises = batch.map(async (q) => {
      const content = q.content || ''
      const options = q.options || []
      const fullContent = options.length > 0 ? `${content}\n选项：${options.join('；')}` : content
      const fingerprint = generateTextFingerprint(content, options, q.question_type)

      // 缓存查找
      if (fingerprint) {
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

            // 非关键写入：fire-and-forget
            if (finalAnswer !== cached.answer) {
              fireForget(() => query(
                `UPDATE ${TABLES.QUESTION_CACHE} SET answer = $1, updated_at = NOW() WHERE id = $2`,
                [finalAnswer, cached.id]
              ), `缓存答案同步更新 q=${q.id.substring(0, 8)}`)
            }
            fireForget(() => saveQuestionSubject(q, cached.subject), `学科同步 q=${q.id.substring(0, 8)}`)
            fireForget(() => incrementQuestionUseCount(fingerprint, PARSER_VERSION), `useCount q=${q.id.substring(0, 8)}`)
            q.cache_id = cached.id
            fireForget(() => updateQuestionCacheId(q.id, cached.id), `cacheId q=${q.id.substring(0, 8)}`)
          } catch (err) {
            console.error(`     题目 ${q.id.substring(0, 8)}: 缓存答案写入失败`, err.message)
            exceptionCount++
          }
          return
        } else if (cached) {
          console.log(`     题目 ${q.id.substring(0, 8)}: 缓存命中但答案无效，重新调用AI`)
        }
        // ⚡ 移除了 findSimilarQuestion（逐条编辑距离计算，收益低、开销大），直接走 AI 调用
      }

      cacheMissCount++
      const result = await generateAnswerForQuestion(fullContent)
      const validation = validateAIAnswer(result.answer, result.analysis)

      if (!validation.isValid) {
        if (result.analysis && result.analysis.trim()) {
          const extracted = extractAnswerFromAnalysis(result.answer, result.analysis, q.options)
          if (extracted && extracted !== '-' && extracted !== result.answer) {
            try {
              await updateQuestionAnswer(q.id, extracted, result.analysis, true)
              q.answer = extracted
              q.analysis = result.analysis
              updatedCount++
              fireForget(() => saveQuestionSubject(q, result.subject), `学科 q=${q.id.substring(0, 8)}`)
              console.log(`     题目 ${q.id.substring(0, 8)}: 从分析文本提取答案: ${extracted}`)
              return
            } catch (err) {
              console.error(`     题目 ${q.id.substring(0, 8)}: 提取答案写入失败`, err.message)
            }
          }
          // 至少保存分析文本（fire-and-forget）
          fireForget(async () => {
            await query(`UPDATE questions SET analysis = $1, updated_at = NOW() WHERE id = $2`, [result.analysis, q.id])
            await saveQuestionSubject(q, result.subject)
          }, `分析文本保存 q=${q.id.substring(0, 8)}`)
        }
        exceptionCount++
        fireForget(() => markAnswerException(q.id, validation.reason), `异常标记 q=${q.id.substring(0, 8)}`)
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

          // 非关键写入：fire-and-forget
          if (fingerprint) {
            fireForget(async () => {
              const cacheId = await cacheQuestion({
                content: fullContent, options, answer: finalAnswer,
                analysis: result.analysis, question_type: q.question_type,
                subject: q.subject, content_type: 'text'
              }, fingerprint, phash, PARSER_VERSION)
              if (cacheId) {
                q.cache_id = cacheId
                await updateQuestionCacheId(q.id, cacheId)
              }
            }, `缓存写入 q=${q.id.substring(0, 8)}`)
          }
          fireForget(() => saveQuestionSubject(q, result.subject), `学科 q=${q.id.substring(0, 8)}`)
        } catch (err) {
          console.error(`     题目 ${q.id.substring(0, 8)}: 答案写入失败`, err.message)
          exceptionCount++
          fireForget(() => markAnswerException(q.id, '答案写入失败: ' + err.message), `异常标记 q=${q.id.substring(0, 8)}`)
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
            fireForget(async () => {
              const cacheId = await cacheQuestion({
                content: fullContent, options, answer: finalAnswer,
                analysis: result.analysis, question_type: q.question_type,
                subject: q.subject, content_type: 'text'
              }, fingerprint, phash, PARSER_VERSION)
              if (cacheId) {
                q.cache_id = cacheId
                await updateQuestionCacheId(q.id, cacheId)
              }
            }, `缓存写入 q=${q.id.substring(0, 8)}`)
          }
          fireForget(() => saveQuestionSubject(q, result.subject), `学科 q=${q.id.substring(0, 8)}`)
        } catch (err) {
          console.error(`     题目 ${q.id.substring(0, 8)}: 答案写入失败`, err.message)
          exceptionCount++
          fireForget(() => markAnswerException(q.id, '答案写入失败: ' + err.message), `异常标记 q=${q.id.substring(0, 8)}`)
        }
      } else {
        emptyCount++
        console.log(`     题目 ${q.id.substring(0, 8)}: AI 无法生成答案（可能需要参考图片）`)
        exceptionCount++
        fireForget(() => markAnswerException(q.id, 'AI无法生成答案'), `异常标记 q=${q.id.substring(0, 8)}`)
      }
    })

    await Promise.allSettled(promises)
  }

  return { updated: updatedCount, total: needAnswer.length, empty: emptyCount, placeholder: placeholderCount, exceptions: exceptionCount, cacheHits: cacheHitCount, cacheMisses: cacheMissCount }
}

/**
 * 精简批改管线（错题重练卷）
 *
 * 前置：student 已上传答卷照片，后端已按 generatedExamId 关联 student_id + task_type，
 * 并将该卷题目（含标准答案 / 题型）写入 questions 表。
 *
 * 流程：
 *   1. 下载 + 拉直 + 压缩答卷图片
 *   2. OCR 仅提取每道题的【学生手写答案】（不生成参考答案、不做 AI 作答）
 *   3. 按题号顺序与组卷 question_ids 对齐
 *   4. 对已识别的标准答案做 judgeAnswer → 得到 { isCorrect, confidence }
 *   5. 置信度门禁（>=0.8）且仅客观题可自动判定；低置信度 / 未识别 / 主观题 → 回退人工
 *   6. 全部高置信度 → POST /grade 标记 graded + 推进掌握度；否则整卷保持未批改，
 *      预填结果，老师在「组卷历史」逐题改判后再保存。
 */
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.8
// OCR 返回的题型不可信时，回退到题库已存的 question_type
const SUBJECTIVE_TYPES = new Set(['answer', 'essay', 'proof', 'drawing', 'composition'])

const processSlimGrading = async (job) => {
  const { taskId, studentId, imageUrl: rawImageUrl, originalName, generatedExamId } = job.data
  const startTime = Date.now()

  const resolveImageUrl = (raw) => {
    if (typeof raw === 'string') {
      if (raw.startsWith('{')) {
        try {
          const parsed = JSON.parse(raw)
          return parsed.url || parsed.ossPath || ''
        } catch { return raw }
      }
      return raw
    }
    if (typeof raw === 'object' && raw !== null) return raw.url || raw.ossPath || ''
    return String(raw || '')
  }
  const imageUrl = resolveImageUrl(rawImageUrl)

  const fail = async (msg) => {
    console.error(`💥 [Slim] taskId=${taskId} 失败: ${msg}`)
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, { error: msg, last_error: msg, failedAt: new Date().toISOString() }).catch(() => {})
    throw new Error(msg)
  }

  console.log(`\n🔹 [Slim] 开始精简批改: examId=${generatedExamId}, taskId=${taskId}`)

  try {
    await job.updateProgress(5)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 5 })

    // 拉取组卷题目（含存储的标准答案 / 题型 / 题号）
    const examRes = await query(
      `SELECT question_ids FROM ${TABLES.GENERATED_EXAMS} WHERE id = $1`,
      [generatedExamId]
    )
    if (examRes.rows.length === 0) return fail('组卷记录不存在')

    const questionIds = Array.isArray(examRes.rows[0].question_ids)
      ? examRes.rows[0].question_ids
      : (typeof examRes.rows[0].question_ids === 'string'
          ? JSON.parse(examRes.rows[0].question_ids || '[]')
          : [])

    if (questionIds.length === 0) return fail('组卷无题目')

    const { rows: bankQuestions } = await query(
      `SELECT id, content, answer, analysis, question_type, options, sort_order
       FROM ${TABLES.QUESTIONS} WHERE id = ANY($1)`,
      [questionIds]
    )
    // 保持与 question_ids 一致的顺序
    const orderMap = new Map(questionIds.map((id, idx) => [id, idx]))
    const storedQuestions = bankQuestions
      .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
      .map((q, idx) => ({ ...q, expected_number: idx + 1 }))

    await job.updateProgress(20)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 20 })

    // 下载 + 拉直 + 压缩图片
    let imageBuffer
    try { imageBuffer = await downloadImage(imageUrl) }
    catch (e) { return fail('下载答卷图片失败: ' + e.message) }

    let straightened
    try { straightened = await deskewImage(imageBuffer) }
    catch { straightened = imageBuffer }
    let compressed
    try { compressed = await compressImageBuffer(straightened) }
    catch (e) { return fail('图片压缩失败: ' + e.message) }

    await job.updateProgress(35)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 35 })

    // OCR：仅取学生答案
    const ocrResult = await recognizeQuestions(bufferToBase64(compressed), taskId)
    if (!ocrResult.success) return fail(ocrResult.error || 'AI 识别失败')

    const ocrQuestions = ocrResult.questions || []
    console.log(`\n🔹 [Slim] OCR 识别 ${ocrQuestions.length} 道学生答案，组卷共 ${storedQuestions.length} 题`)

    await job.updateProgress(70)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 70 })

    // 按题号顺序对齐（OCR 顺序即卷面顺序，与题库一致）
    const results = []
    let autoCount = 0
    let manualCount = 0

    for (let i = 0; i < storedQuestions.length; i++) {
      const stored = storedQuestions[i]
      const ocr = ocrQuestions[i]
      const studentAnswer = (ocr?.student_answer || '').toString().trim()

      // 存储答案为空（OCR 之前未生成）：无法自动判定
      if (!stored.answer || !stored.answer.trim()) {
        results.push({ questionId: stored.id, isCorrect: null, source: 'manual', reason: 'no_reference_answer' })
        manualCount++
        continue
      }

      // 主观题：交由人工判定
      const qType = (stored.question_type || '').toLowerCase()
      if (SUBJECTIVE_TYPES.has(qType)) {
        results.push({ questionId: stored.id, isCorrect: null, source: 'manual', reason: 'subjective' })
        manualCount++
        continue
      }

      // 学生未作答
      if (!studentAnswer) {
        results.push({ questionId: stored.id, isCorrect: false, source: 'ocr', confidence: 0, reason: 'blank' })
        autoCount++
        continue
      }

      const judgment = judgeAnswer(studentAnswer, stored.answer, stored.question_type)
      const confidence = ocr?.confidence != null ? Number(ocr.confidence) : 0
      const highConfidence = confidence >= CONFIDENCE_THRESHOLD

      if (!highConfidence) {
        // 低置信度：不自动判定，预填但回退人工确认
        results.push({ questionId: stored.id, isCorrect: null, source: 'manual', reason: 'low_confidence', confidence })
        manualCount++
        continue
      }

      results.push({ questionId: stored.id, isCorrect: judgment.isCorrect, source: 'ocr', confidence })
      autoCount++
    }

    // 预填每道题的 is_correct + confidence（供组卷历史查看 / 改判）
    for (const r of results) {
      if (r.isCorrect !== null) {
        await query(
          `UPDATE ${TABLES.QUESTIONS} SET is_correct = $1, confidence = $2, updated_at = NOW() WHERE id = $3`,
          [r.isCorrect, r.confidence ?? null, r.questionId]
        ).catch((e) => console.error(`[Slim] 预填 is_correct 失败 q=${r.questionId?.substring(0, 8)}:`, e.message))
      }
    }

    await job.updateProgress(90)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 90 })

    // 仅当全部题都成功自动判定（无任何 manual 回退）才标记 graded + 推进掌握度
    const allAuto = manualCount === 0 && autoCount > 0
    if (allAuto) {
      const gradeResults = results
        .filter((r) => r.isCorrect !== null)
        .map((r) => ({ questionId: r.questionId, isCorrect: r.isCorrect }))
      const gradePayload = { id: generatedExamId, studentId, results: gradeResults }
      await callGradeEndpoint(gradePayload).catch((e) => {
        console.error('[Slim] 自动批改提交失败:', e.message)
      })
      console.log(`\n🔹 [Slim] 全自动判定完成：${autoCount} 题，组卷已标记 graded`)
    } else {
      // 存在需人工判定的题：整卷保持未批改，老师在组卷历史逐题改判后保存
      console.log(`\n🔹 [Slim] 存在 ${manualCount} 道需人工判定题，整卷保持未批改，等待改判`)
    }

    await job.updateProgress(100)

    // 统计空白题数（学生未作答）
    let emptyCount = 0
    try {
      const { rows: blankRows } = await query(
        `SELECT COUNT(*) AS cnt FROM ${TABLES.QUESTIONS} WHERE task_id = $1 AND answer_source = 'blank'`,
        [taskId]
      )
      emptyCount = parseInt(blankRows[0]?.cnt || 0)
    } catch (e) {
      console.error('   [Slim] 统计空白题数失败:', e.message)
    }

    await updateTaskStatus(taskId, TASK_STATUS.DONE, {
      questionCount: storedQuestions.length,
      autoCount,
      manualCount,
      emptyCount,
      duration: Date.now() - startTime,
      completedAt: new Date().toISOString()
    })

    return { taskId, examId: generatedExamId, autoCount, manualCount, allAuto }
  } catch (error) {
    const duration = startTime ? Date.now() - startTime : 0
    console.error(`\n💥💥 [Slim] 精简批改失败: taskId=${taskId}, ${error.message}`)
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, { error: error.message, last_error: error.message, failedAt: new Date().toISOString() }).catch(() => {})
    throw error
  }
}

// 调用 /generated-exams/:id/grade（复用组卷批改掌握度进阶逻辑）
const callGradeEndpoint = async ({ id, studentId, results }) => {
  const base = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`
  const url = `${base}/api/generated-exams/${id}/grade`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, results })
  })
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${resp.status}`)
  }
  return resp.json()
}

// ── 练习册批改管线 ──
// OCR 只识别题号+学生答案，不从 worksheet 提取参考答案
// 答案从 worksheet_answers 表查找，judgeAnswer 对比判定

/**
 * 选单元（不再选 section）：返回 unitKey，对应"本页 OCR 出的题号应到哪一摞答案里查"。
 *
 * answersByUnit: Map<unitKey, Map<sectionKey, Map<`qNo|subNo`, row>>>，由 getWorksheetAnswersBySection 返回。
 * pageTitle:     OCR 出的本页标题（多半是单元标题，如"堂堂练① 19.1(1) 算术平方根"）。
 * questions:     OCR 出的本页题目 [{question_number, question_type, sub_no?}]
 * pageNumber:    本页在上传图片中的页号（1-based，可选）。提供后，若标题失配可按单元的
 *                answer_page_start~answer_page_end 范围做兜底匹配。
 *
 * 匹配策略：
 *  1) 唯一单元：直接取该单元。
 *  2) 标题归一化后与 unit_title / unit_key 做精确/包含匹配（处理空格、圈序号）。
 *  3) 页码范围兜底：当 1)2) 失配但 pageNumber 在某单元 [start,end] 内，且该单元含本题号，
 *     则取该单元（解决 OCR 抽不到章节标题但题号仍能唯一定位的页）。
 *  4) 兜底按题号覆盖率打分；要求至少 60% 的题号能在该单元下命中（避免错挂）。
 */
// 圈序号 ①..⑳ + 阿拉伯 1..20 双向兼容：OCR 经常把"堂堂练①"识别成"堂堂练1"，
// 反之亦然。此处把两种字符都压成统一的 ASCII 数字后再做"包含/相等"判断，
// "堂堂练①"和"堂堂练1"因此被视作同一单元。最多处理 20，常规练习册不会超过。
const CIRCLED_DIGITS_RE = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g
// 用字符串键而不是裸的圈序号：圈序号不在 JS IdentifierName 允许集中，V8 在某些版本
// 会把 "①:1,②:2,..." 误判为 label 序列并抛 "Invalid or unexpected token"。加引号后稳。
const circledToAsciiMap = {
  '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
  '⑪': 11, '⑫': 12, '⑬': 13, '⑭': 14, '⑮': 15, '⑯': 16, '⑰': 17, '⑱': 18, '⑲': 19, '⑳': 20,
}
const normalizeTitleForMatch = (s) => {
  if (!s) return ''
  // 圈序号 → ASCII 数字（"堂堂练①" → "堂堂练1"）
  return String(s)
    .replace(CIRCLED_DIGITS_RE, m => circledToAsciiMap[m] || m)
    .replace(/[\s　]+/g, '') // 空白已经由 normalizeSectionName 压过，此处再兜一次
}

// 内容特征 → 章节关键词：按"特征越具体→匹配越准"排序（命中后立即 return，不继续判）。
// 用于 pageTitle 缺失时根据题目内容（题干 + 学生答案 + 选项）反推章节。
// 关键词命中 unitTitle 或 unitKeyRaw 即视为该章节。
//
// ⚠️ 关键：19 章"实数"包含"平方根/立方根/算术平方根"等概念，绝不能划到 20 章"二次根式"！
// 旧版"二次根式"规则含 "平方根|立方根|根号"，导致 19.1/19.2 章节被误判为 20.x
// （用户截图题 18-20 实为 19.2 实数，被规则误判成"二次根式"，错配到 20.x 系列）。
// "二次根式"严格限定为字面"二次根式"或 √± 形式的多项式根号运算。
const CONTENT_CHAPTER_RULES = [
  { chapter: '一元二次方程', re: /一元二次方程|求根公式|判别式|根与系数|二次三项式/ },
  { chapter: '直角三角形', re: /直角三角形|勾股定理|角平分线/ },
  { chapter: '二次根式', re: /二次根式|根号下|√[a-zA-Z]\s*[+\-×÷]\s*√/ },
  { chapter: '实数', re: /无理数|相反数|绝对值|科学记数法|近似数|平方根|立方根|算术平方根/ },
]
const detectChapterByContent = (questions) => {
  if (!Array.isArray(questions) || questions.length === 0) return null
  // 拼所有题目的题干 + 学生答案 + 选项 + question_type 为一个文本
  // （题目内容里通常会带特征字，如"下列各式中正确的是...√4...±√2..."）
  const buf = []
  for (const q of questions) {
    if (q.content) buf.push(String(q.content))
    if (q.student_answer) buf.push(String(q.student_answer))
    if (Array.isArray(q.options)) buf.push(q.options.join(' '))
    if (typeof q.options === 'string') buf.push(q.options)
  }
  const text = buf.join(' ')
  if (!text) return null
  for (const rule of CONTENT_CHAPTER_RULES) {
    if (rule.re.test(text)) return rule.chapter
  }
  return null
}

// 从 pageTitle + questions content 推断 lesson_code（如 "19.2" / "21.2(3)"）
// 用于多试卷单元错位时（如"试卷4|19.2" vs "试卷6"），lesson_code 严格匹配。
// 优先从 pageTitle 中找"试卷N 19.2"模式的 lesson_code，兜底从题干找"19.2 平方根"模式。
// 过滤：排除"1.5"这种科学记数法小数（必须 ≥ 4 字符，如 "19.2" / "21.2(3)"）
const detectLessonCode = (questions, pageTitle) => {
  if (pageTitle && typeof pageTitle === 'string') {
    // 优先匹配带括号的形式如 "19.1(1)" / "21.2(3)"（OCR 标题里常见）
    // 注意：\b 在 '(' 前不成立，所以带括号的模式不能用 \b
    const m1 = pageTitle.match(/(\d{1,2}\.\d{1,2}(?:\(\d+\)))/)
    if (m1 && m1[1].length >= 4) return m1[1]
    // 兜底：匹配不带括号的形式如 "19.1" / "21.2"
    const m2 = pageTitle.match(/\b(\d{1,2}\.\d{1,2})\b/)
    if (m2 && m2[1].length >= 4) return m2[1]
  }
  // 兜底：从题目 content 找 lesson 模式
  if (Array.isArray(questions) && questions.length > 0) {
    for (const q of questions) {
      if (q.content && typeof q.content === 'string') {
        const m1 = q.content.match(/(\d{1,2}\.\d{1,2}(?:\(\d+\)))/)
        if (m1 && m1[1].length >= 4) return m1[1]
        const m2 = q.content.match(/\b(\d{1,2}\.\d{1,2})\b/)
        if (m2 && m2[1].length >= 4) return m2[1]
      }
    }
  }
  return null
}

export function pickAnswerUnit(answersByUnit, pageTitle, questions, pageNumber, chapterHint) {
  if (!answersByUnit || answersByUnit.size === 0) return null
  if (answersByUnit.size === 1) return [...answersByUnit.keys()][0]

  // 从 3D Map 中抽出每单元的展示键（含 unit_title / unit_key / 页码范围）
  const unitMeta = (unitKey) => {
    const secMap = answersByUnit.get(unitKey)
    if (!secMap) return { unitKey, unitTitle: '', unitKeyRaw: '', pageStart: null, pageEnd: null }
    let pageStart = null
    let pageEnd = null
    for (const qMap of secMap.values()) {
      const sample = qMap.values().next().value
      if (sample) {
        if (pageStart == null && sample.answer_page_start != null) pageStart = sample.answer_page_start
        if (pageEnd == null && sample.answer_page_end != null) pageEnd = sample.answer_page_end
        if (pageStart != null && pageEnd != null) break
      }
    }
    if (!secMap.values().next().value) {
      return { unitKey, unitTitle: '', unitKeyRaw: unitKey, pageStart, pageEnd }
    }
    const sample = [...secMap.values()][0].values().next().value
    return {
      unitKey,
      unitTitle: sample.unit_title || '',
      unitKeyRaw: sample.unit_key || unitKey,
      pageStart,
      pageEnd,
    }
  }
  const candidates = [...answersByUnit.keys()].map(unitMeta)

  // 0-pre) 按页面标题区分"试卷"还是"堂堂练/课时练"，避免两类 unit 互相污染。
  //   标题明确含"堂堂练/课时练"→只保留练习类 unit；明确含"试卷/测试卷"→只保留试卷类 unit；
  //   标题不明确时保持原逻辑：优先保留试卷类 unit（答案库批改常见场景）。
  const normPageTitle = normalizeTitleForMatch(pageTitle)
  const hasTanglian = /堂堂练|课时练|练习题/.test(normPageTitle)
  const hasShijuan = /试卷|测试卷/.test(normPageTitle)

  if (hasTanglian && !hasShijuan) {
    const practiceOnly = candidates.filter(c => /^堂堂练|^课时练/.test(c.unitKeyRaw || c.unitKey || ''))
    if (practiceOnly.length >= 1) {
      candidates.splice(0, candidates.length, ...practiceOnly)
    }
  } else if (!hasTanglian && hasShijuan) {
    const paperOnlyCandidates = candidates.filter(c => /^试卷/.test(c.unitKeyRaw || c.unitKey || ''))
    if (paperOnlyCandidates.length >= 1) {
      candidates.splice(0, candidates.length, ...paperOnlyCandidates)
    }
  } else {
    // 标题不明确或同时含两类：保持旧行为，优先试卷类 unit
    const paperOnlyCandidates = candidates.filter(c => /^试卷/.test(c.unitKeyRaw || c.unitKey || ''))
    if (paperOnlyCandidates.length >= 1) {
      candidates.splice(0, candidates.length, ...paperOnlyCandidates)
    }
  }

  // 0) lesson_hint 匹配（最精确：lesson_code 来自 OCR 提示词/题目内容推断）
  //    候选 unit 的 lesson_code 是结构化字段（如"19.2"），而"试卷4" vs "试卷6" 错位时，
  //    lesson_code 严格区分（如"19.2" vs null），远胜标题模糊匹配。
  //    优先从 question content 中检测章节码，再与 candidates 匹配。
  //    命中多个 candidates 时，缩窄 candidates 给后续评分；唯一命中才直接 return。
  //    注：candidates 是 const，用 splice 原地缩窄，不能重新赋值。
  const lessonHint = detectLessonCode(questions, pageTitle)
  if (lessonHint) {
    // 从 pageTitle 抽"试卷N"中的 N
    const pagePaperMatch = pageTitle && typeof pageTitle === 'string'
      ? pageTitle.match(/试卷\s*([0-9㊀-㊉①-⑩]+)/)
      : null
    const pagePaperNum = pagePaperMatch
      ? (circledToAsciiMap[pagePaperMatch[1]] || Number(pagePaperMatch[1]))
      : null

    // 收集所有 lesson_code 段严格匹配 lessonHint 的 candidates
    const lessonMatches = []
    for (const c of candidates) {
      const ck = c.unitKeyRaw || ''
      // unitKey 形如 "试卷4|19.2" → 提取 "19.2" 段做严格匹配
      const m = ck.match(/\|(\d+(?:\.\d+)?(?:\(\d+\))?)/)
      if (m && m[1] === lessonHint) {
        lessonMatches.push(c)
      } else if (ck.includes(lessonHint)) {
        // 兜底：unitKeyRaw 任意位置含 lessonHint（如"试卷19"含"19"），
        // 但 lesson_code 段严格匹配的优先（先填入，模糊匹配的追加在后面）
        lessonMatches.push({ ...c, _softMatch: true })
      }
    }

    // 试卷序号锁定：pageTitle 里的"试卷N"必须和 unitKeyRaw 里的"试卷N"一致
    // OCR 把"试卷④"误识别为"试卷①"时，这个 lock 会失败，回退到 lesson_code 兜底
    if (pagePaperNum && lessonMatches.length > 1) {
      const locked = lessonMatches.filter(c => {
        const ck = c.unitKeyRaw || ''
        const m = ck.match(/试卷\s*(\d+)\s*\|/i)
        return m && Number(m[1]) === pagePaperNum
      })
      if (locked.length >= 1) lessonMatches.splice(0, lessonMatches.length, ...locked)
    }

    // 类型关键词锁定（提高性测试/基础性测试）：OCR 不会把这两个词读错
    if (lessonMatches.length > 1 && pageTitle) {
      const normP = normalizeTitleForMatch(pageTitle)
      const hasBasics = /基础性测试/i.test(normP)
      const hasAdvanced = /提高性测试/i.test(normP)
      if (hasBasics || hasAdvanced) {
        const filtered = lessonMatches.filter(c => {
          const ct = normalizeTitleForMatch(c.unitTitle)
          if (hasBasics) return ct.includes('基础性测试')
          if (hasAdvanced) return ct.includes('提高性测试')
          return true
        })
        if (filtered.length >= 1) lessonMatches.splice(0, lessonMatches.length, ...filtered)
      }
    }

    if (lessonMatches.length === 1) return lessonMatches[0].unitKey
    if (lessonMatches.length > 1) {
      // 多个候选命中：先按严格匹配筛（剔除 softMatch），再交给评分阶段
      const strictMatches = lessonMatches.filter(c => !c._softMatch)
      if (strictMatches.length >= 1) {
        candidates.splice(0, candidates.length, ...strictMatches)
      } else {
        candidates.splice(0, candidates.length, ...lessonMatches)
      }
    }
  }

  // 1) 标题匹配：先把 pageTitle 压空白 + 圈序号→ASCII，再做归一化匹配
  //    旧版只压空白，OCR 把"堂堂练①"误识别为"堂堂练1"会直接失配，60% 兜底也撞错单元
  const normTitle = normalizeTitleForMatch(normalizeSectionName(pageTitle))
  if (normTitle) {
    // 1a) 完全相等 / 包含（按更长侧为锚，防"含子串"误中）
    //   两侧同长：直接比；否则要求短侧是长侧的「前缀」或「后缀」之一
    //   杜绝"第十九章 单元测试卷"被"第十九章"单字符错挂（其实同义但置信度应分级）
    for (const c of candidates) {
      const ct = normalizeTitleForMatch(c.unitTitle)
      if (ct && titleMatches(normTitle, ct)) return c.unitKey
    }
    for (const c of candidates) {
      const ck = normalizeTitleForMatch(c.unitKeyRaw)
      if (ck && titleMatches(normTitle, ck)) return c.unitKey
    }
  }

  // 1.5) 内容特征匹配（兜底）——当 pageTitle 缺失/匹配失败且多个章节有相同题号时，
  //   用题目 OCR 文本中的数学特征（√、二次根式等）反推章节。这能解决：
  //     - 页面顶部"二、选择题"等无章节标题的排版，OCR 无法识别 page_title
  //     - 第十九/二十/二十一/二十二章题号都从 1 开始编号，仅靠题号覆盖率会错挂
  //   唯一命中 → 直接采用；多个候选都含 detectedChapter → 缩窄 candidates 给后续打分。
  //   旧版"多个候选命中就跳过"在 chapterHint=null 时会退化为题号覆盖率乱选（user 截图
  //   18-20 题是 19.2 实数，但试卷1|19.1 题号 1-28 也覆盖 18-20，会被错挂）。修复：
  //   缩窄 candidates（而不是跳过）让打分阶段只在 19.2 系列内部选，避免错挂到 19.1。
  //   二次根式规则已修（不再误中"平方根/立方根"），缩窄安全。
  const detectedChapter = detectChapterByContent(questions)
  if (detectedChapter) {
    const titleMatches4 = candidates.filter(c => c.unitTitle && c.unitTitle.includes(detectedChapter))
    if (titleMatches4.length === 1) return titleMatches4[0].unitKey
    const keyMatches4 = candidates.filter(c => c.unitKeyRaw && c.unitKeyRaw.includes(detectedChapter))
    if (keyMatches4.length === 1) return keyMatches4[0].unitKey
    // 多个候选命中：用 detectedChapter 缩窄 candidates（不替换为局部变量，透传下去给打分）
    if (titleMatches4.length > 1) {
      candidates.splice(0, candidates.length, ...titleMatches4)
    } else if (keyMatches4.length > 1) {
      candidates.splice(0, candidates.length, ...keyMatches4)
    }
  }

  // 2) 题号覆盖率打分（带题型吻合度加权）
  const qNos = (questions || []).filter(q => q.question_number != null).map(q => Number(q.question_number))
  if (qNos.length === 0) return null

  // 2.0) 页码范围兜底：标题失配但题号仍可能唯一定位单元。
  //      答案 PDF 解析时已记录每个单元的 answer_page_start/end，
  //      当 pageNumber 落在某单元的 [start,end] 区间内时，强信号→直接走该单元。
  //      多个区间同时命中（区间邻接/重叠时）→ 走题号覆盖率打分，但仅在区间内打分。
  //      没有任何区间匹配 → 退化为全候选打分（保持旧行为）。
  let scopedCandidates = candidates
  if (pageNumber != null && Number.isFinite(Number(pageNumber))) {
    const page = Number(pageNumber)
    const inRange = candidates.filter(c =>
      c.pageStart != null && c.pageEnd != null &&
      page >= Number(c.pageStart) && page <= Number(c.pageEnd)
    )
    if (inRange.length === 1) {
      // 唯一区间命中：仍需题号覆盖率兜底防错挂（>=1题命中即采用），
      // 防止邻接单元页号漂移（如 unit A 末页 = unit B 末页错位）
      const secMap = answersByUnit.get(inRange[0].unitKey)
      let covered = 0
      for (const q of questions || []) {
        if (q.question_number == null) continue
        const qKey = `${Number(q.question_number)}|${q.sub_no || ''}`
        for (const qMap of secMap.values()) {
          if (qMap.has(qKey)) { covered++; break }
        }
      }
      // 唯一命中且任何题号都能在该单元查到 → 直接采用
      if (covered > 0) return inRange[0].unitKey
      // 唯一命中但题号完全没匹配 → 不强行采用，退到覆盖率打分
    } else if (inRange.length > 1) {
      // 多个区间同时命中：缩窄候选集后再打分，避免跨区错挂
      scopedCandidates = inRange
    }
  }

  // 2.0.5) chapterHint 兜底（最后手段，缩窄候选集）。
  //   仅在 0/1/1.5 都没命中时启用，且必须**严匹配**：要求 candidates 的 unitKeyRaw 含"|XX.YY"
  //   这种 lesson_code 段，且 chapterHint 含此 lesson_code，才纳入打分。
  //   旧版直接把 chapterHint="第十九章实数"扔到所有含此子串的 unitTitle，导致
  //   "试卷4"（key="试卷4|19.2"）和"试卷6"（key="试卷6"，title 含"第十九章"）双双命中，
  //   最后由"包含更多"原则（试卷6 title 长）错挂到试卷6。修复：chapterHint 兜底必须
  //   **配合 lesson_code 段**才能生效，否则视为"无效兜底"、直接用题号覆盖率打分。
  //
  //   二次缩窄（章节关键词）：lesson_code 段只能缩窄到 19.* / 21.* 这种大章，区分不出
  //   19.1（"平方根与立方根"）和 19.2（"实数"）。当 chapterHint 包含"实数/二次根式/
  //   一元二次方程/直角三角形"这种细分章节词时，用它去匹配 unitTitle 做二次缩窄。
  //   这能解决无 pageTitle 场景下"19.1 vs 19.2"错挂（实测 user 截图 18-20 题为 19.2
  //   实数，旧版会被错挂到 19.1 试卷①，因 19.1 也覆盖 18-20 题号）。
  if (chapterHint && typeof chapterHint === 'string' && scopedCandidates.length > 1) {
    // 提取 chapterHint 中的 lesson_code 段：支持"19.2"、第19章、第十九章
    let hintLesson = null
    const lessonMatch = chapterHint.match(/(\d{1,2}\.\d{1,2}(?:\(\d+\))?)/)
    if (lessonMatch) {
      hintLesson = lessonMatch[1]
    } else {
      // 中文数字映射
      const cnDigit = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 }
      const cnChapter = chapterHint.match(/第([零一二三四五六七八九十]+)章/)
      if (cnChapter) {
        const s = cnChapter[1]
        let n = 0
        if (s === '十') n = 10
        else if (s.length === 1) n = cnDigit[s] || 0
        else if (s.length === 2 && s[0] === '十') n = 10 + (cnDigit[s[1]] || 0)
        else if (s.length === 2 && s[1] === '十') n = (cnDigit[s[0]] || 0) * 10
        else if (s.length === 3) n = (cnDigit[s[0]] || 0) * 10 + (cnDigit[s[2]] || 0)
        if (n > 0) hintLesson = String(n)
      }
    }
    if (hintLesson) {
      const narrowed = scopedCandidates.filter(c => {
        const ck = c.unitKeyRaw || ''
        return ck.includes(hintLesson)
      })
      // 仅在窄化后候选数 1-N 时采用（至少 1 个，至多不缩为 0）
      if (narrowed.length >= 1 && narrowed.length < scopedCandidates.length) {
        scopedCandidates = narrowed
      }
    }
    // 二次缩窄：章节关键词（实数/二次根式/一元二次方程/直角三角形）匹配 unitTitle
    // 必须等 lesson_code 缩窄后再做，否则 lesson_code 缩窄会因"21"匹配"21.5"把无关 unit 拉进来
    // 例：chapterHint="第十九章实数" → 实数 → 试卷3/4/6 (而非 19.1 试卷1/2)
    if (scopedCandidates.length > 1) {
      const CHAPTER_KEYWORDS = [
        { kw: '二次根式', mustInTitle: /二次根式|根号下/ },
        { kw: '一元二次方程', mustInTitle: /一元二次方程/ },
        { kw: '直角三角形', mustInTitle: /直角三角形|勾股|角平分线/ },
        { kw: '实数', mustInTitle: /实数/ },
      ]
      const hintNorm = String(chapterHint).replace(/[\s　]+/g, '')
      for (const { kw, mustInTitle } of CHAPTER_KEYWORDS) {
        if (hintNorm.includes(kw)) {
          const kwNarrowed = scopedCandidates.filter(c => {
            const ct = c.unitTitle || ''
            // 章节关键词必须出现在 unitTitle（避免"含子串"误中，如"实数"误中"实数提高性测试"也算命中）
            return mustInTitle.test(ct)
          })
          // 仅在窄化后候选数 >=1 且确实缩窄了才采用
          if (kwNarrowed.length >= 1 && kwNarrowed.length < scopedCandidates.length) {
            scopedCandidates = kwNarrowed
            break // 一次缩窄足够，避免"实数"+"二次根式"等组合误伤
          }
        }
      }
    }
  }

  let bestKey = null
  let bestScore = -1
  for (const c of scopedCandidates) {
    const secMap = answersByUnit.get(c.unitKey)
    let covered = 0
    let typeMatch = 0
    for (const q of questions || []) {
      if (q.question_number == null) continue
      const qNo = Number(q.question_number)
      const subNo = q.sub_no || ''
      const qKey = `${qNo}|${subNo}`
      let row = null
      for (const qMap of secMap.values()) {
        if (qMap.has(qKey)) { row = qMap.get(qKey); break }
      }
      if (!row) continue
      covered++
      const ocrIsChoice = q.question_type === 'choice' || /^[A-Da-d]$/.test(String(q.student_answer || '').trim())
      const refIsChoice = row.answer_type === 'choice'
      if (ocrIsChoice === refIsChoice) typeMatch++
    }
    const score = covered / qNos.length + (covered > 0 ? (typeMatch / covered) * 0.5 : 0)
    // 必须严格大于 bestScore，且 covered>0 才更新 bestKey，
    // 避免遍历顺序导致"第一个 0 分 unit 被误认为最佳"（之前 bestScore=-1 时任何 0 分都会 > -1）
    if (score > bestScore && covered > 0) {
      bestScore = score
      bestKey = c.unitKey
    }
  }

  // 3) 覆盖率门槛：60%（旧 50% 偏松，错挂率较高）
  if (bestKey !== null) {
    const secMap = answersByUnit.get(bestKey)
    let covered = 0
    for (const q of questions || []) {
      if (q.question_number == null) continue
      const qNo = Number(q.question_number)
      const subNo = q.sub_no || ''
      const qKey = `${qNo}|${subNo}`
      for (const qMap of secMap.values()) {
        if (qMap.has(qKey)) { covered++; break }
      }
    }
    if (covered < qNos.length * 0.6) return null
  }
  return bestKey
}

// 标题匹配策略：
//  - 完全相等 → 命中
//  - 一侧是另一侧的子串 → 命中（"堂堂练② 19.1(2)平方根" ∈ "堂堂练② 19.1(2)平方根拓展"）
//  - 一侧是另一侧的「有效前缀/后缀」→ 命中
//    例：pageTitle="第十九章 单元测试卷" / unitTitle="第十九章" → 前缀命中
//    例：pageTitle="第十九章" / unitTitle="第十九章 单元测试卷" → 后缀命中
//  - 子串匹配要求长侧 ≥ 短侧 2 字符以上，避免单字符"1"误中"19.1(1)"
function titleMatches(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  // 包含关系：仅在长度差 ≤ 2 字符时接受
  //   修复前：minLen>=2 即通过 → pageTitle="第十九章实数"(6) 被 unitTitle="试卷⑥第十九章实数提高性测试"(14)
  //   误中（实测选到试卷6而非试卷3|19.2）。OCR 漏识别试卷小标题只返回大章级标题时，
  //   "包含"是子串错挂的元凶，必须用"长度差"卡掉大章级 → 完整标题的误中。
  if (a.includes(b) || b.includes(a)) {
    if (Math.abs(a.length - b.length) > 2) return false
    return Math.min(a.length, b.length) >= 2
  }
  // 前缀/后缀匹配：仅在长度差 ≤ 2 时启用，避免"第十九章"误中"第十九章阶段练"
  const lenDiff = Math.abs(a.length - b.length)
  if (lenDiff > 2) return false
  if (a.length <= b.length ? b.startsWith(a) : a.startsWith(b)) return true
  if (a.length <= b.length ? b.endsWith(a) : a.endsWith(b)) return true
  return false
}

// 兼容旧调用：pickAnswerSection 已废弃。业务已切到 pickAnswerUnit + getWorksheetAnswersBySection 的 3D 结构。
// 保留仅为防止外部 import 报错；返回 null 等同"无匹配"，调用方应改用 pickAnswerUnit。
// eslint-disable-next-line no-unused-vars
export function pickAnswerSection(_answersBySection, _pageTitle, _questions) {
  if (typeof console !== 'undefined') {
    console.warn('[worker] pickAnswerSection 已废弃，请改用 pickAnswerUnit(3D Map)')
  }
  return null
}

// ═══════════════════════════════════════════════
// 答案指纹匹配（OCR 题号错位兜底）
// ═══════════════════════════════════════════════
//
// ⚠️ 关键洞察：答案库 resource_answers.content 字段全空（虽然表结构有但数据没填），
// 没办法用"题目 ↔ 题目"匹配。OCR 题号错位时（OCR 读出 22 但答案库 22(1) 是另一道题），
// 必须用"答案 ↔ 答案"做兜底。
//
// 策略：
// 1) normalizeAnswerFingerprint：把答案字符串归一化（去空格、统一根式、统一分号）
// 2) calculateAnswerSimilarity：完全相等=1.0；归一化相等=0.95；包含=0.85；数字部分相同=0.7
// 3) searchByAnswerFingerprint：在同 unit 同 answer_type 内找最相似的题

/**
 * 答案字符串归一化（用于题号错位时的兜底匹配）
 * - 去所有空白
 * - 统一根式：\sqrt / 根号 → √
 * - 去大括号（LaTeX 残留）
 * - 中英文标点统一（，→ , ； → ;）
 * - 大小写不敏感
 */
function normalizeAnswerFingerprint(s) {
  if (s == null) return ''
  return String(s)
    .replace(/\s+/g, '')                          // 去所有空白
    .replace(/\\sqrt\s*\{?/g, '√')                 // \sqrt{ → √；\sqrt → √
    .replace(/根号/g, '√')                          // 根号 → √
    .replace(/[{}]/g, '')                            // 去大括号
    .replace(/，/g, ',')                              // 中文逗号 → ASCII
    .replace(/；/g, ';')                              // 中文分号 → ASCII
    .replace(/。/g, '.')                              // 中文句号 → .
    .replace(/（/g, '(')                              // 中文括号 → ()
    .replace(/）/g, ')')
    .toLowerCase()
    .trim()
}

/**
 * 答案相似度评分（0-1）
 * - 1.0：完全相等
 * - 0.95：归一化后相等
 * - 0.85：一方包含另一方（子串）
 * - 0.7：数字序列相同（应对 √2 → 2√ 等表达差异）
 * - 0：完全不匹配
 */
export function calculateAnswerSimilarity(studentAns, refAns) {
  if (!studentAns || !refAns) return 0
  // ★ 收窄 student 到最终答案：过程型 "√(12/3)=√4=2" → "2"；"8-9=-1" → "-1"
  //   避免过程字符串与参考答案（结果）相似度为 0 被判错。
  //   收窄是幂等的：已经是最终答案的 "2" 不含 = ；， 收窄后仍为 "2"，无副作用。
  //   refAns 不收窄（参考答案保持原样，可能含等号表达式）。
  let sRaw = String(studentAns).trim()
  if (sRaw.includes('=')) sRaw = sRaw.slice(sRaw.lastIndexOf('=') + 1).trim()
  if (sRaw.includes(';') || sRaw.includes('；')) sRaw = sRaw.split(/[;；]/).pop().trim()
  if (sRaw.includes(',') || sRaw.includes('，')) sRaw = sRaw.split(/[,，]/).pop().trim()
  const rRaw = String(refAns).trim()
  if (sRaw === rRaw) return 1.0
  const sNorm = normalizeAnswerFingerprint(sRaw)
  const rNorm = normalizeAnswerFingerprint(rRaw)
  if (!sNorm || !rNorm) return 0
  if (sNorm === rNorm) return 0.95
  // 包含关系（短的包含在长的中）
  if (sNorm.includes(rNorm) || rNorm.includes(sNorm)) {
    const shorter = Math.min(sNorm.length, rNorm.length)
    const longer = Math.max(sNorm.length, rNorm.length)
    if (shorter >= 2 && longer / shorter <= 1.5) return 0.85
  }
  // 数字序列相同
  const sNums = (sNorm.match(/-?\d+(?:\.\d+)?/g) || []).join(',')
  const rNums = (rNorm.match(/-?\d+(?:\.\d+)?/g) || []).join(',')
  if (sNums && sNums === rNums && sNums.length >= 2) return 0.7
  return 0
}

/**
 * 在同 unit 内按"答案指纹"搜索最相似的题
 * @param {string} studentAnswer - 学生手写答案（OCR 识别）
 * @param {string} qType - 题型（choice/fill/answer/judge）
 * @param {Map} unitAnswers - unit 的 secMap (sectionKey → qKey → row)
 * @param {Set} usedKeys - 已被其他题占用的 qKey（避免重复匹配）
 * @returns {{ row, qKey, score } | null}
 */
export function searchByAnswerFingerprint(studentAnswer, qType, unitAnswers, usedKeys) {
  if (!studentAnswer || !unitAnswers) return null
  const trimmed = String(studentAnswer).trim()
  if (!trimmed) return null

  // 选择题/判断题答案太短（单字符 A/B/C/D/√/×），
  // 答案指纹搜索容易误匹配（如学生答 C，答案库有 3 道题答案都是 C），
  // 而且选择题题干才能确定答案，单字符匹配不能作为批改依据。
  // 因此选择题/判断题**跳过**答案指纹兜底，避免把真错题改对。
  const isChoiceLike = (t) => t === 'choice' || t === 'judge'
  if (isChoiceLike(qType)) return null

  let best = null
  let bestScore = 0
  for (const qMap of unitAnswers.values()) {
    for (const [qKey, row] of qMap) {
      if (usedKeys.has(qKey)) continue
      // 答案类型必须一致（选择题不能匹配解答题，除非都是非选择题）
      const rowType = row.answer_type || 'answer'
      const ocrType = qType || rowType
      if (rowType !== ocrType) {
        // 选择题/判断题跟解答题互不匹配
        if (isChoiceLike(rowType) !== isChoiceLike(ocrType)) continue
      }
      // 选择题/判断题也不参与兜底搜索（答案库端也跳过）
      if (isChoiceLike(rowType)) continue
      const refAns = row.answer
      if (!refAns) continue
      const score = calculateAnswerSimilarity(trimmed, refAns)
      if (score > bestScore) {
        bestScore = score
        best = { row, qKey, score }
      }
    }
  }
  // 阈值 0.7 才采用（避免"完全不匹配"反而误用）
  return bestScore >= 0.7 ? best : null
}

/**
 * 用学生答案反推最可能的 unit（无标题/无章节提示/无继承时兜底）
 *   对每道非选择/判断题，跨所有 unit 搜索最相似的答案行，
 *   统计每个 unit 的命中题数和总相似度，取最佳。
 *   选择题/判断题不参与（答案太短，易误匹配）。
 * @param {Array} questions - OCR 识别出的题目列表（含 student_answer, question_type）
 * @param {Map} answersByUnit - unitKey → secMap
 * @returns {{ unitKey, hits, totalScore } | null}
 */
export function searchUnitByStudentAnswers(questions, answersByUnit) {
  if (!questions || questions.length === 0 || !answersByUnit || answersByUnit.size === 0) return null
  const isChoiceLike = (t) => t === 'choice' || t === 'judge'

  const unitScores = new Map() // unitKey → { hits, totalScore }

  for (const q of questions) {
    const studentAnswer = (q.student_answer || '').toString().trim()
    if (!studentAnswer) continue
    const qType = q.question_type || 'answer'
    if (isChoiceLike(qType)) continue

    for (const [unitKey, unitAnswers] of answersByUnit) {
      const found = searchByAnswerFingerprint(studentAnswer, qType, unitAnswers, new Set())
      if (found && found.score >= 0.7) {
        if (!unitScores.has(unitKey)) unitScores.set(unitKey, { hits: 0, totalScore: 0 })
        const s = unitScores.get(unitKey)
        s.hits++
        s.totalScore += found.score
      }
    }
  }

  if (unitScores.size === 0) return null

  let bestUnit = null
  let bestTotalScore = 0
  for (const [unitKey, score] of unitScores) {
    if (score.totalScore > bestTotalScore) {
      bestTotalScore = score.totalScore
      bestUnit = unitKey
    }
  }

  const best = unitScores.get(bestUnit)
  // 采用条件：≥2 道题命中，或总相似度 ≥ 1.5（至少 2 道较强匹配）
  if (best.hits >= 2 || best.totalScore >= 1.5) {
    return { unitKey: bestUnit, hits: best.hits, totalScore: best.totalScore }
  }
  return null
}

const processWorkbookGrading = async (job) => {
  const { taskId, studentId, imageUrl: rawImageUrl, worksheetId, images: jobImages } = job.data
  const startTime = Date.now()

  console.log(`\n📘 [Workbook] 开始练习册批改 taskId=${taskId}, worksheetId=${worksheetId}`)

  // 1. 收集所有待处理的图片URL（支持多页）
  const resolveUrl = (url) => {
    if (typeof url === 'string') return url.startsWith('{') ? (JSON.parse(url).url || '') : url
    return url?.url || String(url || '')
  }

  let imageList
  if (Array.isArray(jobImages) && jobImages.length > 0) {
    imageList = jobImages.map(img => ({
      image_url: resolveUrl(img.image_url),
      page_number: img.page_number || 0
    }))
  } else {
    // 降级：只有单张图片
    imageList = [{ image_url: resolveUrl(rawImageUrl), page_number: 1 }]
  }

  imageList = imageList.filter(img => img.image_url?.startsWith('http'))

  if (imageList.length === 0) {
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
      error: '所有图片URL无效', errorType: 'INVALID_URL'
    })
    throw new Error('所有图片URL无效')
  }

  await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 5 })

  // 2. 逐页处理：下载 → 压缩 → OCR → 解析
  const workbookPrompt = `你是一个专业的学生手写答案识别助手。请从作业图片中提取页面标题和每道题的题号、学生手写答案。

⚠️ 关键：请严格区分印刷体文字和手写文字
- 印刷体文字（题目、选项、题号数字等）→ 不要作为 student_answer
- 手写体文字（学生书写的内容）→ 这才是 student_answer

只输出 JSON 对象，格式：
{
  "page_title": "页面顶部印刷体标题，如'堂堂练① 19.1(1) 算术平方根'、'第一章阶段练1'、'第十九章 单元测试卷'，没有则填 null",
  "chapter_hint": "根据题目内容推断的章节名，如'第二十章二次根式'，不确定就填 null",
  "questions": [
    {
      "question_number": 1,
      "sub_no": "1",  // 如果该题包含多个小问（如 21.(1)、21.(2)），填写小问号 1/2/3...；否则填 null
      "content": "题目原文（印刷体题干，含题号描述，如'与数轴上的点一一对应的是'，选择题可写'下列各式中正确的是'）",
      "student_answer": "学生手写的答案文本，没有则填 null",
      "question_type": "choice",  // choice | fill | judge | answer
      "block_coordinates": { "x": 120, "y": 300, "width": 760, "height": 90 }
    }
  ]
}

注意：
- page_title 从页面页眉/大标题的印刷体读取，尽量完整（包括圈序号 ①②③、课时编号 19.1(1) 等关键信息）。
  它是批改时定位答案库的关键锚点——必须如实输出，绝不要省略或简化。
  例如：识别到"堂堂练①  19.1(1)  算术平方根"就必须原样输出整串，不要简化为"堂堂练1"。

⚠️【关键】如果页面顶部看不到印刷体页眉/标题（被裁掉、模糊、或本就是"二、选择题 + 简答题"这类无章节标题的排版），
  绝对不能把 page_title 留为 null！必须根据本页【题目内容特征】推断最可能的章节标题并填入：
  - 题目出现 √、±√、二次根式、根号运算、平方根、立方根 → 填 "第二十章二次根式"
  - 题目出现实数、无理数、有理数、相反数、绝对值、数轴、科学记数法、近似数 → 填 "第十九章实数"
  - 题目出现一元二次方程、求根公式、判别式、根与系数 → 填 "第二十一章一元二次方程"
  - 题目出现直角三角形、勾股定理、角平分线 → 填 "第二十二章直角三角形"
  - 其他情况：根据题号所在范围 + 内容特征推断；实在判断不出，填 "未知章节"。
  page_title 缺失会导致后端无法定位答案库而错挂章节，批改结果"一塌糊涂"。

- chapter_hint 必须填！当 page_title 拿不准章节时，chapter_hint 是关键的兜底信号。
  填法与上面 page_title 的章节推断规则完全一致。

- content 必须填：每道题的题干原文（印刷体），至少包含这道题在问什么。
  选填题可写"下列各式中正确的是"或"与数轴上的点一一对应的是"等；
  计算题可写"(1) √12 × √(1/3)"；填空题可写"某数..."。
  它的作用是：后端会用 content 里的关键数学符号（√、根号等）反推章节归属。
  content 缺失会导致章节无法反推。

- question_number 从印刷体题号读取，必须是数字
- 如果一道大题包含多个小问（如 21.(1)、21.(2)、22.(1)、22.(2)），必须将每个小问拆成独立的 question 对象输出：question_number 填大题号，sub_no 填小问号，content 只写该小问的题干，student_answer 只写该小问的手写答案。不要把多个小问合并成一道题
- student_answer 只提取学生手写的内容，如果没有手写迹，填 null；判断题的 √/× 也要提取
- block_coordinates 是该题在图片中的整体外接矩形框（含题号、题干、学生作答区），
  用【归一化 0-1000 坐标系】：x/y 为矩形左上角，width/height 为宽高，
  取值范围 0-1000（相对图片宽/高的千分比，与图片实际像素分辨率无关）。
  必须为每道题都返回该框，用于前端在原图上定位题目。
  ⚠️ 必须按题目【真实位置】返回！x/y/width/height 要反映题目在图片中的实际位置，
  不能返回均匀递增的"占位"坐标（如 y:150,200,250,300...）。
  - x：题号最左侧的 x 坐标（0-1000）
  - y：题号上边缘的 y 坐标（0-1000）
  - width：题号所在行到题目整体最右侧的宽度
  - height：题号到题目最后一行（学生作答区下沿）的高度
  如果实在无法判断某道题的具体边界，至少让 width/height 反映题目的真实占比（计算题比选择题高），不要全部返回相同值。
- 不要猜测标准答案
- 只返回 JSON，不要其他文字`

  let allQuestions = []
  let allPageTitles = []
  let pageDataList = []   // 逐页数据：{ pageTitle, imageUrl, questions[] }
  let ocrErrors = 0
  // 记录最近一次 AI 原始响应（去空白/截断 200 字），0 道题 throw 时拼到 error message，
  // 让 NON_RETRYABLE_ERROR_PATTERNS 能匹配"图片是空白"等 AI 拒绝模板。
  let _lastOcrAiHint = null
  const setLastAiHint = (content) => {
    if (content && typeof content === 'string') {
      _lastOcrAiHint = content.substring(0, 200).replace(/\s+/g, ' ').trim()
    }
  }

  for (let pageIdx = 0; pageIdx < imageList.length; pageIdx++) {
    const { image_url: url } = imageList[pageIdx]
    console.log(`   [Workbook] 处理第 ${pageIdx + 1}/${imageList.length} 页: ${url.substring(0, 60)}...`)

    // 下载图片
    let imageBuffer
    try {
      imageBuffer = await downloadImage(url)
    } catch (e) {
      console.error(`   [Workbook] 第 ${pageIdx + 1} 页下载失败:`, e.message)
      ocrErrors++
      continue
    }

    // 纠偏 + 压缩
    // ModelScope Qwen3-VL 限制 2048x2048：长边缩放到 1800 留余量，避免报 400
    //   ⚠️ 不设 withoutEnlargement：3116 bytes 这类手机缩略图实际只有 800x600，
    //   AI 看到原尺寸会胡说"图片是空白"（8B/235B 训练数据都是 1024+ 的图）。
    //   强制放大到 1800x1800 保留视觉信息，AI 才能正确 OCR。
    const compressedBuffer = await sharp(imageBuffer)
      .rotate()
      .resize(1800, 1800, { fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer()

    // OCR
    const { content } = await callVisionCompletion({
      imageDataURL: `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`,
      systemPrompt: workbookPrompt,
      userText: '识别这张作业图片的页面标题和所有题目的学生答案。',
      temperature: 0.1,
      maxTokens: 4096
    })

    if (!content) {
      console.error(`   [Workbook] 第 ${pageIdx + 1} 页AI识别返回为空，跳过`)
      ocrErrors++
      continue
    }

    // 解析 JSON
    let questions = []
    let pageTitle = null
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                        content.match(/```\n?([\s\S]*?)\n?```/) ||
                        content.match(/[\[{][\s\S]*[\]}]/)
      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content
      const parsed = JSON.parse(jsonStr)
      if (Array.isArray(parsed)) {
        questions = parsed
      } else if (parsed && typeof parsed === 'object') {
        pageTitle = parsed.page_title || null
        // chapter_hint 是 AI 推断的章节名（"第二十章二次根式"等），用于
        // pickAnswerUnit 兜底章节匹配。即使 pageTitle 没识别到或无法匹配，
        // chapter_hint 仍可作为可靠的章节信号（AI 看过题目内容）。
        // 把它暂存在 pageDataList，下游消费。
        const chapterHint = parsed.chapter_hint || null
        questions = Array.isArray(parsed.questions) ? parsed.questions : []
        if (chapterHint) {
          // 把 chapter_hint 也合并进每个 question 的临时字段，供 pickAnswerUnit 用
          for (const q of questions) {
            if (q && typeof q === 'object') q._chapter_hint = chapterHint
          }
        }
      }
    } catch (e) {
      // AI 拒绝返回 JSON 时（如 8B/235B 胡说"用户提供的图片是空白"），
      // 把原始响应的前 200 字附到日志 + 保存到 _lastOcrAiHint，
      // 0 道题 throw 时拼到 error message，让 NON_RETRYABLE_ERROR_PATTERNS 匹配。
      const aiHint = String(content || '').substring(0, 200).replace(/\s+/g, ' ').trim()
      setLastAiHint(content)
      console.error(`   [Workbook] 第 ${pageIdx + 1} 页JSON解析失败:`, e.message)
      if (aiHint) console.error(`   AI 原始响应(前200字): ${aiHint}`)
      ocrErrors++
      continue
    }

    // 标记每道题来自哪页图片（image_url）及页码（page_number），保存时写入。
    // page_number 用于前端分卷排序 / 卷N标注 / 中央页图同步——
    // 缺失会导致多卷任务全部塌缩到"第1页"。用上传顺序页号，兜底 pageIdx+1。
    const pageNo = imageList[pageIdx].page_number || (pageIdx + 1)
    for (const q of questions) {
      q._page_image_url = url
      q._page_number = pageNo
    }

    // 把 AI 合并输出的多小问大题拆成独立题目（如 q21(1)、q21(2)）
    questions = splitOcrQuestionsBySubNo(questions)

    console.log(`   [Workbook] 第 ${pageIdx + 1} 页: 识别到 ${questions.length} 道题, 标题="${pageTitle}"`)

    allQuestions.push(...questions)
    if (pageTitle) allPageTitles.push(pageTitle)
    // pageNumber 一并入 pageDataList，供下游 pickAnswerUnit 走"页码范围兜底"匹配：
    // 答案 PDF 中按页号记录了每个单元的起止页，本页若 OCR 失败或标题失配，
    // 可用页码范围作为辅助信号定位所属单元。
    // chapterHint 来自 AI 推断（"第二十章二次根式"等），pickAnswerUnit 内部会消费它。
    pageDataList.push({
      pageTitle,
      imageUrl: url,
      questions,
      pageNumber: pageNo,
      chapterHint: questions.find(q => q && q._chapter_hint)?._chapter_hint || null
    })

    const progress = 5 + Math.round(((pageIdx + 1) / imageList.length) * 60)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress })
  }

  // 所有页面都识别失败 —— 切下一个视觉模型重试 1 次
  // 原因：8B 配额耗尽/降智时可能全返回 0 道题，换 235B/8B-Thinking/Agnes 一次就过；
  // 如果重试仍 0 道题，基本可以确认是图片本身没内容（白页/过小/拍照模糊），放弃。
  if (allQuestions.length === 0) {
    const retriedModel = rotateVLModel()
    if (retriedModel) {
      console.warn(`🔄 [Workbook] 第 1 轮全 0 道题，切换到下一个视觉模型 (${retriedModel}) 重试 1 次...`)
      // 重置页级状态
      let allQuestionsRetry = []
      let ocrErrorsRetry = 0
      const pageDataListRetry = []
      for (let pageIdx = 0; pageIdx < imageList.length; pageIdx++) {
        const { image_url: url } = imageList[pageIdx]
        let imageBuffer
        try {
          imageBuffer = await downloadImage(url)
        } catch (e) {
          console.error(`   [Workbook] 重试第 ${pageIdx + 1} 页下载失败:`, e.message)
          ocrErrorsRetry++
          continue
        }
        const compressedBuffer = await sharp(imageBuffer)
          .rotate()
          .resize(1800, 1800, { fit: 'inside' })
          .jpeg({ quality: 85 })
          .toBuffer()
        const { content } = await callVisionCompletion({
          imageDataURL: `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`,
          systemPrompt: workbookPrompt,
          userText: '识别这张作业图片的页面标题和所有题目的学生答案。',
          temperature: 0.1,
          maxTokens: 4096,
          model: retriedModel, // 锁定到刚切到的模型，不让它内部再切回
        })
        if (!content) { ocrErrorsRetry++; continue }
        let questions = []
        let pageTitle = null
        try {
          const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                            content.match(/```\n?([\s\S]*?)\n?```/) ||
                            content.match(/[\[{][\s\S]*[\]}]/)
          const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content
          const parsed = JSON.parse(jsonStr)
          if (Array.isArray(parsed)) questions = parsed
          else if (parsed && typeof parsed === 'object') {
            pageTitle = parsed.page_title || null
            questions = Array.isArray(parsed.questions) ? parsed.questions : []
          }
        } catch (e) {
          setLastAiHint(content)
          const aiHint = String(content || '').substring(0, 200).replace(/\s+/g, ' ').trim()
          console.error(`   [Workbook] 重试第 ${pageIdx + 1} 页JSON解析失败:`, e.message)
          if (aiHint) console.error(`   重试 AI 原始响应(前200字): ${aiHint}`)
          ocrErrorsRetry++
          continue
        }
        const pageNo = imageList[pageIdx].page_number || (pageIdx + 1)
        for (const q of questions) {
          q._page_image_url = url
          q._page_number = pageNo
        }
        questions = splitOcrQuestionsBySubNo(questions)
        allQuestionsRetry.push(...questions)
        pageDataListRetry.push({ pageTitle, imageUrl: url, questions, pageNumber: pageNo, chapterHint: null })
        console.log(`   [Workbook] 重试第 ${pageIdx + 1} 页: 识别到 ${questions.length} 道题`)
      }
      if (allQuestionsRetry.length > 0) {
        console.log(`✅ [Workbook] 模型切换重试成功，识别到 ${allQuestionsRetry.length} 道题`)
        allQuestions = allQuestionsRetry
        pageDataList = pageDataListRetry
        ocrErrors = ocrErrorsRetry
        allPageTitles = pageDataListRetry.map(p => p.pageTitle).filter(Boolean)
      } else {
        console.warn(`⚠️ [Workbook] 模型切换重试仍为 0 道题，放弃`)
      }
    }
  }

  // 重试后仍 0 道题 → 标记为 AI_EMPTY 进入黑名单，PendingTaskRecovery 不再反复入队
  //   同时把最近一次 AI 原始响应（去空白/截断 200 字）附在 error message 末尾，
  //   让 NON_RETRYABLE_ERROR_PATTERNS 能匹配"图片是空白"等 AI 拒绝模板。
  if (allQuestions.length === 0) {
    const baseError = ocrErrors > 0 ? `${ocrErrors} 页识别失败` : '所有页面识别结果为空'
    const lastAiHint = _lastOcrAiHint ? `；AI 提示: "${_lastOcrAiHint}"` : ''
    const errorDetail = baseError + lastAiHint
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
      error: errorDetail, errorType: 'AI_EMPTY'
    })
    throw new Error(errorDetail)
  }

  // 3. 逐页单元感知的答案匹配（3D 结构：unitKey → sectionKey → qNo|subNo → row）
  const answersByUnit = await getWorksheetAnswersBySection(worksheetId)

  // 统计所有页标题（仅用于诊断日志）
  const titleFreq = {}
  for (const t of allPageTitles) {
    if (t) titleFreq[t] = (titleFreq[t] || 0) + 1
  }

  let wrongCount = 0
  let matchedCount = 0
  let emptyCount = 0
  const pagesMatchInfo = []

  for (const { pageTitle, imageUrl, questions, pageNumber, chapterHint } of pageDataList) {
    if (questions.length === 0) continue

    // 1) 选本页所属单元（unitKey）—— pageNumber 用于"页码范围兜底"
    //    chapterHint 来自 OCR 阶段 AI 推断的章节（如"第二十章二次根式"），
    //    当 pageTitle 缺失/匹配失败时作为强信号兜底。
    const matchedUnit = pickAnswerUnit(answersByUnit, pageTitle, questions, pageNumber, chapterHint)
    const unitAnswers = matchedUnit != null ? answersByUnit.get(matchedUnit) : null

    // 2) 在该单元的"section → qNo|subNo → row"二维索引中，每道题独立查答案。
    //    同一 unit 下不同 section 可能有相同题号（如"一、填空题 1"和"三、解答题 1"），
    //    必须按 question_type 选择对应 section，否则会把填空题答案挂到解答题上。
    const sectionScoreForType = (section, questionType) => {
      if (!section) return 50
      const s = String(section)
      if (questionType === 'choice') return /选择/.test(s) ? 100 : 0
      if (questionType === 'judge') return /判断/.test(s) ? 100 : 0
      if (/填空/.test(s)) return 100
      if (/解答|计算|证明|简答|作图/.test(s)) return 90
      if (/选择/.test(s)) return 0
      if (/判断/.test(s)) return 0
      return 50
    }
    const lookupRow = (qNo, subNo, questionType) => {
      if (!unitAnswers) return null
      const qKey = `${Number(qNo)}|${subNo || ''}`
      let best = null
      let bestScore = -1
      for (const [section, qMap] of unitAnswers) {
        const row = qMap.get(qKey)
        if (!row) continue
        const score = sectionScoreForType(section, questionType)
        if (score > bestScore) {
          bestScore = score
          best = row
        }
      }
      return best
    }

    pagesMatchInfo.push({
      has_title: !!pageTitle,
      page_title: pageTitle,
      matched_unit: matchedUnit,
      question_count: questions.length,
      page_number: pageNumber || null
    })

    console.log(`   [Workbook] 页匹配: title="${pageTitle}" → unit="${matchedUnit}" (${questions.length} 题)`)

    // 对该页题目逐题判定
    for (const q of questions) {
      if (q.question_number == null) continue

      const answerRow = lookupRow(q.question_number, q.sub_no, q.question_type)
      if (answerRow) {
        q.answer = answerRow.answer
        q.answer_source = 'worksheet'
        q.question_type = answerRow.answer_type || q.question_type || 'choice'
        // 回填题干：答案库有题干时用真实题干替换占位符 "第 N 题"
        if (answerRow.content && String(answerRow.content).trim()) {
          q.content = String(answerRow.content).trim()
        }
        matchedCount++

        const hasAnswer = q.student_answer && q.student_answer !== 'null' && q.student_answer !== '未作答'
        if (hasAnswer) {
          const judgment = judgeAnswer(q.student_answer, q.answer, q.question_type)
          q.is_correct = judgment.isCorrect
          if (q.is_correct === false) wrongCount++
        } else {
          q.is_correct = null // 未作答
          emptyCount++
        }
        console.log(`   [Workbook] 题 ${q.question_number}: 学生="${q.student_answer}" 标准="${q.answer}" → ${q.is_correct === true ? '正确' : q.is_correct === false ? '错误' : '待人工'}`)
      } else {
        console.log(`   [Workbook] 题 ${q.question_number}: 答案库无匹配（页标题="${pageTitle}"），标记待人工`)
        q.is_correct = null
      }
    }
  }

  console.log(`   [Workbook] 答案匹配: ${matchedCount}/${allQuestions.length} 题, 错误: ${wrongCount} 题, 空: ${emptyCount} 题`)

  // 单元匹配诊断信息（写入 task metadata 供前端排查）
  const sectionMatchInfo = {
    pages: pagesMatchInfo,
    total_units: answersByUnit.size
  }
  const allNoMatch = pagesMatchInfo.every(p => p.matched_unit == null)
  if (allNoMatch) {
    sectionMatchInfo.match_fail_reason = '所有页面均无法匹配到所属练习单元'
  }

  await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 75 })

  // 5. 保存到数据库（复用现有 createQuestions）
  // 幂等：恢复链路/重试可能对同一 task 重复执行，先清掉旧题目行防止成倍重复
  const deletedOld = await deleteQuestionsByTaskId(taskId)
  if (deletedOld > 0) {
    console.log(`   [Workbook] 幂等清理: 删除旧题目 ${deletedOld} 行 (taskId=${taskId})`)
  }
  const questionsWithStudentId = allQuestions.map(q => ({
    ...q,
    id: crypto.randomUUID(),
    student_id: studentId,
    task_id: taskId,
    content: q.content || `第 ${q.question_number} 题`,
    options: q.options || [],
    analysis: q.analysis || '',
    student_answer: q.student_answer || null,
    ai_answer: null,
    is_complete: true,
    confidence: q.is_correct !== null ? 0.95 : null,
    question_type: q.question_type || 'choice',
    image_url: q._page_image_url || imageList[0]?.image_url || '',
    page_number: q._page_number || 1,
    // 题目定位框（归一化 0-1000）：来自 OCR，供前端在原图上画蓝色定位框。
    // 同时写入 text_bbox，使前端 getDisplayBox 的首选路径生效。
    block_coordinates: q.block_coordinates || null,
    text_bbox: q.block_coordinates || null,
    source_type: 'workbook'
  }))
  // 清除临时标记字段
  for (const q of questionsWithStudentId) { delete q._page_image_url; delete q._page_number; delete q._chapter_hint }

  await createQuestions(questionsWithStudentId)

  // 构建题号 → question_id 映射（用于错题本 question_id 回填）
  const questionIdByNumber = {}
  for (const q of questionsWithStudentId) {
    if (q.question_number) {
      questionIdByNumber[q.question_number] = q.id
    }
  }

  // 6. 自包含错题本同步：裁剪学生作业图片 + 直接写入 wrong_questions
  const wrongQuestions = allQuestions.filter(q => q.is_correct === false && q.question_number)

  for (const wq of wrongQuestions) {
    const pageImageUrl = wq._page_image_url || imageList[0]?.image_url
    let questionImageUrl = null

    if (pageImageUrl && wq.block_coordinates) {
      try {
        questionImageUrl = await cropAndUploadQuestionRegion(
          pageImageUrl,
          wq.block_coordinates,
          studentId,
          crypto.randomUUID()
        )
      } catch (e) {
        console.warn(`  ⚠️ [Workbook] 错题裁剪失败: question_no=${wq.question_number}, error=${e.message}`)
      }
    }

    await addSelfContainedWrongQuestion({
      studentId,
      worksheetId,
      questionNo: wq.question_number,
      pageNumber: wq._page_number || 1,
      studentAnswer: wq.student_answer || null,
      correctAnswer: wq.answer || null,
      answerType: wq.question_type || 'choice',
      content: wq.content || null,
      questionType: wq.question_type || 'choice',
      blockCoordinates: wq.block_coordinates || null,
      questionImageUrl,
      subject: null,
      sourceType: 'workbook',
      questionId: questionIdByNumber[wq.question_number] || null
    })
  }

  if (wrongQuestions.length > 0) {
    console.log(`   [Workbook] 已添加 ${wrongQuestions.length} 题到错题本（自包含）`)
  }

  // 7. 记录 judgement
  for (const q of questionsWithStudentId) {
    if (q.answer && q.student_answer && q.student_answer !== 'null') {
      try {
        await createJudgement({
          questionId: q.id,
          studentId,
          source: 'ai_ocr',
          confidence: q.is_correct !== null ? 0.95 : null,
          isCorrect: q.is_correct,
          content: q.content,
          answer: q.answer,
          studentAnswer: q.student_answer,
          analysis: q.analysis,
          metadata: { worksheet_id: worksheetId, source: 'workbook_pipeline' }
        })
      } catch (e) {
        // 非阻塞
      }
    }
  }

  // 8. 完成
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  await updateTaskStatus(taskId, TASK_STATUS.DONE, {
    progress: 100,
    questionCount: allQuestions.length,
    wrongCount,
    matchedCount,
    emptyCount,
    duration: `${duration}s`,
    source: 'workbook',
    sectionMatch: sectionMatchInfo
  })

  console.log(`✅ [Workbook] 完成: ${allQuestions.length} 题, ${wrongCount} 错, ${emptyCount} 空, 共 ${imageList.length} 页, 耗时 ${duration}s`)
}

// ═══════════════════════════════════════════════
// 统一答案库管线
// ═══════════════════════════════════════════════
//
// 适用场景：
//   - worksheet（official_verified）：练习册已有官方答案
//   - exam（teacher_verified）：试卷已有教师审核答案
//   - retry_paper（teacher_verified）：错题重练卷已有答案
//
// 流程：OCR 提取学生答案 → resource_answers 查找 → judgeAnswer 比对
// 跳过 AI 生成答案，大幅节省成本。
//
// 关键修复（2026-08-01）：
// 旧版 bulkLookupResourceAnswers(resourceId, questionNos) 只按 question_no 查，
// 多 unit 场景下（试卷①/试卷②/试卷③ 题号都从 1 开始）只返回 question_no ASC 第一行，
// → 学生答对但用错单元的答案比对，批改结果"一塌糊涂"。
// 改用 getResourceAnswersBySection(resourceId) 返回 3D Map
// (unitKey → sectionKey → qNo|subNo → row) + pickAnswerUnit 选单元，按 (unit, section, qNo) 精确定位。

const processAnswerBankGrading = async (job) => {
  const { taskId, studentId, imageUrl: rawImageUrl, originalName, resourceId: _resourceId } = job.data
  // resource_id 仅在夜间解析答案库时被设置；普通 workbook 任务只有 worksheet_id。
  // 降级兜底：resourceId 为空时回退到 worksheetId（两者对答案库批改管线等价）
  const resourceId = _resourceId || job.data.worksheetId || null
  const startTime = Date.now()

  const resolveImageUrl = (raw) => {
    if (typeof raw === 'string') {
      if (raw.startsWith('{')) {
        try { const parsed = JSON.parse(raw); return parsed.url || parsed.ossPath || '' }
        catch { return raw }
      }
      return raw
    }
    if (typeof raw === 'object' && raw !== null) return raw.url || raw.ossPath || ''
    return String(raw || '')
  }

  const fail = async (msg) => {
    console.error(`💥 [AnswerBank] taskId=${taskId} 失败: ${msg}`)
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, { error: msg, last_error: msg, failedAt: new Date().toISOString() }).catch(() => {})
    throw new Error(msg)
  }

  console.log(`\n🔹 [AnswerBank] 开始答案库批改: resourceId=${resourceId}, taskId=${taskId}`)

  try {
    await job.updateProgress(5)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 5 })

    // 查询资源信息，确认答案状态
    const resource = await getResourceById(resourceId)
    if (!resource) return fail('资源不存在')
    if (resource.answer_status === 'none' || resource.answer_status === 'ai_draft') {
      console.warn(`⚠️ [AnswerBank] 资源答案未审核 (${resource.answer_status})，降级为 general 管线`)
      // 清除 resource_id 后重新走 general 管线
      job.data.resourceId = null
      return processTask(job)
    }

    // 多图处理
    let rawPages = Array.isArray(job.data.images) && job.data.images.length > 0
      ? job.data.images
      : (typeof job.data.images === 'string' ? (() => { try { return JSON.parse(job.data.images) } catch { return null } })() : null)
    if (!Array.isArray(rawPages) || rawPages.length === 0) {
      const url = resolveImageUrl(rawImageUrl)
      rawPages = [{ page_number: 1, image_url: url }]
    }
    const pages = rawPages.map((p, i) => ({ pageNumber: p.page_number || i + 1, imageUrl: resolveImageUrl(p.image_url), fileName: p.file_name || null }))

    if (pages.length === 0 || !pages[0].imageUrl) return fail('无有效图片')

    await job.updateProgress(10)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 10 })

    // 下载所有图片
    const imageBuffers = []
    for (const page of pages) {
      try {
        const buf = await downloadImage(page.imageUrl)
        imageBuffers.push({ pageNumber: page.pageNumber, buffer: buf })
      } catch (e) {
        console.error(`⚠️ [AnswerBank] 第 ${page.pageNumber} 页下载失败: ${e.message}`)
      }
    }
    if (imageBuffers.length === 0) return fail('图片全部下载失败')

    await job.updateProgress(20)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 20 })

    // ─────────────────────────────────────────────────────────
    // 答案库批改的 OCR 提示词（关键修复）
    // 旧版复用 buildOCRPrompt，prompt 里有"answer 标准答案"字段 + 整体走通用管线，
    // 实际没有用 AI 生成的 answer，而是和答案库比对；但 prompt 仍诱导 AI 干无用功，
    // 且**没有 page_title / chapter_hint 输出**，导致多 unit 场景下无法定位单元。
    //
    // 这里专门写一个 prompt：
    //   1) 不让 AI 猜标准答案（答案库已存在）
    //   2) 强制输出 page_title + chapter_hint（批改时定位单元的锚点）
    //   3) question_number 从印刷体题号读取
    // ─────────────────────────────────────────────────────────
    const answerBankPrompt = `你是一个专业的学生手写答案识别助手。请从试卷/作业图片中提取页面标题和每道题的题号、学生手写答案。

⚠️ 关键：请严格区分印刷体文字和手写文字
- 印刷体文字（题目、选项、题号数字等）→ 不要作为 student_answer
- 手写体文字（学生书写的内容）→ 这才是 student_answer
- 不要猜测或生成标准答案（answer 字段）！答案库已存在，你的任务是仅识别学生作答内容。

只输出 JSON 对象，格式：
{
  "page_title": "页面顶部印刷体标题，如'试卷① 19.1 平方根与立方根 基础性测试'、'试卷② 21.2(3) 一般的一元二次方程的解法'、'第十九章 单元测试卷'，没有则填 null",
  "chapter_hint": "根据题目内容推断的章节名，如'第二十章二次根式'、'第十九章实数'，不确定就填 null",
  "questions": [
    {
      "question_number": 1,
      "sub_no": "1",  // 如果该题包含多个小问（如 21.(1)、21.(2)），填写小问号 1/2/3...；否则填 null
      "content": "题目原文（印刷体题干）",
      "student_answer": "学生手写的答案文本，没有则填 null",
      "question_type": "choice",  // choice | fill | judge | answer
      "block_coordinates": { "x": 120, "y": 300, "width": 760, "height": 90 }
    }
  ]
}

注意：
- page_title 从页面页眉/大标题的印刷体读取，尽量完整（包括圈序号 ①②③、试卷序号、课时编号 19.1(1) 等关键信息）。
  它是批改时定位答案库的关键锚点——必须如实输出，绝不要省略或简化。
  例如：识别到"试卷①  19.1  平方根与立方根  基础性测试"就必须原样输出整串，不要简化为"试卷1"。

⚠️【关键】如果页面顶部看不到印刷体页眉/标题（被裁掉、模糊、或本就是"二、选择题 + 简答题"这类无章节标题的排版），
  绝对不能把 page_title 留为 null！必须根据本页【题目内容特征】推断最可能的章节标题并填入：
  - 题目出现 √、±√、二次根式、根号运算、平方根、立方根 → 填 "第二十章二次根式"
  - 题目出现实数、无理数、有理数、相反数、绝对值、数轴、科学记数法、近似数 → 填 "第十九章实数"
  - 题目出现一元二次方程、求根公式、判别式、根与系数 → 填 "第二十一章一元二次方程"
  - 题目出现直角三角形、勾股定理、角平分线 → 填 "第二十二章直角三角形"
  - 其他情况：根据题号所在范围 + 内容特征推断；实在判断不出，填 "未知章节"。
  page_title 缺失会导致后端无法定位答案库而错挂章节，批改结果"一塌糊涂"。

- chapter_hint 必须填！当 page_title 拿不准章节时，chapter_hint 是关键的兜底信号。
  填法与上面 page_title 的章节推断规则完全一致。

- content 必须填：每道题的题干原文（印刷体），至少包含这道题在问什么。
  选填题可写"下列各式中正确的是"或"与数轴上的点一一对应的是"等；
  计算题可写"(1) √12 × √(1/3)"；填空题可写"某数..."。
  它的作用是：后端会用 content 里的关键数学符号（√、根号等）反推章节归属。
  content 缺失会导致章节无法反推。

- question_number 从印刷体题号读取，必须是数字。
  注意：每个试卷单元（如"试卷①"）的题号都从 1 重新开始编号，请按当前页所在单元的局部题号输出。
  试卷小标题出现在本页时（如"试卷① 19.1..."），该单元下的题号即从 1 开始。
- 如果一道大题包含多个小问（如 21.(1)、21.(2)、22.(1)、22.(2)），必须将每个小问拆成独立的 question 对象输出：question_number 填大题号，sub_no 填小问号，content 只写该小问的题干，student_answer 只写该小问的手写答案。不要把多个小问合并成一道题。

- student_answer 只提取学生手写的内容，如果没有手写迹，填 null；判断题的 √/× 也要提取

- 不要猜测标准答案！不要输出 answer 字段！答案库已存在，不要试图生成。

- 只返回 JSON，不要其他文字`

    // OCR 提取学生答案（按页处理，每页保留 page_title / chapter_hint）
    const pageDataList = []
    let ocrErrors = 0
    let totalQuestions = 0

    for (let pageIdx = 0; pageIdx < imageBuffers.length; pageIdx++) {
      const { pageNumber, buffer } = imageBuffers[pageIdx]
      console.log(`   [AnswerBank] 处理第 ${pageIdx + 1}/${imageBuffers.length} 页: pageNumber=${pageNumber}`)

      let compressed
      try {
        compressed = await sharp(buffer).rotate().normalize().resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
      } catch (e) {
        console.error(`   [AnswerBank] 第 ${pageNumber} 页压缩失败: ${e.message}`)
        ocrErrors++
        continue
      }

      let content
      try {
        const result = await callVisionCompletion({
          imageDataURL: `data:image/jpeg;base64,${bufferToBase64(compressed)}`,
          systemPrompt: answerBankPrompt,
          userText: '识别这张作业图片的页面标题和所有题目的学生答案。',
          temperature: 0.1,
          maxTokens: 4096
        })
        content = result?.content
      } catch (e) {
        console.error(`   [AnswerBank] 第 ${pageNumber} 页 OCR 失败: ${e.message}`)
        ocrErrors++
        continue
      }

      if (!content) {
        console.error(`   [AnswerBank] 第 ${pageNumber} 页AI识别返回为空，跳过`)
        ocrErrors++
        continue
      }

      // 解析 JSON
      let questions = []
      let pageTitle = null
      let chapterHint = null
      try {
        const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                          content.match(/```\n?([\s\S]*?)\n?```/) ||
                          content.match(/[\[{][\s\S]*[\]}]/)
        const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content
        const parsed = JSON.parse(jsonStr)
        if (Array.isArray(parsed)) {
          questions = parsed
        } else if (parsed && typeof parsed === 'object') {
          pageTitle = parsed.page_title || null
          chapterHint = parsed.chapter_hint || null
          questions = Array.isArray(parsed.questions) ? parsed.questions : []
          if (chapterHint) {
            for (const q of questions) {
              if (q && typeof q === 'object') q._chapter_hint = chapterHint
            }
          }
        }
      } catch (e) {
        console.error(`   [AnswerBank] 第 ${pageNumber} 页JSON解析失败: ${e.message}`)
        ocrErrors++
        continue
      }

      // 标记每道题来自哪页图片
      for (const q of questions) {
        q._page_number = pageNumber
        q._page_image_url = pages[pageIdx]?.imageUrl || null
      }

      // 把 AI 合并输出的多小问大题拆成独立题目（如 q21(1)、q21(2)）
      questions = splitOcrQuestionsBySubNo(questions)

      console.log(`   [AnswerBank] 第 ${pageNumber} 页: 识别到 ${questions.length} 道题, 标题="${pageTitle}"`)

      totalQuestions += questions.length
      pageDataList.push({
        pageTitle,
        pageNumber,
        imageUrl: pages[pageIdx]?.imageUrl || null,
        questions,
        chapterHint: questions.find(q => q && q._chapter_hint)?._chapter_hint || null
      })

      const progress = 20 + Math.round(((pageIdx + 1) / imageBuffers.length) * 30)
      await job.updateProgress(progress)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress })
    }

    if (totalQuestions === 0) {
      const errorDetail = ocrErrors > 0 ? `${ocrErrors} 页识别失败` : 'OCR 未识别到任何题目'
      return fail(errorDetail)
    }

    await job.updateProgress(50)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 50 })

    // ─────────────────────────────────────────────────────────
    // 单元感知批改（关键修复）
    // 旧版用 bulkLookupResourceAnswers(resourceId, questionNos) → answerMap = Map<questionNo, row>，
    // 完全没考虑 unit_id。当答案库有多个 unit（试卷①/试卷②/试卷③），每个 unit 题号都从 1 开始，
    // answerMap.get(1) 只返回 question_no ASC 排序后的第一行 → 学生答对但批错。
    //
    // 新版：getResourceAnswersBySection 返回 3D Map（unitKey → sectionKey → qNo|subNo → row），
    // 用 pickAnswerUnit 选本页所属 unit，再在 unit 内部按 (section, question_no, sub_no) 精确定位。
    // ─────────────────────────────────────────────────────────
    const answersByUnit = await getResourceAnswersBySection(resourceId)
    const unitCount = answersByUnit.size
    console.log(`   [AnswerBank] 答案库共 ${unitCount} 个 unit: ${[...answersByUnit.keys()].join(', ')}`)

    // 比对并保存
    const savedQuestions = []
    let emptyCount = 0, matchedCount = 0
    let wrongCount = 0
    const unitHitMap = new Map()  // unitKey → 命中数（诊断用）
    // 临时索引：question_number → { matched_unit_key, matched_unit_title }
    // 供后续 judgement 写入时携带诊断信息（questions 表无此列，故不入表）
    const matchInfoByQN = new Map()
    let qnCounter = 0
    let prevMatchedUnit = null  // 相邻上一页继承用

    for (const { pageTitle, pageNumber, imageUrl, questions, chapterHint } of pageDataList) {
      if (questions.length === 0) continue

      // 1) 选本页所属 unit
      let matchedUnit = unitCount === 1
        ? [...answersByUnit.keys()][0]   // 唯一 unit 时直接采用，跳过匹配
        : pickAnswerUnit(answersByUnit, pageTitle, questions, pageNumber, chapterHint)

      // 1a) 相邻上一页单元继承：当前页无标题/无章节关键词且正常匹配失败时
      //   只继承相邻上一页；如果继承后题号完全对不上，放弃继承（避免错挂）
      const hasPageContext = !!pageTitle || !!chapterHint
      if (!matchedUnit && !hasPageContext && prevMatchedUnit) {
        const candidateAnswers = answersByUnit.get(prevMatchedUnit)
        if (candidateAnswers) {
          let anyMatch = false
          for (const q of questions) {
            if (q.question_number == null) continue
            const qKey = `${Number(q.question_number)}|${q.sub_no || ''}`
            for (const qMap of candidateAnswers.values()) {
              if (qMap.has(qKey)) {
                anyMatch = true
                break
              }
            }
            if (anyMatch) break
          }
          if (anyMatch) {
            matchedUnit = prevMatchedUnit
            console.log(`   [AnswerBank] 继承上一页单元: pageNumber=${pageNumber} → unit="${matchedUnit}"`)
          }
        }
      }

      // 1b) 学生答案反推单元：无标题/无章节提示/继承也失败时，用学生答案跨单元搜索兜底
      //   覆盖单张无标题页面场景；选择题/判断题不参与（答案太短易误匹配）
      if (!matchedUnit && questions.length > 0) {
        const inferred = searchUnitByStudentAnswers(questions, answersByUnit)
        if (inferred) {
          matchedUnit = inferred.unitKey
          console.log(`   [AnswerBank] 学生答案反推单元: pageNumber=${pageNumber} → unit="${matchedUnit}" hits=${inferred.hits} score=${inferred.totalScore.toFixed(2)}`)
        }
      }

      // 更新上一页单元（只有正常匹配/成功继承/学生答案反推成功才传播）
      if (matchedUnit) prevMatchedUnit = matchedUnit

      const unitAnswers = matchedUnit != null ? answersByUnit.get(matchedUnit) : null
      const noUnit = unitCount === 0

      if (matchedUnit) {
        unitHitMap.set(matchedUnit, (unitHitMap.get(matchedUnit) || 0) + 1)
      }
      console.log(`   [AnswerBank] 页匹配: pageNumber=${pageNumber} title="${pageTitle}" chapterHint="${chapterHint}" → unit="${matchedUnit}" (${questions.length} 题)`)

      // 2) 在该 unit 的"section → qNo|subNo → row"二维索引中，每道题独立查答案
      //   同一 unit 下不同 section 可能有相同题号（如"一、填空题 1"和"三、解答题 1"），
      //   必须按 question_type 选择对应 section，否则会把填空题答案挂到解答题上。
      const sectionScoreForType = (section, questionType) => {
        if (!section) return 50
        const s = String(section)
        if (questionType === 'choice') return /选择/.test(s) ? 100 : 0
        if (questionType === 'judge') return /判断/.test(s) ? 100 : 0
        // fill/answer 都可能落在"填空题"或"解答题/计算题/证明题"；
        // 按 section 在答案库中的出现顺序（填空题通常在前）作为次优先级
        if (/填空/.test(s)) return 100
        if (/解答|计算|证明|简答|作图/.test(s)) return 90
        if (/选择/.test(s)) return 0
        if (/判断/.test(s)) return 0
        return 50
      }
      const lookupRow = (qNo, subNo, questionType) => {
        if (!unitAnswers) return null
        const qKey = `${Number(qNo)}|${subNo || ''}`
        let best = null
        let bestScore = -1
        for (const [section, qMap] of unitAnswers) {
          const row = qMap.get(qKey)
          if (!row) continue
          const score = sectionScoreForType(section, questionType)
          if (score > bestScore) {
            bestScore = score
            best = row
          }
        }
        return best
      }

      // 2.0-pre) 列出答案库中某题号的所有 sub_no 行（如 q21 → [{1, row}, {2, row}]）
      //   用于 OCR student_answer 合并输出（"(1) 2 (2) 2√10"）但无 sub_no 字段时，
      //   自动展开 sub 并按段匹配。
      const findSubRowsForQuestion = (qNo) => {
        if (!unitAnswers) return []
        const out = []
        for (const qMap of unitAnswers.values()) {
          for (const [qKey, row] of qMap) {
            const [qnStr, subStr] = qKey.split('|')
            if (Number(qnStr) === Number(qNo) && subStr) {
              out.push({ sub: subStr, row })
            }
          }
        }
        return out
      }

      // 2.0-pre1a) 列出答案库中某题号的所有行（含整题 + 所有 sub），排除已占用的
      //   用于 OCR 把多空题拆成多条记录时，按出现顺序或相似度匹配
      const findAllRowsForQuestion = (qNo) => {
        if (!unitAnswers) return []
        const out = []
        for (const qMap of unitAnswers.values()) {
          for (const [qKey, row] of qMap) {
            const [qnStr, subStr] = qKey.split('|')
            if (Number(qnStr) === Number(qNo)) {
              const qKeyFull = `${Number(qNo)}|${subStr || ''}`
              if (!usedQKeys.has(qKeyFull)) {
                out.push({ sub: subStr || '', row, qKey: qKeyFull })
              }
            }
          }
        }
        return out
      }

      // 2.0-pre2) 从 student_answer 字符串中解析 (1) X (2) Y 标记，返回 [{sub, val}]
      //   支持中英文括号、半角/全角数字、空格；段内允许含括号（如"(3√2-2)²"）
      //   例："(1) 2 (2) 2√10" → [{sub:'1', val:'2'}, {sub:'2', val:'2√10'}]
      //   例："（1）√14；2 （2）2√10；√10" → [{sub:'1', val:'2'}, {sub:'2', val:'√10'}]
      //   例："（1）8-9=-1 （2）..." → [{sub:'1', val:'-1'}, ...]（取最右"="右侧）
      //   策略：先按 (1)(2)... 标记 split 字符串；段内"过程+结果"型收窄到最终答案
      //
      //   ️ 关键修复（2026-08-01 22:10）：移除负向断言，回归基础模式
      //
      //   根因分析：
      //   - 负向断言 (?![0-9...]) 会拒绝 "(2)2√10"（因为 ) 后是数字 2）
      //   - 负向断言 (?![...（...]) 会拒绝 "(1)（2）"（因为 ） 后是 （）
      //   - 负向断言 (?![...（...]) 会拒绝 "(1)(3√2-2)"（因为 ） 后是 (）
      //
      //   最终方案：移除负向断言，只用基础模式 /[（(]\s*(\d{1,2})\s*[)）]/g
      //   数学表达式如 "(12×1/3)" 中 "12" 后是 "×" 不是 ")"，基础模式已经能区分。
      //   子题标记如 "(1)2√10" 中 "1" 后是 ")"，基础模式能匹配。
      const parseSubAnswers = (s) => {
        if (!s) return []
        // 找所有 (N) 标记的位置和 N，N 为 1-2 位数字
        const markerRe = /[（(]\s*(\d{1,2})\s*[)）]/g
        const markers = []
        let m
        while ((m = markerRe.exec(s)) !== null) {
          markers.push({ sub: String(parseInt(m[1], 10)), start: m.index, contentStart: m.index + m[0].length })
        }
        if (markers.length < 1) return []

        const parts = []
        for (let i = 0; i < markers.length; i++) {
          const mk = markers[i]
          const end = i + 1 < markers.length ? markers[i + 1].start : s.length
          let val = s.slice(mk.contentStart, end)
          // 收窄到"最终答案"：
          //   1) 含 "=" 时取最右 "=" 右侧（"8-9=-1" → "-1"，避免"过程"被包含关系阈值过严误判）
          //   2) 按 ; ； 切分取末段（"√14；2" → "2"）
          //   3) 按 , ， 切分取末段（"5, 6, 7" → "7"）
          if (val.includes('=')) {
            val = val.slice(val.lastIndexOf('=') + 1)
          }
          val = val.split(/[;；]/).pop()
          val = val.split(/[,，]/).pop()
          val = val.trim()
          if (val) parts.push({ sub: mk.sub, val })
        }
        return parts
      }

      // 2.0-pre3) 兜底：OCR 漏掉 (1)(2) 标记时，按 ；/; 切分，段数与答案库 sub 数对齐
      //   例："√(12/3)=√4=2；2√(10)" → [{sub:'1', val:'2'}, {sub:'2', val:'2√(10)'}]
      //   例："9×4=36；8-9=-1" → [{sub:'1', val:'36'}, {sub:'2', val:'-1'}]
      //   触发条件：parseSubAnswers 返回空 + 答案库有 ≥2 个 sub + ；/; 切分后段数匹配
      //   策略：按 ；/; 切分；段内同样收窄到最终答案（= 右侧、末段）
      //
      //   关键修复（2026-08-01 22:15）：优先使用此函数（比 parseSubAnswers 更可靠），
      //   因为数学括号如 "(12×1/3)" 会干扰 parseSubAnswers 的 regex 匹配。
      //   段数匹配策略：优先精确匹配，其次允许段数 ≥ subCount（多余段合并到末段）。
      const splitBySemicolon = (s, subCount) => {
        if (!s || subCount < 2) return []
        const parts = s.split(/[;；]/).map(p => p.trim()).filter(p => p)
        if (parts.length < subCount) return []  // 段数不够，无法匹配
        // 段数 ≥ subCount 时，前 subCount-1 段各取一段，剩余全部合并到末段
        const result = []
        for (let i = 0; i < subCount; i++) {
          let val = i < subCount - 1 ? parts[i] : parts.slice(i).join('; ')
          // 收窄到最终答案
          if (val.includes('=')) val = val.slice(val.lastIndexOf('=') + 1)
          val = val.split(/[,，]/).pop().trim()
          if (val) result.push({ sub: String(i + 1), val })
        }
        return result.filter(Boolean)
      }

      // 取本页代表 unit_title（供本页所有题目的 judgement.metadata 共用）
      const pageUnitTitle = unitAnswers
        ? [...unitAnswers.values()][0]?.values().next().value?.unit_title || null
        : null

      // 已通过题号匹配占用的 qKey（一页内 + 历史前页），避免答案指纹搜索时重复匹配
      const usedQKeys = new Set()
      // 暂存"题号可疑"的题：第一轮题号匹配时答案完全不对，二轮用答案指纹兜底
      const suspectQuestions = []

      // 2.0-pre3a) 预扫描：检测 OCR 把多空题拆成多条同题号记录的情况
      //   例：q21 出现 2 次 → [{idx:0, occ:1}, {idx:5, occ:2}]
      //   用于 fallback 阶段按出现顺序映射到答案库 sub 行
      const qNoIndicesMap = new Map()  // qNo → [{idx, occ}]
      for (let qi = 0; qi < questions.length; qi++) {
        if (questions[qi].question_number == null) continue
        const qNo = Number(questions[qi].question_number)
        if (!qNoIndicesMap.has(qNo)) qNoIndicesMap.set(qNo, [])
        qNoIndicesMap.get(qNo).push(qi)
      }

      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi]
        if (q.question_number == null) continue

        const studentAnswer = (q.student_answer || '').toString().trim()
        const isEmpty = !studentAnswer

        let answerRow = null
        let subBreakdown = null  // [{sub, row, studentPart, refPart, correct}]，合并 sub 时填充
        if (!noUnit) {
          answerRow = lookupRow(q.question_number, q.sub_no, q.question_type)

          // 2.0.0) ★ 核心修复：OCR 把多空题拆成多条同题号记录 → 按出现顺序映射 sub ★
          //   场景：OCR 输出两条 q21（student="=√4" 和 "2√(5÷0.5)"），答案库有 21|1="2" 21|2="2√10"
          //   旧版：每条 q21 的 student_answer 只含一个 sub 答案，splitBySemicolon 拆不出来 → ref 空
          //   修复：第 1 条 q21 → lookupRow(21, '1')，第 2 条 → lookupRow(21, '2')
          //   这是"答案对不上"的根因——OCR 拆题但后端不知道该映射哪个 sub
          if (!answerRow && !isEmpty) {
            const qNo = Number(q.question_number)
            const indices = qNoIndicesMap.get(qNo) || []
            if (indices.length >= 2) {
              // 多条同题号 → 计算当前是第几条（出现顺序）
              const occ = indices.indexOf(qi) + 1
              // 按出现顺序查 sub 行
              const subRow = lookupRow(qNo, String(occ), q.question_type)
              if (subRow) {
                answerRow = subRow
                // 用相似度判分（学生答案可能是过程"=√4"，参考答案是结果"2"）
                const sim = calculateAnswerSimilarity(studentAnswer, subRow.answer)
                let correct = null
                if (sim >= 0.7) correct = true
                else if (sim < 0.5) correct = false
                subBreakdown = [{
                  sub: String(occ),
                  row: subRow,
                  studentPart: studentAnswer,
                  refPart: subRow.answer,
                  correct,
                  sim
                }]
                q._subBreakdown = subBreakdown
                console.log(`   [AnswerBank] OCR拆分映射 q${qNo} occ=${occ} → sub(${occ}) student="${studentAnswer.slice(0, 30)}" ref="${(subRow.answer || '').slice(0, 30)}" sim=${sim.toFixed(2)}`)
              }
            }
          }

          // 2.0.1) sub_no 缺失 + 答案库有 sub 划分 + OCR 合并输出 → 自动拆分按段匹配
          //   例：OCR q21 student="(1) 2 (2) 2√10"，sub_no 缺失，答案库有 21|1="2" 21|2="2√10"
          //   修复前：lookupRow(21, null) 查 "21|" → 找不到 → answer 为空
          //   修复后：拆 student_answer → 段1查 21|1="2"，段2查 21|2="2√10" → 合并
          //   ★ 优先级：在 2.0.0b 相似度兜底之前执行，避免兜底提前消费答案行 ★
          if (!answerRow && !q.sub_no && !isEmpty) {
            const subRows = findSubRowsForQuestion(q.question_number)
            if (subRows.length >= 1) {
              // 优先用 parseSubAnswers（有 (1)(2) 标记时更准确，能按标记正确拆分）
              //   例："（1）√14；2 （2）2√10；√10" → sub(1)="2" sub(2)="√10" ✅
              //   splitBySemicolon 按 ；切分会把标记和答案拆开 → sub(1)="（1）√14" ❌
              let parsed = parseSubAnswers(studentAnswer)
              // 兜底：无 (1)(2) 标记或数学括号干扰时，用 splitBySemicolon（按 ；切分）
              //   例："√(12×1/3)=√4=2；2√(5/0.5)=2√10" → parseSubAnswers 返回 [] → splitBySemicolon → sub(1)="2" sub(2)="2√10" ✅
              if (parsed.length < 1) {
                parsed = splitBySemicolon(studentAnswer, subRows.length)
              }
              // parsed 段数应 ≥ subRows 段数（或更宽容：≥1）
              if (parsed.length >= 1) {
                subBreakdown = []
                let refParts = []
                let allCorrect = true
                let anyMatched = false
                // 按 sub 数字匹配（OCR 可能漏读 sub 编号）：把 parsed 按 sub 数字查 subRows
                for (const { sub, val } of parsed) {
                  const sr = subRows.find(s => s.sub === sub)
                  if (!sr) {
                    // sub 编号对不上 → 跳过（保留待人工审核）
                    continue
                  }
                  // 2.0.1.0) sub 段 judge：用答案指纹（sim >= 0.7 对；< 0.5 错；中间 null）
                  //   judgeAnswer 精确匹配在 OCR 噪声场景下易漏：
                  //     - "√10" vs "2√10"（"√10" 是 "2√10" 子串，sim=0.85）
                  //     - "8-9=-1" vs "-1"（"-1" 是 "8-9=-1" 子串，sim=0.85）
                  //   这些情况学生答案实质正确，应判对。
                  const sim = calculateAnswerSimilarity(val, sr.row.answer)
                  let correct = null
                  if (sim >= 0.7) correct = true
                  else if (sim < 0.5) correct = false
                  // 0.5 ≤ sim < 0.7 → correct=null（待人工审核，不判错也不判对）
                  subBreakdown.push({ sub, row: sr.row, studentPart: val, refPart: sr.row.answer, correct, sim })
                  refParts.push(sr.row.answer)
                  anyMatched = true
                  if (correct === false) allCorrect = false
                }
                if (anyMatched) {
                  // 合成 answerRow（用第 1 个 sub 的元数据 + 合并 ref），主循环后续按聚合处理
                  answerRow = { ...subRows[0].row, answer: refParts.join('; ') }
                  q._subBreakdown = subBreakdown
                }
              }
            }
          }

          // 2.0.0b) 答案相似度兜底：主路径 + 拆分映射 + sub 拆分都查不到 → 按 qNo 找最相似行
          //   覆盖：OCR 拆分但出现顺序与 sub_no 不一致、答案库只有整题行等边界场景
          //   ★ 在 2.0.1 之后执行，避免提前消费答案行 ★
          if (!answerRow && !isEmpty) {
            const allRows = findAllRowsForQuestion(q.question_number)
            if (allRows.length >= 1) {
              let bestRow = null
              let bestSim = 0
              let bestSub = ''
              let bestQKey = ''
              for (const { sub, row, qKey } of allRows) {
                const sim = calculateAnswerSimilarity(studentAnswer, row.answer)
                if (sim > bestSim) {
                  bestSim = sim
                  bestRow = row
                  bestSub = sub
                  bestQKey = qKey
                }
              }
              // 相似度 ≥ 0.3 才采用（避免完全不相关的答案被误匹配）
              if (bestRow && bestSim >= 0.3) {
                answerRow = bestRow
                // 占用该 qKey，避免同题号的其他记录重复匹配到同一行
                usedQKeys.add(bestQKey)
                // 如果命中的是 sub 行，设 subBreakdown
                if (bestSub) {
                  let correct = null
                  if (bestSim >= 0.7) correct = true
                  else if (bestSim < 0.5) correct = false
                  subBreakdown = [{
                    sub: bestSub,
                    row: bestRow,
                    studentPart: studentAnswer,
                    refPart: bestRow.answer,
                    correct,
                    sim: bestSim
                  }]
                  q._subBreakdown = subBreakdown
                }
                console.log(`   [AnswerBank] 相似度兜底 q${q.question_number} → sub(${bestSub || 'whole'}) sim=${bestSim.toFixed(2)} student="${studentAnswer.slice(0, 30)}" ref="${(bestRow.answer || '').slice(0, 30)}"`)
              }
            }
          }
          // 2.0.2) 关键修复：主路径 (qNo, subNo) 查不到 + q.sub_no 非空 → fallback 到整题 (qNo, '')
          //   场景：答案库整题合并存储为 21|'' = "(1)2 (2)2√10"，但 OCR 输出 sub_no='1' / sub_no='2' 两行
          //   (例如 AI 视觉模型把 (1)(2) 主动拆成 2 条 sub 题目入库)。
          //   旧版 lookupRow(21, '1') 查 21|1 找不到 → answer 为空，右侧答案显示空。
          //   修复后：整题 row.answer 用 splitSubAnswers 拆 sub 段，按当前 q.sub_no 命中对应段。
          //   同时 student_answer 可能不含 (1)(2) 标记（OCR 已拆开），直接整段比对。
          if (!answerRow && q.sub_no && !isEmpty) {
            const wholeRow = lookupRow(q.question_number, '', q.question_type)
            if (wholeRow && wholeRow.answer) {
              // 整题 row.answer 含 sub 标记？尝试按段匹配
              const subSegs = splitSubAnswers(wholeRow.answer)
              if (subSegs && subSegs.length >= 2) {
                const seg = subSegs.find(s => String(s.sub_no) === String(q.sub_no))
                if (seg) {
                  // 找到对应 sub 段：用整段 student_answer 比对 seg.answer
                  const sim = calculateAnswerSimilarity(studentAnswer, seg.answer)
                  let correct = null
                  if (sim >= 0.7) correct = true
                  else if (sim < 0.5) correct = false
                  // 0.5 ≤ sim < 0.7 → null（边界情况待人工）
                  subBreakdown = [{
                    sub: String(q.sub_no),
                    row: { ...wholeRow, answer: seg.answer },
                    studentPart: studentAnswer,
                    refPart: seg.answer,
                    correct,
                    sim
                  }]
                  // answerRow 用 seg.answer（让 answer 字段显示子段答案而非整题合并），便于右侧展示
                  answerRow = { ...wholeRow, answer: seg.answer }
                  q._subBreakdown = subBreakdown
                }
              }
              // 整题 row.answer 不含 sub 标记（如纯选择题"21. C"）：兜底整段比对
              if (!answerRow) {
                const sim = calculateAnswerSimilarity(studentAnswer, wholeRow.answer)
                if (sim >= 0.5) {
                  // 整题 row.answer 短或与 student_answer 相似时，按整题采用
                  answerRow = wholeRow
                }
              }
            }
          }
        }

        let isCorrect = null
        const refAnswer = answerRow ? answerRow.answer : null
        const refType = answerRow ? (answerRow.answer_type || q.question_type || 'answer') : (q.question_type || 'answer')

        if (subBreakdown && subBreakdown.length >= 1) {
          // 2.0.1.1) sub 拆分匹配：按 sub 段分别 judge，全部正确才算对；任一错则整题错
          //   不再用整段 judgeAnswer（会因 "(1) 2 (2) 2√10" vs "2; 2√10" 字符串相似但语义错位而误判）
          let allOk = true
          let anyJudged = false
          for (const seg of subBreakdown) {
            if (seg.correct === true) { anyJudged = true; continue }
            if (seg.correct === false) { allOk = false; anyJudged = true }
            // null（边界情况）→ 不影响 allOk
          }
          isCorrect = anyJudged ? allOk : null
          if (isCorrect === true || isCorrect === false) matchedCount++
          console.log(`   [AnswerBank] sub 拆分匹配 q${q.question_number}: ${subBreakdown.map(s => `(${s.sub})${s.correct ? '✓' : '✗'}`).join(' ')} student="${studentAnswer.slice(0, 40)}" ref="${refAnswer.slice(0, 40)}"`)
        } else if (answerRow && !isEmpty) {
          // judgeAnswer 签名：(studentAnswer, referenceAnswer, questionType)
          // 是同步函数，无需 catch 兜底（processWorkbookGrading 也按此调用）
          const judgement = judgeAnswer(studentAnswer, refAnswer, refType)
          isCorrect = judgement && typeof judgement.isCorrect !== 'undefined' ? judgement.isCorrect : null
          if (isCorrect === true || isCorrect === false) matchedCount++
        } else if (isEmpty) {
          emptyCount++
          isCorrect = null
        } else {
          // 答案库无此题目，标记为待审核
          isCorrect = null
        }

        if (isCorrect === false) wrongCount++

        // 标记题号已占用（避免二轮答案指纹搜索重复占用）
        // sub 拆分匹配时，把该题所有 sub 都标为已用
        if (subBreakdown && subBreakdown.length >= 1) {
          for (const seg of subBreakdown) {
            usedQKeys.add(`${Number(q.question_number)}|${seg.sub}`)
          }
        } else if (answerRow) {
          usedQKeys.add(`${Number(q.question_number)}|${q.sub_no || ''}`)
        }

        // 收集"题号可疑"的题进入二轮（OCR 题号错位兜底）：
        // 条件：题号匹配到 row、答案非空、但答案相似度 < 0.5（基本不匹配）
        // sub 拆分场景下已按段 judge，跳过整体 suspect 判断（避免 sub 合并 ref 引发误判）
        if (answerRow && !isEmpty && !subBreakdown) {
          const sim = calculateAnswerSimilarity(studentAnswer, refAnswer)
          if (sim < 0.5) {
            suspectQuestions.push({ q, studentAnswer, qType: q.question_type, currentRef: refAnswer, currentSim: sim })
          }
        }

        const questionData = {
          task_id: taskId,
          student_id: studentId,
          content: q.content || (answerRow && answerRow.content) || `第${q.question_number}题`,
          question_type: refType,
          answer: refAnswer,
          student_answer: studentAnswer,
          ai_answer: null,
          answer_source: isEmpty ? 'blank' : 'recognized',
          is_correct: isCorrect,
          status: isCorrect === false ? 'wrong' : 'pending',
          page_number: q._page_number || pageNumber,
          question_number: q.question_number,
          is_suspicious: !!subBreakdown,  // sub 拆分匹配标记为可疑，供 PC 端展示
          confidence: isEmpty ? 0 : (answerRow ? (subBreakdown ? 0.9 : 0.85) : 0),
          source_type: resource.resource_type === 'exam' ? 'exam' : 'homework'
          // 单元匹配结果不写入 questions（表无对应列），仅在 judgement.metadata 记录
        }

        savedQuestions.push(questionData)
        // 用全局递增 id 作为临时 key（不依赖 question_number，因多页可能同号）
        qnCounter++
        matchInfoByQN.set(qnCounter, {
          matched_unit_key: matchedUnit,
          matched_unit_title: answerRow ? answerRow.unit_title : pageUnitTitle
        })
      }

      // 2.5) 答案指纹兜底（题号错位场景）
      //   对第一轮收集的"题号可疑"题，在同 unit 内用"答案 ↔ 答案"找最相似的题
      //   解决：OCR 错把题号 22 读出来，但答案库 22(1) 是另一道题（用户截图实例）
      if (suspectQuestions.length > 0 && unitAnswers) {
        let fingerHit = 0
        for (const suspect of suspectQuestions) {
          const found = searchByAnswerFingerprint(suspect.studentAnswer, suspect.qType, unitAnswers, usedQKeys)
          if (!found) continue
          // 找到更匹配的题：用 found.row 重批 savedQuestions 里的最后一条 questionData
          // （注意：suspect 来自 questions 循环，questionData 已在 savedQuestions 末尾，qnCounter 已递增）
          // 简化做法：定位到对应的 questionData 并原地更新
          const idx = savedQuestions.length - suspectQuestions.length + suspectQuestions.indexOf(suspect)
          const qd = savedQuestions[idx]
          if (!qd) continue

          const oldRef = qd.answer
          const newRef = found.row.answer
          const newQKey = found.qKey
          const newScore = found.score

          // 用新匹配重批
          const judgement = judgeAnswer(suspect.studentAnswer, newRef, found.row.answer_type || suspect.qType || 'answer')
          const newIsCorrect = judgement && typeof judgement.isCorrect !== 'undefined' ? judgement.isCorrect : null

          // 还原统计：原题号匹配判"错"时 wrongCount++，新匹配判"对"时不需 wrongCount--
          // 简化：直接重算 isCorrect 后用最终态更新 wrongCount（仅当状态从 false → true 时 --）
          if (qd.is_correct === false && newIsCorrect === true) wrongCount--
          if (qd.is_correct !== false && newIsCorrect === false) wrongCount++

          qd.answer = newRef
          qd.is_correct = newIsCorrect
          qd.status = newIsCorrect === false ? 'wrong' : 'pending'
          qd.confidence = Math.max(0.85, newScore)  // 答案指纹命中，置信度提升
          qd.is_suspicious = true  // 标记"题号曾错位"供 PC 端展示
          // 记录原题号 vs 答案指纹匹配的真实题号（仅 console，方便诊断）
          const newQNo = newQKey.split('|')[0]
          const oldQNo = String(suspect.q.question_number)
          if (newQNo !== oldQNo) {
            console.log(`   [AnswerBank] 答案指纹兜底: OCR题号 ${oldQNo} → 答案库题号 ${newQNo} (score=${newScore.toFixed(2)}) 学生="${suspect.studentAnswer.slice(0, 20)}" 答案库="${newRef.slice(0, 20)}"`)
            fingerHit++
          }
          usedQKeys.add(newQKey)
        }
        if (fingerHit > 0) {
          console.log(`   [AnswerBank] 答案指纹兜底命中: ${fingerHit}/${suspectQuestions.length} 题（OCR 题号错位已修正）`)
        }
      }
    }

    if (unitCount > 1) {
      const hitSummary = [...unitHitMap.entries()].map(([k, v]) => `${k}=${v}`).join(', ')
      console.log(`   [AnswerBank] 多 unit 命中分布: ${hitSummary}（未命中页将答非所问）`)
    }

    await job.updateProgress(70)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 70 })

    // 幂等：先清旧题，再批量写入
    const deletedOld = await deleteQuestionsByTaskId(taskId)
    if (deletedOld > 0) {
      console.log(`   [AnswerBank] 幂等清理: 删除旧题目 ${deletedOld} 行`)
    }

    // 每个 question 预生成 ID，供错题本和 judgement 使用
    const questionsWithIds = savedQuestions.map(q => ({
      ...q,
      id: crypto.randomUUID(),
      student_id: studentId,
      task_id: taskId
    }))

    await createQuestions(questionsWithIds)

    // 同步错题本 + judgement
    for (let idx = 0; idx < questionsWithIds.length; idx++) {
      const q = questionsWithIds[idx]
      const matchInfo = matchInfoByQN.get(idx + 1) || {}
      if (q.is_correct === false) {
        await addWrongQuestions(studentId, [q.id], null, null).catch(e =>
          console.error(`⚠️ [AnswerBank] 错题本同步失败 questionId=${q.id}:`, e.message)
        )
      }
      // 写 judgement 审计记录
      await createJudgement({
        questionId: q.id,
        studentId,
        source: 'ai_answer_gen',
        confidence: q.confidence || 0,
        isCorrect: q.is_correct,
        content: q.content,
        answer: q.answer,
        studentAnswer: q.student_answer,
        metadata: {
          resource_id: resourceId,
          answer_bank: true,
          // 关键诊断字段：错位排查时一眼能看出命中了哪个 unit
          matched_unit_key: matchInfo.matched_unit_key || null,
          matched_unit_title: matchInfo.matched_unit_title || null
        }
      }).catch(e => console.error(`⚠️ [AnswerBank] judgement 写入失败:`, e.message))
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    await updateTaskStatus(taskId, TASK_STATUS.DONE, {
      questionCount: questionsWithIds.length,
      wrongCount,
      emptyCount,
      matchedCount,
      duration: `${duration}s`,
      source: 'answer_bank',
      resourceType: resource.resource_type
    })

    console.log(`✅ [AnswerBank] 完成: ${questionsWithIds.length} 题, ${wrongCount} 错, ${emptyCount} 空, ${matchedCount} 匹配答案库, 耗时 ${duration}s`)
  } catch (e) {
    console.error(`💥 [AnswerBank] 异常:`, e.message)
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, { error: e.message, last_error: e.message, failedAt: new Date().toISOString() }).catch(() => {})
  }
}

export const processTask = async (job) => {
  const { taskId, studentId, imageUrl: rawImageUrl, originalName } = job.data
  const startTime = Date.now()

  // ── 路由字段兜底：恢复链路重新入队的 job 可能缺 taskType/worksheetId/generatedExamId，
  // 从 tasks 行回读，防止 workbook/错题重练任务被静默降级为完整 AI 管线 ──
  if ((job.data.taskType === undefined || (job.data.taskType === 'workbook' && !job.data.worksheetId)) && taskId) {
    try {
      const { rows } = await query(
        `SELECT task_type, worksheet_id, generated_exam_id, resource_id FROM ${TABLES.TASKS} WHERE id = $1`,
        [taskId]
      )
      if (rows[0]) {
        job.data.taskType = rows[0].task_type || 'general'
        if (!job.data.worksheetId) job.data.worksheetId = rows[0].worksheet_id || null
        if (!job.data.generatedExamId) job.data.generatedExamId = rows[0].generated_exam_id || null
        if (!job.data.resourceId) job.data.resourceId = rows[0].resource_id || rows[0].worksheet_id || null
      }
    } catch (e) {
      console.error(`⚠️ 路由字段回读失败 taskId=${taskId}:`, e.message)
    }
  }
  // 兜底后仍缺 worksheetId 的 workbook 任务：直接抛错，禁止降级到 general 管线
  // 原因：用户既然选了练习册上传，就明确希望走预埋答案库管线。
  // 静默降级会让学生试卷被错批/对不上答案库，违背用户意图，必须让用户看到明确的失败原因并重新上传。
  // 历史上 line 2421-2424 仅为 console.error，导致 fall through 到 general 管道、task_type=workbook
  // 仍被当成通用卷处理，错挂章节、错判答案。
  if (job.data.taskType === 'workbook' && !job.data.worksheetId) {
    const errMsg = `workbook 任务缺少 worksheetId，无法走预埋答案管线 taskId=${taskId}。请检查：(1) 前端是否正确传递 worksheetId (2) 数据库 tasks.worksheet_id 是否为 null (3) 练习册是否被删除`
    console.error(`❌ [路由] ${errMsg}`)
    throw new Error(errMsg)
  }
  const generatedExamId = job.data.generatedExamId
  const resourceId = job.data.resourceId

  // ── 统一答案库管线：优先使用 resource_answers（已审核的答案库）──
  // 跳过 AI 生成答案步骤，仅 OCR + 比对缓存答案，大幅节省成本
  if (resourceId) {
    return processAnswerBankGrading(job)
  }

  // ── 精简管线（错题重练）：按组卷 question_ids 匹配题库已存答案，自动判定 ──
  // 不跑完整 OCR+AI作答+AI判卷 worker，仅 OCR 学生手写答案 → 与存储答案 deterministic 比对
  // → 置信度门禁（0.8）→ 全部高置信度则自动批改并推进掌握度；否则回退人工改判。
  if (generatedExamId) {
    return processSlimGrading(job)
  }

  // ── 练习册管线：OCR 只识别题号+学生答案，不生成参考答案 ──
  // 答案从 worksheet_answers 查找，judgeAnswer 对比判定
  if (job.data.taskType === 'workbook' && job.data.worksheetId) {
    return processWorkbookGrading(job)
  }

  // Defensive: imageUrl from DB might be string URL, JSON object string, or object
  const resolveUrl = (raw) => {
    if (typeof raw === 'string') {
      // Could be plain URL or JSON string from old object serialization
      if (raw.startsWith('{')) {
        try {
          const parsed = JSON.parse(raw)
          return parsed.url || parsed.ossPath || ''
        } catch (e) {
          return raw // fallback: assume it's a URL
        }
      }
      return raw // normal URL string
    }
    if (typeof raw === 'object' && raw !== null) return raw.url || raw.ossPath || ''
    return String(raw || '')
  }
  const imageUrl = resolveUrl(rawImageUrl)

  // ── 多图一任务：job.data.images 为页数组 [{page_number, image_url, file_name}] ──
  // 旧任务/恢复链路可能只有 imageUrl，回退为单页。
  let rawPages = Array.isArray(job.data.images) && job.data.images.length > 0
    ? job.data.images
    : (typeof job.data.images === 'string' ? (() => { try { return JSON.parse(job.data.images) } catch { return null } })() : null)
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    rawPages = [{ page_number: 1, image_url: imageUrl }]
  }
  const pages = rawPages
    .map((p, i) => ({ pageNumber: p.page_number || i + 1, imageUrl: resolveUrl(p.image_url), fileName: p.file_name || null }))
    .sort((a, b) => a.pageNumber - b.pageNumber)

  const invalidPage = pages.find(p => !p.imageUrl || typeof p.imageUrl !== 'string' || !p.imageUrl.startsWith('http'))
  if (invalidPage) {
    console.error(`\n💥 [Worker] taskId=${taskId} — 第 ${invalidPage.pageNumber} 页 imageUrl 无效: ${String(invalidPage.imageUrl).substring(0, 100)}`)
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
  console.log(`   页数: ${pages.length}`)
  pages.forEach(p => console.log(`   第 ${p.pageNumber} 页: ${p.imageUrl}`))
  console.log(`   originalName: ${originalName}`)
  console.log(`🔥🔥 ==========================================\n`)

  try {
    const startedAt = new Date().toISOString()
    console.log(`📊 [Step 1/6] 更新任务状态为 PROCESSING...`)
    await job.updateProgress(5)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, {
      progress: 5,
      startedAt
    })
    console.log(`✅ [Step 1/6] 状态更新完成`)

    // ── Step 2~5：并行 下载 → 拉直压缩 → AI 识别 ──
    // 各页独立无依赖，Promise.all 并发提升吞吐。
    // 进度在 5→70 区间直接跳到完成值（并行下无法精确递增）。
    const pageBuffers = new Map() // pageNumber → 压缩后 buffer（几何裁剪按页取图）
    const questions = []
    let totalOcrDuration = 0

    const pageTasks = pages.map(async (page, pageIdx) => {
      const pageLabel = pages.length > 1 ? `第 ${page.pageNumber}/${pages.length} 页 ` : ''

      console.log(`📊 [Step 2/6] ${pageLabel}从 OSS 下载图片...`)
      let imageBuffer
      try {
        imageBuffer = await downloadImage(page.imageUrl)
      } catch (downloadError) {
        console.error('下载图片失败:', downloadError.message)
        throw new Error(`下载图片失败(${pageLabel.trim() || '第 1 页'}): ` + downloadError.message)
      }
      console.log(`✅ [Step 2/6] ${pageLabel}图片下载完成: ${imageBuffer.length} bytes`)

      console.log(`📊 [Step 3~4/8] ${pageLabel}拉直并压缩图片（合并 Sharp 管线）...`)
      let compressedBuffer
      try {
        // ⚡ 合并 deskew + compress 为单次 Sharp 管线，避免中间 buffer 分配和二次初始化
        compressedBuffer = await sharp(imageBuffer)
          .rotate()
          .normalize()
          .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
        console.log(`✅ [Step 3~4/8] ${pageLabel}拉直+压缩完成: ${imageBuffer.length} → ${compressedBuffer.length} bytes (${Math.round(compressedBuffer.length/imageBuffer.length*100)}%)`)
      } catch (processError) {
        console.error('图片处理失败:', processError)
        throw processError
      }

      const imageBase64 = bufferToBase64(compressedBuffer)

      console.log(`📊 [Step 5/8] ${pageLabel}调用 AI 视觉识别...`)
      const ocrResult = await recognizeQuestions(imageBase64, taskId)

      if (!ocrResult.success) {
        console.error(`❌ [Step 5/8] ${pageLabel}AI 识别失败: ${ocrResult.error}`)
        throw new Error(ocrResult.error || 'AI识别失败')
      }

      const pageQuestions = (ocrResult.questions || []).map(q => ({
        ...q,
        page_number: page.pageNumber,
      }))

      console.log(`✅ [Step 5/8] ${pageLabel}识别 ${pageQuestions.length} 道题`)
      return { pageNumber: page.pageNumber, compressedBuffer, ocrDuration: ocrResult.duration || 0, pageQuestions }
    })

    const pageResults = await Promise.all(pageTasks)
    for (const r of pageResults) {
      pageBuffers.set(r.pageNumber, r.compressedBuffer)
      questions.push(...r.pageQuestions)
      totalOcrDuration += r.ocrDuration
    }

    await job.updateProgress(70)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 70 })

    // 兼容后续单图逻辑：compressedBuffer 指向第 1 页（pHash 缓存等非关键路径）
    const compressedBuffer = pageBuffers.get(pages[0].pageNumber)

    let wrongCount = questions.filter(q => q.is_correct === false).length
    let answerGenResult = { updated: 0, total: 0, empty: 0, placeholder: 0, exceptions: 0, cacheHits: 0, cacheMisses: 0 }

    console.log(`✅ [Step 5/8] AI 识别成功: ${pages.length} 页共 ${questions.length} 道题, ${wrongCount} 道错题, OCR 耗时 ${Math.round(totalOcrDuration/1000)}s`)

    if (questions.length > 0) {
      console.log(`📊 [Step 6/8] 保存题目到数据库...`)

      // ── 坐标存储策略：block_coordinates / text_bbox 保持 AI 返回的 0-1000 归一化坐标直接入库 ──
      // 前端按图片实际显示尺寸(naturalWidth/naturalHeight)换算像素，彻底与分辨率解耦，
      // 无论展示原图还是压缩图，overlay 都能精准对齐。
      // 几何图裁剪需要对应页压缩图的像素坐标，故仅在裁剪处把 image bbox 局部换算，
      // 不影响入库的归一化值。
      const pageDims = new Map() // pageNumber → {w, h}
      for (const [pageNo, buf] of pageBuffers) {
        try {
          const _meta = await sharp(buf).metadata()
          pageDims.set(pageNo, { w: _meta.width, h: _meta.height })
        } catch (e) {
          console.warn(`   ⚠️ [坐标] 读取第 ${pageNo} 页压缩图尺寸失败: ${e.message}`)
        }
      }

      // ── 多模态切题：处理几何配图（⚡ 并行化） ─
      const geometryImageCache = new Map() // 页码+bbox 去重缓存 (一图多题)

      // 收集所有需要裁剪几何图的题目
      const geometryTasks = questions
        .filter(q => {
          const hasImage = q.image_type && q.image_type !== 'none'
          const hasLegacyImage = q.geometry_image?.has_image && q.geometry_image.bbox
          const imageType = q.image_type || (hasLegacyImage ? 'geometry' : null)
          if (!q.image_type && imageType) q.image_type = imageType
          return hasImage || hasLegacyImage
        })
        .map(q => {
          const imageBbox = q.image_bbox || (q.geometry_image?.bbox || null)
          const imageType = q.image_type || 'geometry'
          const bbox = imageBbox
          if (!bbox) {
            if (q.content && (q.content.includes('如图') || q.content.includes('图1') || q.content.includes('图示'))) {
              console.log(`   ⚠️ [几何图] ${q.id}: 题干含"如图"关键词但未返回 bbox`)
            }
            return null
          }
          const pageNo = q.page_number || pages[0].pageNumber
          const dims = pageDims.get(pageNo)
          const safeBbox = clampImageBboxToBlock(bbox, q.block_coordinates)
          const pixelBbox = dims ? denormalizeBbox(safeBbox, dims.w, dims.h) : safeBbox
          const cacheKey = `${pageNo}:${JSON.stringify(safeBbox)}`
          return { q, safeBbox, pixelBbox, cacheKey, imageType, imageBbox, pageNo }
        })
        .filter(Boolean)

      if (geometryTasks.length > 0) {
        console.log(`   [几何图] ⚡ 并行裁剪 ${geometryTasks.length} 张配图...`)
        await Promise.allSettled(geometryTasks.map(async ({ q, safeBbox, pixelBbox, cacheKey, pageNo }) => {
          if (geometryImageCache.has(cacheKey)) {
            q.geometry_image_url = geometryImageCache.get(cacheKey)
          } else {
            const pageBuffer = pageBuffers.get(pageNo) || compressedBuffer
            q.geometry_image_url = await cropAndUploadGeometryImage(pageBuffer, pixelBbox, studentId, q.id)
            if (q.geometry_image_url) {
              geometryImageCache.set(cacheKey, q.geometry_image_url)
            }
          }
        }))
      }

      // 标记有"如图"关键词但无 bbox 的题
      for (const q of questions) {
        const hasBbox = (q.image_type && q.image_type !== 'none') || (q.geometry_image?.has_image && q.geometry_image.bbox)
        if (!hasBbox && q.content && (q.content.includes('如图') || q.content.includes('图1') || q.content.includes('图示'))) {
          console.log(`   ⚠️ [几何图] ${q.id}: 题干含"如图"关键词但未返回 geometry_image, content=${q.content.substring(0, 60)}`)
        }
      }

      const questionsWithStudentId = questions.map(q => ({
        ...q,
        student_id: studentId
      }))

      await createQuestions(questionsWithStudentId)
      console.log(`✅ [Step 6/8] 题目保存成功 (含 ${geometryImageCache.size} 张几何配图)`)

      // ── 页面理解：将裁剪后的几何图保存到 question_assets（⚡ 并行化） ──
      const geometryQuestions = questions.filter(q => q.geometry_image_url)
      if (geometryQuestions.length > 0) {
        const assetResults = await Promise.allSettled(geometryQuestions.map(async (q) => {
          const imageType = q.image_type || 'geometry'
          const imageBbox = q.image_bbox || (q.geometry_image?.bbox || null)
          const sourcePage = pages.find(p => p.pageNumber === q.page_number)
          await createQuestionAsset({
            question_id: q.id,
            asset_type: imageType === 'chart' ? 'chart_image' : 'geometry_image',
            original_image_url: sourcePage?.imageUrl || imageUrl,
            cropped_image_url: q.geometry_image_url,
            bbox: imageBbox,
            tikz_status: imageType === 'geometry' ? 'pending' : 'none'
          })
          return true
        }))
        const assetCount = assetResults.filter(r => r.status === 'fulfilled').length
        console.log(`   ✅ [question_assets] 已保存 ${assetCount} 条资源记录（其中 geometry 类型标记为 tikz_status=pending）`)
      }

      // ── 几何图重建 → 已改为后台异步任务 ──
      // 不再在此处同步调用 processGeometryCleaning()。
      // 由 geometryWorker 扫描 pending 状态的 geometry 资产，
      // 异步调用 Vision API 完成结构识别 + SVG 渲染。
      // 详见 geometryWorker.js 和 pendingTaskRecovery.js。

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
      // 批量查询所有人工复核判定，避免逐题 N+1 DB 查询
      const judgementableQuestions = questions.filter(q =>
        q.answer && q.answer.trim() && q.answer !== '待人工补充' && q.answer !== '此为主观题，无唯一标准答案'
      )
      let manualJudgementMap = new Map()
      if (judgementableQuestions.length > 0) {
        try {
          const questionIds = judgementableQuestions.map(q => q.id)
          const { rows: judgements } = await query(
            `SELECT DISTINCT ON (question_id) question_id, id, source, is_correct
             FROM ${TABLES.JUDGEMENTS}
             WHERE question_id = ANY($1) AND student_id = $2 AND source = 'manual_review'
             ORDER BY question_id, created_at DESC`,
            [questionIds, studentId]
          )
          for (const j of judgements) {
            manualJudgementMap.set(j.question_id, j)
          }
        } catch (e) {
          console.error('  批量查询人工判定失败:', e.message)
        }
      }
      for (const q of judgementableQuestions) {
          const manualJudgement = manualJudgementMap.get(q.id)
          if (manualJudgement && manualJudgement.is_correct !== null) {
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

      console.log(`📊 [Step 8/8] 生成本地标签...`)
      const tagResults = await generateTagsForQuestions(questions)
      const tagMap = {}
      const difficultyMap = {}
      for (const tr of tagResults) {
        tagMap[tr.questionId] = tr.tags
        difficultyMap[tr.questionId] = tr.difficulty
      }

      for (const q of questions) {
        const tags = tagMap[q.id]
        // 本地规则分类必得标签（至少 ['未分类']）→ 标记来源为 local。
        // 难度统一为默认值（3），留待每日回填任务用 LLM 修正。
        q.ai_tags = tags && tags.length > 0 ? tags : ['未分类']
        q.tags_source = 'local'
        q.difficulty = difficultyMap[q.id] ?? 3
      }

      const tagUpdates = questions.map(q => ({
        id: q.id,
        ai_tags: q.ai_tags,
        difficulty: q.difficulty
      }))
      await batchUpdateQuestionTags(tagUpdates)
      console.log(`✅ [Step 8/8] 本地标签保存成功`)

      await job.updateProgress(90)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 90 })

      // ── 自动保存 AI 生成的答案到答案库 ──
      try {
        const savableQuestions = questions.filter(q =>
          q.answer && q.answer.trim()
          && q.answer !== '待人工补充'
          && q.answer !== '此为主观题，无唯一标准答案'
        )
        if (savableQuestions.length > 0) {
          const subject = job.data.subject || null
          const resourceName = originalName || `试卷_${new Date().toISOString().slice(0, 10)}`
          // 1. 创建 resource
          const { rows: [newResource] } = await query(
            `INSERT INTO resources (resource_type, name, subject, answer_status, status, answer_count)
             VALUES ('exam', $1, $2, 'ai_draft', 'draft', $3) RETURNING *`,
            [resourceName, subject, savableQuestions.length]
          )
          // 2. 逐题保存答案
          let savedCount = 0
          for (const q of savableQuestions) {
            try {
              await query(
                `INSERT INTO resource_answers (resource_id, question_no, answer, answer_type, content, answer_status, source)
                 VALUES ($1, $2, $3, $4, $5, 'ai_draft', 'ai_grading')`,
                [newResource.id, q.question_number || 0, q.answer, q.question_type || 'choice', q.content || null]
              )
              savedCount++
            } catch (e) {
              console.error(`   ⚠️ [Auto-save] 保存第 ${q.question_number} 题答案失败:`, e.message)
            }
          }
          // 3. 关联 task → resource
          await query(
            `UPDATE tasks SET resource_id = $1 WHERE id = $2`,
            [newResource.id, taskId]
          )
          console.log(`✅ [Auto-save] 答案库已保存: "${resourceName}" (${savedCount}/${savableQuestions.length} 题, resourceId=${newResource.id})`)
        } else {
          console.log(`  ℹ️ [Auto-save] 无可用答案，跳过答案库保存`)
        }
      } catch (e) {
        console.error(`  ⚠️ [Auto-save] 保存答案库失败:`, e.message)
      }
    } else {
      console.log(`⚠️  AI 未识别到任何题目`)
    }

    await job.updateProgress(100)
    const duration = Date.now() - startTime

    // 统计空白题数（学生未作答）
    let emptyCount = 0
    try {
      const { rows: blankRows } = await query(
        `SELECT COUNT(*) AS cnt FROM ${TABLES.QUESTIONS} WHERE task_id = $1 AND answer_source = 'blank'`,
        [taskId]
      )
      emptyCount = parseInt(blankRows[0]?.cnt || 0)
    } catch (e) {
      console.error('   统计空白题数失败:', e.message)
    }

    await updateTaskStatus(taskId, TASK_STATUS.DONE, {
      questionCount: questions.length,
      wrongCount: wrongCount,
      emptyCount: emptyCount,
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
      emptyCount,
      duration,
      cacheHits: answerGenResult?.cacheHits || 0,
      cacheMisses: answerGenResult?.cacheMisses || 0
    }
  } catch (error) {
    const duration = startTime ? Date.now() - startTime : 0
    console.error(`\n💥💥💥 [Worker] ==========================================`)
    console.error(`💥💥💥 [Worker] 任务处理失败:`)
    console.error(`   taskId: ${taskId}`)
    console.error(`   错误: ${error.message}`)
    console.error(`💥💥 ==========================================\n`)

    try {
      // 解析已有 retry_count（存于 result JSON），失败自增一次。
      let prevRetry = 0
      try {
        const { rows } = await query(
          `SELECT result, retry_count FROM ${TABLES.TASKS} WHERE id = $1`,
          [taskId]
        )
        if (rows.length > 0) {
          if (typeof rows[0].retry_count === 'number') prevRetry = rows[0].retry_count
          else if (rows[0].result) {
            const r = typeof rows[0].result === 'string' ? JSON.parse(rows[0].result) : rows[0].result
            prevRetry = Number(r?.retryCount || 0)
          }
        }
      } catch { /* 读取失败则 retry 从 0 计 */ }

      await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
        error: error.message || '处理失败',
        last_error: error.message || '处理失败',
        retry_count: prevRetry + 1,
        duration: duration,
        failedAt: new Date().toISOString()
      })
    } catch (updateError) {
      console.error('更新任务失败状态时出错:', updateError)
    }

    // ── 关键：非可重试错误不抛给 BullMQ ──
    // 配额耗尽 / 限流 / URL 失效 / 缺少 worksheetId 等属于"自愈失败"，
    // 抛给 BullMQ 会触发 attempts=3 的内部重试（每次都重复下载图片、调 AI、浪费 30s+）。
    // 返回 undefined → BullMQ 视为 completed → 不再重试。
    // 任务在 DB 里已经是 FAILED，PendingTaskRecovery 黑名单会兜底阻止再次入队。
    if (NON_RETRYABLE_ERROR_PATTERNS.some(pat => pat.test(error.message || ''))) {
      console.warn(`🚫 [Worker] 任务命中非可重试黑名单，跳过 BullMQ 重试: taskId=${taskId}`)
      return undefined
    }

    throw error
  }
}
