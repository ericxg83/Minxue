/**
 * 修复脚本：余晨瑞错题本 09-14 结算事故（42804）遗留脏数据
 *
 * 事实依据（探针 _diag_pollution_error_count / _yuchenrui_v2）：
 *  - 该生真实只有 1 份重练卷（bb3fbf5c 错题再测-0911，17 题）+ 1 个 wrong_retry 任务。
 *  - 09-13 每点一次「完成复核」，42804 炸点前的 wrong_questions 推进就提交一次：
 *    error_count 被推到 28、practice_count 31；9 条被推成 mastered（假完全掌握）。
 *  - 09-14 05:01 修复版结算已正常落库（17 条 generated_exam:*:final 审计，每题恰 1 次）。
 *
 * 修复口径（人工复核优先，与 questionResultCaliber / effectiveIsCorrect 同源）：
 *  - 有效结果 = review_status ?? is_correct（review_status='correct' → 对；'wrong'/'wrong_no_book' → 错）
 *  - 有效对（9 条）：lifecycle_status='review_1'（只答对过 1 次 = 基本掌握）、
 *    status='pending'、error_count=1、practice_count=1、mastered_at=NULL
 *  - 有效错（5 条）：lifecycle_status='new'（待复习）、status='pending'、
 *    error_count=2（原作业错 1 次 + 重练错 1 次）、practice_count=1、mastered_at=NULL
 *  - 只动 wrong_questions 计数器/生命周期；不碰 questions / judgements / generated_exams。
 *
 * 安全性：先建备份表 wrong_questions_bak_20260914_pollution；幂等（重跑 0 行）；
 *         --rollback 从备份表还原。
 */
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })

import pg from 'pg'
const { Pool } = pg
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})
const q = (sql, params) => pool.query(sql, params)

const STUDENT_ID = 'cd4773e3-71da-4da3-a452-cfb7f9b6c33f' // 余晨瑞
const STUDENT_NAME = '余晨瑞'
const BACKUP_TABLE = 'wrong_questions_bak_20260914_pollution'

const rollback = process.argv.includes('--rollback')

/** 人工优先的有效判定（与 effectiveIsCorrect 同源） */
const effectiveIsCorrect = (qRow) => {
  if (!qRow) return null
  if (qRow.review_status === 'correct') return true
  if (qRow.review_status === 'wrong' || qRow.review_status === 'wrong_no_book') return false
  if (qRow.answer_source === 'blank') return false
  if (qRow.is_correct === true) return true
  if (qRow.is_correct === false) return false
  return null
}

async function main() {
  if (rollback) {
    const { rowCount } = await q(`
      UPDATE wrong_questions wq SET
        lifecycle_status = b.lifecycle_status,
        status = b.status,
        error_count = b.error_count,
        practice_count = b.practice_count,
        mastered_at = b.mastered_at,
        updated_at = NOW()
      FROM ${BACKUP_TABLE} b
      WHERE wq.id = b.id
    `)
    console.log(`[rollback] 已从 ${BACKUP_TABLE} 还原 ${rowCount} 行`)
    await pool.end()
    return
  }

  // 1. 取该生重练卷题目集合 + 每题真实结算（generated_exam:*:final 恰 1 次）
  const exam = await q(
    `SELECT id::text, question_ids FROM generated_exams WHERE student_id=$1 ORDER BY created_at DESC`,
    [STUDENT_ID]
  )
  if (exam.rowCount !== 1) throw new Error(`期望 1 份重练卷，实际 ${exam.rowCount}，中止`)
  const examQids = exam.rows[0].question_ids
  console.log(`重练卷 ${exam.rows[0].id.slice(0, 8)}：${examQids.length} 题`)

  const settle = await q(
    `SELECT question_id::text AS q_id, is_correct, COUNT(*)::int AS n
     FROM judgements
     WHERE student_id=$1 AND metadata->>'settlement_key' LIKE 'generated_exam:%:final'
     GROUP BY question_id, is_correct`,
    [STUDENT_ID]
  )
  const settleMap = new Map()
  for (const r of settle.rows) {
    if (settleMap.has(r.q_id)) throw new Error(`题 ${r.q_id} 有多条重练结算审计，中止`)
    settleMap.set(r.q_id, r.is_correct)
  }
  if (settle.rows.length !== examQids.length) {
    throw new Error(`结算审计 ${settle.rows.length} 条 != 卷面 ${examQids.length} 题，中止`)
  }

  // 2. questions 现况 → 人工优先有效结果
  const qs = await q(
    `SELECT id::text AS q_id, is_correct, review_status, answer_source
     FROM questions WHERE id = ANY($1::uuid[])`,
    [examQids]
  )
  const qMap = new Map(qs.rows.map(r => [r.q_id, r]))

  // 3. wrong_questions 现况 → 目标态
  const wqs = await q(
    `SELECT id::text, question_id::text AS q_id, COALESCE(lifecycle_status,'new') AS lc,
            status, error_count, practice_count
     FROM wrong_questions WHERE student_id=$1`,
    [STUDENT_ID]
  )
  const plans = []
  for (const w of wqs.rows) {
    if (!examQids.includes(w.q_id)) {
      console.log(`  跳过（不在重练卷）：${w.id.slice(0, 8)} / ${w.q_id.slice(0, 8)}`)
      continue
    }
    const eff = effectiveIsCorrect(qMap.get(w.q_id))
    if (eff === null) throw new Error(`题 ${w.q_id} 有效判定为 null，中止（需人工确认）`)
    const target = eff
      ? { lc: 'review_1', status: 'pending', err: 1, prac: 1 }   // 只答对 1 次 = 基本掌握
      : { lc: 'new',      status: 'pending', err: 2, prac: 1 }   // 原作业错1次 + 重练错1次 = 待复习
    const dirty = w.lc !== target.lc || w.status !== target.status ||
      w.error_count !== target.err || w.practice_count !== target.prac
    plans.push({ id: w.id, q: w.q_id, eff, dirty, from: w, to: target })
  }

  const toFix = plans.filter(p => p.dirty)
  console.log(`\n待修复 ${toFix.length} / ${plans.length} 条：`)
  console.table(plans.map(p => ({
    wq: p.id.slice(0, 8), q: p.q.slice(0, 8),
    eff_ok: p.eff,
    from: `${p.from.lc}/${p.from.status}/e${p.from.error_count}/p${p.from.practice_count}`,
    to: `${p.to.lc}/${p.to.status}/e${p.to.err}/p${p.to.prac}`,
    dirty: p.dirty
  })))

  if (toFix.length === 0) { console.log('无需修复（幂等重跑）'); await pool.end(); return }

  // 4. 备份（幂等：不存在才建）
  await q(`CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} AS
           SELECT * FROM wrong_questions WHERE student_id=$1 AND false`, [STUDENT_ID])
  const bakCount = await q(`SELECT COUNT(*)::int AS n FROM ${BACKUP_TABLE}`)
  if (bakCount.rows[0].n === 0) {
    await q(`INSERT INTO ${BACKUP_TABLE}
             SELECT * FROM wrong_questions WHERE student_id=$1`, [STUDENT_ID])
    console.log(`备份 → ${BACKUP_TABLE}（${wqs.rows.length} 行）`)
  } else {
    console.log(`备份表已存在（${bakCount.rows[0].n} 行），跳过重复备份`)
  }

  // 5. 逐行修复（带 WHERE 守卫，保证幂等 + 防并发漂移）
  let fixed = 0
  for (const p of toFix) {
    const { rowCount } = await q(
      `UPDATE wrong_questions
       SET lifecycle_status=$1, status=$2, error_count=$3, practice_count=$4,
           mastered_at=NULL, updated_at=NOW()
       WHERE id=$5 AND student_id=$6
         AND (lifecycle_status IS DISTINCT FROM $1 OR status IS DISTINCT FROM $2
              OR error_count IS DISTINCT FROM $3 OR practice_count IS DISTINCT FROM $4)`,
      [p.to.lc, p.to.status, p.to.err, p.to.prac, p.id, STUDENT_ID]
    )
    fixed += rowCount
  }
  console.log(`\n已修复 ${fixed} 行`)

  // 6. 修复后核验
  const after = await q(
    `SELECT COALESCE(lifecycle_status,'new') AS lc, COUNT(*)::int AS n,
            MIN(error_count)::int AS min_err, MAX(error_count)::int AS max_err,
            MIN(practice_count)::int AS min_prac, MAX(practice_count)::int AS max_prac
     FROM wrong_questions WHERE student_id=$1
     GROUP BY 1 ORDER BY 1`,
    [STUDENT_ID]
  )
  console.log('\n修复后分布：')
  console.table(after.rows)

  await pool.end()
}

main().catch(e => { console.error(e); process.exitCode = 1; pool.end() })
