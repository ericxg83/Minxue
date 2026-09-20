/**
 * 派生点「是否已被约束确定」的判据（纯函数，零视觉调用）。
 *
 * 背景：geometryWorker 原先对含派生点（垂足/中点/交点/动点）的结构一律早退
 * （derived_deferred → 标 none → 前端回退裁剪原图）。那道闸是约束求解器接入之前
 * 的临时保护，代价是：视觉调用已经花掉（早退发生在 callVisionCompletion 之后），
 * 结果却被整条丢弃。
 *
 * 放宽它需要回答一个问题——**求解器收敛，是否等于这张图可信？**
 * 不等于。求解只保证满足「已抽取」的约束；题干里某条构造关系若被漏抽，
 * 派生点会退化成自由点，停在模型目测的位置上（实测偏差可达 11px / 400px 画布），
 * 此时入库等于把一张与题干矛盾的图当干净图展示给学生。
 *
 * 因此本模块给出保守判据：**派生点必须被已抽取的约束"确定"**。
 *   - 一条约束对某个点的"自由度亏损"= 它给该点带来的独立方程数。
 *   - 一个点需要累计亏损 ≥ 2 才算确定（平面点有 2 个自由度）。
 *   - 只有 args.point === 该点（或 angle_bisector 的 ray[1]）的约束才计入，
 *     其余关系型约束（equal_length / angle_value / perpendicular / polygon_shape …）
 *     本身不足以钉住一个点，一律记 0。
 *
 * 纪律：判据偏保守——宁可判"未确定"退回裁剪原图，也不放一张可能错的图过去。
 * 漏判的代价只是少一张干净重绘（原图永远是正确的）；误判的代价是错图进学生视野。
 */

import { extractConstraints } from './constraintExtract.js'

/**
 * 各约束类型对「被它钉住的点」贡献的独立方程数。
 *   2 = 完全确定平面点（垂足/中点/交点/对称/旋转/三心）
 *   1 = 只剩一个自由度（在线上/在圆上/在射线上滑动）
 *   0 = 不钉点（空约束或纯关系约束）
 *
 * 两条已知的空约束，一律记 0：
 *   - circle_center：题干抽取器生成的是 { point: O, circle: O }，残差 dist(O,O)≡0。
 *   - on_circle 对**圆心**的贡献：方程 |P−O| = r 里 r 取的是该圆上所有 on_circle
 *     点到圆心的平均距离（见 residual.js 的 circleRadius），自引用。只有一个
 *     on_circle 时 r ≡ |P−O|，残差恒为 0，同样是空约束。既然不可靠就不计入。
 */
export const DERIVED_DOF_DEFICIT = {
  midpoint: 2,
  foot: 2,
  line_intersect: 2,
  reflect: 2,
  rotate: 2,
  centroid: 2,
  incenter: 2,
  circumcenter: 2,
  on_segment: 1,
  on_line: 1,
  on_circle: 1,
  angle_bisector: 1,
  circle_center: 0
}

/** 判定一个点是否"确定"所需的自由度亏损阈值（平面点 2 个自由度） */
export const DETERMINED_THRESHOLD = 2

/** 从结构里挑出带 derived 字段的点标签 */
export function derivedLabels(structure) {
  return (structure?.points || [])
    .filter(p => p?.label && p.derived && typeof p.derived === 'object' && Object.keys(p.derived).length > 0)
    .map(p => p.label)
}

/**
 * 逐点累计自由度亏损。
 *
 * 只统计"以该点为中心"的约束：args.point === 该点，或 angle_bisector 的 ray[1]。
 * 其余关系型约束（equal_length / angle_value / perpendicular / polygon_shape /
 * tangent / ratio）描述的是点与点的关系，本身不足以单独钉住一个点，一律记 0。
 *
 * @returns {Map<string, {deficit:number, sources:string[]}>}
 */
export function dofLedger(constraints) {
  const ledger = new Map()
  const add = (label, n, src) => {
    if (typeof label !== 'string' || !label) return
    if (!ledger.has(label)) ledger.set(label, { deficit: 0, sources: [] })
    const rec = ledger.get(label)
    rec.deficit += n
    if (n > 0 && !rec.sources.includes(src)) rec.sources.push(src)
  }

  for (const c of constraints || []) {
    const a = c?.args || {}
    const type = c?.type
    const n = DERIVED_DOF_DEFICIT[type]
    if (n == null || n === 0) continue // 未知/纯关系型/空约束：不钉点
    const src = `${type}:${c?.source || '?'}`
    if (typeof a.point === 'string') add(a.point, n, src)
    if (type === 'angle_bisector' && Array.isArray(a.ray)) add(a.ray[1], n, src)
  }
  return ledger
}

/**
 * 评估结构里每个派生点是否已被约束确定。
 *
 * @param {object} structure normalizeStructure 后的结构
 * @param {object[]} constraints extractConstraints 产出的约束数组
 * @returns {{points:{label,deficit,sources,determined}[], uncovered:string[], allDetermined:boolean}}
 *   uncovered = 未确定的派生点标签（含完全无约束的），空数组表示可安全重绘
 */
export function derivedPointCoverage(structure, constraints) {
  const ledger = dofLedger(constraints)
  const points = derivedLabels(structure).map((label) => {
    const rec = ledger.get(label) || { deficit: 0, sources: [] }
    return {
      label,
      deficit: rec.deficit,
      sources: rec.sources,
      determined: rec.deficit >= DETERMINED_THRESHOLD
    }
  })
  const uncovered = points.filter(p => !p.determined).map(p => p.label)
  return { points, uncovered, allDetermined: uncovered.length === 0 }
}

/**
 * 一步到位：从题干 + 结构抽取约束，再评估派生点确定度。
 * 供 geometryWorker 在回灌修正之后调用。
 *
 * @returns {{points, uncovered, allDetermined, nConstraints, dropped:string[]}}
 */
export function assessDerivedReadiness(structure, content) {
  const { constraints, dropped } = extractConstraints(content || '', structure)
  const cov = derivedPointCoverage(structure, constraints)
  return {
    ...cov,
    nConstraints: constraints.length,
    dropped: (dropped || []).map(d => d.reason)
  }
}

/**
 * 回灌修正是否真的成功——要求**正面证据**，形状未知一律判否（fail-closed）。
 *
 * 不能只写 `!solved.skipped`：空对象 / 缺字段会被当成成功放行，
 * 安全网的默认姿态必须是拒绝。
 */
function solverVerified(solved) {
  return Boolean(solved)
    && solved.skipped !== true
    && solved.converged === true
    && solved.pass === true
    && solved.degenerate === false
}

/**
 * 合成裁决：含派生点的结构能否入库。
 *
 * 两道闸必须同时过——**求解器收敛不等于图可信**：
 *   a. 回灌修正成功（求解收敛 + 残差闸门通过 + 非退化）
 *   b. 每个派生点都被已抽取的约束确定（自由度亏损 ≥ 2）
 *
 * 缺任一 → 返回 ok:false，调用方标 none 让前端回退裁剪原图。
 *
 * @param {object} structure normalizeStructure 后的结构
 * @param {string} content 题干文本
 * @param {object} solved structure.solved —— 回灌修正结果（correctedRender 产出）
 * @returns {{ok:boolean, reason?:string, points:object[], uncovered:string[],
 *            allDetermined:boolean, nConstraints:number, dropped:string[]}}
 *   reason: solver:<原因> | undetermined:<标签列表>
 */
export function canPublishDerivedFigure(structure, content, solved) {
  const readiness = assessDerivedReadiness(structure, content)
  if (!solverVerified(solved)) {
    const why = solved?.skipped === true
      ? (solved.reason || 'unknown')
      : (solved ? 'evidence_incomplete' : 'missing')
    return { ok: false, reason: `solver:${why}`, ...readiness }
  }
  if (!readiness.allDetermined) {
    return { ok: false, reason: `undetermined:${readiness.uncovered.join('/')}`, ...readiness }
  }
  return { ok: true, ...readiness }
}
