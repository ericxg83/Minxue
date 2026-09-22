/**
 * 定点重判（不重新生成答案）：仅对指定 question id 用当前 judgeAnswer 重算 is_correct，
 * 判定有变化时走 finalizeRejudgeResult 同步 status / 错题本 / 掌握度 / 判题审计。
 *
 * 用途（2026-09-22）：judgeService 修掉两处带分数归一化缺口后，把受影响的存量题判定对齐。
 * 与 regradeTask.mjs 的区别：**不调用答案引擎**，只重跑判分 —— 答案本身保持不变。
 *
 * 用法:
 *   dry-run(默认,不写库):  node server/scripts/refixJudge.mjs <questionId> [<questionId> ...]
 *   真正写库:              node server/scripts/refixJudge.mjs <id...> --apply
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })

const APPLY = process.argv.includes('--apply')
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (ids.length === 0) {
  console.error('用法: node server/scripts/refixJudge.mjs <questionId> [...] [--apply]')
  process.exit(1)
}

const { query } = await import('../config/neon.js')
const { judgeAnswer } = await import('../services/judgeService.js')
const { finalizeRejudgeResult } = await import('../services/gradingFinalizer.js')

console.log(`\n===== 定点重判 ${APPLY ? '（写库）' : '（DRY-RUN，不写库）'} | ${ids.length} 题 =====\n`)

let changed = 0
for (const id of ids) {
  const { rows } = await query(`SELECT * FROM questions WHERE id = $1`, [id])
  const q = rows[0]
  if (!q) { console.log(`${id} ❌ 未找到`); continue }

  const { isCorrect: newCorrect, unrecognized } = judgeAnswer(q.student_answer, q.answer, q.question_type)
  const jChg = newCorrect !== q.is_correct
  console.log(
    `${jChg ? '⚖️ ' : '   '}${id.slice(0, 8)} #${q.question_number}.${q.sub_no ?? '-'} ` +
    `判定 ${q.is_correct} → ${newCorrect}${unrecognized ? '（未识别，交人工）' : ''}`
  )
  console.log(`     答案=${JSON.stringify(q.answer)}`)
  console.log(`     学生=${JSON.stringify(q.student_answer)}  status=${q.status}`)
  if (!jChg) continue

  if (APPLY) {
    const r = await finalizeRejudgeResult({
      question: q,
      isCorrect: newCorrect,
      oldIsCorrect: q.is_correct,
      source: 'regrade_script'
    })
    console.log(`     → finalizeRejudgeResult: ${JSON.stringify(r)}`)
  }
  changed++
}

console.log(`\n${APPLY ? '✅ 已写库' : '（dry-run：未写库）'} 判定变化 ${changed} 题`)
process.exit(0)
