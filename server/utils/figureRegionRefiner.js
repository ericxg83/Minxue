import sharp from 'sharp'

/**
 * 配图区域收紧（纯像素、不看模型语义）。
 *
 * 模型给的 image_bbox 只是"大概在这一块"：初中试卷常把多道题的配图挤成一行、
 * 图下标注"第N题图"，模型返回的框往往横向压到隔壁配图、纵向拖进图注和题干文字，
 * 再加上裁剪时的 20% padding，出来的"配图"里混着别人的图和一堆文字。
 *
 * 这里用墨迹投影 + 带体检做收紧：
 *   ① 搜索窗内做行分带，并逐带体检出【图形带】（排除题干/选项/图注/学生手写）
 *   ② 取与模型框最贴合的图形带，带内做列分组 → 取本题那一张图（切掉隔壁配图）
 *   ③ 组内复检一次，只保留图形带并合并相邻图形带（切掉被并进来的图注行）
 * 贴着墨迹裁紧，只留 3% 内边距。任一步判不出图形 → 返回 null，宁可不给配图。
 *
 * 图形内部的标注（A/B/C/北/米/数轴刻度）属于配图本身，不在剔除范围内。
 */

const SEG_WIDTH = 1600         // 分割用降采样宽度（原图常 3000+px，降采样同时抑噪）
const INK_DELTA = 30           // 比局部纸面背景暗这么多才算墨迹（自适应，抗蓝底/阴影）
const ROW_MIN_INK_RATIO = 0.015 // 一行的墨迹占比下限；太低会被纸面噪点连成一整带
const COL_MIN_INK_RATIO = 0.02  // 一列的墨迹占比下限（相对带高）
const ROW_BRIDGE_RATIO = 0.004 // 纵向桥接间隙（相对页高），小于它的空白不切带
const COL_BRIDGE_RATIO = 0.010 // 横向桥接间隙（相对页宽），用于切开并排的多张配图
const STOP_GAP_RATIO = 0.025   // 沿列扩张时，连续空白超过页高这个比例就停（图内断裂跨得过去）
const GROW_MIN_INK_RATIO = 0.010 // 扩张时一行至少这么多墨（相对列宽）才算"有内容"，挡住descender
const TRIM_BRIDGE_RATIO = 0.0015 // 收尾修边用的细桥接：图注与图形只隔十几像素，粗桥接分不开
const TRIM_MIN_INK_RATIO = 0.008 // 收尾修边的行墨量下限（相对列宽）
const WIN_EXPAND_X = 0.25      // 搜索窗横向放宽（放宽后靠列分组切回来）
const WIN_EXPAND_Y = 0.80      // 搜索窗纵向放宽（要看到配图上下的空白才分得出带）
const PAD_RATIO = 0.05
const MIN_SIDE_RATIO = 0.02    // 结果任一边不足页面 2% → 判失败
// 收紧结果比模型框大出这么多倍 → 说明分带没咬住图形边界（横格作业本的印刷横线会
// 冒充"图形的长横线"，把题干和手写一起并进来）→ 判失败，不给配图。
const MAX_GROWTH_H = 2.0
const MAX_GROWTH_W = 1.7

// ── 图形带体检阈值（数值来自线上样本实测，见 tests/figureRegionRefiner.test.mjs）──
const MAX_INK_COVERAGE = 0.14  // 墨迹覆盖率上限：印刷文字行普遍 >19%，图形 2.5%~12%
const TALL_BAND_RATIO = 0.05   // 带高 ≥ 页高 5% → 够高，直接算图形（文字行普遍 <5%）
const FLAT_RUN_RATIO = 0.35    // 数轴/长条示意图很扁，靠"最长连续横线 ≥ 带宽 35%"救回
const FLAT_MIN_HEIGHT_RATIO = 0.015 // 扁图形的带高下限，挡掉分数线/下划线那种一两行的横杠
const TEXT_RUN_RATIO = 0.12    // 最长横向墨迹不足带宽 12% 且不高 → 文字行（图形有横贯的基线）

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/** 一维墨迹投影分带：连续有墨的区间合成一带，空白不足 bridge 的不切断。 */
export function projectionBands(profile, minInk, bridge) {
  const bands = []
  let start = -1
  let lastInk = -1
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] >= minInk) {
      if (start < 0) start = i
      lastInk = i
    } else if (start >= 0 && i - lastInk > bridge) {
      bands.push({ start, end: lastInk })
      start = -1
    }
  }
  if (start >= 0) bands.push({ start, end: lastInk })
  return bands
}

/** 建墨迹掩码：局部纸面背景 - INK_DELTA 作为自适应阈值 */
export function buildInkMask(gray, bg, w, h) {
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < gray.length; i++) ink[i] = gray[i] < bg[i] - INK_DELTA ? 1 : 0
  return ink
}

/** 形态学开运算：3x3 邻域内墨邻居不足 2 个的孤立墨点视为噪点抹掉 */
export function denoiseInkMask(ink, w, h) {
  const out = new Uint8Array(ink.length)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!ink[i]) continue
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (ink[i + dy * w + dx]) n++
        }
      }
      out[i] = n >= 2 ? 1 : 0
    }
  }
  return out
}

/**
 * 统计一条带在给定横向范围内的形态特征。
 * @returns {Object} { x0, x1, width, height, coverage, maxRunH }
 */
export function bandStats(ink, w, y0, y1, x0, x1) {
  let inkCount = 0
  let maxRunH = 0
  let minX = x1
  let maxX = x0 - 1
  for (let y = y0; y <= y1; y++) {
    let run = 0
    for (let x = x0; x < x1; x++) {
      if (ink[y * w + x]) {
        inkCount++
        run++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      } else {
        if (run > maxRunH) maxRunH = run
        run = 0
      }
    }
    if (run > maxRunH) maxRunH = run
  }
  if (maxX < minX) return null
  const width = maxX - minX + 1
  const height = y1 - y0 + 1
  return {
    x0: minX,
    x1: maxX,
    width,
    height,
    coverage: inkCount / (width * height),
    maxRunH
  }
}

/**
 * 带体检：这条带是图形，还是印刷文字/图注/学生手写？
 *
 * 印刷文字行的墨迹覆盖率普遍在 19% 以上（线上样本：题干 19.9%、选项 20~30%、
 * 图注"第N题图" 22.5%），而图形只有 2.5%~12%——图形是线条，文字是密排笔画。
 * 覆盖率过关后再看"够不够高"：文字行高普遍不到页高 5%，图形普遍超过；
 * 数轴这类极扁的合法配图靠"最长连续横线"救回，同时用带高下限挡掉分数线/下划线。
 */
export function isFigureBand(stats, pageH) {
  if (!stats) return false
  if (isTextBand(stats, pageH)) return false
  if (stats.height >= TALL_BAND_RATIO * pageH) return true
  return stats.maxRunH >= FLAT_RUN_RATIO * stats.width
    && stats.height >= FLAT_MIN_HEIGHT_RATIO * pageH
}

/**
 * 文字带（印刷题干/选项/图注"第N题图"/学生手写）判据，两条任一命中即算文字：
 *  a) 墨迹覆盖率过高 —— 文字是密排笔画，图形是稀疏线条；
 *  b) 又矮、又没有一条像样的长横线 —— 文字行里最长的连续横向墨迹只有一个笔画那么长，
 *     而图形总有一条基线/坐标轴/边框横贯大半个宽度。
 * 只靠覆盖率不够：印刷淡一点的页面上，图注只有 10%、题干 12%，都低于覆盖率阈值。
 */
export function isTextBand(stats, pageH) {
  if (!stats) return true
  if (stats.coverage > MAX_INK_COVERAGE) return true
  return stats.maxRunH < TEXT_RUN_RATIO * stats.width
    && stats.height < TALL_BAND_RATIO * pageH
}

/** 在候选带里挑与模型框最贴合的一条：先看纵向重叠，再看距离，最后看谁更高 */
function pickNearest(bands, lo, hi) {
  let best = null
  for (const b of bands) {
    const ov = overlap(b.start, b.end, lo, hi)
    const dist = ov > 0 ? 0 : Math.min(Math.abs(b.start - hi), Math.abs(lo - b.end))
    const cand = { ...b, ov, dist, height: b.end - b.start }
    if (!best
      || cand.ov > best.ov
      || (cand.ov === best.ov && cand.dist < best.dist)
      || (cand.ov === best.ov && cand.dist === best.dist && cand.height > best.height)) {
      best = cand
    }
  }
  return best
}

/**
 * 在 [x0,x1) 横向范围内做行分带，返回 {bands, stats}（绝对 y 坐标）。
 *
 * ⚠️ minInk 必须由调用方传同一个绝对值：分带阈值随横向范围变化时，
 * 同一页在"整窗"和"单列"两次分带会得到完全不同的切分（窄列阈值更低 →
 * 题干、图注、配图会被连成一整带），线上就是这么把数轴上方的题干裹进配图的。
 */
function segmentRows(ink, w, h, y0, y1, x0, x1, minInk) {
  const prof = new Int32Array(y1 - y0)
  for (let y = y0; y < y1; y++) {
    let c = 0
    for (let x = x0; x < x1; x++) if (ink[y * w + x]) c++
    prof[y - y0] = c
  }
  const bridge = Math.max(2, Math.round(ROW_BRIDGE_RATIO * h))
  return projectionBands(prof, minInk, bridge).map(b => {
    const start = b.start + y0
    const end = b.end + y0
    return { start, end, stats: bandStats(ink, w, start, end, x0, x1) }
  })
}

/**
 * 从锚点带向上下扩张，确定配图的真实纵向范围。
 *
 * 不再靠"墨迹分带"决定边界——同一张图会被内部空白切成好几段，阈值定高了会切掉
 * 上半张图（"B"这种孤立标注行墨量很少），定低了又会把题干连进来。
 * 改成：把【密排文字带】当硬边界（题干/选项/图注/手写），在这两条边界之间
 * 沿列逐行扩张，遇到连续超过 stopGap 的空白才停 —— 图内断裂跨得过去，
 * 图外的下一块内容跨不过去。
 */
function growVertical(ink, w, anchor, column, limitTop, limitBottom, stopGap) {
  const need = Math.max(2, Math.round(GROW_MIN_INK_RATIO * (column.end - column.start + 1)))
  const rowHasInk = (y) => {
    let c = 0
    for (let x = column.start; x <= column.end; x++) {
      if (ink[y * w + x]) { c++; if (c >= need) return true }
    }
    return false
  }
  let top = anchor.start
  for (let y = anchor.start - 1, blank = 0; y >= limitTop; y--) {
    if (rowHasInk(y)) { top = y; blank = 0 } else if (++blank > stopGap) break
  }
  let bottom = anchor.end
  for (let y = anchor.end + 1, blank = 0; y <= limitBottom; y++) {
    if (rowHasInk(y)) { bottom = y; blank = 0 } else if (++blank > stopGap) break
  }
  return { start: top, end: bottom }
}

/**
 * 收尾修边：把区域首尾的文字带削掉。
 *
 * 图注（"第N题图"）常常紧贴在图形下方十几个像素处，粗桥接分带时会和图形连成一带、
 * 混合后的覆盖率又低到能冒充图形。这里用细桥接在【已定区域内】重新切一次，
 * 从两端逐条削掉文字带，遇到第一条非文字带就停（图形内部不会被动）。
 */
function trimTextEdges(ink, w, h, region, column, pageH) {
  const bridge = Math.max(1, Math.round(TRIM_BRIDGE_RATIO * pageH))
  const minInk = Math.max(2, Math.round(TRIM_MIN_INK_RATIO * (column.end - column.start + 1)))
  const prof = new Int32Array(region.end - region.start + 1)
  for (let y = region.start; y <= region.end; y++) {
    let c = 0
    for (let x = column.start; x <= column.end; x++) if (ink[y * w + x]) c++
    prof[y - region.start] = c
  }
  const bands = projectionBands(prof, minInk, bridge).map(b => {
    const start = b.start + region.start
    const end = b.end + region.start
    return { start, end, stats: bandStats(ink, w, start, end, column.start, column.end + 1) }
  })
  let lo = 0
  let hi = bands.length - 1
  while (lo <= hi && isTextBand(bands[lo].stats, pageH)) lo++
  while (hi >= lo && isTextBand(bands[hi].stats, pageH)) hi--
  if (lo > hi) return region
  return { start: bands[lo].start, end: bands[hi].end }
}

/**
 * @param {Uint8Array} ink 整页墨迹掩码（1=墨）
 * @param {Object} box 模型框（与 ink 同坐标系）
 * @returns {Object|null} 收紧后的框 {x,y,width,height,steps}；判不出图形返回 null
 */
export function refineFigureRegion(ink, w, h, box) {
  const winX0 = clamp(Math.round(box.x - box.width * WIN_EXPAND_X), 0, w - 1)
  const winX1 = clamp(Math.round(box.x + box.width * (1 + WIN_EXPAND_X)), 1, w)
  const winY0 = clamp(Math.round(box.y - box.height * WIN_EXPAND_Y), 0, h - 1)
  const winY1 = clamp(Math.round(box.y + box.height * (1 + WIN_EXPAND_Y)), 1, h)
  if (winX1 - winX0 < 8 || winY1 - winY0 < 8) return null
  const boxY1 = box.y + box.height
  const boxX1 = box.x + box.width
  const rowMinInk = Math.max(2, Math.round(ROW_MIN_INK_RATIO * (winX1 - winX0)))
  const stopGap = Math.max(2, Math.round(STOP_GAP_RATIO * h))

  // ① 整窗行分带 + 体检 → 配图在哪一行（题干/选项/图注/手写在这一步就被剔除）
  const winRows = segmentRows(ink, w, h, winY0, winY1, winX0, winX1, rowMinInk)
  const rowFigures = winRows.filter(b => isFigureBand(b.stats, h))
  if (rowFigures.length === 0) return null
  const anchor = pickNearest(rowFigures, box.y, boxY1)
  if (!anchor) return null

  // ② 该行内列分组 → 取本题那一张（切开并排的多张配图）
  const colProf = new Int32Array(winX1 - winX0)
  for (let x = winX0; x < winX1; x++) {
    let c = 0
    for (let y = anchor.start; y <= anchor.end; y++) if (ink[y * w + x]) c++
    colProf[x - winX0] = c
  }
  const colMinInk = Math.max(1, Math.round(COL_MIN_INK_RATIO * (anchor.end - anchor.start + 1)))
  const colGroups = projectionBands(colProf, colMinInk, Math.max(2, Math.round(COL_BRIDGE_RATIO * w)))
    .map(b => ({ start: b.start + winX0, end: b.end + winX0 }))
  if (colGroups.length === 0) return null
  const column = pickNearest(colGroups, box.x, boxX1)
  if (!column) return null

  // ③ 密排文字带当硬边界，在边界之间沿列扩张出配图的真实纵向范围
  const textBands = winRows.filter(b => isTextBand(b.stats, h))
  let limitTop = winY0
  let limitBottom = winY1 - 1
  for (const b of textBands) {
    if (b.end < anchor.start) limitTop = Math.max(limitTop, b.end + 1)
    if (b.start > anchor.end) limitBottom = Math.min(limitBottom, b.start - 1)
  }
  const grown = growVertical(ink, w, anchor, column, limitTop, limitBottom, stopGap)

  // ④ 收尾修边：削掉贴在图形上下的图注/文字行
  const vertical = trimTextEdges(ink, w, h, grown, column, h)

  const tight = bandStats(ink, w, vertical.start, vertical.end, column.start, column.end + 1)
  if (!tight || !isFigureBand(tight, h)) return null

  const padX = Math.max(2, Math.round(tight.width * PAD_RATIO))
  const padY = Math.max(2, Math.round(tight.height * PAD_RATIO))
  const x0 = clamp(tight.x0 - padX, 0, w - 1)
  const y0 = clamp(vertical.start - padY, 0, h - 1)
  const x1 = clamp(tight.x1 + padX + 1, 1, w)
  const y1 = clamp(vertical.end + padY + 1, 1, h)
  const outW = x1 - x0
  const outH = y1 - y0
  if (outW < MIN_SIDE_RATIO * w || outH < MIN_SIDE_RATIO * h) return null
  if (outH > box.height * MAX_GROWTH_H || outW > box.width * MAX_GROWTH_W) return null

  return {
    x: x0,
    y: y0,
    width: outW,
    height: outH,
    steps: { rowFigures: rowFigures.length, colGroups: colGroups.length, textBands: textBands.length }
  }
}

/**
 * 在整页原图上把模型的配图框收紧到单张配图。
 *
 * @param {Buffer} pageBuffer 整页原图
 * @param {Object} pixelBox 模型框（整页原始像素坐标）
 * @param {Function} estimateBackground 局部纸面背景估计（复用 worker 里那份实现）
 * @returns {Promise<Object|null>} 原始像素坐标下的收紧框；判不出图形返回 null
 */
export async function refineFigureBoxOnPage(pageBuffer, pixelBox, estimateBackground) {
  const meta = await sharp(pageBuffer).metadata()
  const fullW = meta.width
  const fullH = meta.height
  if (!fullW || !fullH) return null

  const scale = Math.min(1, SEG_WIDTH / fullW)
  const segW = Math.max(1, Math.round(fullW * scale))
  const segH = Math.max(1, Math.round(fullH * scale))
  const { data: gray } = await sharp(pageBuffer)
    .grayscale()
    .resize(segW, segH, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const ink = denoiseInkMask(
    buildInkMask(gray, estimateBackground(gray, segW, segH), segW, segH), segW, segH)

  const refined = refineFigureRegion(ink, segW, segH, {
    x: pixelBox.x * scale,
    y: pixelBox.y * scale,
    width: pixelBox.width * scale,
    height: pixelBox.height * scale
  })
  if (!refined) return null

  const x = clamp(Math.round(refined.x / scale), 0, fullW - 1)
  const y = clamp(Math.round(refined.y / scale), 0, fullH - 1)
  return {
    x,
    y,
    width: Math.min(Math.round(refined.width / scale), fullW - x),
    height: Math.min(Math.round(refined.height / scale), fullH - y),
    steps: refined.steps
  }
}


