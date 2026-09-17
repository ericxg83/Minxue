/**
 * weekendHandout.js — 周末班错题课件 API（方案 A：后端取数 + Node 端渲染 PPTX）
 * ================================================================
 * POST /api/weekend-ppt/preview
 *   Body: { grade?, from?, to?, days?, students?: string[], subject?,
 *           maxPerDay?, limit?, mergeThin?, withAnswer? }
 *   → 题单预览（按天分组、每题含题干/小问/答案/难度/共错人数/配图URL/缺小问标记）
 *
 * POST /api/weekend-ppt/generate
 *   Body: 同 preview + selected: number[]   ← 前端勾选的 question slide index
 *   → 原生可编辑 PPTX 二进制流（Content-Disposition attachment）
 *
 * 口径 = server/lib/weekendHandout.js（与 CLI 脚本 weekend-handout.mjs 同源），
 * 样式 = server/services/weekendPptxService.js（敏学品牌 token）。
 */
import { Router } from 'express'
import pg from 'pg'
import { buildHandout } from '../lib/weekendHandout.js'
import { renderWeekendPptx } from '../services/weekendPptxService.js'

const router = Router()

// 单例连接池（与 config/neon.js getPool 同级配置；buildHandout 需要传入 pool）
let _pool = null
function getPool() {
  if (!_pool) {
    const connectionString = process.env.NEON_DATABASE_URL
    if (!connectionString) throw new Error('数据库未配置：缺少 NEON_DATABASE_URL 环境变量')
    _pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 5 })
  }
  return _pool
}

/** 参数归一化：只取认识的白名单字段，非法值回退默认 */
function sanitizeParams(body = {}) {
  const num = (v, dft) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : dft
  }
  const str = (v, dft = '') => (typeof v === 'string' ? v.trim() : dft)
  const arr = (v) => (Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : [])
  const params = {
    grade: str(body.grade, '初三') || '初三',
    subject: str(body.subject),
    days: num(body.days, 20),
    from: str(body.from) || undefined,
    to: str(body.to) || undefined,
    students: arr(body.students),
    maxPerDay: num(body.maxPerDay, 0),
    limit: num(body.limit, 0),
    mergeThin: num(body.mergeThin, 0),
    withAnswer: body.withAnswer !== false,
  }
  return params
}

/** 按 selected 勾选重建 handout（section 统计量同步重算） */
function applySelection(handout, selected) {
  const sel = new Set((selected || []).map(Number).filter(Number.isInteger))
  if (sel.size === 0) return handout
  const slides = handout.slides
  const keptQ = slides.filter(s => s.kind === 'question' && sel.has(s.index))
  if (keptQ.length === 0) throw new Error('选中的题目为空，未生成课件。')
  const keptSections = slides.filter(s => s.kind === 'section')
  // 重算每个 section 的分节统计
  const secTopics = new Map()
  for (const q of keptQ) {
    const k = q.sectionLabel
    if (!secTopics.has(k)) secTopics.set(k, [])
    secTopics.get(k).push(q)
  }
  const newSections = keptSections.map(sec => {
    const qs = secTopics.get(sec.label) || []
    const newTiers = { basic: 0, medium: 0, hard: 0, unknown: 0 }
    for (const q of qs) {
      const k = q.tier || 'unknown'
      if (newTiers[k] !== undefined) newTiers[k] += 1
    }
    return { ...sec, topicCount: qs.length, tiers: newTiers }
  })
  // 重建 slides：section 用新统计，question 只留勾选
  const newSlides = []
  for (const sec of newSections) {
    newSlides.push(sec)
    for (const q of keptQ) {
      if (q.sectionLabel === sec.label) newSlides.push(q)
    }
  }
  const stats = {
    ...handout.stats,
    topics: keptQ.length,
    questionSlides: keptQ.length,
    sections: newSections.length,
  }
  return { ...handout, slides: newSlides, sections: newSections, stats, overview: [] }
}

/**
 * POST /api/weekend-ppt/preview
 * 题单预览（供前端展示与勾选）。不落盘、不生成文件。
 */
router.post('/api/weekend-ppt/preview', async (req, res) => {
  const t0 = Date.now()
  try {
    const params = sanitizeParams(req.body)
    const handout = await buildHandout({ pool: getPool(), ...params, logger: m => console.log(`[weekendPpt] ${m}`) })
    console.log(`[weekendPpt] preview OK grade=${params.grade} 时段=${handout.periodLabel} 题=${handout.stats.topics} ${Date.now() - t0}ms`)
    res.json({ success: true, handout })
  } catch (error) {
    console.error('[weekendPpt] preview 失败:', error)
    res.status(400).json({ error: error.message })
  }
})

/**
 * POST /api/weekend-ppt/generate
 * 选中题目 → 渲染 PPTX 二进制返回（前端 Blob 下载，不落盘）。
 */
router.post('/api/weekend-ppt/generate', async (req, res) => {
  const t0 = Date.now()
  try {
    const params = sanitizeParams(req.body)
    const selected = req.body?.selected
    if (!Array.isArray(selected) || selected.length === 0) {
      return res.status(400).json({ error: '缺少 selected（勾选的题目 index 数组）' })
    }
    const handout = await buildHandout({ pool: getPool(), ...params, logger: m => console.log(`[weekendPpt] ${m}`) })
    const picked = applySelection(handout, selected)
    const buffer = await renderWeekendPptx(picked, { logger: m => console.log(`[weekendPpt] ${m}`) })

    const safeName = `${picked.grade}${picked.subject ? '_' + picked.subject : ''}_周末班错题课件_${picked.period.start}_${picked.period.end}`
      .replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)
    const finalName = `${safeName}.pptx`

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(finalName)}"`)
    res.setHeader('Content-Length', buffer.length)
    res.send(buffer)
    console.log(`[weekendPpt] generate OK ${picked.stats.topics} 题 ${buffer.length} bytes ${Date.now() - t0}ms`)
  } catch (error) {
    console.error('[weekendPpt] generate 失败:', error)
    res.status(400).json({ error: error.message })
  }
})

export default router