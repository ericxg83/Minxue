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
import { parseLineParabola, applyLineParabola } from './lineParabola.js'

export { parseFunctionGraphSpec } from './parseSpec.js'
export { sampleParabola, xInterceptsOf, computeView, specToGeometryStructure } from './buildStructure.js'
export { parseLineParabola, applyLineParabola } from './lineParabola.js'

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
  '直线\\s*[A-WYZa-wyz](?![=＝<>≤≥⩾⩽])',  // 直线BC / 直线l（不含 直线x=2 这类对称轴写法）
  '作\\s*[A-Z]\\s*[A-Z]',        // 作CD / 作QF
].join('|'))

export function hasOtherGeometry(text) {
  return OTHER_GEOMETRY_RE.test(String(text ?? ''))
}

/**
 * 题干 → 函数图象几何结构。无法确定图形、或题干含其他几何构造时返回 null。
 *
 * 纯度闸的复合构造例外（2026-09-27，「35条其他」处理）：题干写明
 * 「直线y=kx+b（全数字）与抛物线交于X、Y两点」时，直线/弦/△XY顶点都是
 * **解出来的坐标**，本通道画得全 —— 不再被 hasOtherGeometry 一刀切拦回
 * DSL 目测通道（那里画不出曲线，两头拒之门外 → 长期停留描摹/裁片）。
 * 拼不出完整图（无实根/字母冲突/顶点无名）仍返回 null，旧行为零回归。
 *
 * @param {string} parentStem - 多小问大题的公共题干
 * @param {string} content - 子题正文
 * @param {{ignorePurity?: boolean}} [opts] - ignorePurity 仅供诊断脚本统计理论覆盖率
 * @returns {object|null} 可直接交给 renderGeometrySvg 的结构，或 null
 */
export function buildFunctionGraphFromStem(parentStem, content, opts = {}) {
  return buildFunctionGraphParts(parentStem, content, null, opts)?.structure || null
}

/**
 * 共用内部实现：返回 { svg, structure, spec }（render 缺省时 svg 为 null）。
 * 纯度闸不命中，或命中但复合构造可解析且拼装成功 → 出图；否则 null。
 */
function buildFunctionGraphParts(parentStem, content, render, opts = {}) {
  const text = `${parentStem ?? ''} ${content ?? ''}`
  const impure = !opts.ignorePurity && hasOtherGeometry(text)
  const lp = impure ? parseLineParabola(text) : null
  // 含其它几何构造且不是「直线×抛物线」可解复合 → 照旧拒
  if (impure && !lp) return null
  // 多曲线/平移题拒绝（2026-09-27 目检实锤，「反碟长」b456c04d/0b31b1fa）：配图真身若是
  // **平移后位置只在图里**的曲线，确定性通道只会画出原曲线 = 把特例当通用图示，
  // 比不出图更误导 → 不接。例外：平移后的目标表达式已写明（「得到 y=(x-1)²-2」），
  // 此时从目标句开始解析（原曲线不画），旧能力不回归。
  let parseFrom = `${parentStem ?? ''} ${content ?? ''}`
  // 复合构造证据优先：「直线y=kx+b 交于X、Y两点」句式自带完整几何事实，
  // 题干里顺带提「平移」不改变交点可解性（实证 2c84e156：顶点为C——平移——直线交于A、B）；
  // 只有拿不到复合证据时，平移字样才意味着「配图真身是平移后曲线」→ 走目标式提取/拒绝。
  if (!lp && /平移|翻折|旋转/.test(`${parentStem ?? ''} ${content ?? ''}`)) {
    // tm.index = 「得到/后」在全文的下标；在其后窗口内直接取完整目标式
    // （不能用 tm[0] —— 正则尾部类会把它截成半截表达式）
    const tm = parseFrom.match(new RegExp(`(?:得到|得|变为|后)\s*(?:新|该)?\s*抛物线[^y]{0,14}\s*y\s*=`))
      || parseFrom.match(new RegExp(`平移[^;，。]{0,24}?得到[^;，。]{0,12}?y\s*=`))
    const tail = tm ? parseFrom.slice(tm.index).match(/y\s*=[^，。;；\s][^，。;；]*/) : null
    const target = tail?.[0] || null
    if (!target) return null
    parseFrom = target
  }
  // 平移目标路径（parseFrom 已被收缩成裸表达式 y=…）：只拿目标句；
  // 其余（含复合构造）：全文入参，交点字母在任意一句，表达式由主循环逐候选尝试，
  // 曲线上点一致性校验兼并防拿错曲线。
  const spec = /^y\s*=/.test(parseFrom)
    ? parseFunctionGraphSpec(null, parseFrom)
    : parseFunctionGraphSpec(parentStem, content)
  if (!spec) return null
  // 把直线挂进 spec：computeView 据此把交点/截距纳入视野（否则窗口只容得下
  // 抛物线本体，交点在窗外→拼不回→白白退描摹）。对非复合路径无副作用。
  if (lp) spec.line = { k: lp.k, b: lp.b }
  let structure = specToGeometryStructure(spec)
  if (!structure?.curves?.length) return null
  if (impure) {
    structure = applyLineParabola(structure, spec, lp)
    if (!structure) return null // 复合构造拼不出完整图 → 回退原行为
  }
  const svg = typeof render === 'function' ? render(structure) : null
  if (typeof render === 'function' && !svg) return null
  return { svg, structure, spec }
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
  return buildFunctionGraphParts(parentStem, content, render, opts)
}
