/**
 * fix-parent-stem-quality-v4.mjs — 整页重识别（by-page）结果复核修正（一次性）
 * 复核 _backfill_bypage.log 写入的 35 行后回滚 18 行：
 *   · 空字符串 stem（脚本 bug，已修）：7639eee3 p3 Q2 / 85e391bf p3 Q2 / ea7935c6 p3 Q2
 *   · 页标题被当题干（「课后练习 27.2(x)」）：73e54aef p4 Q1、p4 Q2、p8 Q1、
 *     7639eee3 p4 Q1、p6 Q1、85e391bf p6 Q1、ea7935c6 p6 Q1
 *   · OCR 跳号漏行：9d547fe8 p2 Q14（31² 31³ 后缺 31⁴）
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const ROLLBACK = [
  ['7639eee3', 3, 2, '空字符串 stem（脚本 bug）'],
  ['85e391bf', 3, 2, '空字符串 stem（脚本 bug）'],
  ['ea7935c6', 3, 2, '空字符串 stem（脚本 bug）'],
  ['73e54aef', 4, 1, '页标题「课后练习 27.2(2)」被当题干'],
  ['73e54aef', 4, 2, '页标题「课后练习 27.2(2)」被当题干'],
  ['73e54aef', 8, 1, '页标题「课后练习 27.2(4)」被当题干'],
  ['7639eee3', 4, 1, '页标题「课后练习 27.2(2)」被当题干'],
  ['7639eee3', 6, 1, '页标题「课后练习 27.2(3)」被当题干'],
  ['85e391bf', 6, 1, '页标题「课后练习 27.2(3)」被当题干'],
  ['ea7935c6', 6, 1, '页标题「课后练习 27.2(3)」被当题干'],
  ['9d547fe8', 2, 14, 'OCR 跳号漏行（缺 31⁴）']
]
let rolled = 0
for (const [prefix, page, qno, why] of ROLLBACK) {
  const { rows } = await pool.query(
    `SELECT id FROM questions WHERE task_id::text LIKE $1 || '%' AND page_number = $2 AND question_number = $3 AND parent_stem IS NOT NULL`,
    [prefix, page, qno]
  )
  if (!rows.length) { console.log(`⚠️ 未找到 ${prefix} p${page} Q${qno}`); continue }
  await pool.query(`UPDATE questions SET parent_stem = NULL, updated_at = NOW() WHERE id = ANY($1::uuid[])`, [rows.map(r => r.id)])
  rolled += rows.length
  console.log(`↩️ 回滚 ${rows.length} 行 ${prefix} p${page} Q${qno} — ${why}`)
}
const stat = await pool.query(`
  SELECT count(*) FILTER (WHERE parent_stem IS NOT NULL) AS with_stem,
         count(*) FILTER (WHERE parent_stem = '') AS empty_stem,
         count(*) FILTER (WHERE sub_no IS NOT NULL) AS with_sub,
         count(*) FILTER (WHERE parent_stem IS NULL AND btrim(coalesce(content,'')) ~ '^[（(]\\s*[0-9１-９一二三四五六七八九]{1,2}\\s*[)）]') AS pending
  FROM questions`)
console.log(`\n完成：回滚 ${rolled} 行`); console.log('终态:', JSON.stringify(stat.rows[0]))
await pool.end()
