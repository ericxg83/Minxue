/**
 * 本地直接调用 processWorkbookGrading 重跑指定 workbook 任务（**不走 Redis 队列**）
 *
 * 为什么需要它：
 *   Redis(Upstash) 与 Neon 库都是云端共享的，线上 Render 的 worker 也在消费同一个
 *   `task-processing` 队列。本地 `queue.add()` 入队的作业很可能被线上 worker 抢走，
 *   而线上跑的是已部署的代码 —— 本地新改的逻辑（如 forceUnitId）不会生效，
 *   表现为"作业 completed 但结果没变、本地日志里连'收到任务'都没有"。
 *   本脚本绕过队列，在本机进程内直接执行评分函数，保证跑的就是本机这份代码。
 *
 * 动作：
 *   1) 从 DB 读任务（images 多页数组 / student_id / worksheet_id / task_type / original_name）
 *   2) 构造与 index.js 正常上传完全一致的 job.data，附加可选 forceUnitId
 *   3) 直接 await processWorkbookGrading(job)（内部会 deleteQuestionsByTaskId 删题重建）
 *
 * ⚠️ 破坏性：会删题重建。执行前请用 backup-before-workbook-retry.mjs 备份。
 *
 * 用法:
 *   node server/scripts/rerun-workbook-direct.mjs --task=<id前缀> [--force-unit=<unit_key|UUID>] [--dry]
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })

const arg = (name) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(`--${name}=`.length) || null
const DRY = process.argv.includes('--dry')
const TASK_PREFIX = arg('task')
const FORCE_UNIT = arg('force-unit')

if (!TASK_PREFIX) {
  console.error('❌ 缺少 --task=<id前缀>')
  process.exit(1)
}

const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const { rows } = await pool.query(
  `SELECT id, status, image_url, images, student_id, original_name, task_type, worksheet_id, resource_id,
          (SELECT COUNT(*)::int FROM questions WHERE task_id = tasks.id) AS q_rows
   FROM tasks WHERE id::text LIKE $1`,
  [TASK_PREFIX + '%']
)
if (rows.length === 0) { console.error(`❌ 未找到任务 ${TASK_PREFIX}`); process.exit(1) }
if (rows.length > 1) { console.error(`❌ 前缀 ${TASK_PREFIX} 匹配到多个任务`); process.exit(1) }
const t = rows[0]

const images = Array.isArray(t.images) ? t.images : []
console.log('\n===== 本地直调重跑 =====')
console.log(`  taskId      = ${t.id}`)
console.log(`  status      = ${t.status}   已有题数 = ${t.q_rows}`)
console.log(`  task_type   = ${t.task_type}   worksheet_id = ${t.worksheet_id || '(null)'}`)
console.log(`  pages       = ${images.length}`)
console.log(`  forceUnit   = ${FORCE_UNIT || '(不指定)'}`)

if (!images.length) {
  console.error('❌ tasks.images 为空，无法多页重跑（只跑单页会丢题）')
  process.exit(1)
}
if (t.task_type !== 'workbook' || !t.worksheet_id) {
  console.error(`❌ 该任务不是 workbook 任务（task_type=${t.task_type}），不应走 processWorkbookGrading`)
  process.exit(1)
}

const job = {
  data: {
    taskId: t.id,
    studentId: t.student_id,
    imageUrl: t.image_url,
    images,
    originalName: t.original_name,
    generatedExamId: null,
    taskType: t.task_type,
    worksheetId: t.worksheet_id,
    resourceId: t.resource_id || null,
    ...(FORCE_UNIT ? { forceUnitId: FORCE_UNIT } : {})
  }
}

if (DRY) {
  console.log('\n--dry：不执行。将构造的 job.data：')
  console.log(JSON.stringify({ ...job.data, images: `[${images.length} 页]` }, null, 2))
  await pool.end()
  process.exit(0)
}

// 先重置为 pending，避免列表页显示旧结论
await pool.query(`UPDATE tasks SET status = 'pending', result = NULL, last_error = NULL WHERE id = $1`, [t.id])

console.log('\n开始执行（本机代码）...')
const { processWorkbookGrading } = await import('../worker.js')
const t0 = Date.now()
try {
  await processWorkbookGrading(job)
  console.log(`\n✅ 执行完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
} catch (e) {
  console.error('\n❌ 执行失败:', e?.message)
  console.error(e?.stack?.split('\n').slice(0, 5).join('\n'))
}

const after = await pool.query(`SELECT status, result FROM tasks WHERE id = $1`, [t.id])
const res = after.rows[0].result || {}
console.log(`\n结果: status=${after.rows[0].status} matchedCount=${res.matchedCount ?? '?'} pendingCount=${res.pendingCount ?? '?'} emptyCount=${res.emptyCount ?? '?'} wrongCount=${res.wrongCount ?? '?'}`)
if (res.sectionMatch?.pages) {
  for (const p of res.sectionMatch.pages) {
    console.log(`  页${p.page_number}: title=${JSON.stringify(p.page_title)} unit=${JSON.stringify(p.matched_unit)} method=${JSON.stringify(p.matched_method)} 题数=${p.question_count}`)
  }
}
const cnt = await pool.query(`SELECT answer_source, COUNT(*)::int AS n FROM questions WHERE task_id=$1 GROUP BY answer_source`, [t.id])
console.log('answer_source:', cnt.rows.map(r => `${r.answer_source}=${r.n}`).join('  '))

await pool.end()
process.exit(0)
