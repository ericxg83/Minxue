/**
 * vectorize-figures.mjs — 用「矢量化描摹」把画不出来的配图变清晰（默认 dry-run）
 *
 * 适用对象：**几何重绘不适用或失败**的题（前端显示 raw / none）——数轴、统计图、
 * 流程图、数值转换器、折纸示意、格点图、以及重绘被闸门拒的几何题。
 * 这些图在**原卷上本来就是对的**，缺的只是清晰度；描摹只做「照抄」，不构造不改内容。
 *
 * 写入：`questions.clean_geometry_image_url` + `question_assets.clean_geometry_image_url`
 *   （存**栅格化后的 PNG URL**，与 geometryWorker 的发布口径一致 —— 该列被周末课件当
 *   图片 URL 读，绝不能塞 SVG 源码进去）。
 *   SVG 源码另存 scripts/logs/vectorize-svg/ 备查（未来若有 trace 专用列可直接迁移）。
 *
 * 用法（在 server/ 目录下）：
 *   node scripts/vectorize-figures.mjs                # dry-run：出对照图，不写库
 *   node scripts/vectorize-figures.mjs --apply        # 真写（先落快照）
 *   node scripts/vectorize-figures.mjs --scope all    # 不限「画不出来」，扫全部引图错题
 *   node scripts/vectorize-figures.mjs --ids a,b --limit N
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}
import fsp from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { vectorizeFigure } from '../utils/figureVectorize.js'
import { downloadImageBufferNoProxy } from '../utils/noProxyHttp.js'
import { uploadImage } from '../services/ossService.js'
import { hasFigureReference } from '../utils/questionCompleteness.js'
import { getGeometryDisplayUrl } from '../../src/utils/geometryDisplay.js'

const APPLY = process.argv.includes('--apply')
const argOf = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const LIMIT = Number(argOf('--limit') || 0)
const IDS = (argOf('--ids') || '').split(',').map(s => s.trim()).filter(Boolean)
const SCOPE = argOf('--scope') || 'gap'
const TARGET_SHORT = Number(argOf('--short') || 1600)
const SUPERSAMPLE = Number(argOf('--ss') || 3)
const SVGDIR = new URL('./logs/vectorize-svg/', import.meta.url)
const SHEETDIR = new URL('./logs/vectorize-sheet/', import.meta.url)

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const rows = (await pool.query(`
  SELECT q.id, q.student_id, q.question_number, q.content, q.parent_stem, q.geometry_image_url,
         q.clean_geometry_svg, q.clean_geometry_image_url, q.tikz_svg_url, q.display_image_type,
         q.geometry_manual_override,
         a.tikz_status, a.last_error AS asset_last_error, a.id AS asset_id
  FROM questions q
  LEFT JOIN LATERAL (
    SELECT id, tikz_status, last_error FROM question_assets
    WHERE question_id = q.id AND asset_type = 'geometry_image'
    ORDER BY created_at DESC LIMIT 1
  ) a ON TRUE
  WHERE q.deleted_at IS NULL AND q.geometry_image_url IS NOT NULL
`)).rows

const wrongIds = new Set((await pool.query(
  `SELECT DISTINCT question_id::text AS id FROM wrong_questions WHERE question_id IS NOT NULL`
)).rows.map(r => r.id))

let cands = rows.filter(r => hasFigureReference({ content: r.content, parent_stem: r.parent_stem }))
  .filter(r => wrongIds.has(r.id))
if (SCOPE !== 'all') {
  cands = cands.filter(r => {
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
await fsp.mkdir(SVGDIR, { recursive: true })
await fsp.mkdir(SHEETDIR, { recursive: true })

const results = []
for (const r of cands) {
  const short = r.id.slice(0, 8)
  let buf
  try { buf = await downloadImageBufferNoProxy(r.geometry_image_url) } catch (e) { console.log(`  ${short}: 裁片下载失败(${e.message})`); continue }

  const res = await vectorizeFigure(buf)
  if (!res.ok) { console.log(`  ${short} 第${r.question_number}题: 描摹未通过闸门 → ${res.reason}`); continue }

  const src = await sharp(buf).metadata()
  const sw = src.width, sh = src.height
  const scale = Math.max(1, Math.min(SUPERSAMPLE, TARGET_SHORT / Math.min(sw, sh)))
  // 用 width/height 放大 viewBox ⇒ sharp 以更高分辨率栅格化矢量
  const hiSvg = res.svg
    .replace(`width="${sw}" height="${sh}"`, `width="${Math.round(sw * scale)}" height="${Math.round(sh * scale)}"`)
    .replace(`<rect width="${sw}" height="${sh}"`, `<rect width="${sw}" height="${sh}"`)
  let png = await sharp(Buffer.from(hiSvg)).png().toBuffer()
  const pm = await sharp(png).metadata()
  // 降采样到目标短边（lanczos3 抗锯齿，避免 3x 超采样直接上线体积过大）
  if (Math.min(pm.width, pm.height) > TARGET_SHORT) {
    png = await sharp(png).resize({
      width: pm.width >= pm.height ? TARGET_SHORT * Math.round(pm.width / pm.height) : TARGET_SHORT,
      kernel: 'lanczos3',
    }).png().toBuffer()
  }
  const out = await sharp(png).metadata()

  await fsp.writeFile(new URL(`${short}.svg`, SVGDIR), res.svg)
  await fsp.writeFile(new URL(`${short}-raster.png`, SHEETDIR), png)

  console.log(`  ${short} 第${r.question_number}题: mismatch=${res.stats.mismatch} iou=${res.stats.iou} loops=${res.stats.loops} | ${sw}x${sh} → ${out.width}x${out.height} | svg ${(res.stats.svgBytes / 1024).toFixed(1)}KB → png ${(png.length / 1024).toFixed(1)}KB`)

  let newUrl = null
  if (APPLY) {
    try {
      newUrl = await uploadImage(png, `figuretrace_${r.student_id}_${r.id}.png`, r.student_id)
    } catch (e) { console.log(`  ${short}: 上传失败(${e.message})`); continue }
  }
  results.push({
    id: r.id, assetId: r.asset_id, oldCleanUrl: r.clean_geometry_image_url, newUrl,
    mismatch: res.stats.mismatch, iou: res.stats.iou, loops: res.stats.loops,
    srcW: sw, srcH: sh, outW: out.width, outH: out.height,
  })
}

console.log(`\n汇总：通过闸门 ${results.length} / 候选 ${cands.length} 条`)
if (results.length) {
  const ms = results.map(x => x.mismatch).sort((a, b) => a - b)
  console.log(`  mismatch 中位 ${ms[Math.floor(ms.length / 2)]} / 最大 ${ms[ms.length - 1]}`)
}
console.log(`  SVG 目录: ${SVGDIR.pathname}`)

if (!APPLY) { console.log('（dry-run：未上传、未写库）'); await pool.end(); process.exit(0) }

const backupPath = new URL(`./logs/vectorize-backup-${Date.now()}.json`, import.meta.url)
await fsp.writeFile(backupPath, JSON.stringify(results, null, 1), 'utf8')
console.log(`💾 回滚快照: ${backupPath.pathname}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const r of results) {
    if (!r.newUrl) continue
    await client.query(`UPDATE questions SET clean_geometry_image_url = $2, updated_at = NOW() WHERE id = $1`, [r.id, r.newUrl])
    if (r.assetId) {
      await client.query(`UPDATE question_assets SET clean_geometry_image_url = $2, updated_at = NOW() WHERE id = $1`, [r.assetId, r.newUrl])
    }
  }
  await client.query('COMMIT')
  console.log(`✅ 已提交 ${results.filter(r => r.newUrl).length} 条`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error('❌ 已回滚：', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
