/**
 * 恢复 task 73e54aef 的归属：student_id 改回陈施君，清掉 deleted_at，
 * 连带 questions.student_id 也改回。
 *
 * 背景：今天的清理动作把 task 73e54aef 的 student_id 误改成张诗蕊，并标 deleted_at；
 * 但 wrong_questions 没被改，所以陈施君的"错题还在、作业列表不见"。
 *
 * dry-run：默认只打印计划。加 --apply 真正改库。
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

const TASK_ID = '73e54aef-882f-4647-a3c1-d461cb861c59'
const CSJ = '23aabcd4-e3a5-47e5-9170-78d2122255b3'
const ZSR = 'bf235b85-e5d4-4f50-9e42-af8330df9451'

console.log(APPLY ? '⚠️  APPLY 模式：以下操作会真实改数据库。\n' : '🔍 DRY-RUN 模式。加 --apply 才会改库。\n')

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // 1. 先看备份里 task 73e54aef 的原归属
  const bk = await client.query(
    `SELECT id, student_id, status, deleted_at, created_at, updated_at
     FROM tasks_backup_20260902 WHERE id = $1`, [TASK_ID])
  if (bk.rowCount === 0) {
    console.log('❌ 备份表里没有 task 73e54aef，无法恢复')
    await client.query('ROLLBACK')
    process.exit(1)
  }
  console.log('📦 备份里 task 73e54aef：')
  console.log(JSON.stringify(bk.rows[0], null, 2))

  // 2. 现存 task 状态
  const cur = await client.query(
    `SELECT id, student_id, status, deleted_at, created_at, updated_at
     FROM tasks WHERE id = $1`, [TASK_ID])
  console.log('\n📍 现存 task 73e54aef：')
  console.log(JSON.stringify(cur.rows[0], null, 2))

  // 3. 该 task 下的 questions 现存归属
  const q = await client.query(
    `SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE student_id = $1)::int AS csj,
       COUNT(*) FILTER (WHERE student_id = $2)::int AS zsr,
       COUNT(*) FILTER (WHERE student_id NOT IN ($1,$2))::int AS other
     FROM questions WHERE task_id = $3`, [CSJ, ZSR, TASK_ID])
  console.log('\n📍 现存 questions 中该 task 的 student_id 分布：')
  console.log(JSON.stringify(q.rows[0], null, 2))

  // 4. 备份 questions 中该 task 的归属
  const qbk = await client.query(
    `SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE student_id = $1)::int AS csj,
       COUNT(*) FILTER (WHERE student_id = $2)::int AS zsr
     FROM questions_backup_20260902 WHERE task_id = $3`, [CSJ, ZSR, TASK_ID])
  console.log('\n📦 备份 questions 中该 task 的 student_id 分布：')
  console.log(JSON.stringify(qbk.rows[0], null, 2))

  // 5. 计划
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('📋 恢复计划：')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`  ① UPDATE tasks
       SET student_id = '${CSJ}',
           updated_at = NOW()
       WHERE id = '${TASK_ID}'
         AND student_id = '${ZSR}'
         AND deleted_at IS NOT NULL
     -- 清掉 deleted_at 同时改 student_id`)
  console.log(`  ② UPDATE questions
       SET student_id = '${CSJ}',
           updated_at = NOW()
       WHERE task_id = '${TASK_ID}'
         AND student_id = '${ZSR}'`)

  if (!APPLY) {
    console.log('\n💡 加 --apply 真正执行。建议恢复前先建本次备份：')
    console.log('   CREATE TABLE tasks_restore_pre_20260902 AS SELECT * FROM tasks;')
    console.log('   CREATE TABLE questions_restore_pre_20260902 AS SELECT * FROM questions;')
    await client.query('ROLLBACK')
    process.exit(0)
  }

  // 6. 执行
  console.log('\n⏳ 开始恢复...\n')

  const u1 = await client.query(
    `UPDATE tasks
     SET student_id = $1,
           deleted_at = NULL,
           updated_at = NOW()
     WHERE id = $2
       AND student_id = $3
       AND deleted_at IS NOT NULL
     RETURNING id, student_id, deleted_at, updated_at`,
    [CSJ, TASK_ID, ZSR]
  )
  console.log(`✅ task 73e54aef 恢复：${u1.rowCount} 条`)
  if (u1.rowCount > 0) console.log(JSON.stringify(u1.rows[0], null, 2))

  const u2 = await client.query(
    `UPDATE questions
     SET student_id = $1,
           updated_at = NOW()
     WHERE task_id = $2
       AND student_id = $3
     RETURNING id`,
    [CSJ, TASK_ID, ZSR]
  )
  console.log(`✅ questions 归属恢复：${u2.rowCount} 条`)

  // 7. 验证
  const v1 = await client.query(
    `SELECT student_id, deleted_at, status FROM tasks WHERE id = $1`, [TASK_ID])
  console.log('\n📋 恢复后 task 状态：', JSON.stringify(v1.rows[0], null, 2))

  const v2 = await client.query(
    `SELECT student_id, COUNT(*)::int AS n FROM questions WHERE task_id = $1 GROUP BY student_id`, [TASK_ID])
  console.log('📋 恢复后 questions 归属：', JSON.stringify(v2.rows, null, 2))

  const v3 = await client.query(
    `SELECT COUNT(*)::int AS n FROM tasks WHERE student_id = $1 AND deleted_at IS NULL`, [CSJ])
  console.log('📋 陈施君名下 alive tasks 数：', v3.rows[0].n)

  await client.query('COMMIT')
  console.log('\n✅ 已提交。')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('\n❌ 失败:', e.message)
  console.error(e.stack)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}