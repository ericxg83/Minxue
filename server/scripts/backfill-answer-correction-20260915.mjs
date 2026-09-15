/**
 * 参考答案纠正 + 重判（2026-09-15「±4/±2 却显示 AI正确」报障收尾）
 *
 * 病根：答案引擎在「平方根」题上把「算术平方根」当答案，或算错值后又在结论句自我矛盾。
 *       本轮 5 组全部有数学推导级证据，不是风格化改写。
 *
 * ── 5 组修正 ────────────────────────────────────────────────────────────────────
 * ① √(a-1)+√(b-5)=0，求 (a-b)² 的平方根     现 `±2`   → `±4`
 *    a=1,b=5 ⇒ (1-5)²=16 ⇒ 平方根 ±4。原解析正文写「16的平方根是±4」，
 *    末句却写「最终答案是±2」——自相矛盾。学生答 ±4 是对的（2 名学生被误判）。
 * ② √81的平方根                             现 `9`    → `±3`
 *    √81=9，9 的平方根 = ±3。答 `9` 是把「算术平方根」当「平方根」。
 *    注意 question_cache 侧本来就是 `±3`，只有 questions 实例被写坏。
 * ③ 正数 a 的两个平方根是 3x+2y=2 的一组解   现 `1`    → `4`
 *    x=-y 代入 ⇒ -3y+2y=2 ⇒ **-y=2 ⇒ y=-2、x=2** ⇒ a=x²=4。
 *    原解析把 -y=2 算成「y=-1」（3(-y)+2y=-y，若 y=-1 则 -y=1≠2，解析自相矛盾）。
 * ④ |x|=√6，y 是 4 的平方根，|y−x|=x−y，求 x+y   现 `2` → `√6+2 或 √6-2`
 *    枚举：x=√6 时 y=±2 都满足 x≥y；x=-√6 时全不满足 ⇒ 双解。
 *    questions 侧 9-14 已修过，但 question_cache 漏改（仍是 `2`）⇒ 本轮补上并掐断传染。
 * ⑤ 172010 的平方根约为（保留一位小数）      现 `1.3115` → `±414.7`
 *    √172010=√17.201×100≈414.741。原答案 1.3115 是 √1.7201 的值（串到上一行数据）。
 *
 * ── 明确不改 ────────────────────────────────────────────────────────────────────
 * · `若m-4没有平方根，则|m-5|` / `若(1/3)x有平方根，则x的条件` —— 题干只是**提到**
 *   平方根，问的不是求平方根。宽口径正则会把这类打成嫌疑，逐条核验后确认答案正确。
 * · `已知x=1-2a，y=3a-4…求这个数` → `a=-4, 25` 亦正确（a=-4 是第(1)问、
 *   a=3 是第(2)问的中间量，答案是分问给出的，不矛盾）。
 * · 主观题（"小海的解题过程是否正确"）的叙述型答案不是坏答案，属正常解答。
 *
 * ── 落库口径（与 2026-09-14 脚本一致）────────────────────────────────────────────
 *   · 只重判 `review_status IS NULL`（未人工复核）的行 —— 老师已复核的结论是 ground truth，
 *     不被脚本翻转；这些行只更新 answer，页面仍显示老师结论。
 *   · 同步改 question_cache.answer：否则题干指纹命中后又会把错答案写回来。
 *   · 清掉 ai_answer_risk_reason（答案已修正，风险提示失效）。
 *
 * 用法（幂等：改完后 answer 已等于目标值，重跑计划为空）
 *   node server/scripts/backfill-answer-correction-20260915.mjs            # dry-run
 *   node server/scripts/backfill-answer-correction-20260915.mjs --apply
 *   node server/scripts/backfill-answer-correction-20260915.mjs --rollback
 */
import { config } from 'dotenv'
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
import pg from 'pg'
import { judgeAnswer } from '../services/judgeService.js'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const BAK_Q = 'questions_bak_20260915_correction'
const BAK_C = 'question_cache_bak_20260915_correction'

const FIXES = [
  {
    key: '① (a-b)² 的平方根（±4/±2 报障原题）',
    cachePrefix: '2615f321',
    nextAnswer: '±4',
    evidence: 'a=1,b=5 ⇒ (1-5)²=16 ⇒ 平方根 ±4；原解析正文即写「16的平方根是±4」',
  },
  {
    key: '② √81 的平方根',
    cachePrefix: '7258cfde',
    nextAnswer: '±3',
    evidence: '√81=9，9 的平方根 = ±3；缓存侧本就存 ±3，仅 questions 实例被写坏',
  },
  {
    key: '③ 正数 a 的两个平方根是 3x+2y=2 的解',
    cachePrefix: 'c2bba5dd',
    nextAnswer: '4',
    evidence: 'x=-y ⇒ -3y+2y=2 ⇒ -y=2 ⇒ y=-2、x=2 ⇒ a=x²=4',
  },
  {
    key: '④ |x|=√6 求 x+y',
    cachePrefix: '83365918',
    nextAnswer: '√6+2 或 √6-2',
    evidence: '枚举 x=√6 时 y=±2 均满足 |y−x|=x−y ⇒ 双解；x=-√6 全不成立',
  },
  {
    key: '⑤ 172010 的平方根约为',
    cachePrefix: '829fa8d9',
    nextAnswer: '±414.7',
    evidence: '√172010=√17.201×100≈414.741；原值 1.3115 是上一行 √1.7201 的数据',
  },
  {
    key: '⑥ m≥0，a-1 和 5-2a 都是 m 的平方根（小海解法题）',
    cachePrefix: 'd6478a30',
    nextAnswer: '小海的解题过程不正确，错在忽略了 a-1=5-2a 的情况，正确的 m 值为 1 或 9',
    evidence: '本题是主观问答。原答案写「m=4」与自己的解析「m=1或9」直接矛盾，且 a-1=5-2a 解得 a=2 不是 4',
  },
  {
    key: '⑦ 圆满组合数（-3、m、-12）',
    cachePrefix: '059523cb',
    nextAnswer: '(1) 是；(2) m = -48',
    evidence: '解析枚举三种配对，只有 -3×m=144 ⇒ m=-48；「m=-27/16」非负整数，不可能满足题设',
  },
  {
    key: '⑧ 求下列各数的算术平方根（5 小问）',
    cachePrefix: '9dbda07e',
    nextAnswer: '7, 13/14, 19/16, √61/5, 3.5',
    evidence: '原答案是模型思考残句；解析末句已给出完整结论「综下答案依次为 7, 13/14, 19/16, √61/5, 3.5」',
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

  const plan = []
  const cachePlan = []

  for (const fix of FIXES) {
    log(`\n########## ${fix.key} → ${JSON.stringify(fix.nextAnswer)} ##########`)
    log(`  证据：${fix.evidence}`)

    const rows = await q(
      `SELECT id, question_number, question_type, answer, student_answer, is_correct, review_status,
              cache_id, ai_answer_risk_reason, left(btrim(coalesce(content,'')), 44) AS stem
       FROM questions
       WHERE deleted_at IS NULL AND cache_id::text LIKE $1 || '%'
       ORDER BY created_at`, [fix.cachePrefix])

    for (const r of rows) {
      const needed = String(r.answer ?? '').trim() !== fix.nextAnswer
      const judged = r.review_status ? null : judgeAnswer(String(r.student_answer ?? ''), fix.nextAnswer, r.question_type)
      if (needed) plan.push({ ...r, fix, nextAnswer: fix.nextAnswer, nextIsCorrect: judged ? judged.isCorrect : null })
      log(`  ${needed ? '[改]' : '[跳过]'} ${r.id.slice(0, 8)} 现答案=${JSON.stringify(String(r.answer))} 学生=${JSON.stringify(String(r.student_answer ?? '').slice(0, 22))} 判定=${String(r.is_correct)} 复核=${r.review_status || '-'}`)
      if (!needed) continue
      if (r.review_status) log(`      ↳ 已人工复核，只改 answer，判定保持老师结论 ${String(r.is_correct)}`)
      else log(`      ↳ 未复核 → 以新答案重判 = ${judged.isCorrect}`)
    }

    const caches = await q(
      `SELECT id, answer, question_type, use_count, left(btrim(coalesce(content,'')), 44) AS stem
       FROM question_cache WHERE id::text LIKE $1 || '%'`, [fix.cachePrefix])
    for (const c of caches) {
      const needed = String(c.answer ?? '').trim() !== fix.nextAnswer
      log(`  [cache] ${needed ? '[改]' : '[跳过]'} ${c.id.slice(0, 8)} ${JSON.stringify(String(c.answer))} → ${JSON.stringify(fix.nextAnswer)} use_count=${c.use_count}`)
      if (needed) cachePlan.push({ ...c, nextAnswer: fix.nextAnswer })
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
