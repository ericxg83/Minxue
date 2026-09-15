/**
 * 回填「被算术自检闸误清空」的参考答案（2026-09-15）
 *
 * 病根（已修，见 server/utils/arithmeticAnswerValidator.js 顶部注释）：
 *   算术自检闸的候选片段字符集不含 Unicode 上标，题干 `-3.6×10⁻⁴` 被截成 `-3.6×10`
 *   （指数被吃掉）→ 算出 -36 → 与正确答案 -0.00036 一比判「验算不符」→
 *   worker 按纪律清空 answer + 转人工 → 老师看到「缺少参考答案」，只能手工批。
 *
 * 本脚本做的事：把这类题**误清空的答案恢复回来**，并（仅对未复核行）按其重判。
 *
 * ── 回填判据（三条同时满足，宁缺毋滥）──────────────────────────────────────────
 *   ① `answer` 为空、`answer_exception_reason='缺少参考答案，无法自动判定'`、未删除；
 *   ② 能从 `analysis` 里提取出答案（extractFinalAnswerFromAnalysis，取文末候选）；
 *   ③ 该答案能通过**修正后**的算术闸 —— 即 validateArithmeticAnswer(题干, 答案)
 *      不是 `applicable && !isValid`。若 `applicable && isValid`，说明题干算式能独立
 *      算出这个值，是数学级证据；若不 applicable（题干含字母/单位，闸本就跳过），
 *      则要求 `judgeAnswer(学生答案, 该答案)` 判对，说明学生独立作答也得出同一个值。
 *
 * ── 落库口径（与 2026-09-14 / 09-15 两个脚本一致）──────────────────────────────
 *   · 只重判 `review_status IS NULL` 的行 —— 老师已复核的结论是 ground truth，
 *     脚本不许翻转；已复核行只补 answer，页面仍显示老师结论。
 *   · 同步改 question_cache.answer（若这些行真的进了缓存）。
 *   · 清掉 ai_answer_risk_reason（答案已恢复，风险提示失效）。
 *
 * 用法（幂等：回填后 answer 不再为空，重跑计划为 0 行）
 *   node server/scripts/backfill-cleared-reference-answer-20260915.mjs            # dry-run
 *   node server/scripts/backfill-cleared-reference-answer-20260915.mjs --apply
 *   node server/scripts/backfill-cleared-reference-answer-20260915.mjs --rollback
 */
import { config } from 'dotenv'
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
import pg from 'pg'
import { judgeAnswer } from '../services/judgeService.js'
import { extractFinalAnswerFromAnalysis } from '../utils/aiParseSelfCheck.js'
import { validateArithmeticAnswer } from '../utils/arithmeticAnswerValidator.js'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const VERBOSE = process.argv.includes('--verbose')
const BAK_Q = 'questions_bak_20260915_cleared_answer'
const BAK_C = 'question_cache_bak_20260915_cleared_answer'
const REASON = '缺少参考答案，无法自动判定'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (sql, params) => (await pool.query(sql, params)).rows
const log = (...a) => console.log(...a)

async function rollback() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const tq = await client.query(`SELECT to_regclass($1) AS t`, [BAK_Q])
    if (tq.rows[0].t) {
      const r = await client.query(`UPDATE questions q SET answer = b.answer, is_correct = b.is_correct,
        answer_exception = b.answer_exception, answer_exception_reason = b.answer_exception_reason,
        updated_at = NOW() FROM ${BAK_Q} b WHERE q.id = b.id`)
      log(`[rollback] questions 还原 ${r.rowCount} 行`)
    }
    const tc = await client.query(`SELECT to_regclass($1) AS t`, [BAK_C])
    if (tc.rows[0].t) {
      const r = await client.query(`UPDATE question_cache c SET answer = b.answer, updated_at = NOW() FROM ${BAK_C} b WHERE c.id = b.id`)
      log(`[rollback] question_cache 还原 ${r.rowCount} 行`)
    }
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

async function main() {
  if (ROLLBACK) { await rollback(); await pool.end(); return }

  const rows = await q(`
    SELECT id, task_id, question_number, question_type, content, analysis, student_answer,
           is_correct, review_status, answer_source, answer_exception, cache_id
    FROM questions
    WHERE deleted_at IS NULL
      AND (answer IS NULL OR btrim(answer) = '')
      AND answer_exception_reason = $1`, [REASON])

  log(`\n扫描：answer 为空 且 提示「${REASON}」= ${rows.length} 行\n`)

  const plan = []
  const cachePlan = []
  const skipped = []

  for (const r of rows) {
    const guess = extractFinalAnswerFromAnalysis(r.analysis)
    const arith = guess ? validateArithmeticAnswer(r.content, guess) : null
    const judge = guess ? judgeAnswer(String(r.student_answer ?? ''), guess, r.question_type) : null

    // 闸明确判「验算不符」→ 仍是真不一致，绝不回填
    const gateRejects = arith && arith.applicable && !arith.isValid
    // 数学级证据：题干算式能独立算出该值
    const stemProves = arith && arith.applicable && arith.isValid
    // 次强证据：学生独立作答得出同一个值
    const studentAgrees = judge && judge.isCorrect === true
    const ok = Boolean(guess) && !gateRejects && (stemProves || studentAgrees)

    const tag = `${String(r.id).slice(0, 8)} #${r.question_number} [${r.question_type}]`
    if (!ok) {
      skipped.push({ ...r, guess, arith, judge, reason: !guess ? '解析里提取不到答案' : gateRejects ? '闸判验算不符（真不一致）' : '既无算式证据、学生答案也不一致' })
      if (VERBOSE) {
        log(`  [跳过] ${tag} ${!guess ? '解析无答案标记' : gateRejects ? `闸判不符 expected=${arith.expected} actual=${arith.actual}` : '证据不足'}`)
        log(`         题干=${JSON.stringify(String(r.content ?? '').slice(0, 50))}`)
        if (guess) log(`         解析答案=${JSON.stringify(guess)} 学生=${JSON.stringify(String(r.student_answer ?? '').slice(0, 30))}`)
      }
      continue
    }

    plan.push({
      ...r, nextAnswer: guess,
      nextIsCorrect: r.review_status ? null : (judge ? judge.isCorrect : null),
      evidence: stemProves ? `题干算式独立求值 = ${arith.expected}` : `学生答案与该值判等通过`,
      arith, judge
    })
    log(`  [回填] ${tag}`)
    log(`         题干   : ${JSON.stringify(String(r.content ?? '').slice(0, 70))}`)
    log(`         学生答 : ${JSON.stringify(String(r.student_answer ?? '').slice(0, 40))}`)
    log(`         恢复为 : ${JSON.stringify(guess)}`)
    log(`         证据   : ${stemProves ? `题干算式独立求值 = ${arith.expected}` : `学生答案判等通过`}`)
    log(`         判定   : ${r.review_status ? `已人工复核（${r.review_status}），只补 answer，不动判定` : `未复核 → 重判 = ${judge ? judge.isCorrect : 'null'}`}`)
  }

  for (const p of plan) {
    if (!p.cache_id) continue
    const c = await q(`SELECT id, answer, use_count FROM question_cache WHERE id = $1`, [p.cache_id])
    if (c[0] && String(c[0].answer ?? '').trim() !== p.nextAnswer) cachePlan.push({ ...c[0], nextAnswer: p.nextAnswer })
  }

  log(`\n== 汇总 ==`)
  log(`  扫描 ${rows.length} 行 → 可回填 ${plan.length} 行，跳过 ${skipped.length} 行`)
  log(`  其中未复核需重判 ${plan.filter(p => !p.review_status).length} 行`)
  log(`  question_cache 待同步 ${cachePlan.length} 条`)
  if (skipped.length) {
    const byReason = {}
    for (const s of skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1
    log(`  跳过原因分布：${JSON.stringify(byReason)}`)
    log(`  （加 --verbose 看逐条明细）`)
  }
  if (!plan.length) { log('  无需改动（幂等）。'); await pool.end(); return }
  if (!APPLY) { log('\n[dry-run] 未写库。确认无误后加 --apply。'); await pool.end(); return }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`CREATE TABLE IF NOT EXISTS ${BAK_Q} AS
      SELECT id, answer, is_correct, answer_exception, answer_exception_reason, updated_at
      FROM questions WHERE false`)
    await client.query(`CREATE TABLE IF NOT EXISTS ${BAK_C} AS
      SELECT id, answer, updated_at FROM question_cache WHERE false`)
    await client.query(`INSERT INTO ${BAK_Q}
      SELECT id, answer, is_correct, answer_exception, answer_exception_reason, updated_at
      FROM questions WHERE id = ANY($1::uuid[])`, [plan.map(p => p.id)])
    if (cachePlan.length) {
      await client.query(`INSERT INTO ${BAK_C} SELECT id, answer, updated_at FROM question_cache WHERE id = ANY($1::uuid[])`, [cachePlan.map(c => c.id)])
    }
    for (const p of plan) {
      if (p.review_status) {
        // 老师结论优先：只补 answer，判定与复核状态保持原样
        await client.query(`UPDATE questions SET answer = $1, answer_exception = false,
          answer_exception_reason = NULL, updated_at = NOW() WHERE id = $2`,
          [p.nextAnswer, p.id])
      } else {
        await client.query(`UPDATE questions SET answer = $1, is_correct = $2::boolean,
          answer_exception = false, answer_exception_reason = NULL, updated_at = NOW() WHERE id = $3`,
          [p.nextAnswer, p.nextIsCorrect, p.id])
      }
    }
    for (const c of cachePlan) {
      await client.query(`UPDATE question_cache SET answer = $1, updated_at = NOW() WHERE id = $2`, [c.nextAnswer, c.id])
    }
    await client.query('COMMIT')
    log(`\n[apply] 完成：questions ${plan.length} 行，question_cache ${cachePlan.length} 条`)
    log(`备份表：${BAK_Q} / ${BAK_C}；回滚：--rollback`)
  } catch (e) { await client.query('ROLLBACK'); console.error('[apply] 失败已回滚：', e.message); throw e } finally { client.release() }
  await pool.end()
}

main().catch(e => { console.error(e); pool.end() })
