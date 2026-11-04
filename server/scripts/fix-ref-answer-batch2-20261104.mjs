/**
 * 「参考答案误挂」批量修复 #2（2026-11-04，同 fix-multiple-direction-answer 同型）
 *
 * 来源：负责人报 5f2f7ee2（倍数方向题，已单独修复）后，全库只读审计
 *   （audit-answer-vs-ai-conflict / audit-answer-conflict-narrow-20261104）：
 *   answer≠ai_answer 且学生答 ai_answer 被判错的 choice 题共 204 道，
 *   逐题「题干推理 + 几何裁片图看图」终裁，确凿假错 5 道（其余 115 道解析站参考侧
 *   = 学生抄 AI 错答案、判错正确；2 道缺原图待人工；2 道图错位待人工）。
 *
 * 确凿依据：
 *   af5484c1 抛物线 y=-(x+2)²，x₁<x₂<-2 ⇒ y₁<y₂<0（下开、对称轴左侧递增、恒负）= B；库给 A。
 *   8594718b / 7aee54e1 y=a(x+m)² 图：开口向下 a<0，顶点(-m,0)在 x 轴负半轴 ⇒ m>0 = C；库给 B。
 *   745c4878 / 560799e9 CD 平分∠ACB 且∠BCD=∠A ⇒ ∠ACB=2∠A；
 *     相似恰 3 对（△ADE∽△ABC、△BCD∽△BAC、△CDE∽△ACD，图中∠A≠∠B 无第4对）= B；库给 A。
 *
 * 链路同 fix-or-multivalue：改 answer（question_cache 同步）→ judgeAnswer 复核 →
 *   finalizeRejudgeResult(pc_rejudge, manualOverride) → 删错题行、掌握度同步、judgements 落痕。
 * 先备份后动库。默认 dry-run。
 *
 * 用法：node server/scripts/fix-ref-answer-batch2-20261104.mjs            # dry-run
 *       node server/scripts/fix-ref-answer-batch2-20261104.mjs --apply
 */
import '../loadEnv.js'
import fs from 'node:fs'
import { getPool } from '../config/neon.js'
import { judgeAnswer } from '../services/judgeService.js'
import { finalizeRejudgeResult } from '../services/gradingFinalizer.js'

const APPLY = process.argv.includes('--apply')

// qidPrefix / oldAnswer / newAnswer / aiAnswer / stuAnswer / stemNeedle（现状闸，防脚本过期误伤）
const TARGETS = [
  { id: 'af5484c1', old: 'A', nu: 'B', stem: 'x₁<x₂<-2' },
  { id: '8594718b', old: 'B', nu: 'C', stem: 'a(x + m)²' },
  { id: '7aee54e1', old: 'B', nu: 'C', stem: 'a(x + m)²' },
  { id: '745c4878', old: 'A', nu: 'B', stem: '相似三角形共有' },
  { id: '560799e9', old: 'A', nu: 'B', stem: '相似三角形共有' }
]

const pool = getPool()
const q = async (sql, params) => (await pool.query(sql, params)).rows

const snapshot = async (qid) => ({
  question: (await q('SELECT * FROM questions WHERE id::text LIKE $1', [qid + '%']))[0] || null,
  wrong_questions: await q('SELECT * FROM wrong_questions WHERE question_id::text LIKE $1', [qid + '%']),
  question_knowledge: await q('SELECT * FROM question_knowledge WHERE question_id::text LIKE $1', [qid + '%'])
})

const run = async () => {
  for (const t of TARGETS) {
    const before = await snapshot(t.id)
    const row = before.question
    if (!row) { console.log(`[skip] ${t.id} 不存在`); continue }
    const fullId = row.id
    const head = `${t.id} no=${row.question_number} answer=${row.answer} ai=${row.ai_answer} stu=${row.student_answer} is_correct=${row.is_correct} status=${row.status} wq=${before.wrong_questions.length}`
    const ok =
      String(row.answer).trim() === t.old &&
      String(row.ai_answer).trim() === t.nu &&
      String(row.student_answer).trim() === t.nu &&
      String(row.content || '').includes(t.stem)
    if (!ok) { console.log(`[skip] 现状不符 ${head} 期望 old=${t.old} new=${t.nu}`); continue }
    console.log(`[fix ] ${head} 参考 ${t.old}→${t.nu}`)

    const dir = new URL('../_backup/', import.meta.url)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(new URL(`q_${fullId}_${Date.now()}.json`, dir), JSON.stringify(before, null, 2), 'utf8')

    if (!APPLY) { console.log('       dry-run（已备份，未写库）'); continue }

    await q(`UPDATE questions SET answer = $1, updated_at = NOW() WHERE id = $2`, [t.nu, fullId])
    if (row.cache_id) {
      const c = await q(
        `UPDATE question_cache SET answer = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
        [t.nu, row.cache_id]
      )
      console.log(`       cache 同步: ${c.length} 行`)
    }
    const fresh = (await snapshot(t.id)).question
    const judged = judgeAnswer(fresh.student_answer, fresh.answer, fresh.question_type || 'answer')
    if (judged.isCorrect !== true) {
      console.log(`[halt] ${t.id} 判题器复核未过（${JSON.stringify(judged)}），已改答案未落判定，请人工核对`)
      continue
    }
    const settlement = await finalizeRejudgeResult({
      question: fresh,
      isCorrect: true,
      oldIsCorrect: row.is_correct,
      source: 'pc_rejudge',
      manualOverride: true
    })
    await q(
      `UPDATE questions SET answer_exception = FALSE, answer_exception_reason = NULL, updated_at = NOW()
        WHERE id = $1 AND (answer_exception IS TRUE OR answer_exception_reason IS NOT NULL)`,
      [fullId]
    )
    const after = await snapshot(t.id)
    console.log(`       settle=${JSON.stringify(settlement)} | answer=${after.question.answer} is_correct=${after.question.is_correct} status=${after.question.status} wq=${after.wrong_questions.length}`)
  }
  await pool.end()
}

run().catch(async (e) => {
  console.error('[fatal]', e)
  try { await pool.end() } catch {}
  process.exitCode = 1
})
