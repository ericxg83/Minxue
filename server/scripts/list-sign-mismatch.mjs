/**
 * 一次性查询：列出 answer_sign_mismatch 命中的 7 条题，
 * 同时输出 question.id（唯一 UUID），用于修复脚本精确定位。
 *
 * 注意：task_id + question_number 不唯一（同一 task 下同号多题），
 * 必须用 id 才能锁定单题。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'
import { aiParseSelfCheck } from '../utils/aiParseSelfCheck.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const { rows } = await pool.query(`
  SELECT id, task_id, question_number, question_type,
         content, answer, student_answer, analysis, is_correct,
         ai_self_check_passed, ai_self_check_issues,
         ai_answer_risk_reason
  FROM questions
  ORDER BY id
`)

const hits = []
for (const r of rows) {
  const check = aiParseSelfCheck({
    answer: r.answer,
    student_answer: r.student_answer,
    analysis: r.analysis
  })
  if (check.issues.includes('answer_sign_mismatch')) {
    hits.push(r)
  }
}

console.log(`answer_sign_mismatch 命中 ${hits.length} 条：\n`)
for (let i = 0; i < hits.length; i++) {
  const h = hits[i]
  console.log(`━━━ [${i + 1}/${hits.length}] ━━━`)
  console.log(`id (用于修复):   ${h.id}`)
  console.log(`task_id:        ${h.task_id}`)
  console.log(`question_number: ${h.question_number}  (${h.question_type})`)
  console.log(`is_correct:     ${h.is_correct}`)
  console.log(`self_check:     passed=${h.ai_self_check_passed}  issues=${JSON.stringify(h.ai_self_check_issues)}`)
  console.log(`risk_reason:    ${h.ai_answer_risk_reason || '(空)'}`)
  console.log(`content:        ${(h.content || '').substring(0, 120)}`)
  console.log(`answer:         ${h.answer}`)
  console.log(`student_answer: ${h.student_answer}`)
  console.log()
}

await pool.end()