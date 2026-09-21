/**
 * 一次性：把 recropFigures 重裁后的新裁片 URL 同步进 question_assets.cropped_image_url
 * （重绘 worker 的输入是 asset.cropped_image_url || geometry_image_url，不同步 = 拿旧裁片重绘）。
 * 只更新「与 questions.geometry_image_url 不一致」的行，先备份后更新。
 */
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const BACKUP = JSON.parse(fs.readFileSync('scripts/logs/recrop-backup-1789982260850.json', 'utf8'))
const IDS = BACKUP.filter((r) => r.newUrl).map((r) => r.id)

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const rows = (await pool.query(
  `SELECT a.id AS asset_id, a.question_id, a.cropped_image_url, q.geometry_image_url
     FROM question_assets a JOIN questions q ON q.id = a.question_id
    WHERE a.question_id = ANY($1::uuid[]) AND a.asset_type = 'geometry_image'`,
  [IDS],
)).rows

const backup = []
const updates = []
for (const r of rows) {
  if (r.cropped_image_url === r.geometry_image_url) continue
  backup.push(r)
  updates.push({ asset_id: r.asset_id, question_id: r.question_id, url: r.geometry_image_url })
}
fs.writeFileSync('scripts/logs/asset-cropsync-backup-1789982260850.json', JSON.stringify(backup, null, 1))
console.log(`待同步 ${updates.length} / 资产行 ${rows.length}（备份 asset-cropsync-backup-1789982260850.json）`)

if (process.argv.includes('--apply')) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const u of updates) {
      await client.query(
        `UPDATE question_assets SET cropped_image_url = $2, updated_at = NOW() WHERE id = $1`,
        [u.asset_id, u.url])
    }
    await client.query('COMMIT')
    console.log(`✅ 已同步 ${updates.length} 条 question_assets.cropped_image_url`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌ 已回滚：', e.message)
    process.exitCode = 1
  } finally {
    client.release()
  }
} else {
  for (const u of updates) console.log(`  ${String(u.question_id).slice(0, 8)} -> ${String(u.url).slice(28, 66)}`)
  console.log('（dry-run，加 --apply 落库）')
}
await pool.end()
