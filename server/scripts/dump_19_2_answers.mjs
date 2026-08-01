/**
 * 查 worksheet 1c31ee45 答案库 19.2 试卷单元的题号 + content
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

import { Pool } from 'pg'
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})

const run = async () => {
  const wsId = '1c31ee45-0879-4d53-a54c-60af85ee15cc'

  console.log('=== 19.2 试卷单元的题号 + content + answer ===\n')
  // 用 resource_units JOIN resource_answers
  const { rows } = await pool.query(`
    SELECT ru.unit_key, ru.unit_title, wa.section, wa.question_no, wa.sub_no,
           wa.answer, wa.answer_type, wa.content
    FROM worksheet_answers wa
    JOIN resource_units ru ON ru.id = wa.unit_id
    WHERE wa.worksheet_id = $1
      AND ru.unit_key LIKE '%19.2%'
    ORDER BY ru.unit_seq, wa.question_no, wa.sub_no
  `, [wsId])

  let curUnit = null
  for (const r of rows) {
    if (r.unit_key !== curUnit) {
      console.log(`\n--- ${r.unit_key} | ${r.unit_title} ---`)
      curUnit = r.unit_key
    }
    const sn = r.sub_no ? `(${r.sub_no})` : ''
    const ans = (r.answer || '').length > 25 ? (r.answer || '').slice(0, 25) + '...' : r.answer
    const cont = r.content ? r.content.slice(0, 60) : '(空)'
    console.log(`  题${r.question_no}${sn} [${r.answer_type}] answer="${ans}" content="${cont}"`)
  }

  console.log('\n\n=== 试卷⑥ 第十九章实数提高性测试（key 不带 lesson_code）===\n')
  const { rows: rows2 } = await pool.query(`
    SELECT ru.unit_key, ru.unit_title, wa.section, wa.question_no, wa.sub_no,
           wa.answer, wa.answer_type, wa.content
    FROM worksheet_answers wa
    JOIN resource_units ru ON ru.id = wa.unit_id
    WHERE wa.worksheet_id = $1
      AND ru.unit_key LIKE '%试卷6%'
    ORDER BY ru.unit_seq, wa.question_no, wa.sub_no
  `, [wsId])
  curUnit = null
  for (const r of rows2) {
    if (r.unit_key !== curUnit) {
      console.log(`\n--- ${r.unit_key} | ${r.unit_title} ---`)
      curUnit = r.unit_key
    }
    const sn = r.sub_no ? `(${r.sub_no})` : ''
    const ans = (r.answer || '').length > 25 ? (r.answer || '').slice(0, 25) + '...' : r.answer
    const cont = r.content ? r.content.slice(0, 60) : '(空)'
    console.log(`  题${r.question_no}${sn} [${r.answer_type}] answer="${ans}" content="${cont}"`)
  }

  // 看看 content 字段填充率
  console.log('\n\n=== 19.x 答案库 content 填充率 ===')
  const { rows: cnt } = await pool.query(`
    SELECT
      COUNT(*)::int as total,
      COUNT(ra.content)::int as with_content,
      COUNT(ra.content)::float / COUNT(*) * 100 as pct
    FROM worksheet_answers wa
    JOIN resource_units ru ON ru.id = wa.unit_id
    WHERE wa.worksheet_id = $1
      AND (ru.unit_key LIKE '%19.%' OR ru.unit_key LIKE '%试卷6%')
  `, [wsId])
  console.log(`  总数: ${cnt[0].total}, 有 content: ${cnt[0].with_content} (${cnt[0].pct.toFixed(1)}%)`)

  await pool.end()
}
run().catch(e => { console.error(e.message); process.exit(1) })
