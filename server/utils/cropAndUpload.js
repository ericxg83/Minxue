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
 * 从学生作业图片裁剪错题区域并上传到 OSS
 *
 * @param {string} pageImageUrl - 原始页面图片 URL
 * @param {object} blockCoords - 归一化 0-1000 坐标 {x, y, width, height}
 * @param {string} studentId - 学生 UUID
 * @param {string} questionId - 题目唯一标识（用于文件名）
 * @returns {Promise<string|null>} 裁剪图片 OSS URL，失败返回 null
 */
export async function cropAndUploadQuestionRegion(pageImageUrl, blockCoords, studentId, questionId) {
  if (!pageImageUrl || !blockCoords) return null

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

  // 反归一化：0-1000 → 像素坐标
  const pixelBbox = denormalizeBbox(blockCoords, imgW, imgH)

  // 钳位到图片边界
  const left = Math.max(0, pixelBbox.x)
  const top = Math.max(0, pixelBbox.y)
  let width = Math.min(pixelBbox.width, imgW - left)
  let height = Math.min(pixelBbox.height, imgH - top)
  if (width <= 0 || height <= 0) return null

  // 20% 内边距（与几何裁剪逻辑一致）
  const padX = Math.round(width * 0.20)
  const padY = Math.round(height * 0.20)
  const paddedLeft = Math.max(0, left - padX)
  const paddedTop = Math.max(0, top - padY)
  const paddedWidth = Math.min(width + padX * 2, imgW - paddedLeft)
  const paddedHeight = Math.min(height + padY * 2, imgH - paddedTop)

  if (paddedWidth <= 0 || paddedHeight <= 0) return null

  let cropped
  try {
    cropped = await sharp(imageBuffer)
      .extract({ left: paddedLeft, top: paddedTop, width: paddedWidth, height: paddedHeight })
      .jpeg({ quality: 85 })
      .toBuffer()
  } catch (e) {
    console.warn(`  ⚠️ [cropAndUpload] 裁剪失败: ${e.message}`)
    return null
  }

  try {
    const fileName = `wrong_${studentId}_${questionId}.jpg`
    const ossUrl = await uploadImage(cropped, fileName, studentId)
    return ossUrl
  } catch (e) {
    console.warn(`  ⚠️ [cropAndUpload] 上传失败: ${e.message}`)
    return null
  }
}