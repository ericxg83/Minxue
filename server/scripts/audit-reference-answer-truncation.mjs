/**
 * 只读评估：参考答案「解析截断」的覆盖面上限与放水风险
 *
 * 不用消融（judgeAnswer 内部不好从外部关掉截断通道），改为直接刻画上限：
 *   A 会被截断的参考答案条数
 *   B 截断片段本身能判对的题数（= 截断通道的收益上限）
 *   C 其中老师结论为「错」的条数（= 放水风险）
 * 端到端净效果以 _diag_judge_equiv_backtest.mjs 为准。
 * 只读，不写库。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import { judgeAnswer, sanitizeReferenceAnswer } from '../services/judgeService.js'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const { rows } = await pool.query(`
  SELECT q.task_id, q.question_number, q.question_type, q.student_answer, q.answer,
         q.answer_source, q.review_status
  FROM tasks t JOIN questions q ON q.task_id = t.id
  WHERE t.created_at > NOW() - INTERVAL '30 days' AND t.status <> 'failed'`)

let truncatable = 0
let upperBound = 0
let conflict = 0
const samples = []
const risks = []

for (const r of rows) {
  const orig = String(r.answer ?? '').trim()
  const cut = sanitizeReferenceAnswer(r.answer)
  if (cut === orig) continue
  truncatable++
  if (!r.student_answer || !String(r.student_answer).trim()) continue
  // 截断片段自身能否判对（该片段不含解析标记，不会再次递归）
  const ok = judgeAnswer(r.student_answer, cut, r.question_type).isCorrect === true
  if (!ok) continue
  upperBound++
  const teacherWrong = r.review_status === 'wrong' || r.review_status === 'wrong_no_book'
  if (teacherWrong) {
    conflict++
    risks.push({ task: String(r.task_id).slice(0, 8), qno: r.question_number,
      stu: String(r.student_answer).slice(0, 28), ref: orig.slice(0, 40) })
  }
  if (samples.length < 12) {
    samples.push({ task: String(r.task_id).slice(0, 8), qno: r.question_number, qt: r.question_type,
      stu: String(r.student_answer).slice(0, 28), 截断片段: cut.slice(0, 24),
      rs: r.review_status || '(未复核)', src: r.answer_source })
  }
}

console.log('\n══════ 参考答案解析截断：覆盖面（近 30 天非失败任务 ' + rows.length + ' 题）══════')
console.table([{ A_会被截断: truncatable, B_截断片段能判对_收益上限: upperBound,
  C_与老师判错冲突_风险: conflict, D_未复核无法判定: upperBound - conflict }])

console.log('\n══════ 收益样本 ══════')
console.table(samples)

if (risks.length) {
  console.log('\n══════ 风险样本（截断后与老师判错冲突）══════')
  console.table(risks)
}

await pool.end()
