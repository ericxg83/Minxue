/**
 * 「或」多值参考答案误挂修复（2026-10-27，负责人截图 #14）
 *
 * 背景：judgeService 新增「或拆支配对」通道（commit 31a6279）后全库 A/B 实测
 * 恰好 3 行翻转（false/null → true），逐条人工核对均为真阳性：
 *   1. d53a69e8（截图 #14，task 8b0b1b72 #11）：参考 10或-10，学生 ± 分类讨论两支
 *      结论 10 / -10 全对。is_correct=null（「主观题需人工判定」化石文案），
 *      且被 AI 幻觉错因（"误将求x-y当作求xy"——题目求的就是 x-y）挂进错题本。
 *   2. dfcbffed（task e2a26f2c #13）：参考 -1或-4，学生推出 a=-1或a=-4，全对。
 *      is_correct=null（10-12 OCR 漏识别按未作答入册，补出作答后一直未判）。
 *   3. 015ee01e（task 7e4865b2 #12）：参考 0 或 2，学生 m=0 或 m=2，全对。
 *      is_correct=false 假错入册（错因"计算错误"为 AI 编造）。
 *
 * 本脚本走系统既有链路（同老师点「判对」）：
 *   judgeAnswer 复核（必须仍为 true，否则跳过）→ finalizeRejudgeResult(pc_rejudge)
 *   → is_correct=true、status 回 pending、wrong_questions 整行删除、掌握度同步、
 *     judgements 审计落痕；再补清 answer_exception / answer_exception_reason
 *   （finalizeRejudgeResult 不动这两个展示列，化石原因必须一并清掉）。
 *
 * 先备份后动库（server/_backup/q_<id>_*.json，含 questions/wrong_questions/question_knowledge 快照）。
 *
 * 用法：node server/scripts/fix-or-multivalue-20261027.mjs            # dry-run
 *       node server/scripts/fix-or-multivalue-20261027.mjs --apply
 */
import '../loadEnv.js'
import fs from 'node:fs'
import { getPool } from '../config/neon.js'
import { judgeAnswer } from '../services/judgeService.js'
import { finalizeRejudgeResult } from '../services/gradingFinalizer.js'

const APPLY = process.argv.includes('--apply')
const TARGETS = [
  'd53a69e8-a471-4be7-b322-c8e17e894aac',
  'dfcbffed-62be-4b9c-a73c-e14e0657e1c4',
  '015ee01e-be21-4a10-8b16-89279cdd3be8'
]

const pool = getPool()
const q = async (sql, params) => (await pool.query(sql, params)).rows

const snapshot = async (qid) => ({
  question: (await q('SELECT * FROM questions WHERE id = $1', [qid]))[0] || null,
  wrong_questions: await q('SELECT * FROM wrong_questions WHERE question_id = $1', [qid]),
  question_knowledge: await q('SELECT * FROM question_knowledge WHERE question_id = $1', [qid])
})

const run = async () => {
  for (const qid of TARGETS) {
    const before = await snapshot(qid)
    const row = before.question
    if (!row) {
      console.log(`[skip] ${qid} 不存在`)
      continue
    }
    const judged = judgeAnswer(row.student_answer, row.answer, row.question_type || 'answer')
    const head = `${String(qid).slice(0, 8)} no=${row.question_number} stored=${row.is_correct} review=${row.review_status} wq=${before.wrong_questions.length}`
    if (judged.isCorrect !== true) {
      console.log(`[skip] ${head} —— 判题器不再是 true（${JSON.stringify(judged)}），不碰`)
      continue
    }
    console.log(`[fix ] ${head} 参考=${row.answer} 引擎=true`)

    const dir = new URL('../_backup/', import.meta.url)
    fs.mkdirSync(dir, { recursive: true })
    const file = new URL(`q_${qid}_${Date.now()}.json`, dir)
    fs.writeFileSync(file, JSON.stringify(before, null, 2), 'utf8')

    if (!APPLY) {
      console.log('       dry-run（已备份快照，未写库）')
      continue
    }

    const settlement = await finalizeRejudgeResult({
      question: row,
      isCorrect: true,
      oldIsCorrect: row.is_correct,
      source: 'pc_rejudge',
      manualOverride: true
    })
    // finalizeRejudgeResult 不动展示列：化石异常原因一并清掉（同 backfill 的 fixable 分支口径）
    await q(
      `UPDATE questions SET answer_exception = FALSE, answer_exception_reason = NULL, updated_at = NOW()
        WHERE id = $1 AND (answer_exception IS TRUE OR answer_exception_reason IS NOT NULL)`,
      [qid]
    )
    const after = await snapshot(qid)
    console.log(`       settle=${JSON.stringify(settlement)} | is_correct=${after.question.is_correct} status=${after.question.status} exception=${after.question.answer_exception} reason=${after.question.answer_exception_reason} wq=${after.wrong_questions.length}`)
  }
  await pool.end()
}

run().catch(async (e) => {
  console.error('[fatal]', e)
  try { await pool.end() } catch {}
  process.exitCode = 1
})
