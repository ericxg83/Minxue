/**
 * 发布 DSL 重绘图：SVG → PNG → OSS → 更新 questions.clean_geometry_image_url
 *
 * 背景（2026-09-19 17:35 用户反馈"线上课件图片没变"）：课件生成器与前端展示
 * 配图读的是 `clean_geometry_image_url` / `geometry_image_url`（图片 URL），
 * 而批量重绘只写了 `clean_geometry_svg`（SVG 文本字段）→ 展示链路不消费 → 图不变。
 * 本脚本把已重绘的 SVG 栅格化上传 OSS，回填 clean_geometry_image_url，全链路立即生效。
 *
 * 幂等：进度里 rec.published 标记已发布的；重跑跳过。
 * 覆盖语义：clean_geometry_image_url 现为 P0 增强图 URL，重绘 PNG 覆盖（重绘优先级高于增强图，符合设计）。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { uploadFile } from '../services/ossService.js'
import { detectNonGeometryFigure, shouldSkipRedraw, findSuspiciousSvgLabels } from '../utils/geometryContentGate.js'

const OUT = 'D:/Minxue_App_V3/server/scripts/logs/c3-dsl-redraw'
const PROGRESS = path.join(OUT, 'progress.json')
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10)

const done = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8')) : {}
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const candidates = Object.entries(done).filter(([, rec]) => rec.ok && rec.svg && !rec.published)
let rows = candidates.map(([id, rec]) => ({ id, rec }))
if (LIMIT > 0) rows = rows.slice(0, LIMIT)
console.log(`待发布 ${rows.length} 张（已发布 ${candidates.length ? Object.values(done).filter(r => r.published).length : 0}）`)

let ok = 0
const failed = []
for (const [i, { id, rec }] of rows.entries()) {
  const tag = String(id).slice(0, 8)
  try {
    const svgPath = path.join(OUT, rec.svg)
    if (!fs.existsSync(svgPath)) throw new Error('本地 SVG 缺失')
    const svg = fs.readFileSync(svgPath, 'utf8')
    // ── 发布侧两道闸（2026-09-27 补，对标 publish-nonc3-dsl-redraws.mjs）──
    // 本脚本早于闸门上线，曾把「不该重绘的流程图」和「图面印模型内部变量名
    // （X_pos/P1_L/p_0…）的旧渲染器产物」发上线。发布必须自证，判据与生成侧同源。
    const meta = await pool.query('SELECT content, parent_stem, options FROM questions WHERE id = $1', [id])
    const qrow = meta.rows[0] || {}
    const allStem = [String(qrow.parent_stem || ''), String(qrow.content || '')].join('\n')
    const pref = detectNonGeometryFigure(allStem)
    if (shouldSkipRedraw(pref)) throw new Error(`不该重绘：${pref.kind || pref.reason || 'non_geometry'}`)
    const suspicious = findSuspiciousSvgLabels(svg, allStem, qrow.options)
    if (suspicious.length) throw new Error(`图面含无出处/内部标注: ${suspicious.join(',').slice(0, 80)}`)
    const png = await sharp(Buffer.from(svg)).resize({ width: 800, withoutEnlargement: false }).png().toBuffer()
    const url = await uploadFile(png, 'png', 'images', `dsl-${tag}`)
    await pool.query('UPDATE questions SET clean_geometry_image_url = $1, updated_at = NOW() WHERE id = $2', [url, id])
    rec.published = true
    rec.publishedUrl = url
    fs.writeFileSync(PROGRESS, JSON.stringify(done, null, 2))
    ok++
    console.log(`[${i + 1}/${rows.length}] ${tag} → ${url.slice(-40)}`)
  } catch (e) {
    failed.push({ tag, err: e.message.slice(0, 80) })
    console.log(`[${i + 1}/${rows.length}] ${tag} ❌ ${e.message.slice(0, 100)}`)
  }
}

console.log('\n== 汇总 ==')
console.log(JSON.stringify({ 本次发布: rows.length, 成功: ok, 失败: failed.length, 累计已发布: Object.values(done).filter(r => r.published).length, 失败明细: failed }, null, 2))
await pool.end()