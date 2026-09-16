/**
 * 重判后的「主观题转人工 + 计数/错题本对账」（2026-09-16）
 *
 * 背景：regradeTask.mjs 用答案引擎重出参考答案后，两类题不该保留自动判定：
 *   R1 引擎给的是元话语（"待人工补充"等）→ 参考答案本身不可用，清空转人工；
 *   R2 主观解答题（学生写了 ∵/∴/证明 的多行过程）→ 字符串比对判出的对/错都不可信，
 *      保留参考答案给老师看，判定转人工。
 * 然后：重算 tasks.result 计数 + 错题本对账（只留 is_correct=false 或 未作答 的）。
 *
 * 用法：node server/scripts/humanize-subjective-20260916.mjs <taskId> [--apply]
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import { detectReferenceMismatch } from '../services/judgeService.js'

const APPLY = process.argv.includes('--apply')
const taskId = process.argv.slice(2).find(a => !a.startsWith('--'))
if (!taskId) { console.error('用法: node server/scripts/humanize-subjective-20260916.mjs <taskId> [--apply]'); process.exit(1) }

const META_ANSWER_RE = /待人工补充|请人工|无法确定|无法给出|人工判定/
const SUBJECTIVE_ANSWER_RE = /∵|∴|因为|所以|证明|解[:：]|\n/
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await pool.query(s, p)).rows

const qs = await q(`
  SELECT id, question_number, question_type, answer, student_answer, is_correct, answer_source
  FROM questions WHERE task_id = $1::uuid ORDER BY question_number`, [taskId])
console.log(`===== ${APPLY ? '应用' : 'DRY-RUN'} | ${qs.length} 题 =====`)

let r1 = 0, r2 = 0
for (const x of qs) {
  const ans = (x.answer || '').trim()
  const stu = (x.student_answer || '').trim()
  if (x.answer_source === 'blank') continue
  if (META_ANSWER_RE.test(ans)) {
    r1++
    console.log(`  R1 题${x.question_number}: 参考答案是元话语("${ans.slice(0, 20)}") → 清空转人工`)
    if (APPLY) await q(`UPDATE questions SET answer=NULL, is_correct=NULL, confidence=NULL, status='pending',
        answer_exception_reason='答案引擎无法给出可核对的标准答案，需人工判定', updated_at=NOW() WHERE id=$1`, [x.id])
    continue
  }
  const subjective = stu.length >= 15 && SUBJECTIVE_ANSWER_RE.test(stu)
  if (subjective && x.is_correct !== null) {
    r2++
    console.log(`  R2 题${x.question_number}: 主观解答题（学生写了证明过程）→ 判定转人工（保留参考答案 "${ans.slice(0, 24)}"）`)
    if (APPLY) await q(`UPDATE questions SET is_correct=NULL, confidence=NULL, status='pending',
        answer_exception_reason='主观解答题需人工判定', updated_at=NOW() WHERE id=$1`, [x.id])
    continue
  }
  // R3 选择/判断题的参考答案与选项对不上（引擎给的是数值/结论，学生答的是字母）→ 判定不可信
  if (x.is_correct !== null && detectReferenceMismatch({ sheetType: x.question_type, referenceAnswer: ans })) {
    r2++
    console.log(`  R3 题${x.question_number}: 选择/判断题参考答案(${ans.slice(0, 20)})与选项对不上 → 判定转人工`)
    if (APPLY) await q(`UPDATE questions SET is_correct=NULL, confidence=NULL, status='pending',
        answer_exception_reason='参考答案与选项无法对应，需人工判定', updated_at=NOW() WHERE id=$1`, [x.id])
  }
}

// 计数重算
const stat = (await q(`
  SELECT COUNT(*) FILTER (WHERE is_correct=false)::int AS wrong,
         COUNT(*) FILTER (WHERE answer_source='blank')::int AS empty,
         COUNT(*) FILTER (WHERE is_correct IS NULL AND answer_source<>'blank')::int AS pending
  FROM questions WHERE task_id=$1::uuid`, [taskId]))[0]
console.log(`计数: wrong=${stat.wrong} empty=${stat.empty} pending=${stat.pending}`)

// 错题本对账：应入册 = is_correct=false 或 未作答
const wq = await q(`
  SELECT w.id, qq.question_number, qq.is_correct, qq.answer_source
  FROM wrong_questions w JOIN questions qq ON qq.id = w.question_id
  WHERE qq.task_id = $1::uuid`, [taskId])
let delCount = 0
for (const w of wq) {
  const should = w.is_correct === false || w.answer_source === 'blank'
  if (!should) {
    delCount++
    console.log(`  错题本清理: 题${w.question_number}（现判定=${w.is_correct}，不该入册）`)
    if (APPLY) await q(`DELETE FROM wrong_questions WHERE id=$1`, [w.id])
  }
}
console.log(`错题本: 现 ${wq.length} 条，清理 ${delCount} 条`)

if (APPLY) {
  await q(`UPDATE tasks SET result = COALESCE(result,'{}'::jsonb) || jsonb_build_object(
      'wrongCount', $2::int, 'emptyCount', $3::int, 'pendingCount', $4::int, 'matchedCount', 0
    ), updated_at = NOW() WHERE id = $1::uuid`, [taskId, stat.wrong, stat.empty, stat.pending])
  console.log('✅ tasks.result 计数已更新')
} else {
  console.log('（dry-run：未写库，加 --apply 执行）')
}
await pool.end()
