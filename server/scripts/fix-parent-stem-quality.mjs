/**
 * fix-parent-stem-quality.mjs — 回填结果人工复核修正（一次性）
 *
 * 依据 _backfill_parent_stem.log 的 28 组通过清单逐条复核：
 *   · 回滚 12 组质量不合格的 parent_stem（截断/混入小问全文/解题过程/页标题/残缺），
 *     **保留 sub_no**（小问号提取自题干开头标号，与 stem 质量无关）；
 *   · 修正 2 组仅带题号前缀的 stem（剥前缀，内容正确）。
 * 快照：server/backups/parent-stem-backfill-2026-09-11T06-59-18-339Z.json
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })

import pg from 'pg'

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// [task_id 前缀, page_number, question_number, 处置, 处置参数]
const ROLLBACK = [
  ['2e39d5d4', 3, 13, '截断：例如：方程 x²−x= 悬空'],
  ['7639eee3', 5, 3, '混入 (1) 小问全文（stem=题号+第一问）'],
  ['7639eee3', 7, 3, '截断：…求平 悬空'],
  ['85e391bf', 3, 2, '截断+上标丢失：…当自变量 悬空'],
  ['ca84e0db', 2, 11, '混入解题过程：所以函数y=…代入，得'],
  ['ca84e0db', 3, 13, 'LaTeX 残留：y=-rac{1}{2}x^2'],
  ['ddcfedfe', 2, 10, '截断：…据市场行 悬空'],
  ['ea7935c6', 3, 2, '页标题非题干：课后练习 27.2(1)'],
  ['ea7935c6', 5, 4, '开头残缺：-2, P(2,)都在抛物线…'],
  ['73e54aef', 5, 4, '开头残缺：都在抛物线…'],
  ['2ed887cd', 2, 9, '截断：…点D(m,n)是 悬空'],
  ['67414108', 2, 10, '截断：…△ABC 为 悬空']
]
const FIX_PREFIX = [
  ['6e78398e', 2, 10, '求出下面各组数的最小公倍数。'],
  ['da0b3d35', 2, 10, '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).']
]

async function main() {
  let rolled = 0, fixed = 0
  for (const [prefix, page, qno, why] of ROLLBACK) {
    const { rows } = await pool.query(`
      SELECT id FROM questions
      WHERE task_id::text LIKE $1 || '%'
        AND page_number = $2 AND question_number = $3
        AND parent_stem IS NOT NULL
    `, [prefix, page, qno])
    if (rows.length === 0) { console.log(`⚠️ 未找到待回滚行: ${prefix} p${page} Q${qno}`); continue }
    await pool.query(`UPDATE questions SET parent_stem = NULL, updated_at = NOW() WHERE id = ANY($1::uuid[])`, [rows.map(r => r.id)])
    rolled += rows.length
    console.log(`↩️ 回滚 ${rows.length} 行 ${prefix} p${page} Q${qno} — ${why}（sub_no 保留）`)
  }
  for (const [prefix, page, qno, newStem] of FIX_PREFIX) {
    const { rows } = await pool.query(`
      SELECT id FROM questions
      WHERE task_id::text LIKE $1 || '%'
        AND page_number = $2 AND question_number = $3
        AND parent_stem IS NOT NULL
    `, [prefix, page, qno])
    if (rows.length === 0) { console.log(`⚠️ 未找到待修正行: ${prefix} p${page} Q${qno}`); continue }
    await pool.query(`UPDATE questions SET parent_stem = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`, [newStem, rows.map(r => r.id)])
    fixed += rows.length
    console.log(`✏️ 修正 ${rows.length} 行 ${prefix} p${page} Q${qno} → "${newStem.slice(0, 40)}"`)
  }
  console.log(`\n完成：回滚 ${rolled} 行，修正 ${fixed} 行`)
  await pool.end()
}

main().catch(async (e) => { console.error('脚本异常:', e); try { await pool.end() } catch {}; process.exit(1) })
