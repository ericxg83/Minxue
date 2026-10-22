/**
 * 修复「参考答案是 ± 合并写法、学生写两根分开 → 判错」的存量（2026-10-22）。
 *
 * 事故（用户截图 #23）：答案 x²-2x=3/2，参考答案 `(2±√10)/2`，
 * 学生 `x₁=1+√10/2，x₂=1-√10/2` —— 同一个解集，判错。
 * 根因已修（judgeService.extractReferenceSolutionSet 支持 ± 展开、值内空格不再截断），
 * 本脚本把修复前留下的错误判定重判。
 *
 * 判据刻意收窄：只扫 `answer` 含 ± 且 `is_correct = false` 的行，
 * 现判为 true 才改 —— 天然幂等，跑第二遍命中 0 条。
 *
 * 用法：node server/scripts/fix-pm-answer-20261022.mjs [--apply]
 */
import '../loadEnv.js'
import { getPool } from '../config/neon.js'
import { judgeAnswer } from '../services/judgeService.js'
import { finalizeRejudgeResult } from '../services/gradingFinalizer.js'

const APPLY = process.argv.includes('--apply')
const pool = getPool()

const r = await pool.query(`
  SELECT id, task_id, student_id, answer, analysis, student_answer, is_correct,
         review_status, status, question_type, content, confidence, cache_id,
         ai_answer_risk_reason
  FROM questions
  WHERE deleted_at IS NULL
    AND answer LIKE '%±%'
    AND is_correct = false
  ORDER BY created_at DESC
`)

const plan = []
for (const row of r.rows) {
  // 只处理「参考答案本身就是一个 ± 数学式」的行：`(2±√10)/2`、`±10`。
  // 带中文的（`x≤2且x≠±1`）不在本脚本范围 —— 那种题学生只写 `x≤2` 属漏条件，
  // 判对是判等层另一条兜底口径的问题，改它会放水。
  if (/[\u4e00-\u9fff]/.test(String(row.answer))) continue
  const j = judgeAnswer(row.student_answer || '', row.answer, row.question_type)
  if (j.isCorrect !== true) continue
  plan.push({ ...row, judged: j })
}

console.log(`扫描 ${r.rows.length} 条「± 参考答案 + 判错」→ 现判为对 ${plan.length} 条\n`)
// 已复核（老师已经标过对错）的行不自动改判，只列出来供核对。
// ⚠️ 这里会混进「学生漏写 ±」的题（`3` vs `±3`）—— 那是既有口径判对，与本脚本无关，
// 且它们都是 review_status 非空的已复核行，动手前先看这一栏。
const auto = plan.filter(p => p.review_status == null)
const reviewed = plan.filter(p => p.review_status != null)
console.log(`  可自动重判 ${auto.length} 条 / 已复核跳过 ${reviewed.length} 条（其中多为「学生漏写 ±」既有口径，不改）\n`)
for (const p of auto) {
  console.log('-'.repeat(84))
  console.log(`题 ${p.id.slice(0, 8)} | ${String(p.content).replace(/\s+/g, ' ').slice(0, 46)}`)
  console.log(`  答案：${p.answer}`)
  console.log(`  学生：${String(p.student_answer || '').replace(/\s+/g, ' ').slice(0, 70)}`)
}

if (!APPLY) {
  console.log('\n[dry-run] 未写库。加 --apply 执行。')
  await pool.end()
  process.exit(0)
}

let settled = 0, skipped = 0, failed = 0
for (const p of plan) {
  if (p.review_status != null) { skipped += 1; continue }
  if (!p.student_id) { skipped += 1; continue }
  try {
    await finalizeRejudgeResult({
      question: p,
      isCorrect: true,
      oldIsCorrect: p.is_correct,
      source: 'pm_reference_parse_fix',
      manualOverride: false,
      confidence: p.confidence
    })
    settled += 1
  } catch (e) {
    failed += 1
    console.error(`  结算失败 q=${p.id.slice(0, 8)}: ${e.message}`)
  }
}
console.log(`\n重判结算：${settled} 条（已复核/无学生跳过 ${skipped}，失败 ${failed}）`)

const cleared = await pool.query(`
  UPDATE questions SET ai_answer_risk_reason = NULL, updated_at = NOW()
  WHERE id = ANY($1::uuid[]) AND ai_answer_risk_reason LIKE '%多路求解%'
  RETURNING id
`, [plan.map(p => p.id)])
console.log(`清除「多路求解存疑」标注：${cleared.rowCount} 条`)

await new Promise(r2 => setTimeout(r2, 1500))
await pool.end()
