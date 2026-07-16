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
import { updateTaskStatus, createQuestions, batchUpdateQuestionTags, addWrongQuestions, createJudgement, updateQuestionAnswer, markAnswerException, findCachedQuestionByFingerprint, cacheQuestion, incrementQuestionUseCount, updateQuestionCacheId, createQuestionAsset, lookupWorksheetAnswer } from './services/neonService.js'
import { uploadImage } from './services/ossService.js'
import { generateTextFingerprint, generatePHash, PARSER_VERSION, TEXT_SIMILARITY_THRESHOLD } from './utils/questionFingerprint.js'
import { uploadFilesWithRetry } from './services/uploadRetryManager.js'
import { judgeAnswer } from './services/judgeService.js'
import { classifyQuestionLocally } from './utils/localTagger.js'

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
const processWorkbookGrading = async (job) => {
  const { taskId, studentId, imageUrl: rawImageUrl, worksheetId } = job.data
  const startTime = Date.now()

  console.log(`\n📘 [Workbook] 开始练习册批改 taskId=${taskId}, worksheetId=${worksheetId}`)

  // 1. 解析 imageUrl
  let imageUrl
  if (typeof rawImageUrl === 'string') {
    imageUrl = rawImageUrl.startsWith('{')
      ? (JSON.parse(rawImageUrl).url || '')
      : rawImageUrl
  } else {
    imageUrl = rawImageUrl?.url || String(rawImageUrl || '')
  }
  if (!imageUrl?.startsWith('http')) {
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
      error: 'imageUrl 无效', errorType: 'INVALID_URL'
    })
    throw new Error('imageUrl 无效')
  }

  await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 5 })

  // 2. 下载图片
  const imagePath = await downloadImage(imageUrl)
  if (!imagePath) {
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
      error: '图片下载失败', errorType: 'DOWNLOAD_FAILED'
    })
    throw new Error('图片下载失败')
  }

  await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 15 })

  // 3. 纠偏 + 压缩
  const compressedBuffer = await sharp(imagePath)
    .rotate()
    .resize(1920, undefined, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()

  await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 30 })

  // 4. OCR — 只提取题号+学生答案，不要求 AI 生成参考答案
  // 使用更简单的 prompt，减少 token 消耗
  const workbookPrompt = `你是一个专业的学生手写答案识别助手。请从作业图片中提取每道题的题号和对应的学生手写答案。

⚠️ 关键：请严格区分印刷体文字和手写文字
- 印刷体文字（题目、选项、题号数字等）→ 不要作为 student_answer
- 手写体文字（学生书写的内容）→ 这才是 student_answer

只输出 JSON 数组，格式：
[
  {
    "question_number": 1,
    "student_answer": "学生手写的答案文本，没有则填 null",
    "question_type": "choice"  // choice | fill | answer
  }
]

注意：
- question_number 从印刷体题号读取，必须是数字
- student_answer 只提取学生手写的内容，如果没有手写迹，填 null
- 不要猜测标准答案
- 只返回 JSON，不要其他文字`

  console.log(`   [Workbook] 开始 AI 识别题号+学生答案...`)
  const { content } = await callVisionCompletion({
    imageDataURL: `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`,
    systemPrompt: workbookPrompt,
    userText: '识别这张作业图片中的所有题目和学生答案。',
    temperature: 0.3,
    maxTokens: 4096
  })

  await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 60 })

  if (!content) {
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
      error: 'AI 识别返回为空', errorType: 'AI_EMPTY'
    })
    throw new Error('AI 识别返回为空')
  }

  // 解析 JSON
  let questions = []
  try {
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      content.match(/```\n?([\s\S]*?)\n?```/) ||
                      content.match(/\[[\s\S]*\]/)
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content
    questions = JSON.parse(jsonStr)
    if (!Array.isArray(questions)) questions = [questions]
  } catch (e) {
    console.error(`   [Workbook] JSON 解析失败:`, e.message)
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
      error: 'AI 识别结果解析失败', errorType: 'JSON_PARSE_ERROR'
    })
    throw new Error('JSON 解析失败')
  }

  console.log(`   [Workbook] AI 识别到 ${questions.length} 道题`)

  // 5. 查找标准答案并判定
  let wrongCount = 0
  let matchedCount = 0
  for (const q of questions) {
    if (!q.question_number) continue

    const answerRow = await lookupWorksheetAnswer(worksheetId, q.question_number)
    if (answerRow) {
      q.answer = answerRow.answer
      q.answer_source = 'worksheet'
      q.question_type = answerRow.answer_type || q.question_type || 'choice'
      matchedCount++

      if (q.student_answer && q.student_answer !== 'null') {
        const judgment = judgeAnswer(q.student_answer, q.answer, q.question_type)
        q.is_correct = judgment.isCorrect
        if (q.is_correct === false) wrongCount++
      } else {
        q.is_correct = null // 未作答
      }
      console.log(`   [Workbook] 题 ${q.question_number}: 学生="${q.student_answer}" 标准="${q.answer}" → ${q.is_correct === true ? '正确' : q.is_correct === false ? '错误' : '待人工'}`)
    } else {
      console.log(`   [Workbook] 题 ${q.question_number}: 答案库无匹配，标记待人工`)
      q.is_correct = null
    }
  }
  console.log(`   [Workbook] 答案匹配: ${matchedCount}/${questions.length} 题, 错误: ${wrongCount} 题`)

  await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 80 })

  // 6. 保存到数据库（复用现有 createQuestions）
  const questionsWithStudentId = questions.map(q => ({
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
    image_url: imageUrl,
    source_type: 'workbook'
  }))

  await createQuestions(questionsWithStudentId)

  // 7. 同步错题本（错误的写入）
  const wrongQuestionIds = questions
    .filter(q => q.is_correct === false && q.question_number)
    .map(q => q.question_number)
  if (wrongQuestionIds.length > 0) {
    const questionMap = {}
    questionsWithStudentId.forEach(q => {
      if (q.is_correct === false) {
        questionMap[q.question_number] = q
      }
    })
    // 需要查询实际 question_id（临时用 question_number 关联）
    const { rows: dbQuestions } = await query(
      `SELECT id, question_number FROM ${TABLES.QUESTIONS} WHERE task_id = $1`,
      [taskId]
    )
    const wrongIds = dbQuestions
      .filter(dq => wrongQuestionIds.includes(dq.question_number))
      .map(dq => dq.id)

    if (wrongIds.length > 0) {
      await addWrongQuestions(studentId, wrongIds, null, null)
      console.log(`   [Workbook] 已添加 ${wrongIds.length} 题到错题本`)
    }
  }

  // 8. 记录 judgement
  for (const q of questionsWithStudentId) {
    if (q.answer && q.student_answer) {
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

  // 9. 完成
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  await updateTaskStatus(taskId, TASK_STATUS.DONE, {
    progress: 100,
    stats: {
      questionCount: questions.length,
      wrongCount,
      matchedCount,
      duration: `${duration}s`,
      source: 'workbook'
    }
  })

  console.log(`✅ [Workbook] 完成: ${questions.length} 题, ${wrongCount} 错, 耗时 ${duration}s`)
}

export const processTask = async (job) => {
  const { taskId, studentId, imageUrl: rawImageUrl, originalName } = job.data
  const startTime = Date.now()

  // ── 路由字段兜底：恢复链路重新入队的 job 可能缺 taskType/worksheetId/generatedExamId，
  // 从 tasks 行回读，防止 workbook/错题重练任务被静默降级为完整 AI 管线 ──
  if ((job.data.taskType === undefined || (job.data.taskType === 'workbook' && !job.data.worksheetId)) && taskId) {
    try {
      const { rows } = await query(
        `SELECT task_type, worksheet_id, generated_exam_id FROM ${TABLES.TASKS} WHERE id = $1`,
        [taskId]
      )
      if (rows[0]) {
        job.data.taskType = rows[0].task_type || 'general'
        if (!job.data.worksheetId) job.data.worksheetId = rows[0].worksheet_id || null
        if (!job.data.generatedExamId) job.data.generatedExamId = rows[0].generated_exam_id || null
      }
    } catch (e) {
      console.error(`⚠️ 路由字段回读失败 taskId=${taskId}:`, e.message)
    }
  }
  // 兜底后仍缺 worksheetId 的 workbook 任务：显式告警（将降级为 general 管线）
  if (job.data.taskType === 'workbook' && !job.data.worksheetId) {
    console.error(`⚠️ [路由] workbook 任务缺少 worksheetId，降级为 general 管线 taskId=${taskId}`)
  }
  const generatedExamId = job.data.generatedExamId

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
    console.error(`   堆栈: ${error.stack}`)
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

    throw error
  }
}
