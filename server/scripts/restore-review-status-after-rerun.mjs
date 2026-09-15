/**
 * 练习册重跑后恢复老师的复核结论
 *
 * 背景：`rerun-workbook-direct.mjs` 会 deleteQuestionsByTaskId 删题重建，
 * 新行的 `review_status` 一律为 null —— 老师之前逐题点出来的"做对了/做错了"
 * 会全部丢失。而 `review_status` 是人工结论，绝不能被机器流程抹掉（AGENTS.md 纪律）。
 *
 * 本脚本从重跑前的备份 JSON（backup-before-workbook-retry.mjs 产出）里取出
 * 每条题的 `review_status`，按 **(question_number, sub_no)** 映射回新行。
 *
 * ⚠️ 只恢复 `review_status`，不恢复 `is_correct`：
 *    AI 判定必须用修好的答案库重算，把旧判定搬回来等于把旧的错误固化。
 *
 * 用法：
 *   node server/scripts/restore-review-status-after-rerun.mjs --task=da0b3d35 --backup=<json>
 *   node server/scripts/restore-review-status-after-rerun.mjs --task=da0b3d35 --backup=<json> --apply
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'

const arg = (n) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(`--${n}=`.length) || null
const APPLY = process.argv.includes('--apply')
const TASK = arg('task')
const BACKUP = arg('backup')

if (!TASK || !BACKUP) { console.error('❌ 需要 --task=<前缀> --backup=<json路径>'); process.exit(1) }
if (!existsSync(BACKUP)) { console.error('❌ 备份文件不存在:', BACKUP); process.exit(1) }

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await pool.query(s, p)).rows

const taskRow = (await q(`SELECT id FROM tasks WHERE id::text LIKE $1`, [TASK + '%']))
if (taskRow.length !== 1) { console.error(`❌ 任务前缀 ${TASK} 匹配到 ${taskRow.length} 条`); process.exit(1) }
const taskId = taskRow[0].id

const bk = JSON.parse(readFileSync(BACKUP, 'utf8'))
const before = bk.questions.filter(x => x.task_id === taskId && x.review_status != null)
console.log(`\n备份里 ${taskId.slice(0, 8)} 的复核结论：${before.length} 条`)

const now = await q(
  `SELECT id, question_number, sub_no, review_status FROM questions WHERE task_id=$1 ORDER BY question_number::int, sub_no NULLS FIRST`,
  [taskId])

const keyOf = (no, sub) => `${Number(no)}|${(sub == null ? '' : String(sub)).trim()}`
const nowMap = new Map(now.map(r => [keyOf(r.question_number, r.sub_no), r]))

console.log('\n===== 映射结果 =====')
const plan = []
let missing = 0
for (const b of before) {
  const key = keyOf(b.question_number, b.sub_no)
  const target = nowMap.get(key)
  if (!target) { console.log(`  ⚠️ 题${b.question_number}(${b.sub_no ?? '整题'}) 在新结果里找不到对应题，跳过`); missing++; continue }
  console.log(`  题${b.question_number}(${b.sub_no ?? '整题'})  review_status="${b.review_status}"（新行 id=${target.id.slice(0, 8)}）`)
  plan.push({ id: target.id, status: b.review_status })
}
console.log(`\n可恢复 ${plan.length} 条，无法匹配 ${missing} 条`)

if (!APPLY) {
  console.log('\n-- dry-run：确认无误后加 --apply 执行。')
  await pool.end(); process.exit(0)
}

if (!plan.length) { console.log('没有可恢复的记录'); await pool.end(); process.exit(0) }

const c = await pool.connect()
try {
  await c.query('BEGIN')
  for (const p of plan) {
    await c.query(`UPDATE questions SET review_status=$1, updated_at=NOW() WHERE id=$2`, [p.status, p.id])
  }
  await c.query('COMMIT')
  console.log(`\n✅ 已恢复 ${plan.length} 条复核结论`)
} catch (e) {
  await c.query('ROLLBACK')
  console.error('❌ 失败已回滚:', e.message)
} finally { c.release() }

console.log('\n===== 恢复后 =====')
console.table(await q(
  `SELECT question_number AS 题号, sub_no AS 子, review_status AS 复核, is_correct AS AI判定
   FROM questions WHERE task_id=$1 ORDER BY question_number::int, sub_no NULLS FIRST`, [taskId]))

await pool.end()
