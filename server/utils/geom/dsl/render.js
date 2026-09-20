/**
 * DSL 通道的渲染与「对照图」合成。
 *
 * 两件事：
 *   1. 结构 → SVG（直接复用 renderGeometrySvg，不另写渲染器）
 *   2. 把「原题裁片」与「我们画出来的图」**并排拼成一张图**，
 *      供 ReAct 视觉闭环一次性看两张图。
 *
 * 为什么要拼成一张而不是发两张图：视觉调用网关（config/ai.js 的
 * buildVisionMessages）只支持单图。拼图是这里唯一不需要改公共链路的做法，
 * 而且顺带把"左原图 / 右重绘"的位置约定写死进 prompt，模型不容易看反。
 */

import sharp from 'sharp'
import { renderGeometrySvg } from '../../geometrySvg.js'

/** 对照图每侧的宽度（高按比例）。太小模型看不清字，太贵又没必要 */
const PANEL_W = 640
const LABEL_H = 28

/**
 * 结构 → SVG 字符串。结构画不出东西时返回 null（与既有调用方语义一致）。
 */
export function renderDslToSvg(structure) {
  if (!structure) return null
  try {
    return renderGeometrySvg(structure)
  } catch {
    return null
  }
}

/** SVG 字符串 → PNG buffer（sharp 栅格化）。失败返回 null */
export async function rasterizeSvg(svg, width = PANEL_W) {
  if (!svg) return null
  try {
    return await sharp(Buffer.from(svg)).resize({ width, fit: 'inside' }).png().toBuffer()
  } catch {
    return null
  }
}

/** 把一个 buffer 缩放到指定宽度（保持比例），并给个白底 */
async function fitPanel(buf, width) {
  if (!buf) return null
  try {
    return await sharp(buf).resize({ width, fit: 'inside', withoutEnlargement: false })
      .flatten({ background: '#ffffff' }).png().toBuffer()
  } catch {
    return null
  }
}

async function meta(buf) {
  try { return await sharp(buf).metadata() } catch { return null }
}

/**
 * 并排合成对照图：左=原题裁片，右=DSL 重绘。
 * 两侧都缩放到 PANEL_W 宽，按较高的一侧对齐，顶部留出文字标签条。
 *
 * @param {Buffer|null} originalBuf 原题裁片（可能为 null，此时只放右图）
 * @param {Buffer|null} renderBuf DSL 重绘 PNG
 * @returns {Promise<Buffer|null>}
 */
export async function composeComparison(originalBuf, renderBuf) {
  const left = await fitPanel(originalBuf, PANEL_W)
  const right = await fitPanel(renderBuf, PANEL_W)
  if (!left && !right) return null

  const lm = left ? await meta(left) : null
  const rm = right ? await meta(right) : null
  const leftW = lm?.width || 0
  const rightW = rm?.width || 0
  const bodyH = Math.max(lm?.height || 0, rm?.height || 0, 120)
  const W = Math.max(leftW + rightW, PANEL_W) + 24
  const H = bodyH + LABEL_H + 24

  const comps = []
  let x = 12
  if (left) {
    comps.push({ input: left, left: x, top: LABEL_H })
    x += leftW + 12
  }
  if (right) comps.push({ input: right, left: x, top: LABEL_H })

  const svgLabel = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${LABEL_H}">
    <rect width="${W}" height="${LABEL_H}" fill="#ffffff"/>
    <text x="12" y="19" font-family="sans-serif" font-size="14" fill="#c00">左：原题裁片</text>
    <text x="${left ? leftW + 24 : 12}" y="19" font-family="sans-serif" font-size="14" fill="#0a7">右：按 DSL 重绘</text>
  </svg>`

  try {
    return await sharp({
      create: { width: W, height: H, channels: 3, background: '#ffffff' }
    }).composite([
      { input: Buffer.from(svgLabel), left: 0, top: 0 },
      ...comps
    ]).png().toBuffer()
  } catch {
    return null
  }
}

/** PNG buffer → data URL（供视觉调用） */
export const toDataUrl = (buf) => (buf ? `data:image/png;base64,${buf.toString('base64')}` : null)
