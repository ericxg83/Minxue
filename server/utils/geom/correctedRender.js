/**
 * 回灌修正渲染（P5 核心）：用求解后的一致坐标重新生成「题设正确」的几何图。
 *
 * 流程：extractConstraints（题干+结构+模型三路抽约束）→ solveGeometry 求解 →
 *       residualGate 安全闸门 → buildCorrectedStructure 回填坐标 → renderGeometrySvg 重渲。
 *
 * 重要：本模块是纯函数，且严格受安全闸门约束——
 *   仅当「求解收敛 && 解后自洽 && 非退化」时才回灌，否则返回 ok:false 并给出 reason，
 *   调用方（geometryWorker）必须保留原图、交人工复核，绝不擅自改渲染。
 *
 * 与 computeGeometryConsistency 共用同一套约束/求解/闸门，保证「审计信号」与「修正动作」同源。
 */
import { extractConstraints } from './constraintExtract.js'
import { solveGeometry } from './solver.js'
import { residualGate } from './residual.js'
import { derivedLabels } from './derivedCoverage.js'
import { renderGeometrySvg } from '../geometrySvg.js'
import { dist } from './vec.js'

const isNum = (v) => typeof v === 'number' && isFinite(v)

/**
 * 用求解坐标回填结构中的点坐标。
 * 兼容两种格式：新格式 points[i].position.{x,y} 与 旧格式 points[i].{x,y}。
 * @param {object} structure
 * @param {Object<string,{x:number,y:number}>} solvedPoints 求解后的 {label:{x,y}} 映射
 * @returns {object} 深拷贝后的修正结构
 */
export function buildCorrectedStructure(structure, solvedPoints) {
  const s = JSON.parse(JSON.stringify(structure || {}))
  for (const p of s.points || []) {
    const sp = solvedPoints && solvedPoints[p.label]
    if (!sp) continue
    if (p.position && typeof p.position === 'object') {
      p.position.x = sp.x
      p.position.y = sp.y
    } else {
      p.x = sp.x
      p.y = sp.y
    }
  }
  return s
}

/**
 * 尝试把几何结构回灌修正为「与题设一致」的图。
 * @param {object} structure normalizeStructure 后的结构（points / segments / circles / constraints）
 * @param {string} content 题干文本
 * @param {object} [options]
 * @returns {{ok:boolean, svg?:string, solved?:object, reason?:string}}
 *   reason: empty_structure | no_constraints | not_converged | inconsistent | degenerate | render_failed
 */
export function correctGeometryFigure(structure, content, options = {}) {
  if (!structure || !Array.isArray(structure.points) || structure.points.length === 0) {
    return { ok: false, reason: 'empty_structure' }
  }
  const { constraints, dropped } = extractConstraints(content || '', structure)
  if (!constraints || constraints.length === 0) {
    return { ok: false, reason: 'no_constraints' }
  }

  // ── 冻结真实顶点 ──
  // 含派生点的结构里，真实顶点是**从图上读出来的观测值**，派生点是**推出来的**：
  // 前者应当不动，修正由后者承担。
  //
  // 反例（实测，折叠题 A(10,80) B(40,20) C(90,80) + B′ 关于 AC 的镜像）：
  // 不冻结时 LM 的最小范数步把 21.8px 修正**平摊**到四个点上，
  // 真实顶点 C 被挪 21.8px —— 等于"把三角形掰歪"换取 B′ 就位，图被扭曲。
  // 注意 anchorWeight 调参救不了：LM 是梯度下降，首步就把修正摊开、约束满足后梯度归零，
  // 锚再也拉不回来（局部极小）。实测 anchorWeight 放大 5000 倍，顶点仍动 3.85px。
  //
  // 无派生点的结构不冻结：那类题的全部点都是观测值，本来就靠求解器微调自洽。
  const derivedSet = new Set(derivedLabels(structure))
  const fixedPoints = derivedSet.size > 0
    ? structure.points.map(p => p.label).filter(l => l && !derivedSet.has(l))
    : []
  const baseOpts = { circles: structure.circles }

  // 第一选择：冻结真实顶点，让修正全部落在派生点上。
  let sol = solveGeometry(structure.points, constraints, { ...baseOpts, fixedPoints })
  let gate = residualGate(sol.points, constraints, baseOpts)
  let frozeVertices = fixedPoints.length > 0

  // 第二选择：冻结解不开就退回不冻结（= 改造前的行为）。
  // 触发场景：真实顶点自身与题设矛盾，例如模型把 AB≠AC 的三角形配上了「AB=AC」的题干，
  // 此时不动顶点就无解。这一步让冻结成为**单调改进**——它只会把"扭曲的图"换成
  // "干净的图"或"回退裁剪原图"，绝不会把原本出得来的图变成出不来。
  if (frozeVertices && !(sol.converged && gate.pass && !gate.degenerate)) {
    const sol2 = solveGeometry(structure.points, constraints, baseOpts)
    const gate2 = residualGate(sol2.points, constraints, baseOpts)
    if (sol2.converged && gate2.pass && !gate2.degenerate) {
      sol = sol2
      gate = gate2
      frozeVertices = false
    }
  }

  // 安全闸门：仅当求解收敛且解后自洽且非退化时才回灌，否则交人工复核
  if (!sol.converged) return { ok: false, reason: 'not_converged' }
  if (!gate.pass) return { ok: false, reason: 'inconsistent' }
  if (gate.degenerate) return { ok: false, reason: 'degenerate' }

  const corrected = buildCorrectedStructure(structure, sol.points)
  const svg = renderGeometrySvg(corrected)
  if (!svg) return { ok: false, reason: 'render_failed' }

  // 位移分账：走冻结路径时 shiftFixed 必须为 0，全部修正由派生点承担；
  // 走退回路径时 shiftFixed > 0，量级即"真实顶点被挪了多少"，供回归与人工排查。
  let shiftFixed = 0
  let shiftDerived = 0
  for (const p of structure.points) {
    const sp = sol.points[p.label]
    if (!sp || !isNum(p.x) || !isNum(p.y)) continue
    const d = dist({ x: p.x, y: p.y }, sp)
    if (!isNum(d)) continue
    if (derivedSet.has(p.label)) shiftDerived = Math.max(shiftDerived, d)
    else shiftFixed = Math.max(shiftFixed, d)
  }

  return {
    ok: true,
    svg,
    solved: {
      points: sol.points,
      converged: sol.converged,
      displacement: sol.displacement,
      frozeVertices,
      shiftFixed,
      shiftDerived,
      nFixed: frozeVertices ? fixedPoints.length : 0,
      pass: gate.pass,
      degenerate: gate.degenerate,
      maxNorm: gate.maxNorm,
      nConstraints: constraints.length,
      nDropped: dropped.length,
      dropped: dropped.map((d) => d.reason)
    }
  }
}
