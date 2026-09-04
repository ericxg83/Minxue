import 'dotenv/config'
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })

import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const name = '周俊辰'

async function main() {
  const stu = await pool.query(
    `SELECT id, name, grade, enrollment_status, paused_at, created_at FROM students WHERE name = $1`,
    [name]
  )
  console.log('=== students ===')
  console.table(stu.rows.map(r => ({ id: r.id, name: r.name, grade: r.grade, enrollment: r.enrollment_status })))
  if (stu.rows.length === 0) { console.log('未找到'); return pool.end() }

  for (const s of stu.rows) {
    console.log(`\n\n=== ${s.name} (${s.id}) 完整诊断 ===`)

    // 1. 全部错题状态分布
    const stats = await pool.query(
      `SELECT lifecycle_status, status, COUNT(*)::int AS n
       FROM wrong_questions WHERE student_id=$1
       GROUP BY lifecycle_status, status ORDER BY n DESC`,
      [s.id]
    )
    console.log('\n[1] wrong_questions 状态分布')
    console.table(stats.rows)

    // 2. 13 条 mastered 的详细信息 + 关联 questions 的 review_status 和 task 类型
    const mastered = await pool.query(
      `SELECT wq.id AS wq_id, wq.question_id, wq.status AS wq_status, wq.lifecycle_status,
              wq.error_count, wq.practice_count,
              wq.added_at, wq.last_wrong_at, wq.mastered_at, wq.updated_at AS wq_updated_at,
              wq.source_type, wq.worksheet_id, wq.subject,
              q.review_status AS q_review_status, q.is_correct AS q_is_correct,
              q.task_id, t.task_type AS q_task_type, t.status AS q_task_status,
              t.original_name AS q_task_name, t.created_at AS task_created_at,
              LEFT(wq.content, 40) AS content_head
       FROM wrong_questions wq
       LEFT JOIN questions q ON q.id = wq.question_id
       LEFT JOIN tasks t ON t.id = q.task_id
       WHERE wq.student_id = $1 AND wq.lifecycle_status = 'mastered'
       ORDER BY wq.mastered_at NULLS LAST, wq.updated_at DESC`,
      [s.id]
    )
    console.log(`\n[2] lifecycle=mastered 明细 (${mastered.rowCount} 条)`)
    console.table(mastered.rows.map(r => ({
      wq_id: r.wq_id?.slice(0, 8),
      error: r.error_count, practice: r.practice_count,
      wq_status: r.wq_status, lifecycle: r.lifecycle_status,
      source_type: r.source_type,
      q_review: r.q_review_status,
      task_type: r.q_task_type,
      added: r.added_at, mastered_at: r.mastered_at,
      head: r.content_head
    })))

    // 3. 该学生有没有过 generated_exams 重练卷
    const ge = await pool.query(
      `SELECT id, name, status, created_at, updated_at, retry_task_id,
              jsonb_array_length(COALESCE(question_ids, '[]'::jsonb)) AS n_questions
       FROM generated_exams WHERE student_id=$1 ORDER BY created_at DESC`,
      [s.id]
    )
    console.log(`\n[3] generated_exams (重练卷) 共 ${ge.rowCount} 条`)
    if (ge.rowCount > 0) console.table(ge.rows)
    else console.log('  (无 — 从未生成过重练卷)')

    // 4. 该学生全部 tasks 类型分布 (看是否有 retry_paper / wrong_retry)
    const taskDist = await pool.query(
      `SELECT task_type, status, COUNT(*)::int AS n
       FROM tasks WHERE student_id=$1 AND deleted_at IS NULL
       GROUP BY task_type, status ORDER BY task_type, status`,
      [s.id]
    )
    console.log('\n[4] tasks 类型分布')
    console.table(taskDist.rows)

    // 5. 13 条 mastered 中有多少来自"重练卷题目"(其 question_id 出现在 generated_exams)
    const fromRetry = await pool.query(
      `SELECT COUNT(*)::int AS n FROM wrong_questions wq
       WHERE wq.student_id=$1 AND wq.lifecycle_status='mastered'
         AND EXISTS (
           SELECT 1 FROM generated_exams ge
           WHERE ge.student_id=$1
             AND jsonb_typeof(ge.question_ids)='array'
             AND EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(ge.question_ids) qid
               WHERE qid = wq.question_id::text
             )
         )`,
      [s.id]
    )
    console.log(`\n[5] mastered 且 question_id 曾出现在该生任意重练卷里: ${fromRetry.rows[0].n} / ${mastered.rowCount}`)

    // 6. 反向: 这 13 条对应的 questions.review_status 分布 (如果大量是 'correct' 就锤实是复核点出来的)
    const rsDist = await pool.query(
      `SELECT COALESCE(q.review_status,'(null)') AS rs, COUNT(*)::int AS n
       FROM wrong_questions wq LEFT JOIN questions q ON q.id=wq.question_id
       WHERE wq.student_id=$1 AND wq.lifecycle_status='mastered'
       GROUP BY q.review_status ORDER BY n DESC`,
      [s.id]
    )
    console.log('\n[6] mastered 对应 questions.review_status 分布')
    console.table(rsDist.rows)

    // 7. 全站: mastered 分布 (按 practice_count) — 状态机产生的 mastered 必须 practice_count>=3
    const global = await pool.query(
      `SELECT
         COUNT(*)::int AS total_mastered,
         COUNT(*) FILTER (WHERE practice_count >= 3)::int AS sm_legal_p3plus,
         COUNT(*) FILTER (WHERE practice_count = 2)::int AS p2,
         COUNT(*) FILTER (WHERE practice_count = 1)::int AS p1,
         COUNT(*) FILTER (WHERE COALESCE(practice_count,0) = 0)::int AS p0_suspect
       FROM wrong_questions WHERE lifecycle_status='mastered'`
    )
    console.log('\n[7] 全站 lifecycle=mastered 分布 (按 practice_count, sm_legal_p3plus=状态机正常, p0_suspect=铁定污染)')
    console.table(global.rows)

    // 8. 全站: mastered 且学生从未生成过重练卷 —— 最纯粹的 bug 判据
    const globalSuspicious = await pool.query(
      `SELECT COUNT(DISTINCT wq.student_id)::int AS students,
              COUNT(*)::int AS rows
       FROM wrong_questions wq
       WHERE wq.lifecycle_status='mastered'
         AND NOT EXISTS (
           SELECT 1 FROM generated_exams ge WHERE ge.student_id = wq.student_id
         )`
    )
    console.log('\n[8] 全站: mastered 但学生从未生成过重练卷 (100% 污染)')
    console.table(globalSuspicious.rows)

    // 9. 全站: mastered 且 questions.review_status='correct' 且 practice_count<3
    //   → 直接归因: 老师在 PC 复核点了"正确"造成的假掌握
    const directAttribution = await pool.query(
      `SELECT COUNT(*)::int AS rows, COUNT(DISTINCT wq.student_id)::int AS students
       FROM wrong_questions wq
       LEFT JOIN questions q ON q.id = wq.question_id
       WHERE wq.lifecycle_status='mastered'
         AND q.review_status = 'correct'
         AND COALESCE(wq.practice_count,0) < 3`
    )
    console.log('\n[9] 全站: mastered 且关联 questions.review_status=correct 且 practice_count<3 (直接归因 reviewStore 污染)')
    console.table(directAttribution.rows)

    // 10. 全站: mastered 且 error_count=1 (只错过一次) 且 practice_count=0 (从未重练)
    //   → 数学上不可能到达 mastered, 100% 污染
    const impossibleMastered = await pool.query(
      `SELECT COUNT(*)::int AS rows, COUNT(DISTINCT student_id)::int AS students
       FROM wrong_questions
       WHERE lifecycle_status='mastered'
         AND error_count = 1
         AND COALESCE(practice_count,0) = 0`
    )
    console.log('\n[10] 全站: mastered 且 error_count=1 且 practice_count=0 (数学上不可能的组合)')
    console.table(impossibleMastered.rows)

    // 11. 学生维度 top 20 (被污染最严重的学生)
    const topStudents = await pool.query(
      `SELECT s.name, s.grade, COUNT(*)::int AS fake_mastered
       FROM wrong_questions wq
       LEFT JOIN questions q ON q.id = wq.question_id
       JOIN students s ON s.id = wq.student_id
       WHERE wq.lifecycle_status='mastered'
         AND COALESCE(wq.practice_count,0) < 3
       GROUP BY s.id, s.name, s.grade
       ORDER BY fake_mastered DESC LIMIT 20`
    )
    console.log('\n[11] 全站: 假掌握最多的学生 Top 20 (practice_count<3)')
    console.table(topStudents.rows)
  }

  await pool.end()
}

main().catch(e => { console.error(e); pool.end() })
