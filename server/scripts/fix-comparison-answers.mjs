/**
 * 存量扫描：比较大小题型答案引擎算反（2026-09-21 √7>3 事故修复）
 *
 * 用法：
 *   node server/scripts/fix-comparison-answers.mjs            # 只读 dry-run，输出疑似错题库
 *   node server/scripts/fix-comparison-answers.mjs --apply    # 把疑似错答案清空 + 标 risk（转人工，不写错答案）
 *
 * 不依赖答案引擎：自己数值求解比较两个表达式，与落库 answer 比对。
 * 只动 answer 列（清空 + answer_exception 标 reason），不动 is_correct /
 * wrong_questions / 掌握度 —— 转人工后由老师复核，符合最小改动原则。
 */
import dotenv from 'dotenv'
import pg from 'pg'
import { verifyComparisonAnswer } from '../utils/comparisonAnswerVerifier.js'

dotenv.config({ path: 'D:/Minxue_App_V3/server/.env' })

const { Client } = pg
const c = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const APPLY = process.argv.includes('--apply')

const { rows } = await c.query(`
  SELECT id, task_id, question_number, sub_no, content, parent_stem, answer, student_answer,
         is_correct, answer_source, answer_exception
  FROM questions
  WHERE deleted_at IS NULL
    AND content LIKE '%比较大小%'
    AND answer IS NOT NULL AND answer <> ''
    AND answer_source <> 'blank'
  ORDER BY updated_at DESC
`)

console.log(`扫描到含"比较大小"且 answer 非空的题：${rows.length} 条`)
const bad = []
const skipped = []
for (const r of rows) {
  const content = [r.parent_stem, r.content].filter(Boolean).join('\n')
  let v
  try {
    v = verifyComparisonAnswer(content, r.answer)
  } catch (e) {
    skipped.push({ id: r.id, err: e.message })
    continue
  }
  if (v === null) continue // 不适用（无法提取/求值）→ 不动
  if (v.ok) continue       // 一致 → 不动
  bad.push({ ...r, expected: v.expected, actual: v.actual, reason: v.reason })
}

console.log(`疑似答案引擎算反（answer 与确定性结论不符）：${bad.length} 条`)
console.log('---')
for (const b of bad) {
  console.log(`id=${b.id} q#${b.question_number}${b.sub_no ? '(' + b.sub_no + ')' : ''} | 题面=${JSON.stringify((b.content || '').slice(0, 60))} | answer=${JSON.stringify(b.answer)} | 应=${b.expected} | 现=${b.actual} | is_correct=${b.is_correct} | source=${b.answer_source}`)
}

if (skipped.length) {
  console.log(`\n跳过（解析异常）：${skipped.length} 条`)
  for (const s of skipped) console.log(`  ${s.id}: ${s.err}`)
}

if (APPLY) {
  console.log(`\n=== APPLY：清空 ${bad.length} 条错答案并标 risk ===`)
  for (const b of bad) {
    await c.query(
      `UPDATE questions
       SET answer = '', answer_exception = true,
           answer_exception_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [b.reason, b.id]
    )
    // 同步标 AI 答案风险（复核页红色横幅）
    try {
      await c.query(
        `UPDATE questions SET ai_answer_risk_reason = $1 WHERE id = $2 AND ai_answer_risk_reason IS NULL`,
        [b.reason, b.id]
      )
    } catch { /* ignore */ }
    console.log(`  ✅ ${b.id} 已清空 answer + 标 risk`)
  }
  console.log(`完成。${bad.length} 条转人工复核（未写入错误答案，未改动 is_correct / 错题本 / 掌握度）。`)
} else {
  console.log('\n这是 dry-run（只读）。加 --apply 才会清空错答案并标 risk。')
}

await c.end()
