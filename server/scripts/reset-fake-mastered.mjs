/**
 * 回洗"假掌握"数据
 *
 * 背景：PC 工作台复核点「正确」时，reviewStore 曾绕过状态机把错题一步写成
 *      lifecycle_status='mastered'。历史上共 61 条被污染，分布在 9 位学生。
 *      这些行的共同特征：practice_count < 2。
 *
 * 判据（自 2026-09-04 起，状态机简化为 new→review_1→mastered，累计答对 2 次到掌握）：
 *      lifecycle_status='mastered' AND COALESCE(practice_count, 0) < 2
 *
 * 动作：lifecycle_status='new', status='pending', mastered_at=NULL, updated_at=NOW()
 *
 * 用法：
 *   node scripts/reset-fake-mastered.mjs             # dry-run 只报告，不改数据
 *   node scripts/reset-fake-mastered.mjs --execute   # 实际回洗
 */
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })

import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const EXECUTE = process.argv.includes('--execute')

const WHERE = `
  lifecycle_status = 'mastered'
  AND COALESCE(practice_count, 0) < 2
`

async function main() {
  console.log(`\n模式: ${EXECUTE ? '*** 执行回洗 ***' : '*** DRY-RUN (不改数据) ***'}`)
  console.log(`判据: lifecycle_status='mastered' AND COALESCE(practice_count,0) < 2\n`)

  // 1. 总数与按学生分布
  const total = await pool.query(
    `SELECT COUNT(*)::int AS n FROM wrong_questions WHERE ${WHERE}`
  )
  console.log(`命中总数: ${total.rows[0].n}`)

  const byStudent = await pool.query(
    `SELECT s.name, s.grade, COUNT(*)::int AS n
     FROM wrong_questions wq JOIN students s ON s.id = wq.student_id
     WHERE ${WHERE}
     GROUP BY s.id, s.name, s.grade ORDER BY n DESC`
  )
  console.log('\n按学生分布:')
  console.table(byStudent.rows)

  // 2. practice_count 分布（确认是否全是 p0）
  const byPractice = await pool.query(
    `SELECT COALESCE(practice_count, 0) AS pc, COUNT(*)::int AS n
     FROM wrong_questions WHERE ${WHERE}
     GROUP BY COALESCE(practice_count, 0) ORDER BY pc`
  )
  console.log('\npractice_count 分布 (0/1/2 均应回洗; >=3 已通过状态机合法到达):')
  console.table(byPractice.rows)

  // 3. error_count 分布
  const byError = await pool.query(
    `SELECT error_count, COUNT(*)::int AS n
     FROM wrong_questions WHERE ${WHERE}
     GROUP BY error_count ORDER BY error_count`
  )
  console.log('\nerror_count 分布:')
  console.table(byError.rows)

  // 3b. phase 2 命中量: status/lifecycle 双字段不一致
  const syncPreview = await pool.query(
    `SELECT COUNT(*)::int AS n FROM wrong_questions
     WHERE status = 'mastered'
       AND lifecycle_status IS DISTINCT FROM 'mastered'`
  )
  console.log(`\nphase 2 预览: status='mastered' 但 lifecycle != 'mastered' 共 ${syncPreview.rows[0].n} 条 (将同步为 status='pending')`)

  if (!EXECUTE) {
    console.log('\n[DRY-RUN] 未做任何修改。确认判据无误后加 --execute 执行回洗。\n')
    return pool.end()
  }

  // 4. 事务内 UPDATE
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const upd = await client.query(
      `UPDATE wrong_questions
       SET lifecycle_status = 'new',
           status = 'pending',
           mastered_at = NULL,
           updated_at = NOW()
       WHERE ${WHERE}
       RETURNING id, student_id, question_id, practice_count, error_count`
    )
    console.log(`\n[EXECUTE phase 1] 已回洗 ${upd.rowCount} 条 lifecycle='mastered' AND practice_count<2`)

    // phase 2: 修 status 与 lifecycle 双字段不一致的遗留脏值
    // 场景：早期 reviewStore 只写 status 没写 lifecycle，或 cleanup 脚本只洗了一边
    const sync = await client.query(
      `UPDATE wrong_questions
       SET status = 'pending', updated_at = NOW()
       WHERE status = 'mastered'
         AND lifecycle_status IS DISTINCT FROM 'mastered'
       RETURNING id, student_id, lifecycle_status`
    )
    console.log(`[EXECUTE phase 2] 已对齐 ${sync.rowCount} 条 status/lifecycle 双字段不一致`)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('回洗失败，事务已回滚:', e.message)
    client.release()
    return pool.end()
  }
  client.release()

  // 5. 复查
  const after = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE lifecycle_status='mastered')::int AS mastered_left,
       COUNT(*) FILTER (WHERE status='mastered' AND lifecycle_status IS DISTINCT FROM 'mastered')::int AS status_lagging_left
     FROM wrong_questions`
  )
  console.log(`复查: lifecycle='mastered' 剩余 ${after.rows[0].mastered_left}, status/lifecycle 不一致剩余 ${after.rows[0].status_lagging_left}`)

  await pool.end()
}

main().catch(e => { console.error(e); pool.end() })
