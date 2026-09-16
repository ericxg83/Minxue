/**
 * 收尾对账（2026-09-16）：参考答案重对齐后，同步两处下游数据
 *
 * 背景：realign-task-answers-from-bank.mjs 只改 questions.answer / is_correct，
 * 不碰 tasks.result 缓存，也不碰错题本 —— 于是会出现典型的「界面说成功、库里没同步」：
 *   ① 批改中心顶部仍显示旧的「AI判错 15」（tasks.result.wrongCount 是缓存）；
 *   ② 错题本里留着「学生答对却被判错」的脏错题（本次实测 陈昊煜 9 条 / 朱思诺 13 条 / 赵安迪 12 条），
 *      学生会被要求重练自己做对的题。
 *
 * 本脚本对指定任务做：
 *   1. 用 computeTaskStats（与复核页/worker 同一套分桶）重算 tasks.result 四桶；
 *   2. 删除错题本里**当前判定为对**（is_correct = true）的脏记录（先备份到 server/backups/）。
 *      判定为 null（待人工/未作答）的记录一律保留 —— 归属仍由老师定夺。
 *
 * 用法：
 *   node server/scripts/reconcile-wrongbook-after-realign-20260916.mjs --task=0e1d4de7 --task=cc7a292b --apply
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { computeTaskStats } from '../utils/taskStats.js'

const APPLY = process.argv.includes('--apply')
const TASKS = process.argv.filter(a => a.startsWith('--task=')).map(a => a.slice(7))
if (!TASKS.length) { console.error('❌ 需要至少一个 --task=<前缀>'); process.exit(1) }

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await pool.query(s, p)).rows

const ids = []
for (const prefix of TASKS) {
  const rows = await q(`SELECT id FROM tasks WHERE id::text LIKE $1`, [prefix + '%'])
  if (rows.length !== 1) { console.error(`❌ 前缀 ${prefix} 匹配 ${rows.length} 条`); process.exit(1) }
  ids.push(rows[0].id)
}
const students = await q(
  `SELECT t.id, s.name FROM tasks t JOIN students s ON s.id=t.student_id WHERE t.id = ANY($1::uuid[])`, [ids])
const nameOf = new Map(students.map(r => [r.id, r.name]))

console.log('\n===== 0. 恢复被洗掉的 answer_source=\'blank\'（学生未作答）=====')
const blankCand = await q(`
  SELECT qq.id, qq.question_number, s.name AS student_name
  FROM questions qq JOIN tasks t ON t.id = qq.task_id JOIN students s ON s.id = t.student_id
  WHERE qq.task_id = ANY($1::uuid[])
    AND (qq.student_answer IS NULL OR btrim(qq.student_answer) = '')
    AND qq.answer_source IS DISTINCT FROM 'blank'`, [ids])
console.log(`  待恢复 ${blankCand.length} 条：` + blankCand.map(b => `${b.student_name}第${b.question_number}题`).join(', ') || '（无）')

console.log('\n===== 1. tasks.result 重算 =====')
const statUpdates = []
for (const id of ids) {
  const rows = await q(`SELECT is_correct, answer_source, review_status, confidence FROM questions WHERE task_id=$1`, [id])
  const stats = computeTaskStats(rows)
  const before = await q(`SELECT result->>'wrongCount' AS w, result->>'emptyCount' AS e, result->>'pendingCount' AS p FROM tasks WHERE id=$1`, [id])
  statUpdates.push({ id, stats, before: before[0] })
  console.log(`  ${(nameOf.get(id) || '').padEnd(5)} 判错 ${before[0].w} → ${stats.wrongCount}   空 ${before[0].e} → ${stats.emptyCount}   待人工 ${before[0].p} → ${stats.pendingCount}   题数 ${stats.questionCount}`)
}

console.log('\n===== 2. 错题本脏记录（当前判定为「对」）=====')
const dirty = await q(`
  SELECT wq.id, wq.student_id, wq.question_id, wq.subject, wq.status, wq.error_count,
         wq.added_at, qq.question_number, s.name AS student_name
  FROM wrong_questions wq
  JOIN questions qq ON qq.id = wq.question_id
  JOIN students s ON s.id = wq.student_id
  WHERE qq.task_id = ANY($1::uuid[]) AND qq.is_correct = true`, [ids])
for (const d of dirty) console.log(`  ${d.student_name} 第${d.question_number}题 (status=${d.status}, error_count=${d.error_count})`)
console.log(`  合计 ${dirty.length} 条`)

// 保留判定为 null 的记录
const kept = await q(`
  SELECT s.name AS student_name, qq.question_number, qq.is_correct
  FROM wrong_questions wq JOIN questions qq ON qq.id = wq.question_id JOIN students s ON s.id=wq.student_id
  WHERE qq.task_id = ANY($1::uuid[]) AND qq.is_correct IS NOT TRUE`, [ids])
console.log(`  保留（判定为 null / false）${kept.length} 条：${kept.map(k => `${k.student_name}${k.question_number}${k.is_correct === null ? '(待人工)' : ''}`).join(', ')}`)

if (!APPLY) { console.log('\n--dry：确认无误后加 --apply'); await pool.end(); process.exit(0) }

// 备份
const outDir = 'D:/Minxue_App_V3/server/backups'
fs.mkdirSync(outDir, { recursive: true })
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dumpFile = path.join(outDir, `wrong-questions-realign-${ts}.json`)
fs.writeFileSync(dumpFile, JSON.stringify({ ts, tasks: ids, removed: dirty, statUpdates: statUpdates.map(s => ({ id: s.id, stats: s.stats, before: s.before })) }, null, 1), 'utf8')
console.log(`\n备份：${dumpFile}`)

// 删脏错题
if (dirty.length) {
  await pool.query(`DELETE FROM wrong_questions WHERE id = ANY($1::uuid[])`, [dirty.map(d => d.id)])
  console.log(`已删除脏错题 ${dirty.length} 条`)
}

// 恢复 blank（必须在统计口径上先于重算，见分桶定义 answer_source==='blank' → empty）
if (blankCand.length) {
  await pool.query(`UPDATE questions SET answer_source='blank' WHERE id = ANY($1::uuid[])`, [blankCand.map(b => b.id)])
  console.log(`已恢复 ${blankCand.length} 条 answer_source=blank`)
}

// 写回统计：必须在「恢复 blank」之后**重新计算**，否则 empty 桶仍按被洗过的
// answer_source 归属（实测把 emptyCount 2/2/3 写成 0/0/0）。
for (const id of ids) {
  const rows = await q(`SELECT is_correct, answer_source, review_status, confidence FROM questions WHERE task_id=$1`, [id])
  const stats = computeTaskStats(rows)
  await pool.query(
    `UPDATE tasks SET result = COALESCE(result,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
    [JSON.stringify({ questionCount: stats.questionCount, wrongCount: stats.wrongCount, emptyCount: stats.emptyCount, pendingCount: stats.pendingCount }), id])
  console.log(`已重算 ${nameOf.get(id)} 的任务统计：判错 ${stats.wrongCount} / 空 ${stats.emptyCount} / 待人工 ${stats.pendingCount} / 题数 ${stats.questionCount}`)
}

await pool.end()
