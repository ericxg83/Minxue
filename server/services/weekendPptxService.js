/**
 * 周末班错题课件 → 原生可编辑 PPTX（敏学品牌版，Node 端渲染）
 * ================================================================
 * 2026-09-17 方案 A 落地：后端直接用 pptxgenjs 渲染，替代 python-pptx 脚本，
 * 与 server/lib/weekendHandout.js（取数聚合）同栈，供 preview/generate API 复用。
 *
 * 样式规范：敏学 Design System（MINXUE_UI_DESIGN_SYSTEM.md）
 *   - 主色 #6366F1（Indigo-500）；白底 + 1px #E2E8F0 border 分层；无重阴影
 *   - 难度分档 = 状态色语义：基础→绿 #16A34A / 中等→主色 / 较难→橙 #D97706 / 未判定→灰 #64748B
 *   - 答案卡：浅色 mist 底（#EEF2FF）+ 左侧色条 + 「参考答案」小标
 *   - 圆角克制（10-12px 等）；字体微软雅黑（Win 放映最稳）
 *
 * 版式（与 weekend-handout-pptx.py 对齐）：
 *   封面 + 目录 + 分节页 ×N + 题目页 ×N（一页一道完整题，多小问已聚合）
 *   题干/答案高度动态分配 + 字号多档自适应（长答案不截断）
 */
import https from 'node:https'
import http from 'node:http'
import { URL } from 'node:url'

// ── 敏学 Design Tokens ──
const C_PRIMARY = '6366F1'
const C_PRIMARY_MIST = 'EEF2FF'
const C_TEXT = '1E293B'
const C_TEXT_2 = '64748B'
const C_TEXT_3 = '94A3B8'
const C_BORDER = 'E2E8F0'
const C_BORDER_LIGHT = 'F1F5F9'
const C_WHITE = 'FFFFFF'
const C_DANGER = 'DC2626'

const TIER_COLORS = {
  basic:   { fg: '16A34A', bg: 'DCFCE7' },
  medium:  { fg: C_PRIMARY, bg: C_PRIMARY_MIST },
  hard:    { fg: 'D97706', bg: 'FEF3C7' },
  unknown: { fg: C_TEXT_2, bg: C_BORDER_LIGHT },
}
const TIER_LABEL = { basic: '基础', medium: '中等', hard: '较难', unknown: '难度未判定' }

const FONT = 'Microsoft YaHei'
const PAGE_W = 13.333
const PAGE_H = 7.5
const MARGIN = 0.5

// ── 行数估算（与 python 版 char_w 同口径）──
function charW(c) {
  const o = c.codePointAt(0)
  if ((o >= 0x4e00 && o <= 0x9fff) || '，。；：、？！（）《》【】“”’·—…'.includes(c)) return 1
  return 0.55
}
export function estimateLines(text, sizePt, boxWIn) {
  if (!text) return 1
  const em = sizePt / 72
  const maxEm = boxWIn / em
  let lines = 0
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { lines += 1; continue }
    let w = 0
    for (const ch of para) {
      w += charW(ch)
      if (w > maxEm) { lines += 1; w = 0 }
    }
    lines += 1
  }
  return Math.max(lines, 1)
}

function downloadImage(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let u
    try { u = new URL(url) } catch { return resolve(null) }
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.get(url, { headers: { 'User-Agent': 'minxue-weekend-ppt/1.0' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null) }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', () => resolve(null))
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null) })
  })
}

/** 下载配图（并发限制 4，失败静默降级 → 页面无图不中断） */
async function fetchFigures(slides, { logger = () => {} } = {}) {
  const urls = [...new Set(slides.filter(s => s.kind === 'question' && s.figure).map(s => s.figure))]
  const map = new Map()
  let cursor = 0
  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor++]
      const buf = await downloadImage(url)
      if (buf && buf.length > 200) {
        // pptxgenjs 的 addImage({data}) 只收 base64 data URI 字符串（不收原始 Buffer）
        const mime = /\.png(\?|$)/i.test(url) ? 'image/png'
          : /\.webp(\?|$)/i.test(url) ? 'image/webp' : 'image/jpeg'
        map.set(url, `data:${mime};base64,${buf.toString('base64')}`)
      } else {
        logger(`   [图] 下载失败，跳过: ${String(url).slice(0, 80)}`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return map
}

// ── 基础构件 ──
function addBox(slide, x, y, w, h, { fill, line, radius } = {}) {
  return slide.addShape('roundRect', {
    x, y, w, h,
    fill: fill ? { color: fill, transparency: 0 } : { type: 'none' },
    line: line ? { color: line, width: 1 } : { type: 'none' },
    rectRadius: radius ?? 0.1,
  })
}

function addText(slide, x, y, w, h, text, opts = {}) {
  const {
    size = 13, bold = false, color = C_TEXT, align = 'left', lineSpacing = 1.0,
    valign = 'top', animation,
  } = opts
  const opt = {
    x, y, w, h,
    text: String(text ?? ''),
    fontSize: size, bold, color, fontFace: FONT,
    align, valign,
    lineSpacingMultiple: lineSpacing,
    margin: 0,
    autoFit: false,
    isTextBox: true,
  }
  if (animation) opt.animation = animation
  return slide.addText(opt.text, opt)
}

// ── 页面构建 ──
function buildCover(pptx, handout) {
  const s = pptx.addSlide()
  addBox(s, 0, 0, PAGE_W, 0.1, { fill: C_PRIMARY })
  addText(s, MARGIN, 1.3, PAGE_W - 1, 0.9, '周末错题讲评', { size: 40, bold: true })
  addText(s, MARGIN, 2.2, PAGE_W - 1, 0.5,
    `${handout.grade} · ${handout.period.start} ~ ${handout.period.end}`, { size: 18, color: C_TEXT_2 })
  addText(s, MARGIN, 2.75, PAGE_W - 1, 0.45,
    (handout.stats.studentNames || []).join('、'), { size: 14, color: C_TEXT_3 })

  const kpis = [
    ['错题', handout.stats.rawRows],
    ['去重题', handout.stats.topics],
    ['有课日', handout.stats.days],
    ['学生', handout.stats.students],
  ]
  const kw = (PAGE_W - 2 * MARGIN - 3 * 0.2) / 4
  kpis.forEach(([label, value], i) => {
    const x = MARGIN + i * (kw + 0.2)
    addBox(s, x, 3.5, kw, 1.15, { fill: C_WHITE, line: C_BORDER, radius: 0.08 })
    addBox(s, x + 0.16, 3.62, 0.06, 0.9, { fill: C_PRIMARY })
    addText(s, x + 0.35, 3.72, kw - 0.5, 0.55, String(value), { size: 30, bold: true })
    addText(s, x + 0.35, 4.28, kw - 0.5, 0.3, label, { size: 13, color: C_TEXT_2 })
  })
  addText(s, MARGIN, 6.7, PAGE_W - 1, 0.4,
    '放映时单击一次浮现参考答案 · 日期倒序 · 每天内部由易到难', { size: 12, color: C_TEXT_3 })
}

function buildToc(pptx, slides) {
  const s = pptx.addSlide()
  addBox(s, 0, 0, PAGE_W, 0.1, { fill: C_PRIMARY })
  addText(s, MARGIN, 0.5, 6, 0.6, '本份课件目录', { size: 26, bold: true })
  addText(s, 9.5, 0.6, 3.3, 0.4, '按日期倒序 · 每天内部由易到难', { size: 12, color: C_TEXT_3 })
  const secs = slides.filter(sl => sl.kind === 'section')
  const tw = PAGE_W - 2 * MARGIN
  const th = 0.62
  const ty = 1.35
  const headers = ['日期', '题数', '学生', '基础', '中等', '较难', '未判定']
  const widths = [0.3 * tw, 0.1 * tw, 0.12 * tw, 0.12 * tw, 0.12 * tw, 0.12 * tw, 0.12 * tw]
  headers.forEach((hdr, j) => {
    const x = MARGIN + widths.slice(0, j).reduce((a, b) => a + b, 0)
    addText(s, x, ty + 0.1, widths[j], 0.3, hdr,
      { size: 12, bold: true, color: C_TEXT_3, align: j === 0 ? 'left' : 'right' })
  })
  addBox(s, MARGIN, ty + 0.42, tw, 0.02, { fill: C_BORDER })
  secs.forEach((sec, i) => {
    const y = ty + 0.62 + i * th
    const vals = [sec.label, String(sec.topicCount), String(sec.studentCount),
      ...['basic', 'medium', 'hard', 'unknown'].map(k => String(sec.tiers?.[k] ?? 0))]
    vals.forEach((v, j) => {
      const x = MARGIN + widths.slice(0, j).reduce((a, b) => a + b, 0)
      addText(s, x, y + 0.12, widths[j], 0.4, v,
        { size: 15, bold: j === 0, align: j === 0 ? 'left' : 'right' })
    })
    addBox(s, MARGIN, y + th - 0.02, tw, 0.02, { fill: C_BORDER_LIGHT })
  })
}

function buildSection(pptx, sec, secIdx, secTotal) {
  const s = pptx.addSlide()
  addBox(s, 0, 0, PAGE_W, 0.1, { fill: C_PRIMARY })
  addBox(s, 0, 0.5, PAGE_W, 2.2, { fill: C_PRIMARY_MIST })
  addBox(s, MARGIN, 0.72, 0.08, 0.6, { fill: C_PRIMARY })
  addText(s, MARGIN + 0.25, 0.68, 6, 0.4, `SECTION ${String(secIdx).padStart(2, '0')} / ${String(secTotal).padStart(2, '0')}`,
    { size: 13, bold: true, color: C_PRIMARY })
  addText(s, MARGIN + 0.25, 1.25, 9, 0.9, sec.label || '', { size: 36, bold: true })
  addText(s, MARGIN + 0.25, 2.15, 11, 0.4,
    `${sec.topicCount} 题 · ${sec.studentCount} 名学生`, { size: 16, color: C_TEXT_2 })
  const stus = (sec.students || []).join('、')
  if (stus) addText(s, MARGIN + 0.25, 3.2, 11, 0.4, `错的学生：${stus}`, { size: 13, color: C_TEXT_3 })
  const tiers = sec.tiers || {}
  const parts = ['basic', 'medium', 'hard', 'unknown']
    .filter(k => tiers[k])
    .map(k => `${TIER_LABEL[k]} ${tiers[k]}`)
  if (parts.length) addText(s, MARGIN + 0.25, 3.7, 11, 0.4, parts.join(' · '), { size: 14, color: C_TEXT_2 })
}

function buildQuestion(pptx, q, seq, figMap) {
  const s = pptx.addSlide()
  const tier = q.tier || 'unknown'
  const { fg, bg } = TIER_COLORS[tier] || TIER_COLORS.unknown
  const tierLabel = TIER_LABEL[tier] || '难度未判定'
  const day = q.day || ''
  const qtype = q.typeLabel || '未标题型'

  // 页眉：题号徽章 + 日期 + 难度 + 人数
  addBox(s, MARGIN, 0.42, 0.62, 0.62, { fill: fg, radius: 0.25 })
  addText(s, MARGIN, 0.5, 0.62, 0.5, String(seq), { size: 22, bold: true, color: C_WHITE, align: 'center' })
  addText(s, MARGIN + 0.85, 0.52, 5.5, 0.4, `${day} · ${qtype}`, { size: 14, color: C_TEXT_2 })
  const d = q.difficulty
  const dlabel = d === null || d === undefined ? tierLabel : `难度 ${d} · ${tierLabel}`
  const tagW = 0.28 + dlabel.length * 0.13
  addBox(s, MARGIN + 0.85, 0.95, tagW, 0.34, { fill: bg, radius: 0.5 })
  addText(s, MARGIN + 0.85, 0.98, tagW, 0.3, dlabel, { size: 11.5, bold: true, color: fg, align: 'center' })
  const subParts = q.subParts || []
  if (subParts.length > 1) {
    addText(s, 4.2, 0.98, 3, 0.3, `含 ${subParts.length} 小问（完整题）`, { size: 11.5, color: C_TEXT_3 })
  }
  addText(s, 10.3, 0.52, 2.5, 0.4, `${q.studentCount || 0} 人错`, { size: 14, bold: true, color: C_TEXT_2, align: 'right' })
  addBox(s, MARGIN, 1.42, PAGE_W - 2 * MARGIN, 0.02, { fill: C_BORDER })

  // 内容区：题干 + 答案 动态分配高度
  const hasFig = !!q.figure && figMap.has(q.figure)
  const stemW = hasFig ? (PAGE_W - 2 * MARGIN - 3.5) : (PAGE_W - 2 * MARGIN)
  const stemX = MARGIN
  const parent = q.parentStem || ''
  const subTexts = subParts.length > 1
    ? subParts.map(sp => `(${sp.subNo}) ${String(sp.content || '').trim()}`.trimEnd())
    : [q.stem || '']
  const ans = q.answer || ''
  const ansSource = q.answerSourceLabel || ''
  const ansRisk = q.answerRisk || null
  const missing = q.missingSubs || []

  const STEM_TOP = 1.62
  const FIG_BOTTOM = 6.9
  const PAGE_BOTTOM = 7.15

  // 选字号：题干 17→15→13，答案 14→12→10.5→9，直到总高度放得下
  let stemSize = 17
  let ansSize = 14
  for (let iter = 0; iter < 4; iter++) {
    let stemLines = estimateLines(parent, stemSize, stemW)
    for (const st of subTexts) stemLines += estimateLines(st, stemSize, stemW - 0.3)
    const ansLines = estimateLines(ans, ansSize, PAGE_W - 2 * MARGIN - 0.6)
    const stemH = stemLines * stemSize * 1.25 / 72 + 0.15
    const ansH = 0.5 + ansLines * ansSize * 1.2 / 72
    const figH = FIG_BOTTOM - STEM_TOP
    const stemBottom = Math.min(STEM_TOP + stemH, 5.6)
    const ansTop = Math.max(stemBottom + 0.18, 4.7)
    const totalOk = (ansTop + ansH <= PAGE_BOTTOM) && (stemH <= figH)
    if (totalOk) break
    if (stemSize > 13) stemSize -= 2
    else ansSize = Math.max(9, ansSize - 1.5)
  }
  // 兜底：仍超时再压答案
  for (let iter = 0; iter < 3; iter++) {
    const ansLines = estimateLines(ans, ansSize, PAGE_W - 2 * MARGIN - 0.6)
    const ansH = 0.5 + ansLines * ansSize * 1.2 / 72
    let stemLines = estimateLines(parent, stemSize, stemW)
    for (const st of subTexts) stemLines += estimateLines(st, stemSize, stemW - 0.3)
    const stemH = stemLines * stemSize * 1.25 / 72 + 0.15
    const stemBottom = Math.min(STEM_TOP + stemH, 5.6)
    const ansTop = Math.max(stemBottom + 0.18, 4.7)
    if (ansTop + ansH <= PAGE_BOTTOM) break
    ansSize = Math.max(9, ansSize - 1.5)
  }

  // 题干文本框
  let stemLines = estimateLines(parent, stemSize, stemW)
  for (const st of subTexts) stemLines += estimateLines(st, stemSize, stemW - 0.3)
  const stemH = stemLines * stemSize * 1.25 / 72 + 0.15
  const stemBottom = Math.min(STEM_TOP + stemH, 5.6)
  const boxH = Math.max(stemBottom - STEM_TOP, 0.3)

  const paras = []
  if (parent) {
    paras.push({ text: parent, options: { bold: true, breakLine: true } })
    if (subTexts[0]) paras.push({ text: '', options: { fontSize: 4, breakLine: true } })
  }
  subTexts.forEach((st, i) => {
    paras.push({
      text: st,
      options: { bold: false, breakLine: i < subTexts.length - 1,
        spaceBefore: (!parent && i === 0) ? 0 : 6 },
    })
  })
  const tb = s.addText(paras, {
    x: stemX, y: STEM_TOP, w: stemW, h: boxH,
    fontSize: stemSize, color: C_TEXT, fontFace: FONT,
    lineSpacingMultiple: 1.25, valign: 'top', margin: 0, isTextBox: true,
  })

  // 缺小问提示
  if (missing.length) {
    addText(s, stemX, Math.min(stemBottom + 0.05, 5.55), 9.5, 0.3,
      `⚠ 本题错在第 ${missing.join('、')} 问，但题库缺该小问题干 — 讲前请看原卷图`,
      { size: 12, bold: true, color: C_DANGER })
  }

  // 配图（右置白卡 + border）
  if (hasFig) {
    const buf = figMap.get(q.figure)
    if (buf) {
      const fx = PAGE_W - MARGIN - 3.1
      const fh = Math.max(Math.min(FIG_BOTTOM, stemBottom + 0.5) - STEM_TOP, 1.0)
      addBox(s, fx, STEM_TOP, 3.1, fh, { fill: C_WHITE, line: C_BORDER, radius: 0.05 })
      try {
        s.addImage({ data: buf, x: fx + 0.2, y: STEM_TOP + 0.15, w: 2.7, h: Math.max(fh - 0.3, 1.0),
          sizing: { type: 'contain', w: 2.7, h: Math.max(fh - 0.3, 1.0) } })
      } catch { /* 图损坏跳过 */ }
    }
  }

  // 答案卡（底部，高度自适应）
  const ansLines = estimateLines(ans, ansSize, PAGE_W - 2 * MARGIN - 0.6)
  let ansH = 0.5 + ansLines * ansSize * 1.2 / 72
  let ansTop = Math.max(stemBottom + 0.18, 4.7)
  if (ansTop + ansH > PAGE_BOTTOM) ansH = PAGE_BOTTOM - ansTop
  addBox(s, MARGIN, ansTop, PAGE_W - 2 * MARGIN, ansH, { fill: C_PRIMARY_MIST })
  addBox(s, MARGIN, ansTop, 0.07, ansH, { fill: C_PRIMARY })
  const ansCard = s.addText(`参考答案${ansSource ? ' · ' + ansSource : ''}`, {
    x: MARGIN + 0.25, y: ansTop + 0.1, w: 6, h: 0.28,
    fontSize: 10.5, bold: true, color: C_PRIMARY, fontFace: FONT,
    margin: 0, isTextBox: true,
  })
  if (ans) {
    addText(s, MARGIN + 0.25, ansTop + 0.36, PAGE_W - 2 * MARGIN - 0.6,
      Math.max(ansH - 0.44, 0.5), ans,
      { size: ansSize, bold: true, lineSpacing: 1.2, animation: 'fade' })
  } else {
    addText(s, MARGIN + 0.25, ansTop + 0.4, 9, 0.35,
      '参考答案暂缺 — 讲前请人工补', { size: 13, color: C_DANGER })
  }
  if (ansRisk) {
    addText(s, MARGIN + 0.25, ansTop + Math.max(ansH - 0.3, 0.1), 11, 0.28,
      `⚠ ${ansRisk}`, { size: 10, color: C_DANGER })
  }
}

/**
 * 渲染整份 PPTX
 * @param {object} handout buildHandout() 返回值
 * @returns {Promise<Buffer>}
 */
export async function renderWeekendPptx(handout, { logger = () => {} } = {}) {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'WIDE', width: PAGE_W, height: PAGE_H })
  pptx.layout = 'WIDE'
  pptx.author = '敏学'
  pptx.company = '敏学'
  pptx.title = handout.title

  const slides = handout.slides || []
  const figMap = await fetchFigures(slides, { logger })

  buildCover(pptx, handout)
  buildToc(pptx, slides)

  const secs = slides.filter(sl => sl.kind === 'section')
  const secTotal = secs.length
  let totalQ = 0
  secs.forEach((sec, secIdx) => {
    buildSection(pptx, sec, secIdx + 1, secTotal)
    const day = sec.label
    // 序号按节从 1 起（与预览页「题单预览」的节内编号一致，方便边看边对）
    let seq = 0
    for (const q of slides.filter(sl => sl.kind === 'question' && sl.sectionLabel === day)) {
      seq += 1
      totalQ += 1
      buildQuestion(pptx, q, seq, figMap)
    }
  })

  const buf = await pptx.write({ outputType: 'nodebuffer' })
  logger(`[ppt] 渲染完成: ${totalQ} 题 / ${secs.length} 分节, ${buf.length} bytes`)
  return buf
}
