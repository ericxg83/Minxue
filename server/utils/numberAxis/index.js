/**
 * 数轴确定性渲染通道 —— 对外唯一入口（2026-09-26 P2-7 程序化图元）。
 *
 * 与 functionGraph 通道同构：`题干文本 → parseSpec（不猜，解析不出返回 null）→
 * buildStructure（服务端精确布局）→ 调用方注入的 renderGeometrySvg 渲染`。
 * 零视觉调用、坐标零目测；出不了图调用方回退原卷裁片/描摹，绝不硬画。
 *
 * 安全原则：
 *   1. 题干含本通道画不出来的构造（三角形/圆/中点/其它几何文字）→ null。
 *      残缺的图不如原卷裁片（与 functionGraph 的纯度闸同一口径）。
 *   2. 生成的结构必须被 `detectNumberAxis` 识别为数轴，否则 null ——
 *      识别不到意味着渲染器不走刻度吸附/标签摆位通道，画出来是歪图。
 *
 * @module utils/numberAxis
 */

import { parseNumberAxisSpec, specToNumberAxisStructure } from './parseSpec.js'
import { normalizeStructure, detectNumberAxis } from '../geom/structure.js'
import { hasOtherGeometry } from '../functionGraph/index.js'

export { parseNumberAxisSpec, specToNumberAxisStructure, parseAxisNumber } from './parseSpec.js'

/**
 * 一步到位：题干 → 数轴 SVG。
 *
 * @param {string} parentStem 多小问大题公共题干
 * @param {string} content 子题正文
 * @param {Function} render renderGeometrySvg（注入，避免循环依赖，同 functionGraph）
 * @returns {{ svg: string, structure: object, spec: object }|null}
 */
export function buildNumberAxisSvg(parentStem, content, render) {
  const text = [String(parentStem ?? ''), String(content ?? '')].join('\n')
  if (!/数轴/.test(text)) return null
  if (hasOtherGeometry(text)) return null
  const spec = parseNumberAxisSpec(text)
  if (!spec) return null
  const raw = specToNumberAxisStructure(spec)
  if (!raw) return null
  const structure = normalizeStructure(raw)
  const axis = detectNumberAxis(structure.points, structure.segments, {
    coordinateSystem: !!structure.coordinate_system?.exists,
  })
  if (!axis) return null
  const svg = typeof render === 'function' ? render(structure) : null
  if (!svg) return null
  return { svg, structure, spec }
}
