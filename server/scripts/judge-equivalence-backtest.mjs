/**
 * 只读回测：判等层（judgeAnswer）在真实人工复核数据上的表现
 *
 * Ground truth = 老师的人工复核结论（questions.review_status）
 *   review_status='correct'                        → 这道题学生是对的
 *   review_status='wrong' / 'wrong_no_book'        → 这道题学生是错的
 * 预测 = judgeAnswer(student_answer, answer, question_type)
 *
 * 指标（判等层改动的唯一验收标准）：
 *   假错 false-negative = 人工判对、judgeAnswer 判错  ← 要消灭的，正是老师的复核负担
 *   假对 false-positive = 人工判错、judgeAnswer 判对  ← 绝对不允许增加（放水）
 *   未判定 null          = judgeAnswer 给不出结论
 *
 * 只读，不写库。用法：node _diag_judge_equiv_backtest.mjs [--json]
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import { judgeAnswer } from '../services/judgeService.js'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const { rows } = await pool.query(`
  SELECT q.id, q.task_id, t.task_type, q.question_number, q.sub_no, q.question_type,
         q.content, q.student_answer, q.answer, q.answer_source,
         q.is_correct AS ai_is_correct, q.confidence, q.review_status, q.is_complete
  FROM tasks t JOIN questions q ON q.task_id = t.id
  WHERE t.created_at > NOW() - INTERVAL '30 days'
    AND q.review_status IN ('correct', 'wrong', 'wrong_no_book')
  ORDER BY t.created_at DESC, q.question_number`)

const cases = rows.map(r => {
  const truth = r.review_status === 'correct' ? true : false
  let pred = null
  let err = null
  try {
    pred = judgeAnswer(r.student_answer, r.answer, r.question_type).isCorrect
  } catch (e) { err = e.message }
  return { ...r, truth, pred, err }
})

const fn = cases.filter(c => c.truth === true && c.pred !== true)   // 假错：老师说对，判等说不是对
const fp = cases.filter(c => c.truth === false && c.pred === true)  // 假对：老师说错，判等说对
const okTrue = cases.filter(c => c.truth === true && c.pred === true)
const okFalse = cases.filter(c => c.truth === false && c.pred === false)

const clip = (s, n = 34) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n)

console.log('\n══════ 判等层回测总览（近 30 天人工复核题）══════')
console.table([{
  样本: cases.length,
  人工判对: cases.filter(c => c.truth).length,
  人工判错: cases.filter(c => !c.truth).length,
  假错_FN: fn.length,
  假对_FP: fp.length,
  判等正确: okTrue.length + okFalse.length,
  一致率: cases.length ? Math.round((okTrue.length + okFalse.length) / cases.length * 100) + '%' : '-',
}])

console.log('\n══════ 假错明细（人工=对，judgeAnswer 未判对）══════')
console.table(fn.map(c => ({
  task: String(c.task_id).slice(0, 8), qno: c.question_number, sub: c.sub_no || '',
  qt: c.question_type, src: c.answer_source,
  学生: clip(c.student_answer), 参考: clip(c.answer), 判定: c.pred === null ? 'null' : c.pred,
})))

if (fp.length) {
  console.log('\n══════ 假对明细（人工=错，judgeAnswer 判对）—— 这些绝不能新增 ══════')
  console.table(fp.map(c => ({
    task: String(c.task_id).slice(0, 8), qno: c.question_number, qt: c.question_type,
    学生: clip(c.student_answer), 参考: clip(c.answer),
  })))
}

if (process.argv.includes('--json')) {
  console.log('\n---JSON---')
  console.log(JSON.stringify({ cases, fn: fn.map(c => c.id), fp: fp.map(c => c.id) }))
}

await pool.end()
