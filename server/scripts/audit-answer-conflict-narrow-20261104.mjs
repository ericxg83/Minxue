// Read-only narrowing audit: among the 1005 high-risk rows, how many have an
// analysis text whose stated final answer agrees with ai_answer but NOT with answer
// -> high-confidence fake wrongs (reference answer itself is wrong).
// Only extracts from choice-type rows (A-D letter) to stay objective.
import '../loadEnv.js'
import { getPool } from '../config/neon.js'

const pool = getPool()
const rows = await pool.query(`
  SELECT q.id, q.student_id, s.name AS student_name, q.task_id,
         q.question_number, q.answer, q.ai_answer, q.student_answer,
         q.analysis, q.created_at,
         EXISTS (SELECT 1 FROM wrong_questions wq WHERE wq.question_id = q.id) AS in_wrong_book
    FROM questions q
    LEFT JOIN students s ON s.id = q.student_id
   WHERE q.deleted_at IS NULL
     AND q.answer_source = 'recognized'
     AND q.question_type = 'choice'
     AND q.answer ~ '^[A-D]$'
     AND q.ai_answer ~ '^[A-D]$'
     AND q.answer <> q.ai_answer
     AND btrim(q.student_answer) = btrim(q.ai_answer)
     AND q.is_correct = FALSE
   ORDER BY q.created_at DESC
`)
console.log('CHOICE_HIGH_RISK:', rows.rowCount)

const pickFromAnalysis = (text) => {
  const t = String(text || '')
  const patterns = [
    /最终答案[：:]\s*\*?\*?\s*([A-D])\b/,
    /正确答案[是为：:]\s*\*?\*?\s*([A-D])\b/,
    /故选\s*([A-D])\b/,
    /答案[为：:]\s*\*?\*?\s*([A-D])\b/,
    /\b([A-D])\s*项[正对]确/
  ]
  for (const p of patterns) {
    const m = t.match(p)
    if (m) return m[1]
  }
  return null
}

let agreeAI = 0, agreeRef = 0, noParse = 0, inBookHighConf = 0
const highConf = []
for (const r of rows.rows) {
  const picked = pickFromAnalysis(r.analysis)
  if (!picked) { noParse += 1; continue }
  if (picked === r.ai_answer) {
    agreeAI += 1
    if (r.in_wrong_book) inBookHighConf += 1
    highConf.push({
      q: String(r.id).slice(0, 8),
      stu: r.student_name || String(r.student_id).slice(0, 8),
      no: r.question_number,
      ref: r.answer, ai: r.ai_answer, parsed: picked,
      at: String(r.created_at || '').slice(0, 10),
      inBook: r.in_wrong_book
    })
  } else if (picked === r.answer) {
    agreeRef += 1
  } else {
    noParse += 1
  }
}
console.log('ANALYSIS_AGREES_WITH_AI(high-conf fake wrong):', agreeAI)
console.log('ANALYSIS_AGREES_WITH_REF(judging was right):', agreeRef)
console.log('ANALYSIS_UNPARSABLE:', noParse)
console.log('HIGH_CONF_IN_WRONG_BOOK:', inBookHighConf)
console.log('--- HIGH CONF SAMPLE (first 30) ---')
for (const h of highConf.slice(0, 30)) console.log(JSON.stringify(h))
fs.writeFileSync(new URL('./_highconf_list_1104.json', import.meta.url), JSON.stringify(highConf, null, 2), 'utf8')
await pool.end()
