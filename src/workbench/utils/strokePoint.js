/**
 * 板书笔迹点的精度量化（2026-10-03 第 87 轮）
 *
 * ── 为什么需要 ──────────────────────────────────────────────
 * 点坐标直接来自 PointerEvent，是**全精度浮点**：
 *   x: (e.clientX - rect.left + panX) / zoom
 *   p: e.pressure
 * 实测单点 JSON 平均 48.7 字符（`{"x":123.45678912345678,"y":456.7890123456789,"p":0.484375}`），
 * 一题写 50 笔 ≈ 145 KB。而板书按「题目」一条 localStorage 键**永久存在**，
 * 全仓没有任何清理逻辑 —— 5MB 配额迟早写满，写满后 saveStrokes 的 catch 会把失败
 * 静默吞掉，老师当堂写的板书无声消失。
 *
 * ── 量化到 2 位小数 ─────────────────────────────────────────
 * 单点降到 ~25 字符（省约一半），视觉上无损：
 * 画布 dpr ≤ 2、纸面缩放 zoom ≤ 4，0.01 板面 px 最坏也只是 0.04 屏幕 px，
 * 远低于抗锯齿与笔画平滑（drawSegment 的二次曲线）的感知阈值。
 *
 * ── ⛔ 一条纪律 ─────────────────────────────────────────────
 * 量化必须发生在**点进入笔迹的那一刻**（`DrawingCanvas#pointFromEvent`），
 * 不能只在落盘时做 —— 否则内存里的点与存下来的点不是同一份，
 * 「撤销后重做」「导出板书图」会画出与屏幕上细微不同的线。
 */

export const STROKE_COORD_DECIMALS = 2
export const STROKE_PRESSURE_DECIMALS = 2

function roundTo(v, digits) {
  const f = 10 ** digits
  return Math.round(Number(v) * f) / f
}

/**
 * 量化一个笔迹点。返回新对象（不原地改，调用方可能还持有原引用）。
 * `p` 为 null/undefined 时原样保留（不是所有指针都报压感）。
 *
 * @param {{x:number,y:number,p?:number}} pt
 * @returns {{x:number,y:number,p?:number}}
 */
export function quantizeStrokePoint(pt) {
  if (!pt) return pt
  return {
    x: roundTo(pt.x, STROKE_COORD_DECIMALS),
    y: roundTo(pt.y, STROKE_COORD_DECIMALS),
    p: pt.p == null ? pt.p : roundTo(pt.p, STROKE_PRESSURE_DECIMALS),
  }
}

/** 量化一整组笔迹（切题替换 / 迁移旧数据时用；不改原数组） */
export function quantizeStrokes(strokes) {
  if (!Array.isArray(strokes)) return []
  return strokes.map((s) => {
    if (!s || !Array.isArray(s.points)) return s
    return { ...s, points: s.points.map(quantizeStrokePoint) }
  })
}
