/**
 * 回滚 2026-09-11 的作业归属搬运：task 47ffb534 从毛辰绮 改回 范梓琪。
 * 依据 backup_misattr_20260911 中每行原始的 student_id 逐行还原。
 *
 * 用法：默认 dry-run；加 --apply 真正回滚。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const APPLY = process.argv.includes('--apply')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 })

const TASK_ID = '47ffb534-e6f3-418c-8ef7-e7faad80b60e'
const MAO = '31b7d263-0eb0-476e-836e-faa7977b15f4' // 当前归属
const BACKUP_TABLE = 'backup_misattr_20260911'

console.log(APPLY ? '⚠️  APPLY 模式：真实回滚\n' : '🔍 DRY-RUN 模式。加 --apply 才回滚\n')

const client = await pool.connect()
try {
  await client.query('BEGIN')

  const bk = await client.query(
    `SELECT table_name, COUNT(*)::int n FROM ${BACKUP_TABLE} GROUP BY table_name ORDER BY table_name`)
  console.log('📦 备份表内容:', JSON.stringify(bk.rows))
  if (bk.rowCount === 0) throw new Error(`备份表 ${BACKUP_TABLE} 为空，无法回滚`)

  const guard = await client.query(`SELECT student_id FROM tasks WHERE id=$1`, [TASK_ID])
  if (guard.rows[0].student_id !== MAO) {
    throw new Error('task 当前归属不是毛辰绮，终止（可能已回滚过）')
  }

  // 逐行按备份的 (table, row_id) -> 原始 student_id 还原
  const rows = (await client.query(
    `SELECT table_name, row_id, row_data->>'student_id' AS sid FROM ${BACKUP_TABLE} ORDER BY table_name`)).rows

  const byTable = {}
  for (const r of rows) (byTable[r.table_name] = byTable[r.table_name] || []).push(r)
  for (const [table, list] of Object.entries(byTable)) {
    console.log(`\n  [${table}] 待还原 ${list.length} 行 -> 原始归属 ${[...new Set(list.map(x => x.sid))].join(', ')}`)
  }

  if (!APPLY) {
    await client.query('ROLLBACK')
    console.log('\n（dry-run 结束，未改库）')
  } else {
    const PK = { judgements: 'id', tasks: 'id', questions: 'id', wrong_questions: 'id', training_logs: 'id' }
    for (const [table, list] of Object.entries(byTable)) {
      let n = 0
      for (const r of list) {
        const res = await client.query(
          `UPDATE ${table} SET student_id=$1 WHERE ${PK[table]}=$2`, [r.sid, r.row_id])
        n += res.rowCount
      }
      console.log(`  ${table}: 还原 ${n} 行`)
    }
    await client.query('COMMIT')
    console.log('\n✅ 已回滚')
  }

  const t = await pool.query(
    `SELECT s.name FROM tasks t JOIN students s ON s.id=t.student_id WHERE t.id=$1`, [TASK_ID])
  console.log('🔎 当前归属:', t.rows[0]?.name)
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('❌ 失败:', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
