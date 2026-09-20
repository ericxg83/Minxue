/**
 * 给页图叠加归一化刻度（供视觉模型「读刻度」定位，而不是凭感觉估）。
 * 刻度线画成浅红虚线 + 左/右边缘的数字标注，尽量不遮住正文黑字。
 */
import sharp from 'sharp'

/**
 * @param {Buffer} imageBuffer 原图
 * @param {Object} [opts]
 * @param {number} [opts.width] 输出宽度（内部降采样）
 * @param {number} [opts.minorStep] 细线间隔（归一化单位）
 * @param {number} [opts.majorStep] 粗线间隔（带数字）
 * @returns {Promise<Buffer>} JPEG
 */
export async function renderRuledImage (imageBuffer, opts = {}) {
  const width = opts.width || 1000
  const minor = opts.minorStep || 50
  const major = opts.majorStep || 100

  const base = sharp(imageBuffer).resize({ width, fit: 'inside' }).jpeg({ quality: 82 })
  const meta = await sharp(await base.toBuffer()).metadata()
  const W = meta.width
  const H = meta.height

  const parts = []
  for (let v = 0; v <= 1000; v += minor) {
    const y = Math.round(v / 1000 * H)
    const isMajor = v % major === 0
    parts.push(
      `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${isMajor ? '#e04040' : '#f0a0a0'}" stroke-width="${isMajor ? 1.4 : 1}" stroke-dasharray="${isMajor ? '10 6' : '5 7'}" opacity="${isMajor ? 0.75 : 0.5}"/>`
    )
    if (isMajor) {
      parts.push(`<rect x="0" y="${y - 8}" width="46" height="16" fill="#ffffff" opacity="0.85"/>`)
      parts.push(`<text x="3" y="${y + 5}" font-family="monospace" font-size="13" font-weight="700" fill="#c00000">${v}</text>`)
      parts.push(`<rect x="${W - 46}" y="${y - 8}" width="46" height="16" fill="#ffffff" opacity="0.85"/>`)
      parts.push(`<text x="${W - 43}" y="${y + 5}" font-family="monospace" font-size="13" font-weight="700" fill="#c00000">${v}</text>`)
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`

  return sharp(await base.toBuffer())
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 82 })
    .toBuffer()
}
