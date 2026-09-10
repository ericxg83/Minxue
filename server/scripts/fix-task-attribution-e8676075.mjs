/**
 * 2026-09-10 事故回填：任务 e8676075 的作业图片本是陆晨曦的，因前端学生归属被
 * 初始化后台刷新覆盖，上传归到了蔡怡希名下。
 *
 * 范围（只动 student_id 归属，不改任何业务状态/判题结果）：
 *   1. tasks.student_id
 *   2. questions.student_id（该 task 全部题目）
 *   3. wrong_questions.student_id（该 task 题目产生的错题）
 *   4. judgements.student_id（该 task 题目的判题审计归属）
 * 掌握度：knowledge_mastery 为 (student_id, kp_id) 聚合，事故任务尚未产生记录，
 * 无需迁移；如后续发现，可用 questions 表重放 syncQuestionsKnowledgeAndMastery。
 *
 * 用法：默认 dry-run 只打印计划；加 --apply 真正改库。
 * 所有受影响行先备份到 backup_misattr_20260910（JSONB 全行），可据此回滚。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const APPLY = process.argv.includes('--apply')

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const TASK_ID = 'e8676075-d1da-4be3-b9f8-e2e7c9053f77'
const CAI = '431c5182-265b-44c5-a32e-8367abbfefc5'  // 蔡怡希（错误归属）
const LU = '24f3df8b-9679-4295-8de5-b62ce53c7059'   // 陆晨曦（正确归属）
const BACKUP_TABLE = 'backup_misattr_20260910'

console.log(APPLY ? '⚠️  APPLY 模式：以下操作会真实改库\n' : '🔍 DRY-RUN 模式。加 --apply 才会改库\n')

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // 0. 守卫：task 必须存在且当前归属为蔡怡希，防止重复执行/误执行
  const cur = await client.query(
    `SELECT id, student_id, status, original_name, created_at FROM tasks WHERE id = $1`, [TASK_ID])
  if (cur.rowCount === 0) throw new Error(`task ${TASK_ID} 不存在`)
  if (cur.rows[0].student_id !== CAI) {
    throw new Error(`task 当前 student_id=${cur.rows[0].student_id}，不是蔡怡希(${CAI})，终止（可能已回填过）`)
  }
  console.log('📋 目标 task:', JSON.stringify(cur.rows[0], null, 2))
  console.log(`   归属变更: 蔡怡希(${CAI}) → 陆晨曦(${LU})\n`)

  // 1. 备份表（不存在则建）
  if (APPLY) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
        id BIGSERIAL PRIMARY KEY,
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        row_data JSONB NOT NULL,
        backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`)
  }

  // 2. 收集受影响行并备份
  const taskRow = cur.rows[0]
  const qRows = (await client.query(
    `SELECT * FROM questions WHERE task_id = $1`, [TASK_ID])).rows
  const qIds = qRows.map(r => r.id)
  const wqRows = (await client.query(
    `SELECT * FROM wrong_questions WHERE question_id = ANY($1::uuid[])`, [qIds])).rows
  const jRows = (await client.query(
    `SELECT * FROM judgements WHERE question_id = ANY($1::text[])`, [qIds])).rows

  console.log(`📦 受影响行：tasks=1, questions=${qRows.length}, wrong_questions=${wqRows.length}, judgements=${jRows.length}`)

  if (APPLY) {
    const backup = async (table, rows) => {
      for (const r of rows) {
        await client.query(
          `INSERT INTO ${BACKUP_TABLE} (table_name, row_id, row_data) VALUES ($1, $2, $3)`,
          [table, String(r.id), JSON.stringify(r)])
      }
    }
    await backup('tasks', [taskRow])
    await backup('questions', qRows)
    await backup('wrong_questions', wqRows)
    await backup('judgements', jRows)
    console.log('📦 已备份到', BACKUP_TABLE)
  }

  // 3. 归属变更（全部带当前归属守卫，幂等）
  const statements = [
    { sql: `UPDATE tasks SET student_id = $1, updated_at = NOW() WHERE id = $2 AND student_id = $3`, tag: 'tasks', expect: 1 },
    { sql: `UPDATE questions SET student_id = $1, updated_at = NOW() WHERE task_id = $2 AND student_id = $3`, tag: 'questions', expect: qRows.length },
    { sql: `UPDATE wrong_questions SET student_id = $1, updated_at = NOW() WHERE question_id = ANY($2::uuid[]) AND student_id = $3`, tag: 'wrong_questions', expect: wqRows.length },
    { sql: `UPDATE judgements SET student_id = $1 WHERE question_id = ANY($2::text[]) AND student_id = $3`, tag: 'judgements', expect: jRows.length }
  ]

  if (APPLY) {
    for (const s of statements) {
      const params = s.tag === 'tasks'
        ? [LU, TASK_ID, CAI]
        : s.tag === 'questions'
          ? [LU, TASK_ID, CAI]
          : s.tag === 'wrong_questions' || s.tag === 'judgements'
            ? [LU, qIds, CAI]
            : []
      const r = await client.query(s.sql, params)
      console.log(`  ${s.tag}: ${r.rowCount} 行更新（预期 ${s.expect}）`)
      if (r.rowCount !== s.expect) throw new Error(`${s.tag} 更新行数 ${r.rowCount} != 预期 ${s.expect}，回滚`)
    }
    await client.query('COMMIT')
    console.log('\n✅ 已提交：task 归属已改为陆晨曦')
  } else {
    console.log('\n计划执行的 UPDATE（dry-run 未执行）：')
    for (const s of statements) console.log(`  - ${s.tag}: 预期 ${s.expect} 行`)
    await client.query('ROLLBACK')
    console.log('\n（dry-run 结束，未改库。确认无误后加 --apply 执行）')
  }

  // 4. 执行后复核
  const verify = async () => {
    const t = await pool.query(`SELECT student_id FROM tasks WHERE id = $1`, [TASK_ID])
    const q = await pool.query(
      `SELECT student_id, COUNT(*)::int FROM questions WHERE task_id = $1 GROUP BY student_id`, [TASK_ID])
    const w = await pool.query(
      `SELECT student_id, COUNT(*)::int FROM wrong_questions WHERE question_id = ANY($1::uuid[]) GROUP BY student_id`, [qIds])
    const j = await pool.query(
      `SELECT student_id, COUNT(*)::int FROM judgements WHERE question_id = ANY($1::text[]) GROUP BY student_id`, [qIds])
    console.log('\n🔎 复核：')
    console.log('  tasks.student_id =', t.rows[0]?.student_id)
    console.log('  questions 分布:', JSON.stringify(q.rows))
    console.log('  wrong_questions 分布:', JSON.stringify(w.rows))
    console.log('  judgements 分布:', JSON.stringify(j.rows))
  }
  await verify()
} catch (e) {
  try { await client.query('ROLLBACK') } catch {}
  console.error('❌ 失败，已回滚:', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
