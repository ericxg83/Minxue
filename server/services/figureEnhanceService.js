/**
 * 配图展示增强管线（纯 sharp，零外部依赖）
 *
 * 目标：让原卷裁剪配图在屏幕/投影上"看起来清晰"。
 * 输入：已经上传的原裁片 URL / buffer（questions.geometry_image_url）
 * 输出：增强后的 PNG buffer / 上传后的 OSS URL（写 questions.clean_geometry_image_url）
 *
 * 与 worker 里 cleanGeometryCrop 的区别：
 *  - cleanGeometryCrop 是识别/入库前的净化（去灰底、浅笔迹、纠偏），输出仍是"裁剪原图"语义；
 *  - 本管线是展示层增强，面向"老师看到的观感"：去网点噪声、拉对比、锐化、裁白边。
 *
 * ⚠️ 实现纪律（2026-09-18 实测踩坑）：
 *  - 全程用 sharp 高层 API 链式 pipeline，**禁止 raw buffer 中转重建**——
 *    实测 raw().toBuffer({resolveWithObject}) 的 info.channels 与 data 长度
 *    在 grayscale/median 后不一致，重建会得到"内存区过小"或错乱图像。
 *  - trim 后加"内容包围盒保护"：面积骤减(过裁)时回退未 trim 版本，宁可留白边不可丢内容。
 *
 * @module figureEnhanceService
 */

import sharp from 'sharp'
import { uploadImage } from './ossService.js'

/**
 * 像素级增强主函数（v3：全程高层 API pipeline）。
 *
 * @param {Buffer} input - 原裁片 buffer（PNG/JPG 均可）
 * @param {Object} [opts]
 * @param {number} [opts.minShortEdge=0] - 短边小于该值则 lanczos3 放大（超分兜底）
 * @param {number} [opts.linearA=1.3] - 对比度斜率
 * @param {number} [opts.linearB=-30] - 亮度偏移
 * @returns {Promise<Buffer>} 增强后 PNG buffer（失败返回原 buffer）
 */
export async function enhanceFigureBuffer(input, opts = {}) {
  const { minShortEdge = 0, linearA = 1.3, linearB = -30 } = opts
  try {
    const meta = await sharp(input).metadata()
    const w0 = meta.width || 0
    const h0 = meta.height || 0
    if (!w0 || !h0) return input

    // 1) 基础增强 pipeline：去噪 → 对比拉伸 → 线性对比度 → 锐化
    let pipeline = sharp(input)
      .grayscale()
      .median(3)                      // 去扫描网点/椒盐（保边，比 blur 安全）
      .normalize()                    // 直方图拉伸，拉开灰底与线条的对比
      .linear(linearA, linearB)       // 拉对比：线条更黑、灰底更白
      .sharpen({ sigma: 1.2, m1: 1.0, m2: 1.4 })

    // 2) 超分兜底：短边 < minShortEdge → lanczos3 放大
    if (minShortEdge > 0 && Math.min(w0, h0) < minShortEdge) {
      const scale = minShortEdge / Math.min(w0, h0)
      const nw = Math.min(2400, Math.round(w0 * scale))
      const nh = Math.min(2400, Math.round(h0 * scale))
      pipeline = pipeline.resize(nw, nh, { kernel: 'lanczos3' })
    }

    // 3) trim 去白边 + 内容保护：trim 后面积 < 原 25% → 过裁，回退未 trim 版本
    const trimmed = await pipeline.clone().trim({ threshold: 20 }).png().toBuffer({ resolveWithObject: true })
    const w1 = trimmed.info.width
    const h1 = trimmed.info.height
    if (w1 && h1 && (w1 * h1) >= (w0 * h0) * 0.25) {
      return trimmed.data
    }
    // 过裁回退：整链重跑（不 trim）
    const plain = await pipeline.png().toBuffer()
    return plain
  } catch (error) {
    console.warn(`   ⚠️ [配图增强] 失败，返回原图继续: ${error.message}`)
    return input
  }
}

/**
 * 从 OSS 下载 → 增强 → 上传，返回新的 OSS URL。
 * 失败返回 null（调用方回退原裁片）。
 *
 * @param {string} srcUrl 原裁片 URL
 * @param {string} studentId
 * @param {string} questionId
 * @param {Object} [opts] 透传 enhanceFigureBuffer
 * @returns {Promise<string|null>}
 */
export async function enhanceAndUploadFigure(srcUrl, studentId, questionId, opts = {}) {
  try {
    if (!srcUrl) return null
    const resp = await fetch(srcUrl)
    if (!resp.ok) {
      console.warn(`   ⚠️ [配图增强] 下载失败 ${resp.status}: ${srcUrl.slice(0, 90)}`)
      return null
    }
    const buf = Buffer.from(await resp.arrayBuffer())
    const enhanced = await enhanceFigureBuffer(buf, opts)
    if (!enhanced || enhanced.length === buf.length) return null
    const fileName = `enhanced_${studentId}_${questionId}.png`
    return await uploadImage(enhanced, fileName, studentId)
  } catch (error) {
    console.warn(`   ⚠️ [配图增强] 上传失败: ${error.message}`)
    return null
  }
}

export default { enhanceFigureBuffer, enhanceAndUploadFigure }