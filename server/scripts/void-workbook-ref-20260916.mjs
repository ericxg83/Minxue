/**
 * 作废指定任务的「练习册参考答案」并全部转人工（2026-09-16 事故处置）
 *
 * 背景：成长·桥第03周（203d3e56）/ 28.1(1)（479e623e）走了练习册批改路线，
 * 但卷面题根本不在《九上上海作业答案》里，按题号取到的参考答案是别的题的
 * （题1 卷面必为 D 而答案册给 A；题4 卷面填空而答案册是解答题）→ 假红叉。
 *
 * 本脚本做的事（可 dry-run）：
 *   1) 清空 questions.answer / is_correct / confidence，标 is_suspicious，
 *      写 answer_exception_reason = 「参考答案与本题不匹配，已转为人工判定」；
 *   2) 未作答（answer_source='blank'）的题不动（本就走"未作答"桶）；
 *   3) 重算 tasks.result 的 wrongCount / matchedCount / pendingCount（不重算会
 *      出现"列表页显示 6 错、点进去一道没有"）；
 *   4) 错题本对账：删掉因假红叉入册的错题（保留未作答入册的那些）。
 *
 * 用法：
 *   node server/scripts/void-workbook-ref-20260916.mjs <taskId前缀...> [--apply]
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const PREFIXES = process.argv.slice(2).filter(a => !a.startsWith('--'))
if (PREFIXES.length === 0) {
  console.error('用法: node server/scripts/void-workbook-ref-20260916.mjs <taskId前缀...> [--apply]')
  process.exit(1)
}
const REASON = '参考答案与本题不匹配，已转为人工判定'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await pool.query(s, p)).rows

const tasks = await q(
  `SELECT id FROM tasks WHERE ${PREFIXES.map((_, i) => `id::text LIKE $${i + 1}`).join(' OR ')}`,
  PREFIXES.map(p => p + '%')
)
console.log(`===== ${APPLY ? '应用作废' : 'DRY-RUN（不写库）'} | ${tasks.length} 个任务 =====`)

for (const t of tasks) {
  const id = t.id
  const qs = await q(
    `SELECT id, question_number, question_type, answer, student_answer, is_correct, answer_source
     FROM questions WHERE task_id = $1::uuid ORDER BY question_number`, [id])
  const targets = qs.filter(x => x.answer_source !== 'blank')
  const blanks = qs.filter(x => x.answer_source === 'blank')
  console.log(`\n--- task ${id} | ${qs.length} 题：作废 ${targets.length} · 未作答保留 ${blanks.length} ---`)
  for (const x of targets) {
    console.log(`   题${x.question_number} [${x.question_type}] 原参考答案="${String(x.answer || '').slice(0, 34)}" 原判定=${x.is_correct} → 清空转人工`)
  }

  if (!APPLY) continue

  if (targets.length) {
    await q(
      `UPDATE questions
          SET answer = NULL,
              is_correct = NULL,
              confidence = NULL,
              answer_source = 'recognized',
              status = 'pending',
              is_suspicious = true,
              answer_exception_reason = $2,
              updated_at = NOW()
        WHERE task_id = $1::uuid AND answer_source <> 'blank'`, [id, REASON])
  }

  // 重算任务计数（pendingCount = 既非对/错、也非未作答）
  const after = await q(
    `SELECT
       COUNT(*) FILTER (WHERE is_correct = false)::int AS wrong,
       COUNT(*) FILTER (WHERE answer_source = 'blank')::int AS empty,
       COUNT(*) FILTER (WHERE is_correct IS NULL AND answer_source <> 'blank')::int AS pending
     FROM questions WHERE task_id = $1::uuid`, [id])
  const { wrong, empty, pending } = after[0]
  await q(
    `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
        'wrongCount', $2::int, 'matchedCount', 0, 'emptyCount', $3::int, 'pendingCount', $4::int,
        'voidedReference', true,
        'voidedReason', $5::text
      ), updated_at = NOW() WHERE id = $1::uuid`,
    [id, wrong, empty, pending, REASON])

  // 错题本对账：删掉因假红叉入册的（保留未作答入册的）
  const del = await q(
    `DELETE FROM wrong_questions w
      USING questions qq
      WHERE w.question_id = qq.id AND qq.task_id = $1::uuid AND qq.answer_source <> 'blank'
      RETURNING w.id`, [id])
  console.log(`   ✅ 已作废 ${targets.length} 题；错题本清理 ${del.length} 条；计数 wrong=${wrong} empty=${empty} pending=${pending}`)
}

if (!APPLY) console.log('\n（dry-run 结束，未写库。加 --apply 执行）')
await pool.end()
