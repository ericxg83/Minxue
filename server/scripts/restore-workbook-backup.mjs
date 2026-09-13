/**
 * 从备份恢复三个 workbook 任务的重跑前数据（questions / wrong_questions / judgements）。
 * 背景：重跑因「魔搭 OCR 配额耗尽 → 备用视觉模型」反而产出更差数据（题数 15→9、答案库命中 7→0）。
 * 先删后插，行数与备份核对，任何一步失败立即中止。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import { readFileSync } from 'node:fs'

const FILE = process.argv[2]
if (!FILE) { console.error('用法: node scripts/restore-workbook-backup.mjs <备份json路径>'); process.exit(1) }
const backup = JSON.parse(readFileSync(FILE, 'utf8'))
console.log(`备份: ${FILE}`)
console.log(`  created=${backup.createdAt}  questions=${backup.questions.length} wrong=${backup.wrongQuestions.length} judgements=${backup.judgements.length}`)

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await pool.query(s, p)).rows
const ids = backup.taskIds

// 只保留当前表里真实存在的列，避免备份列与现库结构漂移
const colsOf = async (table) =>
  (await q(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [table])).map(r => r.column_name)

const insertRows = async (client, table, rows) => {
  if (!rows.length) return 0
  const colInfo = (await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1`, [table])).rows
  const valid = new Set(colInfo.map(r => r.column_name))
  // json/jsonb 列必须显式 JSON.stringify：node-postgres 会把 JS 数组序列化成
  // Postgres 数组字面量 {"a","b"} 而不是 JSON，直接传数组必报
  // "invalid input syntax for type json"
  const jsonCols = new Set(colInfo.filter(r => r.data_type === 'json' || r.data_type === 'jsonb').map(r => r.column_name))
  const arrayCols = new Set(colInfo.filter(r => r.data_type === 'ARRAY').map(r => r.column_name))
  const prep = (k, v) => {
    if (v === undefined) return null
    if (jsonCols.has(k) && (Array.isArray(v) || (v && typeof v === 'object'))) return JSON.stringify(v)
    if (arrayCols.has(k) && Array.isArray(v)) return v
    return v
  }
  const first = Object.keys(rows[0]).filter(k => valid.has(k))
  const values = []
  const groups = rows.map((row, r) => {
    const keys = Object.keys(row).filter(k => valid.has(k))
    if (keys.join(',') !== first.join(',')) throw new Error(`${table} 第 ${r} 行列集不一致，中止`)
    const ph = keys.map((_, i) => `$${r * keys.length + i + 1}`).join(',')
    for (const k of keys) values.push(row[k] === undefined ? null : row[k])
    return `(${ph})`
  })
  // 逐行插入（便于定位坏行）；任何一行失败都会带上行号与 json 列的序列化形态
  let done = 0
  for (const row of rows) {
    const keys = Object.keys(row).filter(k => valid.has(k))
    const vals = keys.map(k => prep(k, row[k]))
    try {
      await client.query(
        `INSERT INTO ${table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
        vals)
    } catch (e) {
      console.error(`  ❌ ${table} 第 ${done + 1} 行 id=${row.id}: ${e.message}`)
      for (const k of keys) {
        const v = row[k]
        if (v !== null && typeof v === 'object') {
          let s; try { s = JSON.stringify(v) } catch (je) { s = '(无法序列化: ' + je.message + ')' }
          console.error(`     ${k}: ${s.slice(0, 160)}`)
        }
      }
      throw e
    }
    done++
  }
  return done
}

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // 1) 清掉重跑产生的现数据（先删引用，再删题目）
  const delWq = await client.query(
    `DELETE FROM wrong_questions WHERE question_id::text IN (SELECT id::text FROM questions WHERE task_id::text = ANY($1))`, [ids])
  const delJ = await client.query(
    `DELETE FROM judgements WHERE question_id::text IN (SELECT id::text FROM questions WHERE task_id::text = ANY($1))`, [ids])
  const delQ = await client.query(`DELETE FROM questions WHERE task_id::text = ANY($1)`, [ids])
  console.log(`已清除重跑数据: questions=${delQ.rowCount} wrong=${delWq.rowCount} judgements=${delJ.rowCount}`)

  // 2) 按备份回填（先按主键清掉可能残留的同 id 行——judgements.question_id 是 text，
  //    不会随 questions 级联删除，历次重跑可能留下同 id 审计行）
  for (const [table, rows] of [
    ['questions', backup.questions],
    ['wrong_questions', backup.wrongQuestions],
    ['judgements', backup.judgements],
  ]) {
    if (!rows.length) continue
    const ids = rows.map(r => r.id)
    const del = await client.query(`DELETE FROM ${table} WHERE id::text = ANY($1)`, [ids])
    console.log(`  清理 ${table} 同 id 残留: ${del.rowCount}`)
  }
  const nq = await insertRows(client, "questions", backup.questions)
  const nw = await insertRows(client, "wrong_questions", backup.wrongQuestions)
  const nj = await insertRows(client, "judgements", backup.judgements)
  console.log(`已回填: questions=${nq} wrong=${nw} judgements=${nj}`)

  if (nq !== backup.questions.length || nw !== backup.wrongQuestions.length || nj !== backup.judgements.length) {
    throw new Error('回填行数与备份不一致，回滚')
  }
  await client.query('COMMIT')
  console.log('\n✅ 恢复完成，已回到重跑前状态')
} catch (e) {
  await client.query('ROLLBACK')
  console.error('\n❌ 已回滚，数据库未变:', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
