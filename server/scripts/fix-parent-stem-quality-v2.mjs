/**
 * fix-parent-stem-quality-v2.mjs — 第二轮回填结果复核修正（一次性）
 * 依据 _backfill_stem_v2.log 的 13 组通过清单逐条复核：
 *   回滚 5 组质量问题（截断/漏行/剥前缀后暴露小问标号），保留 sub_no。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const ROLLBACK = [
  ['2e39d5d4', 3, 13, '截断：缺「例如：方程…」段，条件不完整'],
  ['9d547fe8', 2, 14, '漏行：31²、31³ 后有 31⁴，OCR 跳号'],
  ['67414108', 2, 11, '截断：…与x轴交 悬空'],
  ['ddcfedfe', 2, 10, '截断：…据市场行情推测,此 悬空'],
  ['ea7935c6', 3, 2, '剥题号前缀后以「（1）」开头且截断']
]

async function main() {
  let rolled = 0
  for (const [prefix, page, qno, why] of ROLLBACK) {
    const { rows } = await pool.query(`
      SELECT id FROM questions
      WHERE task_id::text LIKE $1 || '%'
        AND page_number = $2 AND question_number = $3
        AND parent_stem IS NOT NULL
    `, [prefix, page, qno])
    if (rows.length === 0) { console.log(`⚠️ 未找到: ${prefix} p${page} Q${qno}`); continue }
    await pool.query(`UPDATE questions SET parent_stem = NULL, updated_at = NOW() WHERE id = ANY($1::uuid[])`, [rows.map(r => r.id)])
    rolled += rows.length
    console.log(`↩️ 回滚 ${rows.length} 行 ${prefix} p${page} Q${qno} — ${why}`)
  }
  const stat = await pool.query(`
    SELECT count(*) FILTER (WHERE parent_stem IS NOT NULL) AS with_stem,
           count(*) FILTER (WHERE parent_stem IS NULL AND btrim(coalesce(content,'')) ~ '^[（(]\\s*[0-9１-９一二三四五六七八九]{1,2}\\s*[)）]') AS pending,
           count(*) FILTER (WHERE sub_no IS NOT NULL) AS with_sub
    FROM questions`)
  console.log(`\n完成：回滚 ${rolled} 行`)
  console.log('终态:', JSON.stringify(stat.rows[0]))
  await pool.end()
}

main().catch(async (e) => { console.error('脚本异常:', e); try { await pool.end() } catch {}; process.exit(1) })
