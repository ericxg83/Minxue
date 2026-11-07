/**
 * clipFigureClean.js — 截图入题库专用「配图提取」（2026-11-07）
 *
 * ── 为什么要单独一条链 ──
 * 试卷题库主链路的配图判据（paperFigureAssign#analyzeCropFigure）是**白底黑墨**：
 * `isInk(v) = v < 200`，按行墨迹剖面找图形带、横向裁紧。它对印刷卷（白纸黑字）很准，
 * 但老师看网课/视频截下来的题是另一种版式：**深色黑板 + 白色/浅蓝笔迹 + 讲课老师人像
 * + 板书题干 + 播放器按钮**。深底让「几乎每个像素都是墨」，剖面退化成整块，
 * 主链路判不出图形 ⇒ image_url 为空 ⇒ parseClipImages 用整张截图顶上。
 * 负责人 2026-11-07 报障：「题目有了，但是配图并没有被提取出来」「我并不需要很杂乱的
 * 信息，比如说图片中的人像以及黑色背景」「和讲解版要求出来的质量有很大的差异」。
 *
 * ── 本模块的口径 ──
 * 配图 = **白底、只有几何图形与顶点字母**，与讲解版/讲义的 4x 高清裁片同一观感标准
 * （2026-11-03 定稿：靠左、图形占满图幅、标注完整）。做法是三段，全部确定性像素，
 * 只有「框选图形区域」用一次视觉模型：
 *   ① 视觉模型只框几何图形（明确排除人像 / 板书文字 / UI / 深色背景），短 prompt 只做一件事；
 *   ② 深底反相 + 分段白底化：亮笔迹 → 深墨迹，黑底与中灰 → 纯白；
 *      浅底截图（PPT/试卷翻拍）不反相，只做同款白底化；
 *   ③ **笔迹连通域掩膜**：只保留与最大图形块空间相邻的笔迹块（含顶点字母），
 *      块外一律涂白 ⇒ 人像、黑板渐变、板书文字、按钮全部消失，图形骨架零改动。
 *      最后按保留块的包围盒裁紧，图形占满图幅。
 *
 * ⛔ 两条纪律：
 *   1. 不做生成式超分/重绘 —— 那是判题依据，重绘会悄悄改线条位置（2026-11-06 图形选项
 *      高清化已定过这个口径）。11-03 负责人也明确「试卷题库不需要矢量，要高清裁片」。
 *   2. 任何一步不达标就返回 null（**不挂配图**），绝不退回整张截图。
 *      原截图仍留在 page_image_url，老师点「看原截图」能看到；宁可不给图，不给脏图。
 */

import sharp from 'sharp'
import { callVisionCompletion, GENERAL_OCR_VENDOR_CHAIN } from '../config/ai.js'

const MEASURE_WIDTH = 1000
/** 模型框外扩（归一化 0-1000）：保住框边缘的顶点字母 A/B/C，实测 20 够 */
const BOX_PAD_NORM = 20
/** 深底板书的亮笔迹 / 浅底印刷的深墨迹，共用同一阈值 */
const STROKE_THRESHOLD = 150
/** 裁片灰度中位数低于此 ⇒ 判为深底板书（需要反相） */
const DARK_BOARD_MEDIAN = 110
/** 小于这个面积的连通块当噪点丢弃 */
const MIN_COMPONENT_AREA = 20
/** 主图形块占裁片面积的下限/上限：太小=没图，太大=整块色块（人像/背景） */
const MIN_MAIN_FRAC = 0.002
const MAX_MAIN_FRAC = 0.35
/** 成品最小边长与允许宽高比 */
const MIN_SIDE = 120
const MIN_RATIO = 0.15
const MAX_RATIO = 7
/** 成品白底像素占比下限 */
const MIN_WHITE_FRAC = 0.6

export const CLIP_FIGURE_PROMPT = `你是图像区域定位器。这是一张网课/板书/视频截图，请找出【题目配图：几何图形、函数图象或示意图】的外接矩形。

只输出 JSON，不要解释：
{"has_figure":true,"box":{"x":0,"y":0,"width":0,"height":0}}

坐标是 0-1000 归一化整数（x、width 相对整张图宽，y、height 相对整张图高，原点左上）。

【必须排除，框内不许出现】
- 讲课老师的**人像、头部、身体、衣服**（整体排除，一点都不许留）
- 板书/印刷的**题干文字**、下划线、标题、答案
- 播放器按钮、UI 图标、水印、页面边框
- 纯黑或深色的空背景

【框要贴紧】包含图形全部线条与所有顶点字母（A/B/C/D/E/F）、图注，但不要多包一大圈背景。
如果画面里根本没有几何图形或示意图（只有文字），输出 {"has_figure":false}。`

/**
 * 解析模型给的图形框 + 退化闸（纯函数，便于回归测试）。
 * @returns {{hasFigure:boolean, box?:{x,y,width,height}, reason?:string}}
 */
export function parseFigureBox(content) {
  const raw = typeof content === 'string' ? content : String(content ?? '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const whole = (fenced ? fenced[1] : raw).match(/\{[\s\S]*\}/)?.[0] || (fenced ? fenced[1] : raw)
  let obj
  try { obj = JSON.parse(whole.trim()) } catch { return { hasFigure: false, reason: 'unparseable' } }
  if (obj?.has_figure === false) return { hasFigure: false, reason: 'model-said-no-figure' }
  const b = obj?.box
  if (!b) return { hasFigure: false, reason: 'no-box' }
  const box = { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) }
  if (!Object.values(box).every(Number.isFinite)) return { hasFigure: false, reason: 'non-numeric' }
  if (box.x < -20 || box.y < -20 || box.width < 80 || box.height < 80 ||
      box.width > 950 || box.height > 950) return { hasFigure: false, reason: 'box-size' }
  // 整页占位框：模型没认真看，直接拒（拒了不挂图，比挂一张带人像的整页图好）
  if (box.width * box.height > 900000) return { hasFigure: false, reason: 'full-page' }
  return { hasFigure: true, box }
}

/**
 * 8 邻域连通域标记（纯函数）。
 * @param {Uint8Array|Buffer} gray 单通道灰度像素
 * @param {(v:number)=>boolean} isStroke 笔迹判据
 * @returns {{labels:Int32Array, comps:Array<{id,area,x0,y0,x1,y1}>}}
 */
export function labelStrokes(gray, width, height, isStroke) {
  const n = width * height
  const labels = new Int32Array(n)
  const stack = new Int32Array(n)
  const comps = []
  let next = 1
  for (let p = 0; p < n; p++) {
    if (labels[p] || !isStroke(gray[p])) continue
    let sp = 0
    stack[sp++] = p
    labels[p] = next
    let area = 0, x0 = width, y0 = height, x1 = -1, y1 = -1
    while (sp > 0) {
      const q = stack[--sp]
      const y = Math.floor(q / width)
      const x = q - y * width
      area++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const r = ny * width + nx
          if (labels[r] || !isStroke(gray[r])) continue
          labels[r] = next          // 先标记再入栈：每个像素最多入栈一次
          stack[sp++] = r
        }
      }
    }
    comps.push({ id: next, area, x0, y0, x1, y1 })
    next++
  }
  return { labels, comps }
}

/**
 * 从连通块里挑出「属于这幅图」的块（纯函数）。
 *
 * 主块 = 面积最大的那块（几何线条彼此相连，天然是一整块；顶点字母是各自独立的小块）。
 * 保留 = 面积达标 **且** 落在「主块包围盒外扩 10%（至少 40px）」内的块。
 * 外扩是为了把图上方/下方的顶点字母 A/B/C/D 收进来；贴边且远离图形的人像高光块
 * （实测 2026-11-07 那张截图：bbox x=0..23，主块左缘 x=91）会被这个判据挡在外面。
 *
 * @returns {{main:object, keep:Array, box:{x0,y0,x1,y1}}|null}
 */
export function pickFigureComponents(comps, width, height) {
  if (!comps?.length) return null
  const total = width * height
  let main = comps[0]
  for (const c of comps) if (c.area > main.area) main = c
  const frac = main.area / total
  if (frac < MIN_MAIN_FRAC || frac > MAX_MAIN_FRAC) return null
  if (main.x1 - main.x0 + 1 < 40 || main.y1 - main.y0 + 1 < 40) return null

  const m = Math.max(40, Math.round(Math.max(width, height) * 0.10))
  const reg = { x0: main.x0 - m, y0: main.y0 - m, x1: main.x1 + m, y1: main.y1 + m }
  const keep = comps.filter(c => c.area >= MIN_COMPONENT_AREA &&
    !(c.x1 < reg.x0 || c.x0 > reg.x1 || c.y1 < reg.y0 || c.y0 > reg.y1))
  if (!keep.length) return null
  return {
    main,
    keep,
    box: {
      x0: Math.min(...keep.map(c => c.x0)),
      y0: Math.min(...keep.map(c => c.y0)),
      x1: Math.max(...keep.map(c => c.x1)),
      y1: Math.max(...keep.map(c => c.y1)),
    },
  }
}

/** 灰度中位数（直方图，O(n) 无需排序）。 */
function medianGray(gray) {
  const hist = new Int32Array(256)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const half = Math.floor(gray.length / 2)
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc > half) return v
  }
  return 128
}

/**
 * 把「裁片 + 保留块」渲染成白底成品（纯函数，返回单通道像素与裁切框）。
 * 深底板书：反相 + 洗中灰；浅底印刷：只做分段白底化（与 2026-11-06 图形选项高清化同款）。
 * 块外一律纯白 —— 这是去掉人像/黑板渐变/板书文字的关键一步。
 */
export function renderCleanFigure(gray, width, height, labels, picked, darkBoard) {
  const n = width * height
  const keepIds = new Set(picked.keep.map(c => c.id))
  const core = new Uint8Array(n)
  for (let p = 0; p < n; p++) if (keepIds.has(labels[p])) core[p] = 1
  // 膨胀 1px：保住笔迹的抗锯齿边缘，不让线条发虚
  const mask = new Uint8Array(core)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (!core[p]) continue
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          mask[ny * width + nx] = 1
        }
      }
    }
  }

  const out = new Uint8Array(n)
  let white = 0
  for (let p = 0; p < n; p++) {
    if (!mask[p]) { out[p] = 255; white++; continue }
    const v = gray[p]
    let c
    if (darkBoard) {
      const inv = 255 - v
      const w = Math.min(1, Math.max(0, (inv - 110) / 30))
      c = inv * (1 - w) + 255 * w
    } else {
      const w = Math.min(1, Math.max(0, (v - 150) / 35))
      c = v * (1 - w) + 255 * w
    }
    const q = Math.round(c)
    out[p] = q
    if (q === 255) white++
  }

  // 按保留块的包围盒裁紧（图形占满图幅 = 讲解版配图标准②）
  const px = Math.max(8, Math.round(width * 0.025))
  const py = Math.max(8, Math.round(height * 0.025))
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < x0) return null
  const left = Math.max(0, x0 - px)
  const top = Math.max(0, y0 - py)
  const right = Math.min(width, x1 + px + 1)
  const bottom = Math.min(height, y1 + py + 1)
  const w = right - left
  const h = bottom - top
  const ratio = w / h
  if (w < MIN_SIDE || h < MIN_SIDE || ratio < MIN_RATIO || ratio > MAX_RATIO) return null
  if (white / n < MIN_WHITE_FRAC) return null
  return { out, left, top, width: w, height: h, sourceWidth: width, whiteFrac: white / n }
}

/**
 * 从一张截图里提取干净的几何配图。
 * @param {Buffer} imageBuffer 原始截图
 * @returns {Promise<{buffer:Buffer|null, reason:string}>} 失败时 buffer 为 null，调用方不得挂配图
 */
export async function extractClipFigure(imageBuffer, { logger = console } = {}) {
  try {
    const meta = await sharp(imageBuffer).metadata()
    const W = Number(meta.width) || 0
    const H = Number(meta.height) || 0
    if (W < 200 || H < 200) return { buffer: null, reason: 'image-too-small' }

    const jpeg = await sharp(imageBuffer)
      .resize({ width: MEASURE_WIDTH, fit: 'inside' })
      .jpeg({ quality: 82 })
      .toBuffer()

    let parsed
    try {
      const r = await callVisionCompletion({
        imageDataURL: 'data:image/jpeg;base64,' + jpeg.toString('base64'),
        systemPrompt: CLIP_FIGURE_PROMPT,
        userText: '请框出这张截图里的题目几何配图。',
        temperature: 0.05,
        maxTokens: 512,
        vendorChain: GENERAL_OCR_VENDOR_CHAIN,
      })
      parsed = parseFigureBox(r?.content)
    } catch (e) {
      logger.warn?.(`[clipFigure] 图形框选失败: ${e?.message || e}`)
      return { buffer: null, reason: 'vision-failed' }
    }
    if (!parsed.hasFigure) return { buffer: null, reason: parsed.reason }

    const p = BOX_PAD_NORM
    const x0 = Math.max(0, Math.round((parsed.box.x - p) / 1000 * W))
    const y0 = Math.max(0, Math.round((parsed.box.y - p) / 1000 * H))
    const x1 = Math.min(W, Math.round((parsed.box.x + parsed.box.width + p) / 1000 * W))
    const y1 = Math.min(H, Math.round((parsed.box.y + parsed.box.height + p) / 1000 * H))
    if (x1 - x0 < 80 || y1 - y0 < 80) return { buffer: null, reason: 'crop-too-small' }

    const cropped = await sharp(imageBuffer)
      .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      .greyscale().raw().toBuffer({ resolveWithObject: true })
    const gray = cropped.data
    const cw = cropped.info.width
    const ch = cropped.info.height
    if (gray.length < cw * ch) return { buffer: null, reason: 'raw-short' }

    const darkBoard = medianGray(gray) < DARK_BOARD_MEDIAN
    const isStroke = darkBoard
      ? (v) => v > STROKE_THRESHOLD
      : (v) => v < STROKE_THRESHOLD
    const { labels, comps } = labelStrokes(gray, cw, ch, isStroke)
    const picked = pickFigureComponents(comps, cw, ch)
    if (!picked) return { buffer: null, reason: 'no-main-figure' }
    const clean = renderCleanFigure(gray, cw, ch, labels, picked, darkBoard)
    if (!clean) return { buffer: null, reason: 'quality-gate' }

    // 单通道 → 3 通道 raw，交给 sharp 输出带 sRGB 的 JPEG（下游 raw() 才不会报色彩空间未设）
    const rgb = Buffer.alloc(clean.out.length * 3)
    for (let i = 0; i < clean.out.length; i++) {
      const v = clean.out[i]
      rgb[i * 3] = v
      rgb[i * 3 + 1] = v
      rgb[i * 3 + 2] = v
    }
    const buffer = await sharp(rgb, { raw: { width: clean.sourceWidth, height: ch, channels: 3 } })
      .extract({ left: clean.left, top: clean.top, width: clean.width, height: clean.height })
      .withMetadata({ icc: 'srgb' })
      .jpeg({ quality: 92 })
      .toBuffer()
    logger.info?.(`[clipFigure] 配图提取成功 ${clean.width}x${clean.height} darkBoard=${darkBoard} 白底=${(clean.whiteFrac * 100).toFixed(1)}%`)
    return { buffer, reason: 'ok' }
  } catch (e) {
    logger.warn?.(`[clipFigure] 配图提取异常: ${e?.message || e}`)
    return { buffer: null, reason: 'error' }
  }
}
