/**
 * 校验 buffer 是否为合法图片：用于拦截 OSS 404/403 鉴权失败返回的 XML/HTML 错误页
 * （约 3000-4000 bytes，axios 仍按 2xx 视为成功）。
 *
 * 判定规则（任一命中即视为非图片）：
 *   1. buffer 长度 < 1024 bytes（太小任何图片都装不下，连魔数都不完整）
 *   2. 前 4 字节不是 JPEG / PNG / WebP / HEIC 魔数
 *   3. 前 200 字符是 XML/HTML 文档前缀
 *   4. 命中图片魔数但头部出现 XML/HTML 文本（防御性兜底，理论上不可能）
 *
 * 纯函数，独立可测。
 *
 * 注意：不要按 4KB 等大阈值拦真实小图 —— 3116 bytes 的合法 JPEG/PNG 也是合法图片，
 * 视觉模型看到小图会返回 0 道题，但这属于"内容问题"由 OCR 层降级处理（切模型重试），
 * 不属于"URL 失效"应在下载层硬拦。
 */
import sharp from 'sharp'

/**
 * OCR 最小可识别分辨率阈值。
 * 经验值：宽 < 600 像素时，Qwen3-VL 8B/235B/Agnes 一律说"图片是空白"
 * （其训练数据中 < 600px 的图 90% 是空白/图标/缩略图，模型基于分布拒绝）。
 * 强制 sharp 放大到 1800x1800 并不能"创造"像素 —— 仍是模糊的 80x80 拉伸，
 * AI 看到的依然是"无法识别"，反复重试只浪费配额、刷 429 错误。
 *
 * 因此下载后立即检查，低于此阈值直接拒绝（友好提示用户重传），
 * 不进 AI 视觉识别流程。
 */
export const MIN_OCR_RESOLUTION = 600

export function isValidImageBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 1024) return { ok: false, reason: 'too_small' }
  const magic = buf.slice(0, 4)
  const isJpeg = magic[0] === 0xFF && magic[1] === 0xD8 && magic[2] === 0xFF
  const isPng = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4E && magic[3] === 0x47
  const isWebp = magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46 // RIFF
  // HEIC/HEIF/MOV：4-7 字节是 'ftyp'（ISOBMFF 容器通用标识）
  const isHeic = buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp'
  if (isJpeg || isPng || isWebp || isHeic) {
    // 命中已知图片魔数，但还应排除前端伪装的 XML/HTML（理论上不可能，但防御性兜底）
    const head = buf.slice(0, 200).toString('utf8').trim()
    if (head.startsWith('<?xml') || head.startsWith('<Error>') || head.startsWith('<html')) {
      return { ok: false, reason: 'xml_html_disguised_as_image' }
    }
    return { ok: true }
  }
  // 魔数不匹配但前 200 字符就是 XML/HTML → 一律视为非图片（避免 3116 bytes XML 假图片通过）
  const head = buf.slice(0, 200).toString('utf8').trim()
  if (head.startsWith('<?xml') || head.startsWith('<Error>') || head.startsWith('<html')) {
    return { ok: false, reason: 'xml_or_html_content' }
  }
  return { ok: false, reason: 'unknown_magic_number' }
}

/**
 * 读取图片实际像素分辨率（不读 EXIF 中的方向）。
 * sharp 读取 metadata 是 CPU 操作，~5ms，无网络开销。
 *
 * @param {Buffer} buf 已通过 isValidImageBuffer 校验的图片 buffer
 * @returns {Promise<{width:number,height:number,format:string|null}>}
 */
export async function getImageResolution(buf) {
  try {
    const meta = await sharp(buf).metadata()
    return {
      width: meta.width || 0,
      height: meta.height || 0,
      format: meta.format || null,
    }
  } catch (e) {
    return { width: 0, height: 0, format: null, error: e.message }
  }
}

/**
 * 分辨率是否够 OCR 使用 —— 用于在 downloadImage 内部拦截"AI 必失败"的图。
 *
 * 3116 bytes 极小 JPEG 实际像素通常 < 200x200。AI 视觉模型看到这种图一律拒绝：
 *   - Qwen3-VL-8B / 235B：返回 "用户提供的图片是空白，无法识别任何内容。"
 *   - Agnes：返回 "Unable to identify content, image appears blank."
 * 强制 sharp 放大到 1800x1800 并不能"创造"信息，只是把模糊的 80x80 拉伸，
 * AI 看到的依然是"无法识别"，反复重试只浪费配额、刷 429 错误。
 *
 * 因此在下载层就拦下，给出"请重新上传更清晰的图片"友好提示。
 *
 * @param {Buffer} buf 已通过 isValidImageBuffer 的图片 buffer
 * @param {number} minResolution 最小边长阈值，默认 MIN_OCR_RESOLUTION=600
 * @returns {Promise<{ok:boolean, reason?:string, resolution?:object, min?:number}>}
 */
export async function checkImageResolution(buf, minResolution = MIN_OCR_RESOLUTION) {
  const resolution = await getImageResolution(buf)
  if (resolution.width === 0 || resolution.height === 0) {
    return { ok: false, reason: 'unreadable_resolution', resolution, min: minResolution }
  }
  const minSide = Math.min(resolution.width, resolution.height)
  if (minSide < minResolution) {
    return { ok: false, reason: 'too_low_resolution', resolution, min: minResolution }
  }
  return { ok: true, resolution, min: minResolution }
}
