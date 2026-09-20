/**
 * 干净几何 SVG → 图片 URL 发布通道。
 * ================================================================
 * 解决一个**字段断点**：
 *   · 几何重画成功后写 questions.clean_geometry_svg（SVG 源码）
 *   · 但周末课件 / 讲义取图走 questions.clean_geometry_image_url（图片 URL）
 *     —— lib/weekendHandout.js 的 resolveFigure()，weekendPptxService.fetchFigures() 也按 URL 下载
 * 两个字段不通，重画质量再高，课件那边读到的仍是空值（实测 15 题有 SVG、0 题有 URL）。
 *
 * 本模块负责把已入库的 SVG 栅格化成 PNG → 上传 OSS → 回写 clean_geometry_image_url，
 * 让重画产物对下游可见。
 *
 * 设计约束：
 *   1. **不改 worker 调用链**：本模块自己栅格化上传，不 import worker.js
 *      （worker.js 是主 OCR 管线，import 它会把整条管线拖进 geometryWorker 的依赖图）。
 *   2. **失败不致命**：回写失败不能把一次成功的重画判成失败 —— SVG 本身对
 *      「错题本 / 重练卷预览 / PDF 导出」仍是有效的（那些走 display_image_type）。
 *   3. **宁可不出图，也不出空白图**：栅格化后做一次空白判定，全白就不发布，
 *      下游取不到 URL 会回退原题裁片，原图永远是正确的。
 */
import sharp from 'sharp'
import { uploadImage } from '../../services/ossService.js'
import { query, TABLES } from '../../config/neon.js'
import { updateQuestionCleanGeometryUrl } from '../../services/neonService.js'

/**
 * 栅格化目标宽度（像素）。
 *
 * 依据白板实际显示尺寸：配图宽度 `min(calc(680px * var(--s)), 94%)`，
 * 1920 全屏下 --s ≈ 1.24 × 1.34 ≈ 1.66 → 680 × 1.66 ≈ 1129px。
 * 取 1200 刚好覆盖最宽场景，同时文件仅 ~14KB（400×300 的 SVG 放大 3 倍）。
 */
export const CLEAN_FIGURE_TARGET_WIDTH = 1200

/** density 上下限。低于 72 会糊，高于 600 只会白白增大文件 */
const MIN_DENSITY = 72
const MAX_DENSITY = 600

/**
 * 读 SVG 声明的画布尺寸：优先 width/height 属性，退回 viewBox。
 * 两者都没有返回 null（此时按 density=72 原样渲染，不放大也不缩小）。
 */
function readSvgDeclaredSize(svg) {
  const tag = /<svg\b[^>]*>/i.exec(String(svg))
  if (!tag) return null
  const attr = (name) => {
    const m = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag[0])
    if (!m) return null
    const n = parseFloat(m[1])
    return isFinite(n) && n > 0 ? n : null
  }
  const w = attr('width')
  const h = attr('height')
  if (w && h) return { width: w, height: h }

  const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(tag[0])
  if (vb) {
    const nums = vb[1].trim().split(/[\s,]+/).map(Number)
    if (nums.length === 4 && isFinite(nums[2]) && isFinite(nums[3]) && nums[2] > 0 && nums[3] > 0) {
      return { width: nums[2], height: nums[3] }
    }
  }
  return null
}

/**
 * 计算把 SVG 渲染到 targetWidth 宽所需的 density。
 * sharp 以 density=72 时按 SVG 的 CSS 尺寸（= 1 user unit : 1 px）渲染，
 * 故 density = 72 × target / 声明宽度。
 *
 * @returns {number} 落在 [MIN_DENSITY, MAX_DENSITY] 的整数值
 */
export function computeRasterDensity(svg, targetWidth = CLEAN_FIGURE_TARGET_WIDTH) {
  const size = readSvgDeclaredSize(svg)
  if (!size) return MIN_DENSITY
  const raw = Math.round((72 * targetWidth) / size.width)
  return Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, raw))
}

/**
 * SVG → PNG buffer（白底，放大到目标宽度）。
 * @returns {Promise<Buffer|null>} 失败返回 null
 */
export async function rasterizeCleanSvg(svg, { targetWidth = CLEAN_FIGURE_TARGET_WIDTH } = {}) {
  if (!svg || !/<svg/i.test(String(svg))) return null
  try {
    // SVG 自带白色 <rect> 底，这里再 flatten 一次兜住缺底色的历史 SVG
    return await sharp(Buffer.from(svg), { density: computeRasterDensity(svg, targetWidth) })
      .flatten({ background: '#ffffff' })
      .png({ compressionLevel: 9 })
      .toBuffer()
  } catch {
    return null
  }
}

/**
 * 空白图判定：所有颜色通道的标准差都近乎 0 ⇒ 整张图是同一个颜色。
 *
 * 用 stdev 而不是「非白像素占比」，是因为它不需要扫全部 raw 像素，
 * 且判据更严：白底 + 一条黑线也会让 stdev 明显 > 0。
 *
 * 判定失败（抛错）时返回 true（当作空白）——安全方向是**不发布**。
 */
export async function isBlankRaster(buf, { minStdev = 0.5 } = {}) {
  if (!buf) return true
  try {
    const { channels } = await sharp(buf).flatten({ background: '#ffffff' }).stats()
    const colorChannels = channels.slice(0, 3)
    if (colorChannels.length === 0) return true
    return colorChannels.every((c) => !(c.stdev >= minStdev))
  } catch {
    return true
  }
}

/** 取题目的 student_id（OSS 路径需要；student_id 为空时用 'system' 占位） */
async function fetchStudentId(questionId) {
  try {
    const { rows } = await query(
      `SELECT student_id FROM ${TABLES.QUESTIONS} WHERE id = $1 LIMIT 1`,
      [questionId]
    )
    return rows[0]?.student_id || null
  } catch {
    return null
  }
}

/**
 * 把已渲染好的干净几何 SVG 发布成图片 URL 并回写 questions.clean_geometry_image_url。
 *
 * 任一步失败都只返回 { ok:false, reason }，**不抛异常** —— 调用方在主流程里
 * 应当把它当「附加动作」，失败最多打日志，不能影响重画本身的成败判定。
 *
 * @param {object} opts
 * @param {string} opts.questionId
 * @param {string} opts.svg - 干净几何 SVG 源码
 * @param {string} [opts.studentId] - 省略时查库
 * @param {number} [opts.targetWidth]
 * @returns {Promise<{ok:boolean, url?:string, reason?:string, bytes?:number, width?:number, height?:number}>}
 */
export async function publishCleanGeometryUrl({
  questionId,
  svg,
  studentId = null,
  targetWidth = CLEAN_FIGURE_TARGET_WIDTH
} = {}) {
  if (!questionId) return { ok: false, reason: 'no_question_id' }
  if (!svg || !/<svg/i.test(String(svg))) return { ok: false, reason: 'no_svg' }

  try {
    const sid = studentId || (await fetchStudentId(questionId)) || 'system'

    const png = await rasterizeCleanSvg(svg, { targetWidth })
    if (!png) return { ok: false, reason: 'raster_fail' }

    if (await isBlankRaster(png)) return { ok: false, reason: 'blank_raster' }

    const meta = await sharp(png).metadata().catch(() => null)

    const url = await uploadImage(png, `clean_geometry_${sid}_${questionId}.png`, sid)
    if (!url) return { ok: false, reason: 'upload_fail' }

    await updateQuestionCleanGeometryUrl(questionId, url)

    return {
      ok: true,
      url,
      bytes: png.length,
      width: meta?.width || null,
      height: meta?.height || null
    }
  } catch (e) {
    return { ok: false, reason: `error:${e?.message || 'unknown'}` }
  }
}
