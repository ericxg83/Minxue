/**
 * recrop-figures-hires.mjs — 用「原始上传图」重裁配图（默认 dry-run）
 *
 * 背景与做法见 `server/utils/figureCropHiRes.js` 头部注释：框仍在 1800px 压缩页上算
 * （保持与生产同口径），算完映射回原始上传图坐标裁剪 ⇒ 同区域、更多真实像素。
 *
 * 默认只处理「错题里题干引图、但当前画不出来（显示 raw / none）」的那批。
 *
 * 用法（在 server/ 目录下）：
 *   node scripts/recrop-figures-hires.mjs                 # dry-run：只算增益 + 落本地预览图
 *   node scripts/recrop-figures-hires.mjs --apply         # 真裁 + 上传 + 写库（先落快照）
 *   node scripts/recrop-figures-hires.mjs --scope all     # 不限缺口，扫全部引图错题
 *   node scripts/recrop-figures-hires.mjs --limit 5       # 只处理前 N 条
 *   node scripts/recrop-figures-hires.mjs --ids 69ad87d3,332711ac
 *
 * 写入范围：`questions.geometry_image_url` + `question_assets.cropped_image_url`（同步，
 * 否则重绘 worker 会拿旧裁片当输入）。两列都可整列回滚，快照落在 scripts/logs/。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
// ⚠️ 必须清代理：不清时 OSS 下载 400 且被 catch 静默跳过（2026-09-21 踩坑）
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { cropFigureHiRes, resolutionGain } from '../utils/figureCropHiRes.js'
import { downloadImageBufferNoProxy } from '../utils/noProxyHttp.js'
import { estimatePaperBackground, cleanGeometryCrop } from '../worker.js'
import { uploadImage } from '../services/ossService.js'
import { hasFigureReference } from '../utils/questionCompleteness.js'
import { getGeometryDisplayUrl } from '../../src/utils/geometryDisplay.js'

const APPLY = process.argv.includes('--apply')
const argOf = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const LIMIT = Number(argOf('--limit') || 0)
const IDS = (argOf('--ids') || '').split(',').map(s => s.trim()).filter(Boolean)
const SCOPE = argOf('--scope') || 'gap'
const LOGDIR = new URL('./logs/hires-crop/', import.meta.url)

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const rows = (await pool.query(`
  SELECT q.id, q.student_id, q.task_id, q.question_number, q.page_number, q.content, q.parent_stem,
         q.image_bbox, q.block_coordinates, q.geometry_image_url, q.clean_geometry_svg,
         q.clean_geometry_image_url, q.tikz_svg_url, q.display_image_type, q.geometry_manual_override,
         t.images,
         a.tikz_status, a.last_error AS asset_last_error, a.id AS asset_id
  FROM questions q
  JOIN tasks t ON t.id = q.task_id
  LEFT JOIN LATERAL (
    SELECT id, tikz_status, last_error FROM question_assets
    WHERE question_id = q.id AND asset_type = 'geometry_image'
    ORDER BY created_at DESC LIMIT 1
  ) a ON TRUE
  WHERE q.deleted_at IS NULL AND q.image_bbox IS NOT NULL AND q.geometry_image_url IS NOT NULL
  ORDER BY q.created_at DESC
`)).rows

// 候选：默认「错题 + 题干引图 + 当前显示 raw/none」；--scope all 放开到全部引图错题
const wrongIds = new Set((await pool.query(
  `SELECT DISTINCT question_id::text AS id FROM wrong_questions WHERE question_id IS NOT NULL`
)).rows.map(r => r.id))

let cands = rows.filter(r => hasFigureReference({ content: r.content, parent_stem: r.parent_stem }))
if (SCOPE !== 'all') {
  cands = cands.filter(r => {
    if (!wrongIds.has(r.id)) return false
    const d = getGeometryDisplayUrl({
      clean_geometry_svg: r.clean_geometry_svg, tikz_svg_url: r.tikz_svg_url,
      clean_geometry_image_url: r.clean_geometry_image_url, geometry_image_url: r.geometry_image_url,
      tikz_status: r.tikz_status, asset_last_error: r.asset_last_error,
      display_image_type: r.display_image_type, geometry_manual_override: r.geometry_manual_override,
    })
    return d.type === 'raw' || d.type === 'none'
  })
}
if (IDS.length) cands = cands.filter(r => IDS.some(p => r.id.startsWith(p)))
if (LIMIT > 0) cands = cands.slice(0, LIMIT)

console.log(`${APPLY ? '🛠  APPLY' : '🔍 DRY-RUN'} — 候选 ${cands.length} 条（scope=${SCOPE}）\n`)
if (APPLY) await fs.mkdir(LOGDIR, { recursive: true })

const results = []
const pageCache = new Map()
for (const r of cands) {
  const tag = `${r.id.slice(0, 8)} 第${r.question_number ?? '?'}题`
  let imgs = r.images
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs) } catch { imgs = null } }
  const page = Array.isArray(imgs)
    ? (imgs.find(i => Number(i.page_number) === Number(r.page_number)) || imgs[0])
    : null
  if (!page?.image_url) { console.log(`  ${tag}: 找不到页图，跳过`); continue }

  let origBuf
  if (pageCache.has(page.image_url)) origBuf = pageCache.get(page.image_url)
  else {
    try {
      origBuf = await downloadImageBufferNoProxy(page.image_url)
      pageCache.set(page.image_url, origBuf)
    } catch (e) { console.log(`  ${tag}: 页图下载失败(${e.message})，跳过`); continue }
  }

  // 生产同口径压缩页（用于算框）
  const pageBuf = await sharp(origBuf).rotate().resize(1800, 1800, { fit: 'inside' })
    .jpeg({ quality: 85 }).toBuffer()
  const pm = await sharp(pageBuf).metadata()
  const bboxPx = {
    x: Math.round(r.image_bbox.x / 1000 * pm.width),
    y: Math.round(r.image_bbox.y / 1000 * pm.height),
    width: Math.round(r.image_bbox.width / 1000 * pm.width),
    height: Math.round(r.image_bbox.height / 1000 * pm.height),
  }

  let out = null
  try {
    out = await cropFigureHiRes({
      pageBuffer: pageBuf, originalBuffer: origBuf, bboxPx,
      estimateBackground: estimatePaperBackground, cleanCrop: cleanGeometryCrop,
    })
  } catch (e) { console.log(`  ${tag}: 重裁异常(${e.message})，跳过`); continue }

  if (!out) { console.log(`  ${tag}: 原图无增益或收紧判不出图形 → 保持原样`); continue }

  const gain = resolutionGain(out.boxOnPage, out.scale)
  const meta = await sharp(out.buffer).metadata()
  console.log(`  ${tag}: 框 ${out.boxOnPage.width}x${out.boxOnPage.height}(页) → 源短边 ${gain.beforeShort}→${gain.afterShort} (×${gain.ratio}) → 裁片 ${meta.width}x${meta.height}`)

  let newUrl = null
  if (APPLY) {
    try {
      const fileName = `geometry_${r.student_id}_${r.id}.png`
      newUrl = await uploadImage(out.buffer, fileName, r.student_id)
      await fs.writeFile(new URL(`${r.id.slice(0, 8)}.png`, LOGDIR), out.buffer)
    } catch (e) { console.log(`  ${tag}: 上传失败(${e.message})，跳过`); continue }
  } else {
    await fs.mkdir(LOGDIR, { recursive: true })
    await fs.writeFile(new URL(`${r.id.slice(0, 8)}.png`, LOGDIR), out.buffer)
  }

  results.push({
    id: r.id, assetId: r.asset_id, oldUrl: r.geometry_image_url, newUrl,
    srcShort: gain.beforeShort, newShort: gain.afterShort, ratio: gain.ratio,
    outW: meta.width, outH: meta.height,
  })
}

console.log(`\n汇总：可提升 ${results.length} / 候选 ${cands.length} 条`)
if (results.length) {
  const rs = results.map(x => x.ratio).sort((a, b) => a - b)
  console.log(`  分辨率增益 ×${rs[0]} ~ ×${rs[rs.length - 1]}（中位 ×${rs[Math.floor(rs.length / 2)]}）`)
}
console.log(`  预览图目录: ${LOGDIR.pathname}`)

if (!APPLY) {
  console.log('（dry-run：未上传、未写库。确认后加 --apply）')
  await pool.end()
  process.exit(0)
}

const backupPath = new URL(`./logs/hires-crop-backup-${Date.now()}.json`, import.meta.url)
await fs.mkdir(new URL('./logs/', import.meta.url), { recursive: true })
await fs.writeFile(backupPath, JSON.stringify(results, null, 1), 'utf8')
console.log(`💾 回滚快照（含旧 URL）: ${backupPath.pathname}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const r of results) {
    if (!r.newUrl) continue
    await client.query(`UPDATE questions SET geometry_image_url = $2, updated_at = NOW() WHERE id = $1`, [r.id, r.newUrl])
    // ⚠️ 必须同步资产裁片 URL：重绘 worker 的输入是 asset.cropped_image_url || geometry_image_url
    if (r.assetId) {
      await client.query(`UPDATE question_assets SET cropped_image_url = $2, updated_at = NOW() WHERE id = $1`, [r.assetId, r.newUrl])
    }
  }
  await client.query('COMMIT')
  console.log(`✅ 已提交 ${results.filter(r => r.newUrl).length} 条（questions + question_assets 同步）`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error('❌ 已回滚：', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
