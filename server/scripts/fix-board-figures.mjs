/**
 * 修复白板第9题/第6题配图 (2026-09-18)
 *
 * 根因(两份独立证据):
 *  A. Q9 数值转换器流程图: image_bbox {170,695,820,230} 归一化 → 像素 {281,1529,1353,506}
 *     完整覆盖整张流程图; 但 refineFigureBoxOnPage 的墨迹分带启发式把图形内部稀疏结构
 *     当成"邻图"砍掉, 收紧后只剩 675x236(下半截判断框) → 白板显示不完整。
 *     修复: 代码已加"收紧结果与模型框求并集"下限(worker.js 310-319), 重裁输出 2109x800 完整。
 *  B. Q6 折纸图: image_bbox {420,465,130,95} → 像素 {693,1023,215,209} 只覆盖图形左半,
 *     右侧阴影块(x 941-1030)被切掉; 墨迹紧致框实测 x 600-1040, y 989-1299。
 *     需修正 image_bbox 后重裁。
 *
 * 做法: 备份旧值 → 生产同款 cropAndUploadGeometryImage 重裁 → 落库 image_bbox + geometry_image_url。
 */
import 'dotenv/config'
import fs from 'node:fs/promises'
import pg from 'pg'
import { cropAndUploadGeometryImage } from '../worker.js'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const APPLY = process.argv.includes('--apply')

// ── 两题目标 ──
const TARGETS = [
  {
    id: '3f6abe05-0beb-44ed-a5c1-1f50f47f8633', label: 'Q9 流程图',
    // 模型框本身准(视觉模型确认完整盖住流程图), 保留不动; 重裁走并集下限修复
    newBboxNorm: null, // null → 沿用库内 image_bbox
  },
  // Q6 用 scripts/fix-q6-figure.mjs 精确裁切处理(refine 会把题下文字带进来, 此处不处理)
]

const rows = (await pool.query(`
  SELECT id, question_number, student_id, task_id, image_bbox, geometry_image_url, page_number
  FROM questions WHERE id = ANY($1)`, [TARGETS.map(t => t.id)])).rows
const byId = Object.fromEntries(rows.map(r => [r.id, r]))

const pageCache = new Map()
async function getPageBuf(r) {
  if (pageCache.has(r.task_id)) return pageCache.get(r.task_id)
  const { rows: [t] } = await pool.query(`SELECT images FROM tasks WHERE id = $1`, [r.task_id])
  const imgs = typeof t.images === 'string' ? JSON.parse(t.images) : (t.images || [])
  const page = imgs.find(i => Number(i.page_number) === Number(r.page_number)) || imgs[0]
  const res = await fetch(page.image_url)
  const buf = Buffer.from(await res.arrayBuffer())
  pageCache.set(r.task_id, buf)
  return buf
}

const results = []
for (const t of TARGETS) {
  const r = byId[t.id]
  const oldBbox = r.image_bbox
  const newBboxNorm = t.newBboxNorm || oldBbox
  const buf = await getPageBuf(r)
  const sharpMod = await import('sharp')
  const meta = await sharpMod.default(buf).metadata()
  const px = {
    x: Math.round(newBboxNorm.x / 1000 * meta.width),
    y: Math.round(newBboxNorm.y / 1000 * meta.height),
    width: Math.round(newBboxNorm.width / 1000 * meta.width),
    height: Math.round(newBboxNorm.height / 1000 * meta.height),
  }
  console.log(`\n=== ${t.label} ===`)
  console.log(`  旧 bbox(归一): ${JSON.stringify(oldBbox)}`)
  console.log(`  新 bbox(归一): ${JSON.stringify(newBboxNorm)} → 像素 ${JSON.stringify(px)} (页图 ${meta.width}x${meta.height})`)
  console.log(`  旧图: ${r.geometry_image_url}`)

  const newUrl = await cropAndUploadGeometryImage(buf, px, r.student_id, r.id)
  if (!newUrl) {
    console.log(`  ❌ 重裁失败/判不出图形`)
    results.push({ ...t, ok: false })
    continue
  }
  console.log(`  ✅ 新图: ${newUrl}`)
  results.push({ ...t, r, oldBbox, newBboxNorm, oldUrl: r.geometry_image_url, newUrl, ok: true })
}

if (!APPLY) {
  console.log('\n(dry-run: 未上传未落库, 加 --apply 生效)')
  await pool.end()
  process.exit(0)
}

// ── 落库 + 备份 ──
const backup = results.filter(x => x.ok).map(x => ({
  id: x.r.id, oldBbox: x.oldBbox, oldUrl: x.oldUrl, newBboxNorm: x.newBboxNorm, newUrl: x.newUrl,
}))
const backupPath = `logs/board-figure-fix-backup-${Date.now()}.json`
await fs.mkdir(new URL('./logs/', import.meta.url), { recursive: true })
await fs.writeFile(new URL(backupPath, import.meta.url), JSON.stringify(backup, null, 1), 'utf8')
console.log(`\n💾 备份: ${backupPath}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const x of results.filter(r => r.ok)) {
    await client.query(
      `UPDATE questions SET image_bbox = $2, geometry_image_url = $3, updated_at = NOW() WHERE id = $1`,
      [x.r.id, x.newBboxNorm, x.newUrl])
    console.log(`✅ 已更新 Q${x.r.question_number}: bbox=${JSON.stringify(x.newBboxNorm)}`)
  }
  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK')
  console.error('❌ 已回滚:', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
