/**
 * 补结算「老师已完成复核、但历史结算失败」的重练卷。
 *
 * 背景（2026-09-14 错题再测-0911 事故）：
 *   gradingFinalizer 里批量回写 questions.is_correct 的 SQL 缺 `::boolean`，
 *   PostgreSQL 抛 42804，炸点位于「错题生命周期已推进」与
 *   「generated_exams.status='graded'」之间 → 卷永远停在 ungraded，
 *   PC 一直显示「待复核」、移动端一直显示「待完成」。
 *   SQL 已修（buildIsCorrectAssignments），但事故期间点过复核的卷需要补结算。
 *
 * 用法（在 server/ 目录下执行）：
 *   node scripts/repair-retry-exam-settlement.mjs                  # 只列候选，不写库
 *   node scripts/repair-retry-exam-settlement.mjs --exam=<examId>  # 补结算指定的一份
 *   node scripts/repair-retry-exam-settlement.mjs --all-pending    # 批量补结算全部候选
 *
 * ⚠️ 默认只列不写。因为「有答卷且未 graded」的卷里，多数是**老师本来还没批**的：
 *   worker 的 slim 管线只有全部题都自动判完才自动结算，凡 status='grading' 或含
 *   人工判定题的卷都是在等老师。替老师结算等于伪造复核结论，必须显式指定。
 *
 * 安全约束：
 *   - 只处理「有学生答卷 task」且 exam.status <> 'graded' 的卷；
 *   - results 口径与前端完全同源（review_status 优先于 is_correct）；
 *   - 结算函数自带幂等（judgements.metadata.settlement_key），重复执行不会重复推进；
 *   - 执行前后都打印状态，便于对账。
 */
import 'dotenv/config'
import { query } from '../config/neon.js'
import { finalizeGeneratedExamResults } from '../services/gradingFinalizer.js'

const arg = (name) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const WRITE = Boolean(arg('exam')) || process.argv.includes('--all-pending')
const TARGET_EXAM = arg('exam')

/** 与前端 utils/reviewDecision.effectiveIsCorrect 同源：人工复核结论优先于 AI 判定 */
const effectiveIsCorrect = (q) => {
  if (q.review_status === 'correct') return true
  if (q.review_status === 'wrong' || q.review_status === 'wrong_no_book') return false
  if (q.review_status === 'exclude') return null
  return q.is_correct ?? null
}

const candidates = await query(
  `SELECT ge.id, ge.name, ge.status, ge.student_id, ge.question_ids, s.name AS student
   FROM generated_exams ge
   JOIN students s ON s.id = ge.student_id
   WHERE ge.status <> 'graded'
     AND EXISTS (SELECT 1 FROM tasks t WHERE t.generated_exam_id = ge.id)
     ${TARGET_EXAM ? 'AND ge.id = $1' : ''}
   ORDER BY ge.created_at DESC`,
  TARGET_EXAM ? [TARGET_EXAM] : []
)

console.log(`\n候选卷：${candidates.rows.length} 份`)
for (const r of candidates.rows) {
  console.log(`  - ${r.student} / ${r.name}  exam=${r.id}  status=${r.status}  题数=${(r.question_ids || []).length}`)
}
if (!WRITE || candidates.rows.length === 0) {
  console.log(!WRITE
    ? '\n[只读] 未写库。确认无误后加 --exam=<examId> 或 --all-pending 执行。'
    : '\n无候选，退出。')
  process.exit(0)
}

for (const exam of candidates.rows) {
  const ids = exam.question_ids || []
  if (ids.length === 0) {
    console.log(`\n跳过 ${exam.name}：question_ids 为空`)
    continue
  }

  const { rows: questions } = await query(
    `SELECT id, review_status, is_correct FROM questions WHERE id = ANY($1::uuid[])`,
    [ids]
  )
  const results = questions
    .map(q => ({
      questionId: q.id,
      isCorrect: effectiveIsCorrect(q),
      skipWrongBook: q.review_status === 'wrong_no_book'
    }))
    .filter(r => r.isCorrect !== null)

  console.log(`\n=== 结算 ${exam.student} / ${exam.name} (${exam.id}) ===`)
  console.log(`  可结算题目 ${results.length}/${ids.length}（答对 ${results.filter(r => r.isCorrect).length}，答错 ${results.filter(r => !r.isCorrect).length}）`)

  if (results.length === 0) {
    console.log('  无有效结果，跳过（不改 status，避免无依据地把卷标成已结算）')
    continue
  }

  const stats = await finalizeGeneratedExamResults({
    generatedExamId: exam.id,
    studentId: exam.student_id,
    results
  })
  console.log('  结算结果:', JSON.stringify(stats))

  const { rows: after } = await query(
    `SELECT status, updated_at FROM generated_exams WHERE id = $1`, [exam.id]
  )
  console.log(`  结算后 exam.status=${after[0].status} updated_at=${after[0].updated_at.toISOString()}`)
  if (after[0].status !== 'graded') {
    console.error('  ⚠️ 未标记为 graded，请检查上面的错误')
    process.exitCode = 1
  }
}

console.log('\n完成。')
process.exit(process.exitCode || 0)
