/**
 * 配图「完整性」复检（纯像素，零视觉额度）—— 2026-09-23 Step 2
 *
 * ── 为什么需要它 ──
 * Step 2 dry-run 用现有收紧逻辑跑了 14 张"可补"候选，逐张看图后发现**只有 4 张是真图形**：
 *   · 6 张是【图形碎片】——框只覆盖图形的一部分（只截到顶点 A / 只截到底边 B-Q-C / 格线+孤立 A0）
 *   · 2 张是【纯文字区】被当图形（「共有___对」、一整块代数演算）
 *   · 2 张【被手写污染】
 * 收紧逻辑（refineFigureRegion）只回答"这块像不像图形"，**不回答"这块图形完整吗"**。
 * 补裁场景必须两个都问 —— 给老师一张被切掉一半的图，比不给图更糟。
 *
 * ── 判据（只处理"框内墨迹与框边界的关系"，不猜语义）──
 *   ① 边框切断：图形的线条/轮廓若延伸到框的四边，说明被切了。
 *      判据 = 贴边墨迹密度。碎片图的贴边墨量显著高于完整图（完整图的边留白）。
 *   ② 空边占比：完整图形的四条边附近应当基本干净（顶点字母除外）。
 *   ③ 墨迹分散度：碎片图常有大片空白（只截到一角），完整图墨迹分布相对集中。
 *
 * 三者取"最严的一侧"（任一不达标即判不完整）——与项目"宁可漏兜，不可误伤"一致。
 *
 * @param {Buffer} pageBuffer 整页原图（已按生产同口径压缩）
 * @param {{x,y,width,height}} box 收紧后的框（像素坐标）
 * @param {Function} estimateBackground worker 的纸面背景估计
 * @param {Function} inkMaskOf (buffer) => {ink,w,h} 复用的墨迹掩码构造器
 * @returns {Promise<{complete:boolean, score:object, reasons:string[]}>}
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ── 阈值（来自 14 张已人工核验样本的实测分布，见 _diag_figcomplete_calib_0923.mjs）──
// 贴边墨迹密度：完整图形通常 <0.10（边留白），碎片 >0.16（线条被切断、直抵框边）
export const EDGE_INK_MAX = 0.13
// 四边中最干净的边的墨量下限：完整图形至少有一条干净的边（图形的"外侧"）
export const CLEAN_EDGE_MIN = 0.015
// 墨迹分散度：碎片图（只截一角）会有一整个象限几乎全空
export const EMPTY_QUADRANT_MAX = 1

/**
 * 把框内的二值墨迹掩码切出来（复用调用方已经算好的整页掩码，避免重复解码）
 * @param {Uint8Array} ink 整页墨迹掩码（0/1）
 * @param {number} w 整页宽
 * @param {number} h 整页高
 */
const cropMask = (ink, w, h, box) => {
  const x0 = clamp(Math.round(box.x), 0, w - 1)
  const y0 = clamp(Math.round(box.y), 0, h - 1)
  const x1 = clamp(Math.round(box.x + box.width), x0 + 1, w)
  const y1 = clamp(Math.round(box.y + box.height), y0 + 1, h)
  return { x0, y0, x1, y1, cw: x1 - x0, ch: y1 - y0 }
}

/** 一条边的贴边墨迹密度：贴边 2px 带内墨量 / 该边长 */
const edgeDensity = (ink, w, patch, side, thickness = 2) => {
  const { x0, y0, x1, y1, cw, ch } = patch
  let hits = 0, total = 0
  const t = Math.max(1, Math.min(thickness, Math.floor(Math.min(cw, ch) / 4)))
  if (side === 'left' || side === 'right') {
    const xs = side === 'left' ? [x0, x0 + t - 1] : [x1 - t, x1 - 1]
    for (let y = y0; y < y1; y++) {
      total++
      for (let x = xs[0]; x <= xs[1]; x++) if (ink[y * w + x]) { hits++; break }
    }
  } else {
    const ys = side === 'top' ? [y0, y0 + t - 1] : [y1 - t, y1 - 1]
    for (let x = x0; x < x1; x++) {
      total++
      for (let y = ys[0]; y <= ys[1]; y++) if (ink[y * w + x]) { hits++; break }
    }
  }
  return total > 0 ? hits / total : 0
}

/** 四象限墨量分布，返回最空的象限占比（相对平均） */
const quadrantBalance = (ink, w, patch) => {
  const { x0, y0, x1, y1 } = patch
  const mx = Math.floor((x0 + x1) / 2)
  const my = Math.floor((y0 + y1) / 2)
  const q = [0, 0, 0, 0]
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!ink[y * w + x]) continue
      const qi = (y < my ? 0 : 2) + (x < mx ? 0 : 1)
      q[qi]++
    }
  }
  const total = q.reduce((a, b) => a + b, 0)
  if (total === 0) return { emptyQuadrants: 4, minShare: 0 }
  const avg = total / 4
  const shares = q.map(v => v / avg)
  return { emptyQuadrants: shares.filter(s => s < 0.12).length, minShare: Math.min(...shares), shares }
}

/**
 * 主入口：判「收紧框内的图形是否完整」。
 * @param {Uint8Array} inkMask 整页墨迹掩码（0/1）
 * @param {number} w 整页宽（掩码尺度）
 * @param {number} h 整页高
 * @param {{x,y,width,height}} box 收紧框（与掩码同尺度）
 */
export const verifyFigureCompleteness = (inkMask, w, h, box) => {
  const patch = cropMask(inkMask, w, h, box)
  if (patch.cw < 4 || patch.ch < 4) {
    return { complete: false, reasons: ['框过小'], score: {} }
  }

  const edges = {
    left: edgeDensity(inkMask, w, patch, 'left'),
    right: edgeDensity(inkMask, w, patch, 'right'),
    top: edgeDensity(inkMask, w, patch, 'top'),
    bottom: edgeDensity(inkMask, w, patch, 'bottom'),
  }
  const maxEdge = Math.max(...Object.values(edges))
  const minEdge = Math.min(...Object.values(edges))
  const quad = quadrantBalance(inkMask, w, patch)

  const reasons = []
  if (maxEdge > EDGE_INK_MAX) {
    reasons.push(`贴边墨迹过高(${maxEdge.toFixed(3)}>${EDGE_INK_MAX})，图形被框切断`)
  }
  if (minEdge < CLEAN_EDGE_MIN) {
    reasons.push(`四边都贴着墨迹(min=${minEdge.toFixed(3)})，疑为文字/网格区而非独立图形`)
  }
  if (quad.emptyQuadrants > EMPTY_QUADRANT_MAX) {
    reasons.push(`有 ${quad.emptyQuadrants} 个象限近乎空白，疑为图形碎片`)
  }

  return {
    complete: reasons.length === 0,
    reasons,
    score: { edges, maxEdge, minEdge, ...quad }
  }
}

export const FIGCOMPLETE_THRESHOLDS = Object.freeze({
  EDGE_INK_MAX, CLEAN_EDGE_MIN, EMPTY_QUADRANT_MAX
})
