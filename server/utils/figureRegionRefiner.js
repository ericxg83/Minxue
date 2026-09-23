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

// ── 模型框宽度可信度（2026-09-23 用户明确不接受「配图带题干文字」）──
// 线上实测（420 道引图题）：模型给的 image_bbox 有 21 道宽度≈整题带（≥0.9×block 宽），
// 裁出来必然是「图形 + 题干续行 + 选项字母 + 下一题题号」——老师原话「不接受配图带题干文字」。
// 根因不在分带算法（它对这 21 道都正确切出了列组），而在下面 §并集 那一步：
// 并集把水平方向也拉回模型框宽度，等于把刚被 ④ 削掉的题干文字原样加回来。
//
// 判据：模型框宽度占【页宽】的比例。几何配图在一页里通常只占很窄的一条（实测好样本
// 14%~19% 页宽），而"满宽带"框会接近整页。超过阈值即认定水平向不可信 —— 此时水平
// 方向【只认像素列组】，模型框只用于纵向兜底。
//   阈值 0.50 来自全库分档实测（_ratio_sweep_0923.mjs，60 题"已有配图"样本）：
//     模型框宽占比 0~0.2  → 输出均 0.185，被撑开 0 例
//                 0.2~0.35 → 输出均 0.228，被撑开 1 例
//                 0.35~0.5 → 输出均 0.398，被撑开 0 例（n=1，正交样本，保持并集）
//                 0.5~0.62 → 输出均 0.647，被撑开 1 例  ← 伤害带，必须纳入
//                 0.8~1.01 → 输出均 0.143（本次修复后）
//   ⇒ 0.5 是"并集开始有害"的分界。0.35~0.5 只有 1 例且未被撑开，不下压到那一档，
//     给"合法的中等宽度配图"（多子图并排、宽流程图）留安全边际。
const WIDE_BOX_PAGE_RATIO = 0.50

// ── 图形带体检阈值（数值来自线上样本实测，见 tests/figureRegionRefiner.test.mjs）──
const MAX_INK_COVERAGE = 0.14  // 墨迹覆盖率上限：印刷文字行普遍 >19%，图形 2.5%~12%
const TALL_BAND_RATIO = 0.05   // 带高 ≥ 页高 5% → 够高，直接算图形（文字行普遍 <5%）
const FLAT_RUN_RATIO = 0.35    // 数轴/长条示意图很扁，靠"最长连续横线 ≥ 带宽 35%"救回
const FLAT_MIN_HEIGHT_RATIO = 0.015 // 扁图形的带高下限，挡掉分数线/下划线那种一两行的横杠
const TEXT_RUN_RATIO = 0.12    // 最长横向墨迹不足带宽 12% 且不高 → 文字行（图形有横贯的基线）

// ── 连通域去手写阈值（2026-09-21 第5题 078d57ac）──
// 图形是连通的线条，学生手写是几十上百个互不相连的小笔画。用"最大连通域 + 边距"
// 把外围的手写/演算圈外削掉。只在框内连通域数量很多（=明显混入手写）时才启用，
// 干净的图形（几个域）一律不动 —— 避免误伤由多段构成的合法图形。
const COMPONENT_TEXT_MIN_COUNT = 12   // 框内连通域 ≥ 这么多才认为混入了手写
const COMPONENT_MARGIN_RATIO = 0.15   // 最大域外扩比例（保留紧贴图形的顶点字母）
const COMPONENT_MIN_SHARE = 0.15      // 最大域至少占框内总墨量的这个比例，否则不敢裁
//   ⚠️ 0.15 是实测下限：078d57ac 图形 1250 点 / 全框总墨 6872 = 0.18，手写笔画数量多
//   （71 个小域 5622 点）会把"占比"压得很低，但"最大域"仍然是唯一的大连通块 ——
//   这个闸门防的是"框内没有主导图形"（最大域只是一条小线段），不是防手写。
const COMPONENT_MIN_AREA_RATIO = 0.25 // 裁剪结果至少占到原框面积的这个比例，否则回退

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
 * 用最大连通域把框内的学生手写/演算圈外削掉（2026-09-21 第5题 078d57ac）。
 *
 * 为什么需要它：几何图形是**连通线条**，面积集中在少数几个大连通域里；学生手写
 * 是几十上百个互不相连的小笔画（实测 078d57ac：图形 1 个 1250 点的大域 + 71 个小域，
 * 小域全是手写与图注）。竖向/横向的墨迹投影都会被手写"桥接"进图形带，唯一可靠的区别
 * 是**连通性**：图形连成一片，手写散成一堆。
 *
 * 安全阀（宁可漏兜，不可误伤）：
 *   · 只有框内连通域数量 ≥ COMPONENT_TEXT_MIN_COUNT 才启用（干净图形只有几个域，不动）；
 *   · 最大域必须占到框内总墨量的 COMPONENT_MIN_SHARE，否则认为"没有主导图形"，不动；
 *   · 最大域按 COMPONENT_MARGIN_RATIO 外扩，保住紧贴顶点的字母标注（A/B/C/D）；
 *   · 调用方还要复核裁剪结果仍是图形带、且面积不低于原框 COMPONENT_MIN_AREA_RATIO。
 *
 * @returns {Object|null} {x,y,width,height}（原图的绝对坐标）；不该裁剪时返回 null
 */
function trimToMainComponent(ink, w, h, x, y, width, height) {
  if (width < 8 || height < 8) return null
  // 框太大时直接放弃裁剪：连通域扫描的栈按区域像素数预分配，超大框不值得
  if (width * height > 4_000_000) return null
  const seen = new Uint8Array(width * height)
  // 洪泛栈用预分配 Int32Array（打包 idx），绝不能放 JS 小数组 ——
  // 2026-09-21 实测：数组版在 4GB 堆上把 recropFigures 跑到 OOM。
  const stack = new Int32Array(width * height)
  const at = (lx, ly) => ly * width + lx
  let count = 0
  let totalInk = 0
  let best = null
  for (let ly = 0; ly < height; ly++) {
    for (let lx = 0; lx < width; lx++) {
      const i = at(lx, ly)
      if (seen[i] || !ink[(y + ly) * w + (x + lx)]) continue
      count++
      let top = 0
      stack[top++] = i
      seen[i] = 1
      let n = 0
      let minx = lx; let maxx = lx; let miny = ly; let maxy = ly
      while (top > 0) {
        const cur = stack[--top]
        const cx = cur % width
        const cy = (cur - cx) / width
        n++
        if (cx < minx) minx = cx
        if (cx > maxx) maxx = cx
        if (cy < miny) miny = cy
        if (cy > maxy) maxy = cy
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = cx + dx; const ny = cy + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const j = at(nx, ny)
            if (!seen[j] && ink[(y + ny) * w + (x + nx)]) { seen[j] = 1; stack[top++] = j }
          }
        }
      }
      totalInk += n
      if (!best || n > best.n) best = { n, minx, maxx, miny, maxy }
    }
  }
  if (!best || count < COMPONENT_TEXT_MIN_COUNT) return null
  if (best.n < COMPONENT_MIN_SHARE * totalInk) return null
  const cw = best.maxx - best.minx + 1
  const ch = best.maxy - best.miny + 1
  const mx = Math.round(cw * COMPONENT_MARGIN_RATIO)
  const my = Math.round(ch * COMPONENT_MARGIN_RATIO)
  const nx0 = Math.max(0, best.minx - mx)
  const ny0 = Math.max(0, best.miny - my)
  const nx1 = Math.min(width, best.maxx + mx + 1)
  const ny1 = Math.min(height, best.maxy + my + 1)
  return { x: x + nx0, y: y + ny0, width: nx1 - nx0, height: ny1 - ny0 }
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
  // ⚠️ 试过"把相邻的另一张图形带也当硬边界"来挡"吞并邻题图"，**已实测回退**（2026-09-21）：
  // 用 4 张已知好样本回归，`714b0e6c`（同心圆）高度只剩 70%、`3baafdea` 68% ——
  // "同一张图被细空白切成两带"与"两张相邻的图"在墨迹投影上不可区分，加边界必然误伤真图。
  // 违反项目纪律"宁可漏兜，不可误伤"。该残留缺陷的处置改为上游（收紧后按覆盖率体检，
  // 见 worker.js 的配图体检），不在本函数里做。
  const grown = growVertical(ink, w, anchor, column, limitTop, limitBottom, stopGap)

  // ④ 收尾修边：削掉贴在图形上下的图注/文字行
  const vertical = trimTextEdges(ink, w, h, grown, column, h)

  const tight = bandStats(ink, w, vertical.start, vertical.end, column.start, column.end + 1)
  if (!tight || !isFigureBand(tight, h)) return null

  // ── 配图下限不低于模型框（2026-09-18 白板第9题事故）──
  // 收紧的初衷是"把模型框大概覆盖的区域剔掉紧贴的邻图/图注"；但当模型框本身就已经
  // 很贴图时（视觉模型定位准确），墨迹分带会把【图形内部的稀疏结构】当成"邻图"切掉：
  //   线上实例：数值转换器流程图，模型框 1181×442 完整盖住整张图，
  //   收紧后只剩 595×191（面积 22%），把图砍成下半截 —— 用户看到"配图页不是这道题的"。
  // 收紧的目的始终是【向相邻内容让边】，不是【裁切图形】。模型框是 OCR 视觉模型主动
  // 看图给出的定位，可信度高于墨迹投影的启发式判断，把它作为收缩下限 ——
  // 收紧可以把框向左右（邻图）压缩，但不得越过模型框的边缘收缩。
  // 实现：收紧结果与模型框求并集（并集 = 占上界），保证输出至少覆盖模型框完整范围。
  // 副作用：模型框严重偏位时可能多带些空白，代价远小于把真图砍掉（宁可多留白）。
  //
  // ── ⚠️ 2026-09-23 修正：并集的【水平方向】必须按模型框宽度可信度分两种情况 ──
  // 上面的并集当初是为"防纵向砍半截"加的，但它是**二维并集**，水平向也一并拉回模型框宽。
  // 当模型框是"满宽带"（宽度≈整题带）时，这个水平并集会把 ④ trimTextEdges 刚削掉的
  // 题干/选项/下一题文字原样加回来 —— 实测 a472e76e Q3：像素列组只占 18% 页宽，
  // 并集后输出 75% 页宽，裁片里"（第3题）"+ A/B/C/D 选项字母 + 下一题"6."全在。
  // 用户 2026-09-23 明确否决这种产物。修法：
  //   · 模型框窄（可信）→ 保持原二维并集，行为不变（好样本不受影响）；
  //   · 模型框是满宽带（不可信）→ 水平方向只认像素列组，模型框仅参与纵向兜底。
  // 这不是"取消保护"：纵向仍与模型框求并集，2026-09-18「流程图被砍半截」的场景照旧受保护；
  // 只是不再让一个明显错误（满宽带）在水平方向覆盖一个明显正确的像素结论。
  const modelBoxWide = w > 0 && box.width / w >= WIDE_BOX_PAGE_RATIO
  // 满宽带时水平两边都退回像素列组；否则维持原二维并集（behavior 不变）
  const x0 = modelBoxWide
    ? clamp(tight.x0, 0, w - 1)
    : clamp(Math.min(tight.x0, box.x), 0, w - 1)
  const rawX1 = clamp(Math.max(tight.x1, box.x + box.width), 1, w)
  const x1 = modelBoxWide ? clamp(Math.max(tight.x1, tight.x0 + 1), 1, w) : rawX1
  const uniStart = clamp(Math.min(vertical.start, box.y), 0, h - 1)
  const uniEnd = clamp(Math.max(vertical.end, box.y + box.height), 1, h)

  // ── ⚠️ 并集之后必须【再让一次边】（2026-09-21 白板第2/4/5/6/7题事故）──
  // 上面的并集是 2026-09-18 为"防收紧把图砍半截"加的，必须保留。但它有一个致命副作用：
  // **刚刚被 ④ trimTextEdges 削掉的图注/邻题文字，会被并集原样加回来**。
  // 练习册/密排版面里模型框常常整体偏到图形下方一带（图注「（第N题）」+ 下一题题干），
  // 于是：收紧往上扩张抓到图形带（连图形上方的学生手写一起）→ 并集又把模型框那一段文字并回来
  //   ⇒ 输出 = 图形 + 学生手写 + 图注 + 下一题文字。
  // 实测第5题：模型框落在「（第5题）」+下一题题干上，保留率 高度 180% / 面积 270%，
  // 老师原话"这个图的配图截图区域过大，而且手写部分也没擦除"。
  // 修法：并集后按**同一判据**（trimTextEdges → isTextBand；学生手写因墨迹覆盖率过高本来
  // 就算文字带）再削一次首尾，一旦削到 core 就停 —— 2026-09-18 的"不砍图"保护原样保留。
  const uniTrim = trimTextEdges(ink, w, h, { start: uniStart, end: uniEnd }, column, h)
  const y0 = Math.min(vertical.start, uniTrim.start)
  const y1 = Math.max(vertical.end, uniTrim.end)
  let outW = x1 - x0
  let outH = y1 - y0

  if (outW < MIN_SIDE_RATIO * w || outH < MIN_SIDE_RATIO * h) return null
  if (outH > box.height * MAX_GROWTH_H || outW > box.width * MAX_GROWTH_W) return null

  // ── 2026-09-21 第5题 (078d57ac) 追加：用连通性把框内的学生手写圈外削掉 ──
  // 投影法削不掉"写在图形旁边、与图形同一纵向范围"的整段演算（第5题左侧 15/4、1/2×AD 等）。
  // 判据换成连通性：图形连成一片，手写散成几十个小域。仅在明显混入手写时启用（见函数注释）。
  let finalX = x0
  let finalY = y0
  const mainComp = trimToMainComponent(ink, w, h, x0, y0, outW, outH)
  if (mainComp
    && mainComp.width >= MIN_SIDE_RATIO * w
    && mainComp.height >= MIN_SIDE_RATIO * h
    && mainComp.width * mainComp.height >= COMPONENT_MIN_AREA_RATIO * outW * outH) {
    const compStats = bandStats(ink, w, mainComp.y, mainComp.y + mainComp.height - 1,
      mainComp.x, mainComp.x + mainComp.width)
    if (compStats && isFigureBand(compStats, h)) {
      finalX = mainComp.x
      finalY = mainComp.y
      outW = mainComp.width
      outH = mainComp.height
    }
  }

  return {
    x: finalX,
    y: finalY,
    width: outW,
    height: outH,
    steps: { rowFigures: rowFigures.length, colGroups: colGroups.length, textBands: textBands.length, modelBoxWide, rawX1 }
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


