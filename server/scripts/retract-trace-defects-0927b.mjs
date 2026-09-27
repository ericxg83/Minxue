// 撤回 3 道描摹缺陷产物（2026-09-27 晚逐题检查结论落地），R2 口径：清 SVG+URL 落原始裁片。
// 依据 docs/fig-redraw-pending-20260927.md「逐题目检结论」：
//   e801e7aa  描摹的是错裁区域（手写文字），而 geometry_image_url 裁片本身是正确格点图
//   248d6e9b  描摹丢房子轮廓/地面/尺寸标注（同题副本 8fae272f 描摹良好，对照可判）
//   7e185d42  描摹把污渍放大成黑块吞掉题图面板
// 三道 asset last_error 均不含「无可重绘的几何结构」，回退不会命中展示闸返回 none。
// 幂等：已清空的行跳过。
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'fs'
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const IDS = [
  'e801e7aa-83c5-4706-815f-01b9960160bf',
  '248d6e9b-a73d-490e-959b-09d02366669c',
  '7e185d42-4453-46b9-9f2f-15f1fcf75308',
  'b77fd012-c332-4543-8efb-d1a62a9c5aa3', // 函数通道重绘 y=-x² 缺地面线 AB 与阴影（与 0927 人工复核否掉的同缺陷），裁片本身正确
]
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const rows = (await pool.query(
  `SELECT id, clean_geometry_svg, clean_geometry_image_url, geometry_image_url,
     (SELECT a.last_error FROM question_assets a WHERE a.question_id = q.id AND a.asset_type='geometry_image' ORDER BY a.updated_at DESC LIMIT 1) AS asset_last_error
   FROM questions q WHERE id = ANY($1)`, [IDS])).rows

if (APPLY) {
  fs.writeFileSync(`scripts/logs/retract-trace-defects-backup-${Date.now()}.json`, JSON.stringify(rows, null, 2))
}

for (const r of rows) {
  const id8 = r.id.slice(0, 8)
  if (/无可重绘的几何结构/.test(r.asset_last_error || '')) {
    console.log(`⛔ ${id8}: last_error 含「无可重绘」，撤回会触发展示闸 none，跳过`); continue
  }
  const hasAny = r.clean_geometry_svg || r.clean_geometry_image_url
  console.log(`${APPLY ? '✔' : '◌'} ${id8} svg=${!!r.clean_geometry_svg} url=${!!r.clean_geometry_image_url} 落裁片: ${r.geometry_image_url}`)
  if (!APPLY || !hasAny) continue
  await pool.query(`UPDATE questions SET clean_geometry_svg = NULL, clean_geometry_image_url = NULL, updated_at = NOW() WHERE id = $1`, [r.id])
  await pool.query(`UPDATE question_assets SET clean_geometry_svg = NULL, clean_geometry_image_url = NULL, updated_at = NOW()
     WHERE question_id = $1 AND asset_type = 'geometry_image' AND (clean_geometry_svg IS NOT NULL OR clean_geometry_image_url IS NOT NULL)`, [r.id])
}
console.log(APPLY ? '已执行' : '预演（--apply 执行）')
await pool.end()
