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
 * 从源行裁片里抠「图形带」：去掉顶部的小问文字行，只留下方的大块图形。
 * @param {Buffer} cropBuffer 源行裁片（页面坐标按行 bbox 裁出的 JPEG）
 * @returns {Promise<Buffer|null>} 图形带裁片；找不到干净的图形带返回 null（调用方用整张源裁片兜底）
 *
 * 算法（按行 ink 剖面分带）：
 * - 灰度 < 200 记为墨点，一行墨点数 ≥ max(2, 宽×0.8%) 视为「有墨行」；
 * - 连续有墨行聚成带，带间空白断开；
 * - 图形带 = 第一条高度 ≥ max(70px, 2.2×前方带高中位数) 的带（文字带实测 20-40px）；
 * - 输出 = 该带 [top..bottom] 全宽；整带高须 ≥ 裁片高 25% 且 ≥ 50px，否则放弃。
 */
export async function extractFigureBandFromCrop(cropBuffer) {
  try {
    const { data, info } = await sharp(cropBuffer).greyscale().raw().toBuffer({ resolveWithObject: true })
    const width = Number(info.width) || 0
    const height = Number(info.height) || 0
    if (width < 40 || height < 60) return null

    const inkPerRow = new Array(height).fill(0)
    for (let y = 0; y < height; y++) {
      const off = y * width
      let c = 0
      for (let x = 0; x < width; x++) if (data[off + x] < 200) c++
      inkPerRow[y] = c
    }

    // ── 图形定位（2026-11-03 重写）──
    // 真卷版式：文字在上、图形在下。用「最大的连续空白带」作文字/图形分界，
    // 取其下方墨迹（>=1 像素，能兜住三角形顶点等细线）作为图形；图形内部允许
    // <=40px 的小空隙（细线之间的空白）。图顶细线因此不会被切掉。
    let maxGap = 0, gapEnd = height
    {
      let run = 0
      for (let y = 0; y < height; y++) {
        if (inkPerRow[y] >= 1) {
          if (run > maxGap) { maxGap = run; gapEnd = y }
          run = 0
        } else {
          run++
        }
      }
      if (run > maxGap) { maxGap = run; gapEnd = height }
    }
    // 分界不明显（<25px）视为无文字：整片作为图形（取底部墨簇）
    const sep = maxGap >= 25 ? gapEnd : 0

    let figTop = -1, figBottom = -1, gap = 0
    for (let y = sep; y < height; y++) {
      if (inkPerRow[y] >= 1) { if (figTop === -1) figTop = y; figBottom = y; gap = 0 }
      else { gap++; if (gap > 40) break }
    }
    if (figTop === -1) return null
    // 越过分界再向上收几像素（分界线可能正压在某根细线上）
    figTop = Math.max(0, figTop - 6)
    if (figBottom < height) figBottom = Math.min(height, figBottom + 6)

    const figH = figBottom - figTop
    if (figH < 50 || figH < height * 0.25) return null

    return await sharp(cropBuffer)
      .extract({ left: 0, top: figTop, width, height: Math.min(figBottom, height) - figTop })
      .jpeg({ quality: 82 })
      .toBuffer()
  } catch (e) {
    console.warn('[paperFigureAssign] 图形带提取失败:', e.message)
    return null
  }
}
