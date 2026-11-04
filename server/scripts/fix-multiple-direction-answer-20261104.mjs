/**
 * 「倍数方向」参考答案误挂修复（2026-11-04，负责人截图）
 *
 * 题目：下列各数中，第一个数是第二个数倍数的是（ ）。
 *   A. 4 和 0.4   B. 5 和 1   C. 2 和 8   D. 26 和 4
 * 正确答案 B（5÷1=5，整数倍）。入库参考答案 answer='C'（answer_source='recognized'，
 * 识别管线把「第一个数是第二个数的倍数」方向搞反——C 是「第二个数是第一个数的倍数」的答案）。
 * 同行 ai_answer='B'（AI 解析算对了，题目解析弹窗展示的正是它），学生 student_answer='B'
 * ⇒ 学生答对却被判错，假错入册。
 *
 * 受害链（judgements 审计）：
 *   2026-09-02 初批（answer=C 入库）；
 *   2026-10-15 pc_rejudge 按 C 判错（metadata.oldIsCorrect=true → false），错题入册，
 *             AI 还幻觉错因「错选B，未理解倍数须整数倍关系」（学生答的就是对的）；
 *   2026-11-03 重练卷 5ba59a51（数学-1103-01）结算再次按 C 判错 settle（error_count=2）。
 *
 * 修复：answer C→B（question_cache 同步）→ judgeAnswer 复核 →
 *   finalizeRejudgeResult(pc_rejudge, manualOverride) → is_correct=true、status 回 pending、
 *   wrong_questions 整行删除、掌握度同步、judgements 落痕。
 *   重练结算（judgement 10643）属历史审计，保留不回溯；错题行删除后该题不再重复入册。
 *
 * 先备份后动库（server/_backup/q_<id>_<ts>.json）。
 *
 * 用法：node server/scripts/fix-multiple-direction-answer-20261104.mjs            # dry-run
 *       node server/scripts/fix-multiple-direction-answer-20261104.mjs --apply
 */
import '../loadEnv.js'
import fs from 'node:fs'
import { getPool } from '../config/neon.js'
import { judgeAnswer } from '../services/judgeService.js'
import { finalizeRejudgeResult } from '../services/gradingFinalizer.js'

const APPLY = process.argv.includes('--apply')
const QID = '5f2f7ee2-13b1-450a-bed7-644a7447fc66'
const NEW_ANSWER = 'B'

const pool = getPool()
const q = async (sql, params) => (await pool.query(sql, params)).rows

const snapshot = async (qid) => ({
  question: (await q('SELECT * FROM questions WHERE id = $1', [qid]))[0] || null,
  wrong_questions: await q('SELECT * FROM wrong_questions WHERE question_id = $1', [qid]),
  question_knowledge: await q('SELECT * FROM question_knowledge WHERE question_id = $1', [qid])
})

const run = async () => {
  const before = await snapshot(QID)
  const row = before.question
  if (!row) {
    console.log('[skip] 题目不存在')
    return
  }
  const head = `${String(QID).slice(0, 8)} no=${row.question_number} answer=${row.answer} ai=${row.ai_answer} stu=${row.student_answer} is_correct=${row.is_correct} status=${row.status} wq=${before.wrong_questions.length}`
  // 现状闸：与探针确认的事实不符就不碰（防止脚本过期后误伤）
  if (
    String(row.answer).trim() !== 'C' ||
    String(row.ai_answer).trim() !== 'B' ||
    String(row.student_answer).trim() !== 'B' ||
    !String(row.content || '').includes('第一个数是第二个数')
  ) {
    console.log(`[skip] 现状与预期不符：${head}`)
    return
  }
  console.log(`[fix ] ${head} 参考 C→B（AI 解析与题干方向一致）`)

  const dir = new URL('../_backup/', import.meta.url)
  fs.mkdirSync(dir, { recursive: true })
  const file = new URL(`q_${QID}_${Date.now()}.json`, dir)
  fs.writeFileSync(file, JSON.stringify(before, null, 2), 'utf8')

  if (!APPLY) {
    console.log('       dry-run（已备份快照，未写库）')
    await pool.end()
    return
  }

  // 1) 参考答案改对（answer_source 保持 recognized，与 fix-multisol-answer 先例一致）
  await q(`UPDATE questions SET answer = $1, updated_at = NOW() WHERE id = $2`, [NEW_ANSWER, QID])
  // 2) 同步题目缓存（下次同卷批改不再用错答案）
  if (row.cache_id) {
    const c = await q(
      `UPDATE question_cache SET answer = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
      [NEW_ANSWER, row.cache_id]
    )
    console.log(`       cache 同步: ${c.length} 行`)
  }
  // 3) 复核 + 走既有改判链路（judgeAnswer 用更新后的行）
  const fresh = (await snapshot(QID)).question
  const judged = judgeAnswer(fresh.student_answer, fresh.answer, fresh.question_type || 'answer')
  if (judged.isCorrect !== true) {
    console.log(`[halt] 判题器复核未通过（${JSON.stringify(judged)}），已改答案但未落判定，请人工核对`)
    await pool.end()
    return
  }
  const settlement = await finalizeRejudgeResult({
    question: fresh,
    isCorrect: true,
    oldIsCorrect: row.is_correct,
    source: 'pc_rejudge',
    manualOverride: true
  })
  // finalizeRejudgeResult 不动展示列：化石异常原因一并清掉（同 fix-or-multivalue 口径）
  await q(
    `UPDATE questions SET answer_exception = FALSE, answer_exception_reason = NULL, updated_at = NOW()
      WHERE id = $1 AND (answer_exception IS TRUE OR answer_exception_reason IS NOT NULL)`,
    [QID]
  )
  const after = await snapshot(QID)
  console.log(`       settle=${JSON.stringify(settlement)} | answer=${after.question.answer} is_correct=${after.question.is_correct} status=${after.question.status} wq=${after.wrong_questions.length}`)
  await pool.end()
}

run().catch(async (e) => {
  console.error('[fatal]', e)
  try { await pool.end() } catch {}
  process.exitCode = 1
})
