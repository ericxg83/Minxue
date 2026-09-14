/**
 * 参考答案纠正 + 重判（2026-09-14 错题再测-0911 事故收尾）
 *
 * 修什么（只动 answer 与 is_correct 的**结构性错误**，不做风格化改写）
 *   #4  |x|=√6, y 是 4 的平方根, |y−x|=x−y, 求 x+y
 *       现答案 `2` —— 错。由 y≤x 枚举：x=√6 时 y=±2 均成立（x=−√6 全不成立）
 *       ⇒ x+y = √6+2 或 √6−2（模型只给了正根）。正确答案写双解。
 *   #7  2.6̇ 化为最简分数后是 a/b，求 a+b
 *       现答案 `29` —— 错（解析写「8 + 3 = 29」）。2.6̇=2.666…=8/3 ⇒ a+b = 11。
 *
 * 明确**不改**的
 *   #12 求 2+2⁻¹+2⁻²+⋯ 的值：首项 2、公比 1/2 ⇒ S = 2/(1−1/2) = **4**，现答案 4 本就正确
 *       （学生写 3 是错位相减漏项，答错了）。上一轮报告"答案 4 错、学生 3 对"的判断已作废。
 *
 * 落库口径
 *   · 只重判 `review_status IS NULL`（未人工复核）的行 —— 老师已复核的结论是 ground truth，
 *     不被脚本翻转；这些行只更新 answer，页面仍显示老师的结论。
 *   · 同步把 question_cache 的 answer 一起改掉：否则题干指纹命中后又会把错答案写回来。
 *   · 清掉 ai_answer_risk_reason（答案已修正，风险提示没有意义了）。
 *
 * 用法（幂等：改完后 answer 已等于目标值，重跑计划为空）
 *   node server/scripts/backfill-answer-correction-20260914.mjs            # dry-run
 *   node server/scripts/backfill-answer-correction-20260914.mjs --apply
 *   node server/scripts/backfill-answer-correction-20260914.mjs --rollback
 */
import { config } from 'dotenv'
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
import pg from 'pg'
import { judgeAnswer } from '../services/judgeService.js'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const BAK_Q = 'questions_bak_20260914_correction'
const BAK_C = 'question_cache_bak_20260914_correction'

const FIXES = [
  {
    key: '#4 |x|=√6 求 x+y',
    where: `btrim(content) LIKE '%|x|=%'`,
    nextAnswer: '√6+2 或 √6-2',
    // dry-run 对比用：看看不同口径下会判成什么
    alternatives: ['√6+2', '√6+2 或 √6-2'],
    cacheWhere: `btrim(content) LIKE '%|x|=%'`,
  },
  {
    key: '#7 2.6̇ 化为 a/b 求 a+b',
    where: `btrim(content) LIKE '%2.6̇%'`,
    nextAnswer: '11',
    alternatives: ['11', '18'],
    cacheWhere: `btrim(content) LIKE '%2.6̇%'`,
  },
]

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
        ai_answer_risk_reason = b.ai_answer_risk_reason, updated_at = NOW() FROM ${BAK_Q} b WHERE q.id = b.id`)
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

  const plan = []       // questions 行
  const cachePlan = []  // question_cache 行

  for (const fix of FIXES) {
    log(`\n########## ${fix.key} → ${JSON.stringify(fix.nextAnswer)} ##########`)
    const rows = await q(
      `SELECT id, question_number, question_type, answer, student_answer, is_correct, review_status,
              cache_id, ai_answer_risk_reason, left(btrim(coalesce(content,'')), 44) AS stem
       FROM questions WHERE deleted_at IS NULL AND (${fix.where})`)

    for (const r of rows) {
      const needed = String(r.answer ?? '').trim() !== fix.nextAnswer
      const judged = r.review_status ? null : judgeAnswer(String(r.student_answer ?? ''), fix.nextAnswer, r.question_type)
      if (needed) plan.push({ ...r, fix, nextAnswer: fix.nextAnswer, nextIsCorrect: judged ? judged.isCorrect : null })
      log(`  ${r.id.slice(0, 8)} 现答案=${JSON.stringify(String(r.answer))} 学生=${JSON.stringify(String(r.student_answer ?? '').slice(0, 22))} 判定=${String(r.is_correct)} 复核=${r.review_status || '-'}`)
      if (r.review_status) {
        log(`      ↳ 已人工复核，只改 answer，判定保持老师结论 ${String(r.is_correct)}`)
      } else {
        log(`      ↳ 未复核 → 以新答案重判 = ${judged.isCorrect}`)
      }
      for (const alt of fix.alternatives) {
        if (alt === fix.nextAnswer) continue
        const a = judgeAnswer(String(r.student_answer ?? ''), alt, r.question_type)
        if (a.isCorrect !== judged?.isCorrect) log(`      · 若用 ${JSON.stringify(alt)} 则判 ${a.isCorrect}（供口径参考）`)
      }
    }

    const caches = await q(`SELECT id, answer, question_type, left(btrim(coalesce(content,'')), 44) AS stem FROM question_cache WHERE ${fix.cacheWhere}`)
    for (const c of caches) {
      if (String(c.answer ?? '').trim() === fix.nextAnswer) continue
      cachePlan.push({ ...c, nextAnswer: fix.nextAnswer })
      log(`  [cache] ${c.id.slice(0, 8)} ${JSON.stringify(String(c.answer))} → ${JSON.stringify(fix.nextAnswer)}  ${String(c.stem).replace(/\n/g, ' ')}`)
    }
  }

  log(`\n== 汇总 ==`)
  log(`  questions 待改 ${plan.length} 行（其中未复核需重判 ${plan.filter(p => !p.review_status).length} 行）`)
  log(`  question_cache 待改 ${cachePlan.length} 条`)
  if (!plan.length && !cachePlan.length) { log('  无需改动（幂等）。'); await pool.end(); return }
  if (!APPLY) { log('\n[dry-run] 未写库。确认无误后加 --apply。'); await pool.end(); return }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`CREATE TABLE IF NOT EXISTS ${BAK_Q} AS SELECT id, answer, is_correct, ai_answer_risk_reason, updated_at FROM questions WHERE false`)
    await client.query(`CREATE TABLE IF NOT EXISTS ${BAK_C} AS SELECT id, answer, updated_at FROM question_cache WHERE false`)
    if (plan.length) {
      await client.query(`INSERT INTO ${BAK_Q} SELECT id, answer, is_correct, ai_answer_risk_reason, updated_at FROM questions WHERE id = ANY($1::uuid[])`, [plan.map(p => p.id)])
    }
    if (cachePlan.length) {
      await client.query(`INSERT INTO ${BAK_C} SELECT id, answer, updated_at FROM question_cache WHERE id = ANY($1::uuid[])`, [cachePlan.map(c => c.id)])
    }
    for (const p of plan) {
      if (p.review_status) {
        await client.query(`UPDATE questions SET answer = $1, ai_answer_risk_reason = NULL, updated_at = NOW() WHERE id = $2`, [p.nextAnswer, p.id])
      } else {
        await client.query(`UPDATE questions SET answer = $1, is_correct = $2::boolean, ai_answer_risk_reason = NULL, updated_at = NOW() WHERE id = $3`, [p.nextAnswer, p.nextIsCorrect, p.id])
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
