/**
 * 2026-09-11 作业归属修正：任务 47ffb534「新闵学校"成长·桥"练习 11.1 (4) 整式的乘法 (1)」
 * 实为毛辰绮（初一）的试卷（卷面姓名栏手写「毛辰绮」），上传时误挂在范梓琪（初二）名下。
 *
 * 范围（只改 student_id 归属，不动任何业务状态 / 判题结果 / 题目内容）：
 *   1. tasks.student_id
 *   2. questions.student_id        （该 task 全部 20 题）
 *   3. wrong_questions.student_id  （该 task 题目产生的 6 条错题）
 *   4. judgements.student_id       （该 task 题目的 25 条判题审计）
 *   5. training_logs.student_id    （该 task 题目的重练记录，实测 0 条）
 *
 * 不改动：
 *   - question_knowledge / question_assets：无 student_id 维度，题目本身不变
 *   - knowledge_mastery：本 task 题目未建立知识点关联（question_knowledge=0），无聚合受影响
 *   - generated_exams / student_worksheet_settings：两边均为 0 行
 *   - OSS 图片路径：images 存的是绝对 URL，不改写（沿用上次同类事故的处理口径）
 *
 * 用法：默认 dry-run 只打印计划；加 --apply 真正改库。
 * 所有受影响行先备份到 backup_misattr_20260911（JSONB 全行），可据此回滚。
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

const TASK_ID = '47ffb534-e6f3-418c-8ef7-e7faad80b60e'
const FAN = '91099a74-79f8-4de3-a178-2dc5594168c0' // 范梓琪（错误归属）
const MAO = '31b7d263-0eb0-476e-836e-faa7977b15f4' // 毛辰绮（正确归属）
const BACKUP_TABLE = 'backup_misattr_20260911'

console.log(APPLY ? '⚠️  APPLY 模式：以下操作会真实改库\n' : '🔍 DRY-RUN 模式。加 --apply 才会改库\n')

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // 0. 守卫：task 必须存在且当前归属为范梓琪
  const cur = await client.query(
    `SELECT id, student_id, status, original_name, created_at FROM tasks WHERE id = $1`, [TASK_ID])
  if (cur.rowCount === 0) throw new Error(`task ${TASK_ID} 不存在`)
  if (cur.rows[0].student_id !== FAN) {
    throw new Error(`task 当前 student_id=${cur.rows[0].student_id}，不是范梓琪(${FAN})，终止（可能已搬过）`)
  }
  console.log('📋 目标 task:', JSON.stringify(cur.rows[0], null, 2))
  console.log(`   归属变更: 范梓琪(${FAN}) → 毛辰绮(${MAO})\n`)

  // 1. 备份表
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

  // 2. 收集受影响行
  const taskRow = cur.rows[0]
  const qRows = (await client.query(`SELECT * FROM questions WHERE task_id = $1`, [TASK_ID])).rows
  const qIds = qRows.map(r => r.id)
  const wqRows = (await client.query(
    `SELECT * FROM wrong_questions WHERE question_id = ANY($1::uuid[])`, [qIds])).rows
  const jRows = (await client.query(
    `SELECT * FROM judgements WHERE question_id = ANY($1::text[])`, [qIds.map(String)])).rows
  const tlRows = (await client.query(
    `SELECT * FROM training_logs WHERE question_id = ANY($1::uuid[])`, [qIds])).rows

  console.log(`📦 受影响行：tasks=1, questions=${qRows.length}, wrong_questions=${wqRows.length}, judgements=${jRows.length}, training_logs=${tlRows.length}`)

  // 归属分布（应与预期一致）
  const dist = (rows) => {
    const m = {}
    for (const r of rows) m[r.student_id] = (m[r.student_id] || 0) + 1
    return JSON.stringify(m)
  }
  console.log('   questions 归属分布:', dist(qRows))
  console.log('   wrong_questions 归属分布:', dist(wqRows))
  console.log('   judgements 归属分布:', dist(jRows))
  console.log('   training_logs 归属分布:', dist(tlRows))

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
    await backup('training_logs', tlRows)
    console.log(`📦 已备份到 ${BACKUP_TABLE}`)
  }

  // 3. 归属变更（全部带当前归属守卫，幂等）
  const statements = [
    {
      tag: 'tasks',
      sql: `UPDATE tasks SET student_id = $1, updated_at = NOW() WHERE id = $2 AND student_id = $3`,
      params: [MAO, TASK_ID, FAN], expect: 1
    },
    {
      tag: 'questions',
      sql: `UPDATE questions SET student_id = $1, updated_at = NOW() WHERE task_id = $2 AND student_id = $3`,
      params: [MAO, TASK_ID, FAN], expect: qRows.length
    },
    {
      tag: 'wrong_questions',
      sql: `UPDATE wrong_questions SET student_id = $1, updated_at = NOW() WHERE question_id = ANY($2::uuid[]) AND student_id = $3`,
      params: [MAO, qIds, FAN], expect: wqRows.length
    },
    {
      tag: 'judgements',
      sql: `UPDATE judgements SET student_id = $1 WHERE question_id = ANY($2::text[]) AND student_id = $3`,
      params: [MAO, qIds.map(String), FAN], expect: jRows.length
    },
    {
      tag: 'training_logs',
      sql: `UPDATE training_logs SET student_id = $1, updated_at = NOW() WHERE question_id = ANY($2::uuid[]) AND student_id = $3`,
      params: [MAO, qIds, FAN], expect: tlRows.length
    }
  ]

  if (APPLY) {
    for (const s of statements) {
      const r = await client.query(s.sql, s.params)
      console.log(`  ${s.tag}: ${r.rowCount} 行更新（预期 ${s.expect}）`)
      if (r.rowCount !== s.expect) throw new Error(`${s.tag} 更新行数 ${r.rowCount} != 预期 ${s.expect}，回滚`)
    }
    await client.query('COMMIT')
    console.log('\n✅ 已提交：task 归属已改为毛辰绮')
  } else {
    console.log('\n计划执行的 UPDATE（dry-run 未执行）：')
    for (const s of statements) console.log(`  - ${s.tag}: 预期 ${s.expect} 行`)
    await client.query('ROLLBACK')
    console.log('\n（dry-run 结束，未改库。确认无误后加 --apply 执行）')
  }

  // 4. 执行后复核
  const t = await pool.query(`SELECT student_id, original_name FROM tasks WHERE id = $1`, [TASK_ID])
  const q = await pool.query(
    `SELECT student_id, COUNT(*)::int n FROM questions WHERE task_id = $1 GROUP BY student_id`, [TASK_ID])
  const w = await pool.query(
    `SELECT student_id, COUNT(*)::int n FROM wrong_questions WHERE question_id = ANY($1::uuid[]) GROUP BY student_id`, [qIds])
  const j = await pool.query(
    `SELECT student_id, COUNT(*)::int n FROM judgements WHERE question_id = ANY($1::text[]) GROUP BY student_id`, [qIds.map(String)])
  const tl = await pool.query(
    `SELECT student_id, COUNT(*)::int n FROM training_logs WHERE question_id = ANY($1::uuid[]) GROUP BY student_id`, [qIds])

  console.log('\n🔎 复核：')
  console.log('  tasks.student_id =', t.rows[0]?.student_id, `(${t.rows[0]?.original_name})`)
  console.log('  questions 分布:', JSON.stringify(q.rows))
  console.log('  wrong_questions 分布:', JSON.stringify(w.rows))
  console.log('  judgements 分布:', JSON.stringify(j.rows))
  console.log('  training_logs 分布:', JSON.stringify(tl.rows))

  const cnt = async (sid) => {
    const a = (await pool.query(`SELECT COUNT(*)::int n FROM tasks WHERE student_id=$1 AND deleted_at IS NULL`, [sid])).rows[0].n
    const b = (await pool.query(`SELECT COUNT(*)::int n FROM wrong_questions WHERE student_id=$1`, [sid])).rows[0].n
    return `tasks=${a}, wrong_questions=${b}`
  }
  console.log(`\n📊 毛辰绮名下: ${await cnt(MAO)}`)
  console.log(`📊 范梓琪名下: ${await cnt(FAN)}`)
} catch (e) {
  try { await client.query('ROLLBACK') } catch {}
  console.error('❌ 失败，已回滚:', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
