/**
 * 函数图象独立渲染通道（确定性，零视觉调用）。
 *
 * 为什么独立成通道：
 *   几何重画管线的渲染器只会画线段/圆/弧/角标记，**画不出曲线**。
 *   实测 42 张被拦下的题里 41 张是"函数图象/抛物线/坐标系"，硬塞进几何管线
 *   只会让视觉模型凭图猜函数，既不可靠又白烧额度。
 *
 *   而函数图象题的函数表达式本来就写在题干里（"抛物线 y=ax²+1(a<0)"），
 *   所以正确做法是：**从题干文本解析图形规格 → 服务端确定性采样 → 复用 SVG 渲染器**。
 *
 * 安全原则（沿用"宁愿少显示，也不显示错误信息"）：
 *   1. 开口方向或顶点位置任一无法确定 → 返回 null，调用方回退展示裁剪原图。
 *      宁可不出图，也不给学生一张形状错误的示意图。
 *   2. 题干里还有别的几何构造（三角形、辅助线、垂线）→ 返回 null。
 *      本通道只会画抛物线，画出来是"残缺的图"，而裁剪原图是完整的，
 *      这时候回退原图严格更好。
 */

import { parseFunctionGraphSpec } from './parseSpec.js'
import { specToGeometryStructure } from './buildStructure.js'

export { parseFunctionGraphSpec } from './parseSpec.js'
export { sampleParabola, xInterceptsOf, computeView, specToGeometryStructure } from './buildStructure.js'

/**
 * 题干里是否存在**本通道画不出来**的其他几何构造。
 *
 * 命中任一项就说明这张配图不只是一条抛物线：可能有三角形、辅助线、
 * 垂线、平行线，而我们只画得出抛物线本体。残缺的图不如不画。
 *
 * 注意 `直线` 要排除 `直线x=2`（对称轴）这种写法，只拦 `直线BC` / `直线l`。
 */
const OTHER_GEOMETRY_RE = new RegExp([
  '△|三角形|正方形|矩形|菱形|梯形|平行四边形|四边形',
  '线段|射线|延长线|切线|割线|中线|高线|角平分线',
  '⊥|∥|//|中点|垂足|垂线|平行于|垂直于',
  '连接|连结|联结|相交于直线',
  '直线\\s*[A-WYZa-wyz]',       // 直线BC / 直线l（不含 直线x=2）
  '作\\s*[A-Z]\\s*[A-Z]',        // 作CD / 作QF
].join('|'))

export function hasOtherGeometry(text) {
  return OTHER_GEOMETRY_RE.test(String(text ?? ''))
}

/**
 * 题干 → 函数图象几何结构。无法确定图形、或题干含其他几何构造时返回 null。
 *
 * @param {string} parentStem - 多小问大题的公共题干
 * @param {string} content - 子题正文
 * @param {{ignorePurity?: boolean}} [opts] - ignorePurity 仅供诊断脚本统计理论覆盖率
 * @returns {object|null} 可直接交给 renderGeometrySvg 的结构，或 null
 */
export function buildFunctionGraphFromStem(parentStem, content, opts = {}) {
  if (!opts.ignorePurity && hasOtherGeometry(`${parentStem ?? ''} ${content ?? ''}`)) return null
  const spec = parseFunctionGraphSpec(parentStem, content)
  if (!spec) return null
  const structure = specToGeometryStructure(spec)
  if (!structure?.curves?.length) return null
  return structure
}

/**
 * 一步到位：题干 → SVG。渲染失败返回 null。
 *
 * @param {string} parentStem
 * @param {string} content
 * @param {Function} render - renderGeometrySvg（由调用方注入，避免循环依赖）
 * @param {{ignorePurity?: boolean}} [opts]
 * @returns {{ svg: string, structure: object, spec: object }|null}
 */
export function buildFunctionGraphSvg(parentStem, content, render, opts = {}) {
  if (!opts.ignorePurity && hasOtherGeometry(`${parentStem ?? ''} ${content ?? ''}`)) return null
  const spec = parseFunctionGraphSpec(parentStem, content)
  if (!spec) return null
  const structure = specToGeometryStructure(spec)
  if (!structure?.curves?.length) return null
  const svg = typeof render === 'function' ? render(structure) : null
  if (!svg) return null
  return { svg, structure, spec }
}
