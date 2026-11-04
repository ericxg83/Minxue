// Read-only audit: scale of same-pattern fake-wrongs.
// Pattern: answer_source='recognized' AND answer != ai_answer (both non-empty)
//          AND is_correct = FALSE AND student_answer = ai_answer
//          -> student answered the AI-analysis answer but was judged wrong by `answer`.
// Also reports how many of those are currently sitting in wrong_questions.
import '../loadEnv.js'
import { getPool } from '../config/neon.js'

const pool = getPool()
const rows = await pool.query(`
  SELECT q.id, q.task_id, q.student_id, s.name AS student_name,
         q.question_number, q.question_type, q.answer, q.ai_answer, q.student_answer,
         q.answer_source, q.created_at,
         EXISTS (SELECT 1 FROM wrong_questions wq WHERE wq.question_id = q.id) AS in_wrong_book
    FROM questions q
    LEFT JOIN students s ON s.id = q.student_id
   WHERE q.deleted_at IS NULL
     AND q.answer_source = 'recognized'
     AND q.answer IS NOT NULL AND btrim(q.answer) <> ''
     AND q.ai_answer IS NOT NULL AND btrim(q.ai_answer) <> ''
     AND btrim(q.answer) <> btrim(q.ai_answer)
     AND btrim(q.student_answer) = btrim(q.ai_answer)
     AND q.is_correct = FALSE
   ORDER BY q.created_at DESC
`)
console.log('TOTAL_HIGH_RISK:', rows.rowCount)
let inBook = 0
for (const r of rows.rows) {
  if (r.in_wrong_book) inBook += 1
  console.log(JSON.stringify({
    q: String(r.id).slice(0, 8),
    stu: r.student_name || String(r.student_id).slice(0, 8),
    no: r.question_number,
    type: r.question_type,
    ans: String(r.answer).slice(0, 24),
    ai: String(r.ai_answer).slice(0, 24),
    stuAns: String(r.student_answer).slice(0, 24),
    at: String(r.created_at || '').slice(0, 10),
    inBook: r.in_wrong_book
  }))
}
console.log('IN_WRONG_BOOK:', inBook)
await pool.end()
