/**
 * paperFigureAssign.js — 小问组配图共享（2026-11-02）
 *
 * ── 为什么必须有这一步 ──
 * 切段器（questionBoxMeasure）的切段规则是「某行 y_top = 该行题号行上沿、
 * y_bottom = 下一行题号行上沿」。真卷常见版式「题干 → (1)(2)(3) 小问 → 图块放最后」
 * （2026 上海徐汇一模第 25 题实测，杨浦 19/23、徐汇 21/22/23/24 同模式）：
 * 图块整段落进【最后一个下问】的切段，前面的小问只切到【自己那一行文字条】
 * （归一化高 20 ≈ 一行字，行内展示出来只有几像素高 = 等于没图）。
 *
 * 修法：同页同题号的小问组内，把「带图行」（bbox 高 ≥ FIG_MIN_NORM_H）的图
 * 补给「文字条行」。图源优先用 ink 剖面从源裁片里抠出「图形带」
 * （去掉源行自己的文字行，避免把兄弟小问的文字带进配图）；
 * 抠不出干净图形带就整张源裁片兜底 —— 宁可多带一行小问文字，也不给错图。
 *
 * 两个消费方（同一实现，禁止各写一套）：
 *   ① paperBankService.parsePageToQuestions —— 新卷解析的裁片后置步；
 *   ② 存量数据修复脚本（_fix_pb_figures_1102.mjs）—— 对已入册的卷子补图。
 */

import sharp from 'sharp'

/** 「带图行」的最小归一化高度（0-1000 页高）。一行文字 ≈ 15-30；图形块实测 106-356。 */
export const FIG_MIN_NORM_H = 60

/**
 * 规划小问组的配图共享。
 * @param {Array<{id?:string, page_no?:number, question_no:any, sub_no?:string,
 *                 bbox:{y:number,height:number}|null}>} rows 单页（或整卷）的题目行
 * @returns {Array<{targetIdx:number, sourceIdx:number}>} 需要把 source 行的图补给 target 行
 *          的计划；按 rows 下标引用，调用方据此取行。无计划返回 []。
 *
 * 判据（保守，宁可不出图也不错给）：
 * - 只处理「同页 + 同题号 + sub_no 非空」的小问组（整题行不在内，它自己的切段天然含图）；
 * - source = 组内 bbox 高度最大的行，且高度 ≥ FIG_MIN_NORM_H、且 ≥ 1.8×最大 target 高
 *   （两个高度接近的中等行互不相给，防止把邻行文字条当图）；
 * - target = 组内 bbox 高度 < FIG_MIN_NORM_H 的行（含切段失败的行，它们本来就没图）。
 */
export function planSubrowFigureAssignments(rows) {
  const list = Array.isArray(rows) ? rows : []
  const groups = new Map()
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    if (!r || !r.sub_no) continue
    const key = `${r.page_no ?? ''}|${String(r.question_no ?? '')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(i)
  }
  const plans = []
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue
    const hOf = (i) => {
      const b = list[i] && list[i].bbox
      const h = b ? Number(b.height) : 0
      return Number.isFinite(h) ? h : 0
    }
    let srcIdx = -1
    for (const i of idxs) if (hOf(i) >= FIG_MIN_NORM_H && (srcIdx === -1 || hOf(i) > hOf(srcIdx))) srcIdx = i
    if (srcIdx === -1) continue
    const targets = idxs.filter(i => i !== srcIdx && hOf(i) < FIG_MIN_NORM_H)
    if (!targets.length) continue
    const maxTargetH = Math.max(...targets.map(hOf), 1)
    if (hOf(srcIdx) < maxTargetH * 1.8) continue
    for (const t of targets) plans.push({ targetIdx: t, sourceIdx: srcIdx })
  }
  return plans
}

/**
 * 从源行裁片里抠「图形带」：去掉顶部/零散的小问文字行，只留下方的大块图形。
 * @param {Buffer} cropBuffer 源行裁片（页面坐标按行 bbox 裁出的 JPEG）
 * @returns {Promise<Buffer|null>} 图形带裁片；找不到干净的图形带返回 null（调用方用整张源裁片兜底）
 *
 * 判据（2026-11-03 按 13 张真实裁片重写，取代「整幅宽度」与「2.2× 兄弟带」两版）：
 * - 灰度 < 200 记为墨点；逐行统计墨点数与横向跨度（像素）。
 * - 按行 ink 剖面分段：空白 ≥ 8px 断开（真卷行距实测 10~32px，足以逐行切开文字）。
 * - 「文字带」= 高度 < 120px 且 横向跨度 ≥ 本裁片最宽带的 50%。
 *   ⚠️ 不能用「≥75% 整幅」作绝对阈值：真卷页面有留白，文字行只占 38%~70% 宽，
 *   图形占 12%~45%，绝对阈值会把文字误判成图形（嘉定 24 实测裹进两行小问文字）。
 * - 「图形带」= 最高的非文字带（整片图形远高于单行文字），再向下合并被内部间隙
 *   切碎的图块（间隙 ≤ 40px 且非文字带）；向上合并「顶点字母 / 坐标轴箭头」等标注
 *   （间隙 ≤ 40px、非文字带、且与图形横向范围重叠 ≥ 50%）。
 *   ⚠️ 向上的横向重叠闸不可省：页面左缘的短文字行（「坐标；」「坐标.」）也是窄带，
 *   但它们在图幅之外，并入就会把文字裹进配图（嘉定 24 实测）。
 * - 带宽高须 ≥ 50px 且 ≥ 裁片高 25%，否则视为纯文字 / 无图 → 返回 null。
 * - 纯文字裁片：所有带都是文字带 ⇒ 无图形带 ⇒ null（调用方回退整张裁片，绝不裹文字进图）。
 */
export async function extractFigureBandFromCrop(cropBuffer) {
  try {
    const { data, info } = await sharp(cropBuffer).greyscale().raw().toBuffer({ resolveWithObject: true })
    const width = Number(info.width) || 0
    const height = Number(info.height) || 0
    if (width < 40 || height < 60) return null

    // 逐行墨迹数 + 横向跨度/左右边界（像素）
    const inkPerRow = new Array(height).fill(0)
    const spanPerRow = new Array(height).fill(0)
    const loPerRow = new Array(height).fill(-1)
    const hiPerRow = new Array(height).fill(-1)
    for (let y = 0; y < height; y++) {
      const off = y * width
      let c = 0, lo = -1, hi = -1
      for (let x = 0; x < width; x++) {
        if (data[off + x] < 200) {
          c++
          if (lo < 0) lo = x
          hi = x
        }
      }
      inkPerRow[y] = c
      spanPerRow[y] = lo < 0 ? 0 : (hi - lo + 1)
      loPerRow[y] = lo
      hiPerRow[y] = hi
    }

    // 分段：墨迹簇（空白 >=8px 断开；真卷行距实测 10~32px，8px 足以逐行切开）
    const bands = []
    {
      let y = 0
      while (y < height) {
        while (y < height && inkPerRow[y] === 0) y++
        if (y >= height) break
        const top = y
        let bottom = y, gap = 0
        y++
        while (y < height) {
          if (inkPerRow[y] >= 1) { bottom = y; gap = 0 }
          else { gap++; if (gap >= 8) break }
          y++
        }
        bands.push({ top, bottom })
      }
    }
    if (!bands.length) return null

    const bandMaxSpan = (b) => {
      let m = 0
      for (let y = b.top; y <= b.bottom; y++) if (spanPerRow[y] > m) m = spanPerRow[y]
      return m
    }
    const maxSpan = Math.max(1, ...bands.map(bandMaxSpan))

    // 文字带判据（2026-11-03 按 13 张真实裁片校准）：**相对宽度**，不是绝对整幅比。
    // 真卷整页宽 2144px 时文字行只占 38%~70% 宽（页面左右有留白），图形占 12%~45%；
    // 旧判据「>=75% 整幅才算文字」会把文字全判成图形（嘉定 24 实测裹进两行小问文字）。
    // 现判据：高度 < 120px（单行文字/两三行合并）且 横向跨度 >= 本裁片最宽带的 50%。
    const isTextBand = (b) => {
      if ((b.bottom - b.top + 1) >= 120) return false
      return bandMaxSpan(b) >= maxSpan * 0.5
    }

    // 图形带 = 最高的「非文字带」（整片图形的高度远大于单行文字）
    let fig = null
    let figBandH = 0
    for (const b of bands) {
      if (isTextBand(b)) continue
      const h = b.bottom - b.top + 1
      if (h > figBandH) { fig = b; figBandH = h }
    }
    if (!fig || figBandH < 50) return null

    const bandRange = (b) => {
      let lo = width, hi = -1
      for (let y = b.top; y <= b.bottom; y++) {
        if (loPerRow[y] >= 0 && loPerRow[y] < lo) lo = loPerRow[y]
        if (hiPerRow[y] > hi) hi = hiPerRow[y]
      }
      return hi >= lo ? { lo, hi } : null
    }

    const figRange = bandRange(fig)

    // 向下合并：被内部间隙切碎的图形子块 + 图形下方的顶点字母 / 图注。
    // ⚠️ 不能「遇到文字带就 break」：顶点字母（C/B/F）与「图1」「图2」图注的横向跨度
    //    常达到本裁片最宽带的 50%+，会被判成文字带 —— 一律 break 就会把底部标注整条切掉
    //    （嘉定一模 23/25 实测：C/B/F、A/C、图1/图2 全部缺失）。
    //    闸口改为「横向范围 ≥80% 落在图形范围内」：图注一定在图幅正下方，
    //    而真·正文行会明显超出图幅（页面整宽），仍会被 break 挡住。
    const insideFigRatio = (br) => {
      if (!br || !figRange) return 0
      const overlap = Math.min(br.hi, figRange.hi) - Math.max(br.lo, figRange.lo) + 1
      if (overlap <= 0) return 0
      return overlap / (br.hi - br.lo + 1)
    }
    let figBottomInk = fig.bottom
    for (const b of bands) {
      if (b.top <= fig.bottom) continue
      if (b.top - figBottomInk - 1 > 40) break
      if (isTextBand(b) && insideFigRatio(bandRange(b)) < 0.8) break
      figBottomInk = b.bottom
    }

    // 向上合并图标注（顶点字母 / 坐标轴箭头常在图正上方、窄且紧贴图）。
    // ⚠️ 必须用「与图横向范围重叠」作闸：页面左缘的短文字行（如「坐标；」「坐标.」）
    // 同样是窄带，但它们在图幅左侧之外，并入就会把文字裹进配图（嘉定 24 实测）。
    let figTopInk = fig.top
    const above = bands.filter(b => b.bottom < fig.top).sort((a, b) => b.bottom - a.bottom)
    for (const b of above) {
      if (figTopInk - b.bottom - 1 > 40) break
      if (isTextBand(b)) break
      const br = bandRange(b)
      if (!br || !figRange) break
      const overlap = Math.min(br.hi, figRange.hi) - Math.max(br.lo, figRange.lo) + 1
      const bw = br.hi - br.lo + 1
      if (overlap <= 0 || overlap < bw * 0.5) break
      figTopInk = b.top
    }

    // 顶部留白：不得与上一带（文字）重叠
    let prevBottom = -1
    for (const b of bands) if (b.bottom < figTopInk) prevBottom = Math.max(prevBottom, b.bottom)
    const gapAbove = prevBottom >= 0 ? figTopInk - prevBottom - 1 : 8
    const topMargin = Math.min(4, Math.max(0, Math.floor(gapAbove / 2)))
    const figTop = Math.max(0, figTopInk - topMargin)
    const figBottom = Math.min(height, figBottomInk + 6)
    const figH = figBottom - figTop
    if (figH < 50 || figH < height * 0.25) return null

    // ── 横向裁紧（2026-11-03）──
    // 源裁片是「整页宽」的横条（实测 2144px 宽），而图形常常只占其中一小块，
    // 左右大片空白会同时造成两个观感问题（嘉定一模 23 题实测：图形仅占宽 12%）：
    //   ① 配图缩到 55% 页宽后，图形本身只剩约 15mm —— 显得「尺寸太小」；
    //   ② 图形被左侧空白推到横条中部 —— 看起来像「居中」，而不是靠左。
    // 这里按图形墨迹的水平范围裁到图形本身（两侧各留 1% 余量），
    // 使配图「图形占满图幅」：既靠左、又足够大。
    let inkLeft = width
    let inkRight = -1
    for (let y = figTop; y < figBottom; y++) {
      const off = y * width
      for (let x = 0; x < width; x++) {
        if (data[off + x] < 200) {
          if (x < inkLeft) inkLeft = x
          if (x > inkRight) inkRight = x
        }
      }
    }
    let cropLeft = 0
    let cropWidth = width
    if (inkRight >= inkLeft) {
      const padX = Math.max(8, Math.round(width * 0.01))
      cropLeft = Math.max(0, inkLeft - padX)
      cropWidth = Math.min(width, inkRight + padX + 1) - cropLeft
    }
    // 极端情况（横向墨迹范围过小）退化为整幅宽，避免裁出细条
    if (cropWidth < 40) { cropLeft = 0; cropWidth = width }

    return await sharp(cropBuffer)
      .extract({ left: cropLeft, top: figTop, width: cropWidth, height: figBottom - figTop })
      .jpeg({ quality: 82 })
      .toBuffer()
  } catch (e) {
    console.warn('[paperFigureAssign] 图形带提取失败:', e.message)
    return null
  }
}
