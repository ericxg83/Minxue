/**
 * refix-paper-figures.mjs — 存量卷的配图重裁（2026-11-16）
 *
 * 背景：配图裹题干的老卷不会因为修了判据就自己变干净 —— 必须按**生产同一链路**
 * 重跑一遍：cropQuestionImage → analyzeCropFigure → 小问组共享 → 上传 → 按 id 更新。
 *
 * 用法：
 *   node scripts/refix-paper-figures.mjs --resource 43777282          # 预演（不上传、不写库）
 *   node scripts/refix-paper-figures.mjs --resource 43777282 --apply  # 写库（先落备份）
 *
 * ⛔ 只动 resource_questions.image_url（按 id 精确 UPDATE），不碰题干/答案/bbox。
 * ⛔ 必须清代理，否则 OSS 请求 400 且静默跳过。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'fs'
import { cropQuestionImage, assignPageFigures } from '../services/paperBankService.js'
import { analyzeCropFigure, planSubrowFigureAssignments } from '../services/paperFigureAssign.js'

const argv = process.argv.slice(2)
const argOf = (name, def = null) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const apply = argv.includes('--apply')
const resource = argOf('resource')
if (!resource) {
  console.error('need --resource <id prefix>')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const res = await pool.query(
  `SELECT id, name FROM resources WHERE id::text LIKE $1 LIMIT 1`,
  [resource + '%']
)
if (!res.rowCount) { console.error('resource not found'); process.exit(1) }
const resourceId = res.rows[0].id
console.log('[refix] resource', resourceId, res.rows[0].name)

const q = await pool.query(
  `SELECT id, page_no, question_no, sub_no, content, parent_stem, bbox, page_image_url, image_url
   FROM resource_questions WHERE resource_id = $1 ORDER BY page_no, question_no`,
  [resourceId]
)
const rows = q.rows
console.log('[refix] rows', rows.length, 'with image', rows.filter(r => r.image_url).length)

// 按页分组（planSubrowFigureAssignments 的分组键是 page_no + question_no，跨页不能混）
const byPage = new Map()
for (const r of rows) {
  const p = r.page_no ?? 1
  if (!byPage.has(p)) byPage.set(p, [])
  byPage.get(p).push(r)
}
const pageUrl = new Map()
for (const r of rows) if (r.page_image_url && !pageUrl.has(r.page_no ?? 1)) pageUrl.set(r.page_no ?? 1, r.page_image_url)

const sizeOf = async (url) => {
  if (!url) return '-'
  try {
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
    const m = await sharp(buf).metadata()
    return m.width + 'x' + m.height
  } catch { return '?' }
}

if (!apply) {
  // ── 预演：不上传，只跑「裁片 → 抠图 → 共享规划」 ──
  for (const [pageNo, pageRows] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const url = pageUrl.get(pageNo)
    if (!url) continue
    const pageBuf = Buffer.from(await (await fetch(url)).arrayBuffer())
    const figBands = new Map()
    const kind = new Map()
    for (let i = 0; i < pageRows.length; i++) {
      const box = pageRows[i].bbox
      if (!box) continue
      const crop = await cropQuestionImage(pageBuf, { x: box.x, y: box.y, width: box.width, height: box.height })
      if (!crop) continue
      const fig = await analyzeCropFigure(crop)
      if (!fig.hasFigure) continue
      if (fig.band) figBands.set(i, fig.band)
      kind.set(i, fig.band ? 'band' : 'crop-fallback')
    }
    const withFigure = new Set(kind.keys())
    const plans = planSubrowFigureAssignments(pageRows, figBands, { withFigure })
    for (const pl of plans) kind.set(pl.targetIdx, 'shared')
    console.log('\n-- page ' + pageNo + ' --')
    for (let i = 0; i < pageRows.length; i++) {
      const r = pageRows[i]
      const tag = `q${r.question_no}${r.sub_no ? '(' + r.sub_no + ')' : ''}`
      console.log(
        '  ' + tag.padEnd(9),
        'old', (await sizeOf(r.image_url)).padEnd(11),
        '->', (kind.get(i) || 'none').padEnd(14)
      )
    }
  }
  await pool.end()
  console.log('\n[refix] dry-run done. add --apply to write.')
  process.exit(0)
}

// ── 写库 ──
const before = rows.map(r => ({ id: r.id, page_no: r.page_no, question_no: r.question_no, sub_no: r.sub_no, image_url: r.image_url }))
const snapshotDir = 'D:/Minxue_App_V3/server/scripts/logs'
mkdirSync(snapshotDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const snapPath = `${snapshotDir}/refix-fig-${resourceId}-${stamp}.json`
writeFileSync(snapPath, JSON.stringify({ resourceId, at: new Date().toISOString(), before }, null, 2), 'utf8')
console.log('[refix] snapshot ->', snapPath)

for (const [pageNo, pageRows] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
  const url = pageUrl.get(pageNo)
  if (!url) { console.log('[refix] page ' + pageNo + ' no page image, skip'); continue }
  const pageBuf = Buffer.from(await (await fetch(url)).arrayBuffer())
  // image_url 先清空：让「重算后无图」的行保持空（否则会留着旧脏图）
  const measured = { boxes: {} }
  pageRows.forEach((r, i) => {
    r.image_url = null
    if (r.bbox) measured.boxes[String(i)] = r.bbox
  })
  await assignPageFigures({ rows: pageRows, hiPage: pageBuf, pageNumber: pageNo, measured, logger: console })
  let changed = 0
  for (const r of pageRows) {
    const oldRow = before.find(b => b.id === r.id)
    if ((oldRow?.image_url || null) === (r.image_url || null)) continue
    await pool.query('UPDATE resource_questions SET image_url = $2 WHERE id = $1', [r.id, r.image_url || null])
    changed++
  }
  console.log('[refix] page ' + pageNo + ' updated ' + changed + '/' + pageRows.length)
}
await pool.end()
console.log('[refix] done.')
