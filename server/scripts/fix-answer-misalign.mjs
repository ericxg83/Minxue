/**
 * 修复「参考答案与卷面不符」的错题（2026-09-18，用户确认后执行）
 *
 *   node server/scripts/fix-answer-misalign.mjs            # dry-run（默认，只读 + 备份）
 *   node server/scripts/fix-answer-misalign.mjs --apply    # 写库
 *
 * 分两批判定，语义完全相同（都作废转人工），只是「怎么证明这条答案是错的」不同：
 *
 *   A. 形态硬冲突（7 条，2026-09-18 首批已执行）
 *      非选择题 / 题干含填空线，参考答案却是单个 A–D 字母 —— 填空题的答案不可能是字母。
 *
 *   B. 数学可证（9 条，2026-09-18 第二批）
 *      Q1 AB=3,AC=9,DE=2 → DF：由 AB/AC = DE/DF 得 DF=6=B，库给 C(8)
 *      Q2 下列结论中正确的是：平行线分线段成比例的标准结论 AB/BC=DE/EF=A，库给 D
 *      Q4 AC=6,DE=3,EF=2 → BC：AB/BC=3/2 且 AB+BC=6 → BC=12/5，库给 "× 5/2 = 10。"（残片垃圾）
 *      三类都与卷面学生作答独立吻合，且都出自同一本错位答案库。
 *
 * 处置语义完全沿用项目既有路径，不新造状态：
 *   · questions 侧  ←→ worker.js:5085 的 refGuard 降级（参考答案与本题不匹配 → 丢弃、转人工）
 *   · status 同步   ←→ gradingFinalizer.js:214 的 status CASE（只改 is_correct 会让题继续挂在 status='wrong' 筛选里）
 *   · ai_answer_risk_reason ←→ 迁移 050 专为「AI 给了结论但参考本身不可靠」建的列
 *   · judgements 审计 ←→ 只**追加** source='answer_void'，原 ai_ocr 记录原样保留
 *   · 完整性缓存自愈 ←→ questionCompletenessSync（answer 置空后 is_complete 需重算）
 *
 * 刻意**不填正确答案**：项目口径是「判不出就必须判不出，不给不确定的来源编造标签」
 * （见 src/utils/reviewDecision.js 的参考答案来源注释）。老师人工补，比系统猜一个更好。
 *
 * 回滚：快照 JSON 里有每条的完整原值。
 */
import dotenv from 'dotenv'
dotenv.config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import fs from 'node:fs'
import { createJudgement } from '../services/neonService.js'
import { syncQuestionCompleteness } from '../services/questionCompletenessSync.js'

const APPLY = process.argv.includes('--apply')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const REASON_TEXT = '参考答案与卷面不符，已作废（答案库单元错位），请人工核对'
const RISK_TEXT = '参考答案不可信：答案库（九上上海作业答案）单元错位，原参考答案已作废，请人工核对'

// expect = null 表示不校验条数（首批已执行完，现在应为 0）
const CASES = [
  {
    key: 'form_letter_for_nonchoice',
    label: '形态硬冲突：非选择题/题干有填空线，参考答案却是单个 A–D 字母',
    expect: null,
    where: `((wq.student_answer ~ '[0-9]' AND UPPER(BTRIM(wq.correct_answer)) ~ '^[A-D]$')
            OR (q.content ~ '_{2,}|＿{2,}' AND UPPER(BTRIM(wq.correct_answer)) ~ '^[A-D]$'))`,
  },
  {
    key: 'math_q1_df',
    label: '数学可证 Q1：AB=3,AC=9,DE=2 → DF 应为 B(6)，库给 C(8)',
    expect: 3,
    where: `q.content LIKE '%那么DF的长是%' AND q.answer_source = 'worksheet'
            AND UPPER(BTRIM(wq.correct_answer)) = 'C'`,
  },
  {
    key: 'math_q2_conclusion',
    label: '数学可证 Q2：正确结论 AB/BC=DE/EF=A，库给 D',
    expect: 3,
    where: `q.content LIKE '%那么下列结论中，正确的是%' AND q.answer_source = 'worksheet'
            AND UPPER(BTRIM(wq.correct_answer)) = 'D'`,
  },
  {
    key: 'math_q4_bc',
    label: '数学可证 Q4：BC 应为 12/5，库给 "× 5/2 = 10。"（残片垃圾）',
    expect: 3,
    where: `q.content LIKE '%那么BC的长为%' AND q.answer_source = 'worksheet'
            AND BTRIM(wq.correct_answer) = '× 5/2 = 10。'`,
  },
]

const SELECT = `
  SELECT wq.id AS wq_id, wq.student_id, q.id AS q_id, q.task_id, t.original_name,
         wq.question_no, wq.question_type, wq.student_answer, wq.correct_answer,
         wq.is_blank, wq.status AS wq_status, wq.lifecycle_status, wq.error_type, wq.error_reason,
         q.answer AS q_answer, q.answer_source, q.is_correct, q.status AS q_status,
         q.confidence, q.is_complete, q.content, q.options
  FROM wrong_questions wq
  JOIN questions q ON q.id = wq.question_id
  JOIN tasks t ON t.id = q.task_id
  WHERE wq.correct_answer IS NOT NULL AND (%WHERE%)
  ORDER BY t.original_name, wq.question_no::int NULLS LAST, wq.id`

const all = []
let abort = false
console.log('按判据分批判定：\n')
for (const c of CASES) {
  // ⚠️ 必须用函数式替换：WHERE 里含 `$'`（正则 `^[A-D]$` 后紧跟引号），
  // 字符串式 replace 会把它当成「匹配后剩余部分」的替换模式，拼出语法错误的 SQL。
  const sql = SELECT.replace('%WHERE%', () => c.where)
  const { rows } = await pool.query(sql)
  const ok = c.expect == null || rows.length === c.expect
  if (!ok) abort = true
  console.log(`  [${ok ? '✓' : '✗'}] ${String(rows.length).padStart(2)} 条  ${c.label}${c.expect != null ? `（期望 ${c.expect}）` : ''}`)
  for (const r of rows) all.push({ ...r, caseKey: c.key, caseLabel: c.label })
}
console.log(`\n合计待修 ${all.length} 条`)
if (abort) {
  console.log('\n✗ 有条目数与期望不符，为防误伤已中止。请先人工核对。')
  await pool.end()
  process.exit(1)
}

for (const r of all) {
  console.log('─'.repeat(78))
  console.log(`[${r.caseKey}] wq=${r.wq_id.slice(0, 8)} q=${r.q_id.slice(0, 8)} #${r.question_no} [${r.question_type}]`)
  console.log(`  task=${r.task_id.slice(0, 8)} (${r.original_name})`)
  console.log(`  学生=${JSON.stringify(r.student_answer)} 参考答案=${JSON.stringify(r.correct_answer)} blank=${r.is_blank}`)
  console.log(`  改前 q : answer=${JSON.stringify(r.q_answer)} src=${r.answer_source} is_correct=${r.is_correct} status=${r.q_status} is_complete=${r.is_complete}`)
  console.log(`  改前 wq: status=${r.wq_status}/${r.lifecycle_status} error_type=${JSON.stringify(r.error_type)}`)
  console.log(`  题干: ${String(r.content || '').replace(/\s+/g, ' ').slice(0, 90)}`)
}

const OUT = 'D:/Minxue_App_V3/server/scripts/logs/answer-misalign-fix'
fs.mkdirSync(OUT, { recursive: true })
const stamp = Date.now()
const snapPath = `${OUT}/snapshot-${stamp}.json`
fs.writeFileSync(snapPath, JSON.stringify({
  createdAt: new Date().toISOString(),
  applied: APPLY,
  reasonText: REASON_TEXT,
  riskText: RISK_TEXT,
  cases: CASES.map(c => ({ key: c.key, label: c.label, expect: c.expect })),
  rows: all,
}, null, 1))
console.log(`\n备份快照（含每条完整原值）：${snapPath}`)

if (!APPLY) {
  console.log('\n[DRY-RUN] 未写库。加 --apply 执行。')
  await pool.end()
  process.exit(0)
}

let qFixed = 0, wqFixed = 0, judged = 0
const touchedIds = []
for (const r of all) {
  // 1) questions：参考答案作废 + 转人工（status 同步口径照抄 gradingFinalizer.js:214）
  const a = await pool.query(
    `UPDATE questions
        SET answer = NULL,
            answer_source = 'recognized',
            is_correct = NULL,
            status = CASE
              WHEN status = 'mastered' THEN status
              WHEN status = 'wrong' THEN 'pending'
              ELSE status END,
            is_suspicious = TRUE,
            answer_exception = TRUE,
            answer_exception_reason = $1,
            ai_answer_risk_reason = $2,
            updated_at = NOW()
      WHERE id = $3`,
    [REASON_TEXT, RISK_TEXT, r.q_id]
  )
  qFixed += a.rowCount
  touchedIds.push(r.q_id)

  // 2) wrong_questions：不再展示错答案；原 error_type（"计算错误"）是错因误判 → 置空
  //    （周报侧已有 `error_type || '未标注'` 兜底，见 wrongPaperService.js:115）
  const b = await pool.query(
    `UPDATE wrong_questions
        SET correct_answer = NULL,
            error_type = NULL,
            error_reason = $1,
            updated_at = NOW()
      WHERE id = $2`,
    [REASON_TEXT, r.wq_id]
  )
  wqFixed += b.rowCount

  // 3) judgements：只追加审计，原 ai_ocr 判定记录原样保留
  try {
    await createJudgement({
      questionId: r.q_id,
      studentId: r.student_id,
      source: 'answer_void',
      confidence: r.confidence,
      isCorrect: null,
      content: r.content,
      answer: null,
      studentAnswer: r.student_answer,
      metadata: {
        oldIsCorrect: r.is_correct,
        oldAnswer: r.q_answer,
        oldCorrectAnswer: r.correct_answer,
        oldAnswerSource: r.answer_source,
        oldErrorType: r.error_type,
        reason: 'answer_bank_misaligned',
        caseKey: r.caseKey,
        note: '参考答案与卷面不符，已作废转人工',
        fixedBy: 'fix-answer-misalign.mjs',
      },
    })
    judged += 1
  } catch (e) {
    console.error(`  judgements 追加失败 q=${r.q_id}: ${e.message}`)
  }
}
console.log(`\n✅ questions 更新 ${qFixed} 行；wrong_questions 更新 ${wqFixed} 行；judgements 追加 ${judged} 条`)

// 4) 完整性缓存自愈（answer 置空后 is_complete 需重算）
try {
  await syncQuestionCompleteness(touchedIds)
  console.log(`✅ 完整性缓存已自愈 ${touchedIds.length} 题`)
} catch (e) {
  console.error(`⚠️ 完整性缓存自愈失败（不影响主修复）: ${e.message}`)
}

console.log(`回滚用快照：${snapPath}`)
await pool.end()
