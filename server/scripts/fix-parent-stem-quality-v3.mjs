/**
 * fix-parent-stem-quality-v3.mjs — 第三轮回填结果复核修正（一次性）
 * 复核 31 组实际存储值后，回滚 3 组确认有缺陷的（保留 sub_no）：
 *   · 2e39d5d4 p2 Q11 / ca84e0db p2 Q11：「…点 B(-3,0)和点 C.」缺 C 的坐标
 *   · 9d547fe8 p2 Q14：31² 31³ 之后跳号，缺 31⁴
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const ROLLBACK = [
  ['2e39d5d4', 2, 11, '结尾「和点 C.」缺 C 的坐标，条件不完整'],
  ['ca84e0db', 2, 11, '结尾「和点 C.」缺 C 的坐标，条件不完整'],
  ['9d547fe8', 2, 14, '31²、31³ 后跳号，缺 31⁴']
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
         count(*) FILTER (WHERE sub_no IS NOT NULL) AS with_sub,
         count(*) FILTER (WHERE parent_stem IS NULL AND btrim(coalesce(content,'')) ~ '^[（(]\\s*[0-9１-９一二三四五六七八九]{1,2}\\s*[)）]') AS pending
  FROM questions`)
console.log(`\n完成：回滚 ${rolled} 行`); console.log('终态:', JSON.stringify(stat.rows[0]))
await pool.end()
