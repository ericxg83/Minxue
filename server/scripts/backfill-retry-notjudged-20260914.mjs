/**
 * 重练卷「本次没判却显示成 AI错误」回填（2026-09-14 错题再测-0911 事故）
 *
 * 症状
 *   老师看到批改页把解答题标成「AI错误」，但那几题本次**根本没判**
 *   （slim 管线对主观题走 manual 分支，isCorrect=null）。
 *   旧 SQL 写 `is_correct = COALESCE($2, is_correct)`，把**原作业的旧判定**留了下来；
 *   而这批行的 student_answer 已被本次答卷覆盖 ⇒ 页面上是「新学生答案 + 旧判定」错配。
 *
 * 修法
 *   按 `tasks.result.retryAlign[].isCorrect`（本次判定的真值）回写：
 *     isCorrect === null      → questions.is_correct = NULL（页面落 6 态「AI未判定」）
 *     其它                    → 不动（本次判过的值本来就在库里）
 *   只处理**每道题最后一次重练**（按答卷任务创建时间取最新），避免用旧卷覆盖新卷结论。
 *
 * 用法
 *   node server/scripts/backfill-retry-notjudged-20260914.mjs            # dry-run（默认，只读）
 *   node server/scripts/backfill-retry-notjudged-20260914.mjs --apply
 *   node server/scripts/backfill-retry-notjudged-20260914.mjs --rollback
 *
 * 幂等：回填后这些行的 is_correct 已是 NULL，重跑计划为空。
 */
import { config } from 'dotenv'
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const BAK = 'questions_bak_20260914_retrynotjudged'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (sql, params) => (await pool.query(sql, params)).rows

async function rollback() {
  const t = await q(`SELECT to_regclass($1) AS t`, [BAK])
  if (!t[0].t) { console.log('[rollback] 没有备份表，跳过'); return }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query(`UPDATE questions q SET is_correct = b.is_correct, updated_at = NOW() FROM ${BAK} b WHERE q.id = b.id`)
    await client.query('COMMIT')
    console.log(`[rollback] questions 还原 ${r.rowCount} 行`)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

async function main() {
  if (ROLLBACK) { await rollback(); await pool.end(); return }

  // 每道题最后一次「已出判定结果」的重练卷答卷（按任务创建时间取最新）
  const rows = await q(`
    WITH align AS (
      SELECT t.id AS task_id, t.created_at, a.value AS rec
      FROM tasks t
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.result->'retryAlign', '[]'::jsonb)) AS a(value)
      WHERE t.generated_exam_id IS NOT NULL
        AND t.deleted_at IS NULL
        AND jsonb_typeof(t.result->'retryAlign') = 'array'
    ), expl AS (
      SELECT DISTINCT ON ((rec->>'questionId'))
             (rec->>'questionId') AS question_id,
             task_id, created_at, rec
      FROM align
      ORDER BY (rec->>'questionId'), created_at DESC
    )
    SELECT e.question_id, e.task_id, e.created_at, e.rec,
           q.is_correct, q.student_answer, q.review_status, q.question_type,
           left(btrim(coalesce(q.content,'')), 34) AS stem
    FROM expl e
    JOIN questions q ON q.id::text = e.question_id
    WHERE q.deleted_at IS NULL
      AND (e.rec->>'isCorrect') IS NULL
      AND q.is_correct IS NOT NULL`)

  console.log(`本次未判（retryAlign.isCorrect = null）但库里还留着判定 的行：${rows.length}`)
  console.table(rows.slice(0, 40).map(r => ({
    题: r.question_id.slice(0, 8), 题型: r.question_type, 旧is_correct: String(r.is_correct),
    复核状态: r.review_status || '(未复核)', 学生答案: String(r.student_answer ?? '').slice(0, 16),
    答卷任务: r.task_id.slice(0, 8), 答卷时间: String(r.created_at).slice(0, 16), 题干: r.stem
  })))
  const byType = rows.reduce((m, r) => { m[r.question_type] = (m[r.question_type] || 0) + 1; return m }, {})
  console.log('题型分布：' + JSON.stringify(byType))

  if (!rows.length) { console.log('\n无需回填（幂等）。'); await pool.end(); return }
  if (!APPLY) { console.log('\n[dry-run] 未写库。确认无误后加 --apply。'); await pool.end(); return }

  const ids = rows.map(r => r.question_id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`CREATE TABLE IF NOT EXISTS ${BAK} AS SELECT id, is_correct, updated_at FROM questions WHERE false`)
    await client.query(`INSERT INTO ${BAK} SELECT id, is_correct, updated_at FROM questions WHERE id = ANY($1::uuid[])`, [ids])
    const r = await client.query(`UPDATE questions SET is_correct = NULL, updated_at = NOW() WHERE id = ANY($1::uuid[])`, [ids])
    await client.query('COMMIT')
    console.log(`\n[apply] 已把 ${r.rowCount} 行的 is_correct 置 NULL（本次重练未判，页面改显示「AI未判定」）`)
    console.log(`备份表：${BAK}；回滚：--rollback`)
  } catch (e) { await client.query('ROLLBACK'); console.error('[apply] 失败已回滚：', e.message); throw e } finally { client.release() }
  await pool.end()
}

main().catch(e => { console.error(e); pool.end() })
