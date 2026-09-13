/**
 * backfill-retry-student-answer.mjs — 存量回填：重练卷「学生答案」快照修复
 *
 * 背景（2026-09-13）：
 *   slim 重批管线修复对位错位（commit 0fd5b4e）后，判题用的学生答案已按卷面题号
 *   对齐并存进 tasks.result.retryAlign，is_correct/confidence 也已按新判定回写；
 *   但 questions.student_answer 一直没被回写 —— 批改页「学生答案」展示的仍是
 *   这道题进错题本时原作业的旧答案，且人工重判接口按 questions.student_answer
 *   判题，旧值会让改判结果错。worker.js 代码已补回写；本脚本负责存量数据。
 *
 * 数据源：tasks.result.retryAlign（matchedBy != 'none' 的记录带学生答案；
 *   matchedBy = 'none' 表示未作答/漏识别，回写空串，与 worker 新逻辑一致）。
 *
 * 用法：
 *   node server/scripts/backfill-retry-student-answer.mjs           # dry-run，只打印
 *   node server/scripts/backfill-retry-student-answer.mjs --apply   # 实际写库（先落 JSON 快照）
 *
 * 幂等：重复执行结果一致；已与新逻辑一致的行会被跳过。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const APPLY = process.argv.includes('--apply')

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
const q = async (sql, params) => (await pool.query(sql, params)).rows

const parseResult = (raw) => {
  if (!raw) return null
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return null }
}

// 1. 找所有带 retryAlign 的答卷任务（重练卷）
const tasks = await q(`
  SELECT id, generated_exam_id, result
  FROM tasks
  WHERE generated_exam_id IS NOT NULL
    AND deleted_at IS NULL
    AND result ? 'retryAlign'
  ORDER BY created_at
`)

console.log(`带 retryAlign 的重练答卷任务：${tasks.length} 份`)

const updates = [] // { taskId, examId, questionId, label, matchedBy, oldAnswer, newAnswer }
for (const t of tasks) {
  const result = parseResult(t.result)
  const align = Array.isArray(result?.retryAlign) ? result.retryAlign : []
  for (const rec of align) {
    if (!rec?.questionId) continue
    // matchedBy='none' → 未作答，回写空串；其余用对位记录里的学生答案
    const newAnswer = rec.matchedBy === 'none' ? '' : String(rec.studentAnswer ?? '').trim()
    updates.push({
      taskId: t.id,
      examId: t.generated_exam_id,
      questionId: rec.questionId,
      label: rec.label,
      matchedBy: rec.matchedBy ?? null,
      newAnswer,
    })
  }
}

if (updates.length === 0) {
  console.log('没有需要回填的记录。')
  await pool.end()
  process.exit(0)
}

// 2. 读当前值，筛出真正有差异的行
const ids = [...new Set(updates.map((u) => u.questionId))]
const rows = await q(
  `SELECT id, student_answer, is_correct, confidence FROM questions WHERE id = ANY($1::uuid[])`,
  [ids]
)
const current = new Map(rows.map((r) => [r.id, r]))

const pending = []
for (const u of updates) {
  const cur = current.get(u.questionId)
  if (!cur) {
    console.warn(`⚠️ 题目行不存在，跳过：${u.questionId}（卷面 ${u.label}）`)
    continue
  }
  u.oldAnswer = cur.student_answer ?? null
  u.oldIsCorrect = cur.is_correct
  u.oldConfidence = cur.confidence
  if ((u.oldAnswer ?? '') === u.newAnswer) continue // 已一致，幂等跳过
  pending.push(u)
}

console.log(`对位记录共 ${updates.length} 条，其中 student_answer 需回填 ${pending.length} 条：\n`)
for (const u of pending) {
  const oldShow = u.oldAnswer === null ? '(null)' : `"${String(u.oldAnswer).slice(0, 40)}"`
  const newShow = u.newAnswer === '' ? '(空串=未作答)' : `"${u.newAnswer.slice(0, 40)}"`
  console.log(`  卷 ${String(u.examId).slice(0, 8)} 卷面${u.label} [${u.matchedBy}] ${oldShow} → ${newShow}`)
}

if (!APPLY) {
  console.log('\n[dry-run] 未写库。确认无误后加 --apply 执行。')
  await pool.end()
  process.exit(0)
}

// 3. 写库前快照
const snapshot = {
  createdAt: new Date().toISOString(),
  note: '回填 questions.student_answer 前的原始值（重练卷学生答案快照修复）',
  rows: pending.map((u) => ({
    questionId: u.questionId,
    taskId: u.taskId,
    examId: u.examId,
    label: u.label,
    oldStudentAnswer: u.oldAnswer,
    oldIsCorrect: u.oldIsCorrect,
    oldConfidence: u.oldConfidence,
    newStudentAnswer: u.newAnswer,
  })),
}
const backupDir = 'D:/Minxue_App_V3/server/backups'
fs.mkdirSync(backupDir, { recursive: true })
const backupPath = path.join(backupDir, `retry-student-answer-backup-${Date.now()}.json`)
fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2))
console.log(`\n已落快照：${backupPath}`)

// 4. 逐条回填（小批量语义，出错即停）
let ok = 0
for (const u of pending) {
  try {
    await q(
      `UPDATE questions SET student_answer = $1, updated_at = NOW() WHERE id = $2`,
      [u.newAnswer, u.questionId]
    )
    ok++
  } catch (e) {
    console.error(`✗ 写入失败 q=${u.questionId.slice(0, 8)}: ${e.message}（已停，已写 ${ok}/${pending.length}，可用快照回滚）`)
    break
  }
}
console.log(`\n完成：${ok}/${pending.length} 条已回填。`)

await pool.end()
