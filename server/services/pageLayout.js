/**
 * 页图版面分析（纯图像，零模型调用）。
 *
 * 目的：视觉模型返回的 block_coordinates / text_bbox 不是「量」出来的，是「猜」出来的
 * （2026-09-20 复核：同一页 8 题，框间距恒定、宽度全 800，逐题向下累积漂移，
 *  第 1 题框画到了第 2~5 题上）。因此绝对坐标不可用，但**顺序**与**相对比例**基本可信。
 *
 * 本模块只做一件事：从页图墨迹投影里切出「文本行带」(line band)，
 * 给出每行带的上下边界与左右墨迹范围。上层再拿它把题目重新吸附到真实行上。
 *
 * 坐标系与全仓一致：归一化 0-1000（x 相对图宽，y 相对图高）。
 */

import sharp from 'sharp'

/** 默认参数（可用 opts 覆盖） */
const DEFAULTS = {
  workWidth: 500,        // 分析用降采样宽度：够用且快
  bgSigma: 18,           // 背景估计的模糊半径（工作图宽度单位）
  minDelta: 22,          // 判定为墨迹所需的最小「比背景暗」的幅度
  minRunInk: 0.012,      // 行被判为「有墨」所需的最小墨迹占比
  mergeGapRatio: 0.5,    // 相邻行带间距 < 行高中位数 * 该比例则合并（同一行的上下沿）
}

/**
 * 分析页图，切出文本行带。
 * @param {Buffer} imageBuffer 原图（jpg/png 均可）
 * @param {Object} [opts]
 * @returns {Promise<{width:number,height:number,bands:Array<{top:number,bottom:number,left:number,right:number,ink:number}>,lineHeight:number}>}
 *          top/bottom/left/right 均为归一化 0-1000 整数
 */
export async function analyzePageLayout (imageBuffer, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts }
  const base = sharp(imageBuffer).resize({ width: cfg.workWidth, fit: 'inside' }).greyscale()
  const { data, info } = await base.clone().raw().toBuffer({ resolveWithObject: true })
  // 背景估计：大半径高斯模糊把文字抹平，只留纸面明暗梯度（照片常见阴影/反光）
  const bgInfo = await base.clone().blur(cfg.bgSigma).raw().toBuffer({ resolveWithObject: true })
  const bg = bgInfo.data

  const W = info.width
  const H = info.height
  const px = (x, y) => data[y * W + x]
  const bgAt = (x, y) => bg[y * W + x]

  // 全局对比度尺度：用于把 minDelta 自适应到这张图的明暗范围
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i]
  const mean = sum / data.length
  let sq = 0
  for (let i = 0; i < data.length; i++) { const d = data[i] - mean; sq += d * d }
  const std = Math.sqrt(sq / data.length)
  const delta = Math.max(cfg.minDelta, 0.45 * std)

  // ── 2. 逐行墨迹统计（自适应：像素比背景暗 delta 以上才算墨） ──
  const rowInk = new Float32Array(H)
  const rowLeft = new Int32Array(H).fill(-1)
  const rowRight = new Int32Array(H).fill(-1)
  for (let y = 0; y < H; y++) {
    let c = 0, l = -1, r = -1
    for (let x = 0; x < W; x++) {
      if (px(x, y) < bgAt(x, y) - delta) { c++; if (l < 0) l = x; r = x }
    }
    rowInk[y] = c / W
    rowLeft[y] = l
    rowRight[y] = r
  }

  // ── 3. 切行带 ──
  const raw = []
  let cur = null
  for (let y = 0; y < H; y++) {
    const on = rowInk[y] >= cfg.minRunInk
    if (on) {
      if (!cur) cur = { top: y, bottom: y }
      else cur.bottom = y
    } else if (cur) { raw.push(cur); cur = null }
  }
  if (cur) raw.push(cur)

  // ── 4. 合并紧邻行带（一行文字的上下沿会被空白切开） ──
  const heights = raw.map(b => b.bottom - b.top + 1).sort((a, b) => a - b)
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 8
  const gapLimit = Math.max(1, Math.round(medH * cfg.mergeGapRatio))
  const merged = []
  for (const b of raw) {
    const prev = merged[merged.length - 1]
    if (prev && b.top - prev.bottom - 1 <= gapLimit) prev.bottom = b.bottom
    else merged.push({ ...b })
  }

  // ── 5. 计算左右墨迹范围 + 归一化 ──
  const toN = (v, total) => Math.round(v / total * 1000)
  const bands = merged
    .filter(b => (b.bottom - b.top + 1) >= 2)
    .map(b => {
      let l = -1, r = -1, ink = 0
      for (let y = b.top; y <= b.bottom; y++) {
        if (rowLeft[y] >= 0 && (l < 0 || rowLeft[y] < l)) l = rowLeft[y]
        if (rowRight[y] > r) r = rowRight[y]
        ink += rowInk[y]
      }
      return {
        top: toN(b.top, H),
        bottom: toN(b.bottom + 1, H),
        left: l < 0 ? 0 : toN(l, W),
        right: r < 0 ? 0 : toN(r + 1, W),
        ink: ink / (b.bottom - b.top + 1),
      }
    })

  return {
    width: W, height: H,
    bands,
    lineHeight: toN(medH, H),
    delta,
  }
}
