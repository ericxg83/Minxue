import 'dotenv/config'
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })

import pg from 'pg'
import { aiParseSelfCheck } from '../utils/aiParseSelfCheck.js'

const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const TASK_ID = '87240cbf-abd5-45ea-972d-55befd4037f8'
const QUESTION_NUMBER = 14

async function main() {
  // 1. 拉题 14 当前状态
  const r = await pool.query(
    `SELECT id, question_number, answer, student_answer, analysis,
            ai_self_check_passed, ai_self_check_issues
     FROM questions
     WHERE task_id = $1 AND question_number = $2 AND deleted_at IS NULL`,
    [TASK_ID, QUESTION_NUMBER]
  )
  if (r.rows.length === 0) {
    console.log('未找到题 14')
    await pool.end()
    return
  }
  const q = r.rows[0]
  console.log('=== 题 14 当前状态 ===')
  console.log(`  answer: ${q.answer}`)
  console.log(`  student_answer: ${q.student_answer}`)
  console.log(`  ai_self_check_passed: ${q.ai_self_check_passed}`)
  console.log(`  ai_self_check_issues: ${JSON.stringify(q.ai_self_check_issues)}`)
  console.log(`  analysis_tail: ...${q.analysis.slice(-80)}`)

  // 2. 跑新自检
  const check = aiParseSelfCheck({
    answer: q.answer,
    student_answer: q.student_answer,
    analysis: q.analysis
  })
  console.log('\n=== 跑新自检结果 ===')
  console.log(`  pass: ${check.pass}`)
  console.log(`  issues: ${JSON.stringify(check.issues)}`)

  // 3. UPDATE
  const upd = await pool.query(
    `UPDATE questions
     SET ai_self_check_passed = $1,
         ai_self_check_issues = $2::jsonb,
         updated_at = NOW()
     WHERE id = $3
     RETURNING id, ai_self_check_passed, ai_self_check_issues`,
    [check.pass, JSON.stringify(check.issues), q.id]
  )
  console.log('\n=== UPDATE 后的行 ===')
  console.log(JSON.stringify(upd.rows[0], null, 2))

  await pool.end()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})