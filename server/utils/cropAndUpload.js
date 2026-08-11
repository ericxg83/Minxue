import sharp from 'sharp'
import axios from 'axios'
import { uploadImage } from '../services/ossService.js'

/**
 * 下载图片
 */
async function downloadImage(imageUrl) {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30000
  })
  return Buffer.from(response.data)
}

/**
 * 解析 block coordinates，兼容对象与数组两种形式：
 *   {x, y, width, height} | {x, y, w, h} | [x, y, width, height]
 * 解析失败返回 null。
 */
function parseBox(coords) {
  if (!coords) return null
  if (Array.isArray(coords)) {
    if (coords.length < 4) return null
    const [x, y, width, height] = coords.map(v => Number(v))
    if (![x, y, width, height].every(v => Number.isFinite(v))) return null
    return { x, y, width, height }
  }
  if (typeof coords === 'object') {
    const x = Number(coords.x)
    const y = Number(coords.y)
    const width = Number(coords.width ?? coords.w)
    const height = Number(coords.height ?? coords.h)
    if (![x, y, width, height].every(v => Number.isFinite(v))) return null
    return { x, y, width, height }
  }
  return null
}

/**
 * 坐标可信度校验：
 *  - AI 约定 0-1000 归一化整数；任一数值越界（>1000 或 <0）说明模型实际给了
 *    像素坐标或发生了幻觉，裁剪框会指到错误区域 → 不可信。
 *  - 空框/负宽高等属退化框 → 不可信。
 * 注意：x/y 越界但宽高仍有效时（如 x=1000,width=50 的贴边条），交给
 * clamp + 墨迹校验兜底，不在此一棍子打死。
 */
function isUnreliableBox(box) {
  if (!box) return true
  const { x, y, width, height } = box
  // x/y 必须落在 0-1000 归一化区间；越过 1000 多为像素坐标（高分辨率照片），
  // 裁剪会整体偏移到页面右侧/下方 → 直接判不可信，回退整页。
  if (x < -1 || x > 1001 || y < -1 || y > 1001) return true
  if (!(width >= 1) || !(height >= 1)) return true
  // 宽高本身不应超过 1000（归一化上界），超过同样可疑。
  if (width > 1001 || height > 1001) return true
  return false
}

/**
 * 判断裁剪区域是否接近空白（AI 定位框指向无内容区域时会出现）。
 * 采用「快速灰度统计 + 抽样暗像素计数」两级判定，避免误杀纯白边距。
 */
async function isNearlyBlank(imageBuffer, opts = {}) {
  const { darkThreshold = 200, minDarkRatio = 0.0015 } = opts
  try {
    const stats = await sharp(imageBuffer).grayscale().stats()
    const ch = stats.channels[0]
    // 纸面空白：整体极亮且几乎无波动
    if (ch.min >= 230 && ch.stdev < 6) return true
    if (ch.mean > 251 && ch.stdev < 4) return true

    // 精确判定：抽样统计暗像素占比
    const { data, info } = await sharp(imageBuffer).grayscale().raw().toBuffer({ resolveWithObject: true })
    const total = info.width * info.height
    if (!total) return true
    const step = Math.max(1, Math.floor(total / 120000)) // 大图跳采提速
    let dark = 0
    let sampled = 0
    for (let i = 0; i < data.length; i += step) {
      sampled++
      if (data[i] < darkThreshold) dark++
    }
    return sampled > 0 && dark / sampled < minDarkRatio
  } catch (e) {
    console.warn(`  ⚠️ [cropAndUpload] 空白校验失败（按“非空白”处理）: ${e.message}`)
    return false
  }
}

/**
 * 将 0-1000 归一化坐标转换为像素坐标
 */
function denormalizeBbox(bbox, imgW, imgH) {
  if (!bbox || typeof bbox !== 'object') return bbox
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0)
  const clamp = (v) => Math.max(0, Math.min(1000, n(v)))
  return {
    x: Math.round(clamp(bbox.x) / 1000 * imgW),
    y: Math.round(clamp(bbox.y) / 1000 * imgH),
    width: Math.round(clamp(bbox.width) / 1000 * imgW),
    height: Math.round(clamp(bbox.height) / 1000 * imgH),
  }
}

/**
 * 从学生作业图片裁剪错题区域并上传到 OSS。
 *
 * 健壮性保证（修复“截图里没有这道题”）：
 *  1. 坐标缺失 / 非 0-1000 归一化 / 退化框 → 直接回退整页图片（必含题目）。
 *  2. 内边距加大到 50%（≥24px），吸收 AI 定位偏移。
 *  3. 裁剪后做墨迹校验：接近空白说明 AI 框到了无内容区域 → 整页兜底。
 *  4. 只要 pageImageUrl 有效，任何一步失败都不会返回 null，保证错题必带有效配图。
 *
 * @param {string} pageImageUrl - 原始页面图片 URL
 * @param {object|Array} blockCoords - 归一化 0-1000 坐标 {x, y, width, height}（或数组）
 * @param {string} studentId - 学生 UUID
 * @param {string} questionId - 题目唯一标识（用于文件名）
 * @returns {Promise<string|null>} 裁剪图片 OSS URL；失败回退整页 URL，仅在无页面图片时返回 null
 */
export async function cropAndUploadQuestionRegion(pageImageUrl, blockCoords, studentId, questionId) {
  if (!pageImageUrl) return null

  let imageBuffer
  try {
    imageBuffer = await downloadImage(pageImageUrl)
  } catch (e) {
    console.warn(`  ⚠️ [cropAndUpload] 图片下载失败: ${e.message}`)
    return null
  }

  let meta
  try {
    meta = await sharp(imageBuffer).metadata()
  } catch (e) {
    console.warn(`  ⚠️ [cropAndUpload] 获取图片尺寸失败: ${e.message}`)
    return null
  }

  const imgW = meta.width
  const imgH = meta.height
  if (!imgW || !imgH) return null

  // ── 1. 解析 + 校验坐标，异常直接整页兜底 ──
  const box = parseBox(blockCoords)
  const useFullPage = !box || isUnreliableBox(box)
  if (!box) {
    console.warn(`  ⚠️ [cropAndUpload] 无有效坐标(${JSON.stringify(blockCoords)})，回退整页图片`)
  } else if (useFullPage) {
    console.warn(`  ⚠️ [cropAndUpload] 坐标异常(${JSON.stringify(blockCoords)})，回退整页图片`)
  }

  let left, top, width, height
  if (useFullPage) {
    left = 0
    top = 0
    width = imgW
    height = imgH
  } else {
    // 反归一化：0-1000 → 像素坐标
    const pixelBbox = denormalizeBbox(box, imgW, imgH)
    let x = Math.max(0, pixelBbox.x)
    let y = Math.max(0, pixelBbox.y)
    let w = Math.min(pixelBbox.width, imgW - x)
    let h = Math.min(pixelBbox.height, imgH - y)
    if (w <= 0 || h <= 0) {
      console.warn(`  ⚠️ [cropAndUpload] 裁剪框越界退化，回退整页图片`)
      left = 0; top = 0; width = imgW; height = imgH
    } else {
      // 50% 内边距（≥24px），吸收 AI 定位偏移——宁可多截相邻题，也不能截不到本题
      const padX = Math.max(Math.round(w * 0.5), 24)
      const padY = Math.max(Math.round(h * 0.5), 24)
      const paddedLeft = Math.max(0, x - padX)
      const paddedTop = Math.max(0, y - padY)
      const paddedWidth = Math.min(w + padX * 2, imgW - paddedLeft)
      const paddedHeight = Math.min(h + padY * 2, imgH - paddedTop)
      if (paddedWidth <= 0 || paddedHeight <= 0) {
        left = 0; top = 0; width = imgW; height = imgH
      } else {
        left = paddedLeft
        top = paddedTop
        width = paddedWidth
        height = paddedHeight
      }
    }
  }

  // ── 2. 裁剪 ──
  let cropped
  try {
    cropped = await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .jpeg({ quality: 85 })
      .toBuffer()
  } catch (e) {
    console.warn(`  ⚠️ [cropAndUpload] 裁剪失败: ${e.message}，回退整页图片`)
    return pageImageUrl
  }

  // ── 3. 墨迹校验：AI 框到无内容区域 → 整页兜底 ──
  if (!useFullPage && await isNearlyBlank(cropped)) {
    console.warn(`  ⚠️ [cropAndUpload] 裁剪区域接近空白（AI 定位框偏移），回退整页图片`)
    return pageImageUrl
  }

  // ── 4. 上传 ──
  try {
    const fileName = `wrong_${studentId}_${questionId}.jpg`
    const ossUrl = await uploadImage(cropped, fileName, studentId)
    return ossUrl
  } catch (e) {
    console.warn(`  ⚠️ [cropAndUpload] 上传失败: ${e.message}，回退整页图片`)
    return pageImageUrl
  }
}