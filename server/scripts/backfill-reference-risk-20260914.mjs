/**
 * 参考答案自洽风险标注回填（P0 ③，2026-09-14 错题再测-0911 事故）
 *
 * 标注什么
 *   解析结论区存在**算错的纯算术等式**，而 questions.answer 正好等于它的右边
 *   ⇒ 参考答案疑似抄自错误推导（事故真题：`a + b = 8 + 3 = 29` → 答案 29，正确 11）。
 *   判据见 server/utils/referenceAnswerSelfCheck.js，全库 586 条缓存回测只命中该 1 条真阳性。
 *
 * 写什么
 *   只写 questions.ai_answer_risk_reason（列 050 迁移已建，语义即「AI 给出了结论，
 *   但参考本身可能不可靠」，前端 getAiAnswerRiskText 在 wrong 状态也会展示给老师）。
 *   **不动 answer、不动 is_correct、不动 review_status** —— 这是观测信息，不是判定。
 *   为什么只标注不自动改判：同类"算术自检不通过就拦"的宽判据实测命中 28 条而只 1 条为真，
 *   自动翻转会大面积误伤正确答案；判还是留给人。
 *
 * 用法
 *   node server/scripts/backfill-reference-risk-20260914.mjs            # dry-run（默认，只读）
 *   node server/scripts/backfill-reference-risk-20260914.mjs --apply    # 写库（自动建备份表）
 *   node server/scripts/backfill-reference-risk-20260914.mjs --rollback # 用备份表回滚
 *
 * 幂等：命中项重跑仍会命中（重复写同样的值，无副作用）。
 */
import { config } from 'dotenv'
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
import pg from 'pg'
import { describeReferenceAnswerRisk } from '../utils/referenceAnswerSelfCheck.js'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const BAK = 'questions_bak_20260914_risk'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (sql, params) => (await pool.query(sql, params)).rows
const log = (...a) => console.log(...a)

async function rollback() {
  const t = await q(`SELECT to_regclass($1) AS t`, [BAK])
  if (!t[0].t) { log('[rollback] 没有备份表，跳过'); return }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query(`UPDATE questions q SET ai_answer_risk_reason = b.ai_answer_risk_reason, updated_at = NOW() FROM ${BAK} b WHERE q.id = b.id`)
    await client.query('COMMIT')
    log(`[rollback] questions 还原 ${r.rowCount} 行`)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

async function main() {
  if (ROLLBACK) { await rollback(); await pool.end(); return }

  const rows = await q(`
    SELECT id, question_type, answer, analysis, is_correct, review_status,
           ai_answer_risk_reason,
           left(btrim(coalesce(content,'')), 40) AS stem
    FROM questions
    WHERE deleted_at IS NULL
      AND btrim(coalesce(answer,'')) <> ''
      AND analysis IS NOT NULL AND btrim(analysis) <> ''`)

  const plan = []
  for (const r of rows) {
    const risk = describeReferenceAnswerRisk({ answer: r.answer, analysis: r.analysis, questionType: r.question_type })
    if (!risk) continue
    plan.push({ id: r.id, risk, stem: r.stem, answer: String(r.answer).slice(0, 30), is_correct: r.is_correct, review_status: r.review_status, old: r.ai_answer_risk_reason })
  }

  log(`扫描题目行（有答案+解析）${rows.length} 条，命中风险标注 ${plan.length} 条`)
  console.table(plan.map(p => ({
    题: p.id.slice(0, 8), 参考答案: p.answer, 判定: String(p.is_correct), 复核: p.review_status || '(未复核)',
    题干: String(p.stem).replace(/\n/g, ' ').slice(0, 34),
  })))
  for (const p of plan) log(`  ${p.id.slice(0, 8)} → ${p.risk}`)

  if (!plan.length) { log('\n无命中。'); await pool.end(); return }
  if (!APPLY) { log('\n[dry-run] 未写库。确认无误后加 --apply。'); await pool.end(); return }

  const ids = plan.map(p => p.id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`CREATE TABLE IF NOT EXISTS ${BAK} AS SELECT id, ai_answer_risk_reason, updated_at FROM questions WHERE false`)
    await client.query(`INSERT INTO ${BAK} SELECT id, ai_answer_risk_reason, updated_at FROM questions WHERE id = ANY($1::uuid[])`, [ids])
    await client.query(
      `UPDATE questions q SET ai_answer_risk_reason = p.risk, updated_at = NOW()
       FROM unnest($1::uuid[], $2::text[]) AS p(id, risk) WHERE q.id = p.id`,
      [ids, plan.map(p => p.risk)])
    await client.query('COMMIT')
    log(`\n[apply] 已标注 ${ids.length} 行（只写 ai_answer_risk_reason，不改判定）`)
    log(`备份表：${BAK}；回滚：--rollback`)
  } catch (e) { await client.query('ROLLBACK'); console.error('[apply] 失败已回滚：', e.message); throw e } finally { client.release() }
  await pool.end()
}

main().catch(e => { console.error(e); pool.end() })
