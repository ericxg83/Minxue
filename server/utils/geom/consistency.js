/**
 * 几何自洽性审计（影子模式核心）。
 *
 * 输入：题干文本 + 重建结构（normalizeStructure 形态）。
 * 流程：extractConstraints（题干+结构+模型三路）抽取约束 → solveGeometry 求解 → residualGate 闸门。
 *
 * 重要：本模块只「产出审计字段」，调用方（geometryWorker）必须把它当影子信号——
 * 绝不据此阻断重建、改渲染或改判题。图与题设不符时，只记录 displacement / 不通过原因，交人工复核。
 *
 * @param {object} structure normalizeStructure 后的结构（points / segments / circles / constraints）
 * @param {string} content 题干文本
 * @param {object} [options]
 * @returns {object}
 *   - 无可校验：{ skipped: true, reason }（empty_structure / no_constraints）
 *   - 否则：{ pass, maxNorm, degenerate, degenerateReasons, displacement, converged,
 *            nConstraints, nDropped, dropped[], rawMaxNorm, rawPass, items[] }
 */
import { extractConstraints } from './constraintExtract.js'
import { solveGeometry } from './solver.js'
import { residualGate } from './residual.js'

const round = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1e4) / 1e4 : v)

export function computeGeometryConsistency(structure, content, options = {}) {
  if (!structure || !Array.isArray(structure.points) || structure.points.length === 0) {
    return { skipped: true, reason: 'empty_structure' }
  }
  const { constraints, dropped } = extractConstraints(content || '', structure)
  if (!constraints || constraints.length === 0) {
    return { skipped: true, reason: 'no_constraints' }
  }
  const opts = { circles: structure.circles }

  // 原图（模型坐标）直接评估：反映「图与题设不符」的程度（影子信号之一）
  const rawPts = {}
  for (const p of structure.points) {
    if (p && p.label && typeof p.x === 'number' && typeof p.y === 'number') rawPts[p.label] = { x: p.x, y: p.y }
  }
  const raw = residualGate(rawPts, constraints, opts)

  // 求解后评估：反映「是否存在一致实现」
  const sol = solveGeometry(structure.points, constraints, opts)
  const solved = residualGate(sol.points, constraints, opts)

  const items = solved.items.map((i) => ({
    type: i.type,
    source: i.source,
    soft: i.soft,
    maxNorm: round(i.maxNorm),
    pass: i.pass
  }))

  return {
    pass: solved.pass,
    maxNorm: round(solved.maxNorm),
    degenerate: solved.degenerate,
    degenerateReasons: solved.degenerateReasons,
    displacement: round(sol.displacement),
    converged: sol.converged,
    nConstraints: constraints.length,
    nDropped: dropped.length,
    dropped: dropped.map((d) => d.reason),
    rawMaxNorm: round(raw.maxNorm),
    rawPass: raw.pass,
    items
  }
}
