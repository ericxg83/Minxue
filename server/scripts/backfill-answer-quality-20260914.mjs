/**
 * 参考答案质量回填（2026-09-14 错题再测-0911 事故）
 *
 * 修什么
 *   1) 「叙述型」参考答案：answer 字段是模型的元话语残句/整段解释
 *      （`应包含10`、`写作0.31818...（…）`、`应为①、④、⑤`），判等层永远对不上。
 *      这批答案在原作业批改时就写进了 questions.answer，并缓存进 question_cache，
 *      经题干指纹复用传染给所有同题干的学生。全量实测：客观题缓存命中 14 条。
 *   2) 能救的用答案自己的 analysis 重算「文末最终答案」替换（extractFinalAnswerFromAnalysis）；
 *      救不回来的（解析里也没有干净答案）把 answer 清空 + 标 answer_exception，
 *      **判定一并置 null**——答案本身就是垃圾时，由它推出来的对错没有任何意义。
 *   3) 救回来的按新答案重新判一次（judgeAnswer），让批改页显示与参考答案一致。
 *
 * 不碰什么
 *   - 主观题（answer/essay/proof/drawing/composition）：叙述本身就是答案，一律跳过。
 *   - 错题本 wrong_questions / 生命周期 lifecycle / 掌握度：本次不动（已结算的历史不追溯）。
 *   - 学生未作答（answer_source='blank'）的题：判定语义不变，不重判。
 *
 * 用法
 *   node server/scripts/backfill-answer-quality-20260914.mjs            # dry-run（默认，只读）
 *   node server/scripts/backfill-answer-quality-20260914.mjs --apply    # 写库（自动建备份表）
 *   node server/scripts/backfill-answer-quality-20260914.mjs --rollback # 用备份表回滚
 *
 * 幂等：回填后 answer 不再是叙述型，重跑 plan 为空。
 */
import { config } from 'dotenv'
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
import pg from 'pg'
import { isNarrativeAnswer, extractNumericTokens, numericJaccard } from '../utils/aiParseSelfCheck.js'
import { rescueReferenceAnswer } from '../utils/referenceAnswerRescue.js'
import { judgeAnswer } from '../services/judgeService.js'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const BAK_Q = 'questions_bak_20260914_answer'
const BAK_C = 'question_cache_bak_20260914_answer'
const SUBJECTIVE_TYPES = new Set(['answer', 'essay', 'proof', 'drawing', 'composition'])

/**
 * 判定翻转的「构造上安全」护栏。
 *
 * 为什么需要：judgeAnswer 里存在既有的数学等价放水通道，实测
 *   judgeAnswer('-1/2 x² + 10x', '100 - 20x', 'fill') → true   ← 两个表达式并不相等
 * 直接拿它的输出去翻转历史判定，会把真错题翻成"对"。
 * 所以只承认三种"肉眼可验"的翻转，其余一律保持原判定并登记人工复核：
 *   ① 归一化（去分隔符/空白）后逐字相同
 *   ② 两侧都是枚举型且元素集合相同（`10、8、7、6、5、3、2` vs `2,3,5,6,7,8,10`）
 *   ③ 两侧都是单个数值且数值等价（`0.5` vs `1/2`）
 * （放水通道本身属独立收敛任务：需先用 judge-equivalence-backtest 回测量化再改，不在本次范围。）
 */
const stripSeparators = (s) => String(s ?? '').replace(/[\s,，、;；。:：]/g, '')
const tokenKey = (s) => String(s ?? '').split(/[,，、;；]/).map(x => stripSeparators(x)).filter(Boolean).sort().join('|')

function isSafeFlip(studentAnswer, nextAnswer) {
  if (!studentAnswer || !nextAnswer) return false
  if (stripSeparators(studentAnswer) === stripSeparators(nextAnswer)) return true
  const hasSeparators = /[,，、;；]/.test(String(studentAnswer)) && /[,，、;；]/.test(String(nextAnswer))
  if (hasSeparators && tokenKey(studentAnswer) === tokenKey(nextAnswer)) return true
  const sNums = extractNumericTokens(studentAnswer)
  const nNums = extractNumericTokens(nextAnswer)
  if (sNums.length === 1 && nNums.length === 1) return numericJaccard(sNums, nNums) === 1
  return false
}

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (sql, params) => (await pool.query(sql, params)).rows

const log = (...a) => console.log(...a)
const isObjective = (t) => !SUBJECTIVE_TYPES.has(String(t || '').toLowerCase())

async function rollback() {
  const hasQ = await q(`SELECT to_regclass($1) AS t`, [BAK_Q])
  const hasC = await q(`SELECT to_regclass($1) AS t`, [BAK_C])
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (hasQ[0].t) {
      const r = await client.query(`
        UPDATE questions q
        SET answer = b.answer, is_correct = b.is_correct,
            answer_exception = b.answer_exception,
            answer_exception_reason = b.answer_exception_reason,
            updated_at = NOW()
        FROM ${BAK_Q} b WHERE q.id = b.id`)
      log(`[rollback] questions 还原 ${r.rowCount} 行`)
    }
    if (hasC[0].t) {
      const r = await client.query(`UPDATE question_cache c SET answer = b.answer, updated_at = NOW() FROM ${BAK_C} b WHERE c.id = b.id`)
      log(`[rollback] question_cache 还原 ${r.rowCount} 行`)
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

async function main() {
  if (ROLLBACK) { await rollback(); await pool.end(); return }

  // ── 1. 找出「叙述型」客观题缓存 ────────────────────────────────────────
  const caches = await q(`
    SELECT id, answer, analysis, content, question_type
    FROM question_cache
    WHERE analysis IS NOT NULL AND analysis <> ''`)
  const badCaches = caches.filter(c => isObjective(c.question_type) && isNarrativeAnswer(c.answer))
  log(`缓存 ${caches.length} 条，其中客观题叙述型答案 ${badCaches.length} 条`)

  const cachePlan = badCaches.map(c => {
    const rescued = rescueReferenceAnswer(c.answer, c.analysis)
    return { id: c.id, old: c.answer, next: rescued, rescue: Boolean(rescued), content: String(c.content).slice(0, 34) }
  })
  log('\n== 缓存回填计划 ==')
  console.table(cachePlan.map(p => ({ 缓存: p.id.slice(0, 8), 救回: p.rescue ? 'Y' : 'N', 旧答案: String(p.old).slice(0, 30), 新答案: String(p.next).slice(0, 30), 题干: p.content })))

  // ── 2. 题目行计划：缓存命中的行 + 自己 answer 就是叙述型的行 ─────────────
  const badCacheIds = badCaches.map(c => c.id)
  const rows = await q(`
    SELECT id, cache_id, question_type, answer, analysis, student_answer, answer_source, is_correct,
           left(btrim(coalesce(content,'')), 34) AS stem
    FROM questions
    WHERE deleted_at IS NULL
      AND btrim(coalesce(answer,'')) <> ''
      AND (cache_id = ANY($1::uuid[]) OR answer ~ $2)`,
    [badCacheIds.length ? badCacheIds : [], '应包含|应为|应该是|应该|注意|题目要求|按题目|见解析|写作|等等|由于|因此|所以|说明|解释|可能'])

  const plan = []
  for (const r of rows) {
    if (!isObjective(r.question_type)) continue
    if (!isNarrativeAnswer(r.answer)) continue
    const rescued = rescueReferenceAnswer(r.answer, r.analysis)
    const nextAnswer = rescued || null
    let nextIsCorrect = null
    let note = ''
    if (rescued && r.student_answer && String(r.student_answer).trim() && r.answer_source !== 'blank') {
      const judged = judgeAnswer(String(r.student_answer), rescued, r.question_type).isCorrect
      if (judged !== r.is_correct) {
        if (isSafeFlip(r.student_answer, rescued)) {
          nextIsCorrect = judged
        } else {
          nextIsCorrect = null            // 保持原判定
          note = '翻转未通过安全护栏，保持原判定待人工'
        }
      }
    }
    plan.push({
      id: r.id, stem: r.stem, oldAnswer: String(r.answer).slice(0, 28), nextAnswer: String(nextAnswer ?? '').slice(0, 28),
      rescue: Boolean(rescued), oldIsCorrect: r.is_correct, nextIsCorrect, note,
      student: String(r.student_answer ?? '').slice(0, 20), cacheId: r.cache_id
    })
  }

  log(`\n== 题目行回填计划（客观题 + 叙述型答案）共 ${plan.length} 行 ==`)
  console.table(plan.map(p => ({
    题: p.id.slice(0, 8), 救回: p.rescue ? 'Y' : 'N', 旧答案: p.oldAnswer, 新答案: p.nextAnswer || '(清空+转人工)',
    学生答案: p.student, 旧判定: String(p.oldIsCorrect),
    新判定: p.nextIsCorrect === null ? (p.rescue ? '保持原判定' : 'null(转人工)') : String(p.nextIsCorrect),
    题干: p.stem
  })))
  const flip = plan.filter(p => p.nextIsCorrect !== null && p.nextIsCorrect !== p.oldIsCorrect)
  const flipBlocked = plan.filter(p => p.note)
  log(`\n汇总：救回 ${plan.filter(p => p.rescue).length} 行 / 清空转人工 ${plan.filter(p => !p.rescue).length} 行 / 判定翻转 ${flip.length} 行 / 翻转被护栏拦下 ${flipBlocked.length} 行`)
  if (flip.length) console.table(flip.map(p => ({ 题: p.id.slice(0, 8), 旧: String(p.oldIsCorrect), 新: String(p.nextIsCorrect), 学生: p.student, 新答案: p.nextAnswer, 题干: p.stem })))
  if (flipBlocked.length) console.table(flipBlocked.map(p => ({ 题: p.id.slice(0, 8), 学生: p.student, 新答案: p.nextAnswer, 说明: p.note, 题干: p.stem })))

  if (!APPLY) {
    log('\n[dry-run] 未写库。确认无误后加 --apply。')
    await pool.end()
    return
  }

  // ── 3. 备份 + 写入 ────────────────────────────────────────────────────
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`CREATE TABLE IF NOT EXISTS ${BAK_Q} AS SELECT id, answer, is_correct, answer_exception, answer_exception_reason, updated_at FROM questions WHERE false`)
    await client.query(`CREATE TABLE IF NOT EXISTS ${BAK_C} AS SELECT id, answer, updated_at FROM question_cache WHERE false`)

    const qIds = plan.map(p => p.id)
    if (qIds.length) {
      await client.query(`INSERT INTO ${BAK_Q} SELECT id, answer, is_correct, answer_exception, answer_exception_reason, updated_at FROM questions WHERE id = ANY($1::uuid[])`, [qIds])
    }
    const rescueCacheIds = cachePlan.filter(p => p.rescue).map(p => p.id)
    const deadCacheIds = cachePlan.filter(p => !p.rescue).map(p => p.id)
    const allCacheIds = cachePlan.map(p => p.id)
    if (allCacheIds.length) {
      await client.query(`INSERT INTO ${BAK_C} SELECT id, answer, updated_at FROM question_cache WHERE id = ANY($1::uuid[])`, [allCacheIds])
      if (rescueCacheIds.length) {
        await client.query(`UPDATE question_cache c SET answer = p.next, updated_at = NOW()
                            FROM unnest($1::uuid[], $2::text[]) AS p(id, next) WHERE c.id = p.id`,
          [rescueCacheIds, cachePlan.filter(p => p.rescue).map(p => p.next)])
      }
      // 救不回来的缓存 → 置成既有占位符「待人工补充」，主动作废这条缓存。
      // worker 的缓存命中判定显式排除该占位值（`cached.answer !== '待人工补充'`），
      // 于是同题下次会落到答案引擎重新生成，而不是继续复用一条永远对不上的坏答案。
      // 只改缓存不动题目行：题目的 answer 已由下面的 plan 分支处理（清空 + 转人工）。
      if (deadCacheIds.length) {
        await client.query(`UPDATE question_cache SET answer = '待人工补充', updated_at = NOW() WHERE id = ANY($1::uuid[])`, [deadCacheIds])
      }
    }

    let rescueUpd = 0, nullifyUpd = 0
    for (const p of plan) {
      if (p.rescue) {
        await client.query(
          `UPDATE questions SET answer = $1, is_correct = CASE WHEN $2::text IS NULL THEN is_correct ELSE $2::boolean END,
                               answer_exception = false, answer_exception_reason = NULL, updated_at = NOW()
           WHERE id = $3`,
          [p.nextAnswer, p.nextIsCorrect === null ? null : p.nextIsCorrect, p.id])
        rescueUpd++
      } else {
        await client.query(
          `UPDATE questions SET answer = '', is_correct = NULL,
                               answer_exception = true,
                               answer_exception_reason = '参考答案不可核对（疑似 AI 自述残句，已清空转人工）',
                               updated_at = NOW()
           WHERE id = $1`, [p.id])
        nullifyUpd++
      }
    }
    await client.query('COMMIT')
    log(`\n[apply] 完成：缓存更新 ${rescueCacheIds.length} 条（其中作废 ${deadCacheIds.length} 条），题目救回 ${rescueUpd} 行，清空转人工 ${nullifyUpd} 行`)
    log(`备份表：${BAK_Q} / ${BAK_C}；回滚：--rollback`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('[apply] 失败已回滚：', e.message)
    throw e
  } finally {
    client.release()
  }
  await pool.end()
}

main().catch(e => { console.error(e); pool.end() })
