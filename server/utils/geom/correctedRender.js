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
import { renderGeometrySvg } from '../geometrySvg.js'

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
  const opts = { circles: structure.circles }

  const sol = solveGeometry(structure.points, constraints, opts)
  const gate = residualGate(sol.points, constraints, opts)

  // 安全闸门：仅当求解收敛且解后自洽且非退化时才回灌，否则交人工复核
  if (!sol.converged) return { ok: false, reason: 'not_converged' }
  if (!gate.pass) return { ok: false, reason: 'inconsistent' }
  if (gate.degenerate) return { ok: false, reason: 'degenerate' }

  const corrected = buildCorrectedStructure(structure, sol.points)
  const svg = renderGeometrySvg(corrected)
  if (!svg) return { ok: false, reason: 'render_failed' }

  return {
    ok: true,
    svg,
    solved: {
      points: sol.points,
      converged: sol.converged,
      displacement: sol.displacement,
      pass: gate.pass,
      degenerate: gate.degenerate,
      maxNorm: gate.maxNorm,
      nConstraints: constraints.length,
      nDropped: dropped.length,
      dropped: dropped.map((d) => d.reason)
    }
  }
}
