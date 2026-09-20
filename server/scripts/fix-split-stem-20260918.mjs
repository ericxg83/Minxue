/**
 * 存量修复：2026-09-18 白板残题「求证：AD²=AC·BE。」根因数据修复
 *
 * 根因：worker.js recognizeQuestions 字段映射丢失 sub_no / parent_stem（已修代码），
 * 存量任务建题时把「拆行小问」落成了无小问号、无公共题干的多条记录。
 *
 * 本脚本修复两个任务：
 *   A. 4127b3ce（张诗蕊 第01周 09-18 p2）：Q10（3 行）、Q11（4 行）
 *      · 小问行补 sub_no + parent_stem（题干行原文）
 *      · 题干行 d5458d8a 的幻觉答案 "36°"（题干无设问，AI 编的）作废转人工
 *   B. a35804f8（张诗蕊 第03周 09-18 p3）：Q12（3 行，公共题干整体丢失）
 *      · 用重 OCR 恢复的权威公共题干补 parent_stem + sub_no
 *      · ad501690 的占位垃圾答案 "无法唯一确定，填\"待人工补充" 作废转人工
 *
 * 处置语义照 refGuard / fix-answer-misalign.mjs：answer 置空 + is_suspicious +
 * answer_exception + reason；confidence 不能清空（否则复核状态落 processing 而非 exception）；
 * judgements 只追加 source='answer_void'；最后 syncQuestionCompleteness 回写。
 *
 * 用法：node server/scripts/fix-split-stem-20260918.mjs          # dry-run
 *       node server/scripts/fix-split-stem-20260918.mjs --apply  # 写库
 */
import dotenv from 'dotenv'
dotenv.config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import { syncQuestionCompleteness } from '../services/questionCompletenessSync.js'

const APPLY = process.argv.includes('--apply')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim()

// ── 权威公共题干（来自原卷图核对 / 重 OCR 恢复）──
const STEM10 = collapse('如图，已知：在△ABC中，D是边AC的中点，在边AB上取点E，使∠ADE=∠B。')
const STEM11 = collapse('如图，已知：四边形ABCD为菱形，∠D=36°，延长AC到点E，使得EC=BC，连接BE。')
const STEM12 = collapse('如图（1），已知：在矩形ABCD中，E是边AB的中点，过点E作EF//AD，交边DC于点F，点P、Q分别在边AD、BC上，连接PQ，交EF于点M。')

/** 小问行补结构: id → { sub_no, parent_stem } */
const FIXES = [
  // A. 任务 4127b3ce Q10（题干行 dc09ca36 保留为整题行）
  { id: '83b0a95e-7c1e-4f7f-8a0d-0b0000000001', sub_no: '1', parent_stem: STEM10 },
  { id: 'dad6bb83-7c1e-4f7f-8a0d-0b0000000002', sub_no: '2', parent_stem: STEM10 },
  // A. Q11 小问（题干行 d5458d8a 保留为整题行）
  { id: '0c7b5d89-7c1e-4f7f-8a0d-0b0000000003', sub_no: '1', parent_stem: STEM11 },
  { id: '886825a2-97df-453a-b14f-ddb441221d59', sub_no: '2', parent_stem: STEM11 },
  { id: 'c022f615-7c1e-4f7f-8a0d-0b0000000004', sub_no: '3', parent_stem: STEM11 },
  // B. 任务 a35804f8 Q12（题干整体丢失，重 OCR 恢复）
  { id: 'e19aae64-2236-4111-b5cb-3368194967ae', sub_no: '1', parent_stem: STEM12 },
  { id: '6fd1ed1a-b1f5-434d-8f9e-29ab3f55023a', sub_no: '2', parent_stem: STEM12 },
  { id: 'ad501690-3d58-44a6-b7f2-0313b7805906', sub_no: '3', parent_stem: STEM12 },
]

/** 幻觉/垃圾参考答案作废转人工 { id → reason } */
const VOID_ANSWERS = [
  {
    id: 'd5458d8a-ad1d-4d19-b3de-5005de78d4ec',
    reason: '题干行无设问，AI 却生成参考答案"36°"（幻觉），已作废转人工',
  },
  {
    id: 'ad501690-3d58-44a6-b7f2-0313b7805906',
    reason: '参考答案为占位垃圾串"无法唯一确定，填\\"待人工补充"，已作废转人工',
  },
]

const ALL_IDS = [...new Set([...FIXES.map(f => f.id), ...VOID_ANSWERS.map(v => v.id)])]

const { rows: current } = await pool.query(
  `SELECT id, task_id, question_number, sub_no, parent_stem, content, answer,
          answer_source, is_correct, confidence, status, answer_exception, is_suspicious
     FROM questions WHERE id = ANY($1::uuid[])`,
  [ALL_IDS]
)
const byId = new Map(current.map(r => [r.id, r]))

console.log(`== 修复前现状（${current.length} 行）==`)
for (const r of current) {
  console.log(`  ${r.id.slice(0, 8)} Q${r.question_number} sub=${JSON.stringify(r.sub_no)} conf=${r.confidence} src=${r.answer_source} ans=${JSON.stringify(String(r.answer || '').slice(0, 28))}`)
}
console.log(`== 计划 ==`)
for (const f of FIXES) {
  const r = byId.get(f.id)
  console.log(`  [结构] ${f.id.slice(0, 8)} Q${r?.question_number} sub=${f.sub_no} | parent=${f.parent_stem.slice(0, 30)}…`)
}
for (const v of VOID_ANSWERS) {
  const r = byId.get(v.id)
  console.log(`  [作废] ${v.id.slice(0, 8)} Q${r?.question_number} 现值=${JSON.stringify(String(r?.answer || '').slice(0, 25))} → NULL`)
}

const missing = ALL_IDS.filter(id => !byId.has(id))
if (missing.length) {
  console.error(`\n❌ 库中找不到 ${missing.length} 条：`)
  for (const m of missing) console.error('   ' + m)
  process.exit(1)
}
// 校验：小问行当前 sub_no 必须为空（避免覆盖已有正确结构）
const conflicts = FIXES.filter(f => byId.get(f.id).sub_no != null)
if (conflicts.length) {
  console.error(`\n❌ 以下行已有 sub_no，拒绝覆盖：${conflicts.map(c => c.id).join(', ')}`)
  process.exit(1)
}
// 校验：作废行的 answer 必须确实包含目标垃圾值（防误伤）
const voidCheck = { '36°': 'd5458d8a-ad1d-4d19-b3de-5005de78d4ec', '待人工补充': 'ad501690-3d58-44a6-b7f2-0313b7805906' }
for (const [needle, id] of Object.entries(voidCheck)) {
  const got = String(byId.get(id)?.answer || '')
  if (!got.includes(needle)) {
    console.error(`\n❌ ${id} 现值 ${JSON.stringify(got)} 不包含预期 ${JSON.stringify(needle)}，中止防误伤`)
    process.exit(1)
  }
}

if (!APPLY) {
  console.log('\n(dry-run 模式，未写库。加 --apply 执行)')
  await pool.end()
  process.exit(0)
}

// ── 写库 ──
for (const f of FIXES) {
  await pool.query(
    `UPDATE questions SET sub_no = $1, parent_stem = $2, updated_at = NOW() WHERE id = $3`,
    [f.sub_no, f.parent_stem, f.id]
  )
  console.log(`  ✅ [结构] ${f.id.slice(0, 8)} sub_no=${f.sub_no}`)
}

// 作废幻觉答案：照 refGuard 处置语义（answer 置空、is_suspicious/answer_exception 打标，
// confidence 保留；status 非 mastered 落 pending；答案作废前先备份到 reason 说明里）
for (const v of VOID_ANSWERS) {
  const cur = byId.get(v.id)
  const oldAnswer = String(cur.answer || '')
  await pool.query(
    `UPDATE questions
        SET answer = NULL,
            is_correct = NULL,
            is_suspicious = TRUE,
            answer_exception = TRUE,
            answer_exception_reason = $1,
            status = CASE WHEN status = 'mastered' THEN status ELSE 'pending' END,
            updated_at = NOW()
      WHERE id = $2`,
    [`${v.reason}（原值: ${oldAnswer.slice(0, 40)}）`, v.id]
  )
  // 审计：只追加，不删除原记录；source 用 answer_void（AGENTS 不得绕过判题审计）
  await pool.query(
    `INSERT INTO judgements (question_id, student_id, source, confidence, is_correct, content, answer, created_at)
     VALUES ($1, $2, 'answer_void', $3, NULL, $4, $5, NOW())`,
    [v.id, cur.student_id ?? cur.task_id ?? '', cur.confidence ?? 0, cur.content, oldAnswer]
  )
  console.log(`  ✅ [作废] ${v.id.slice(0, 8)} 原答案 ${JSON.stringify(oldAnswer.slice(0, 25))} → NULL（judgements 已追加 answer_void）`)
}

// 完整性缓存回写（判据读 parent_stem + content，必须带全字段的 SELECT）
await syncQuestionCompleteness(ALL_IDS)
console.log(`  ✅ [回写] syncQuestionCompleteness(${ALL_IDS.length} 条)`)

await pool.end()
console.log('\n完成。')