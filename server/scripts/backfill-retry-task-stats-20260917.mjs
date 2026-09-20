/**
 * 一次性回填：重练答卷任务的批改统计（2026-09-17）
 *
 * 背景：`POST /api/tasks/:id/recalculate-stats` 旧实现按 `task_id` 查题目行，
 * 而重练答卷在 questions 表里**没有本卷题行**（题目行是原作业共用行，task_id 指向原作业）
 * ⇒ 恒 0 行 ⇒ 把 questionCount/wrongCount/emptyCount/pendingCount 全写成 0。
 * 实测 5 份 status='reviewed' 的重练卷 result.questionCount 全是 0（老师一点完成复核，
 * 卷面计数就清零）。写入逻辑已随 commit bdebff56 修好，本脚本负责把**存量**补回来。
 *
 * 口径：与接口完全同源 —— 按 `generated_exams.question_ids` 取行 +
 * `server/utils/taskStats.js` 的 computeTaskStats（与批改页 6 态、PC 列表同源）。
 *
 * 写入方式：默认调**线上已部署的接口**（顺带验证上线；接口幂等，值一样不会变）。
 * 只改 tasks.result 里的统计数字，**不碰任何判定 / 掌握度 / 错题本**。
 *
 * 用法：
 *   node server/scripts/backfill-retry-task-stats-20260917.mjs            # dry-run
 *   node server/scripts/backfill-retry-task-stats-20260917.mjs --apply
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import path from 'node:path'
import fs from 'node:fs'
import pg from 'pg'
import { computeTaskStats } from '../utils/taskStats.js'

const APPLY = process.argv.includes('--apply')
const API_BASE = process.env.MINXUE_API_BASE || 'https://minxue-api.onrender.com'
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const { rows: tasks } = await pool.query(`
  SELECT t.id, s.name AS student, t.status, t.generated_exam_id,
         t.result->>'questionCount' AS cur_qc, t.result->>'correctCount' AS cur_correct,
         t.result->>'wrongCount' AS cur_wrong, t.result->>'emptyCount' AS cur_empty,
         t.result->>'pendingCount' AS cur_pending,
         ge.question_ids
  FROM tasks t
  JOIN students s ON s.id = t.student_id
  JOIN generated_exams ge ON ge.id = t.generated_exam_id
  WHERE t.task_type = 'wrong_retry' AND t.deleted_at IS NULL
  ORDER BY t.created_at DESC`)

const qids = [...new Set(tasks.flatMap(t => t.question_ids || []))]
const { rows: qrows } = qids.length
  ? await pool.query(`SELECT id, is_correct, answer_source, review_status, confidence FROM questions WHERE id = ANY($1::uuid[])`, [qids])
  : { rows: [] }
const byId = new Map(qrows.map(r => [r.id, r]))

const plan = []
for (const t of tasks) {
  const rows = (t.question_ids || []).map(id => byId.get(id)).filter(Boolean)
  const stats = computeTaskStats(rows)
  const next = {
    questionCount: stats.questionCount, correctCount: stats.correctCount,
    wrongCount: stats.wrongCount, emptyCount: stats.emptyCount, pendingCount: stats.pendingCount
  }
  const cur = {
    questionCount: Number(t.cur_qc ?? NaN), correctCount: Number(t.cur_correct ?? NaN),
    wrongCount: Number(t.cur_wrong ?? NaN), emptyCount: Number(t.cur_empty ?? NaN),
    pendingCount: Number(t.cur_pending ?? NaN)
  }
  const changed = Object.keys(next).some(k => cur[k] !== next[k])
  plan.push({ task: t, next, cur, changed })
}

console.log(`\n=== 重练答卷任务统计对照（共 ${plan.length} 条）===`)
console.table(plan.map(p => ({
  学生: p.task.student, 状态: p.task.status,
  '现有 题/对/错/空/待': `${p.cur.questionCount}/${p.cur.correctCount}/${p.cur.wrongCount}/${p.cur.emptyCount}/${p.cur.pendingCount}`,
  '应为 题/对/错/空/待': `${p.next.questionCount}/${p.next.correctCount}/${p.next.wrongCount}/${p.next.emptyCount}/${p.next.pendingCount}`,
  需回填: p.changed ? '✔' : ''
})))

const todo = plan.filter(p => p.changed)
console.log(`\n需回填 ${todo.length} 条 / 共 ${plan.length} 条`)

if (!APPLY) {
  console.log('\n[dry-run] 未写库。加 --apply 才执行（走线上接口）。')
  await pool.end()
  process.exit(0)
}

// 备份现有 result 快照
const ts = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = path.resolve(import.meta.dirname, '..', 'backups', `retry-task-stats-${ts}.json`)
fs.mkdirSync(path.dirname(backupPath), { recursive: true })
fs.writeFileSync(backupPath, JSON.stringify(plan.map(p => ({ id: p.task.id, before: p.cur, expected: p.next })), null, 2))
console.log(`\n已备份现状 → ${backupPath}`)

let ok = 0, fail = 0
for (const p of todo) {
  try {
    const resp = await fetch(`${API_BASE}/api/tasks/${p.task.id}/recalculate-stats`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${await resp.text().catch(() => '')}`.slice(0, 160))
    ok++
    console.log(`  ✓ ${p.task.student} ${p.task.id.slice(0, 8)} → 题${p.next.questionCount} 对${p.next.correctCount} 错${p.next.wrongCount} 空${p.next.emptyCount} 待${p.next.pendingCount}`)
  } catch (e) {
    fail++
    console.error(`  ✗ ${p.task.student} ${p.task.id.slice(0, 8)} 回填失败: ${e.message}`)
  }
}
console.log(`\n回填完成：成功 ${ok} / 失败 ${fail}`)

// 复查：重新读库
const { rows: after } = await pool.query(`
  SELECT t.id, t.result->>'questionCount' qc, t.result->>'correctCount' cc,
         t.result->>'wrongCount' wc, t.result->>'emptyCount' ec, t.result->>'pendingCount' pc
  FROM tasks t WHERE t.id = ANY($1::uuid[])`, [todo.map(p => p.task.id)])
let mismatch = 0
for (const row of after) {
  const exp = todo.find(p => p.task.id === row.id)?.next
  const bad = !exp || Number(row.qc) !== exp.questionCount || Number(row.cc || 0) !== exp.correctCount
  if (bad) { mismatch++; console.error(`  ✗ 复查不一致 ${row.id.slice(0, 8)}: 库=${row.qc}/${row.cc}/${row.wc}/${row.ec}/${row.pc}`) }
}
console.log(mismatch === 0 ? '✅ 复查通过：全部与期望一致' : `❌ 复查有 ${mismatch} 条不一致`)
await pool.end()
