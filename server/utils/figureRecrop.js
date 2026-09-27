/**
 * 配图补裁判据（纯函数，零平台依赖）—— 供 figureRecropSweep 与回归测试共用
 *
 * 唯一口径：哪些题属于「有合格配图框却无图」的 N4 可补裁候选。
 * 与 A 阶段诊断（server/scripts/diag-missing-figures-attribution.mjs）的 N1/N4 分界一致：
 *   · 无框（image_bbox 空）→ 属 N1，需视觉重定位（recrop-missing-figures.mjs），本谓词不放行；
 *   · 有 geometry 框 + 引图 + 无图 → 属 N4，可用现有框补裁，本谓词放行。
 * 能否真裁出干净图交给 cropAndUploadGeometryImage 的像素收紧闸（不在此判，避免判据漂移）。
 */
import { hasFigureReference } from './questionCompleteness.js'

const parseJson = (v) => {
  if (v == null) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

/**
 * @param {Object} q 题目行（须带 geometry_image_url / image_bbox / image_type / content / parent_stem）
 * @returns {boolean} true = N4 可补裁候选
 */
export const isCroppableMissingRow = (q) => {
  if (!q || q.geometry_image_url) return false           // 已有配图（含重绘/手补）绝不覆盖
  const bbox = parseJson(q.image_bbox)
  if (!bbox || !bbox.width || !bbox.height) return false // 无框/零尺寸框 → 属 N1
  if (q.image_type !== 'geometry') return false          // 只补几何配图框
  return hasFigureReference(q)                           // 引图判据与完整性闸同源（含 parent_stem）
}

/**
 * 「N5 可继承兄弟配图」谓词（纯函数，供继承清扫与回归测试共用）。
 * 命中：引图题 + 自身无配图 + 自身无有效几何框（有框走 N4 补裁）+ 有公共题干。
 * 同一大题的多个小问共用一张配图（inheritSharedStemFigures 的落库版）：
 * 兄弟小问已裁出 geometry_image_url → 直接复用同一张图，零裁图零模型。
 * 严格限定「同 task + parent_stem 逐字相同 + 同页」（与 OCR 期继承同口径），
 * parent_stem 为空不继承（无公共题干依据，防跨题误并）。
 */
export const isInheritableMissingRow = (q) => {
  if (!q || q.geometry_image_url) return false
  const bbox = parseJson(q.image_bbox)
  if (bbox && bbox.width && bbox.height && q.image_type === 'geometry') return false // 有 own 框→N4
  if (!String(q.parent_stem || '').trim()) return false                              // 无公共题干不继承
  return hasFigureReference(q)
}

export default { isCroppableMissingRow, isInheritableMissingRow }
