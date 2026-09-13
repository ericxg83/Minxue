/**
 * 定向重跑 3 个 workbook 任务的 OCR（拿回 32+ 道缺答案题）
 * 前置：worker.js 路由已修（workbook 分支先于 resourceId 分支）→ 走 processWorkbookGrading
 * 连接：复用 redisManager.getAvailableClient()（与 worker 同一 Redis 实例），避免独立连接写错实例。
 * 动作：
 *   1) 把 3 个任务 status 重置为 pending（绕过 processTask 幂等闸门：done+有题即跳过）
 *   2) 用 BullMQ Queue('task-processing') 入队 process-task 作业（带 images 多页数组 / imageUrl /
 *      studentId / originalName / taskType / worksheetId）。
 *      关键：processWorkbookGrading 只从 job.data.images 读页（不回读 DB tasks.images），
 *            多页任务必须显式传 images 数组，否则只处理第 1 页 → 丢题。
 * 注意：processWorkbookGrading 内部会 deleteQuestionsByTaskId 删题重建，不可逆；
 *       重跑前请确认已用 backup-before-workbook-retry.mjs 备份。
 *
 * 用法:
 *   node server/scripts/rerun-workbook-ocr-3tasks.mjs [选项]
 *     --dry                        仅打印，不写库/不入队
 *     --tasks=<前缀,逗号分隔>       只重跑指定任务（默认 3 个 workbook 任务）
 *     --force-unit=<unit_key|UUID> 把整份扫描钉死到指定单元（人工确认过单元归属时用）
 *
 * --force-unit 适用场景（worker.js forceUnitId）：
 *   扫描页页眉/小标题 OCR 质量差 ⇒ pickAnswerUnit 所有通道都没锚定到正确单元 ⇒
 *   matchedUnit=null ⇒ unitAnswers=null ⇒ 答案指纹/覆盖率兜底全部失效 ⇒ 整页题拿不到答案。
 *   人工已确认该份作业属于某单元时，用它把"单元归属"这一步钉死；
 *   题号/小问/section 匹配与判等口径完全不变，答案仍全部来自 worksheet_answers。
 *   注意：answersByUnit 的键是 unit_key（如 "27.2(2)"），传 UUID 时 worker 会自动反查。
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })

const DRY = process.argv.includes('--dry')
// --tasks=<前缀,逗号分隔>：只重跑指定任务（默认全部 3 个）
const tasksArg = (process.argv.find(a => a.startsWith('--tasks=')) || '').slice('--tasks='.length)
const FORCE_UNIT = (process.argv.find(a => a.startsWith('--force-unit=')) || '').slice('--force-unit='.length) || null
const PREFIXES = tasksArg ? tasksArg.split(',').map(s => s.trim()).filter(Boolean) : null

const ALL_TASKS = [
  '2ed887cd-0dcf-41dd-a7b6-738d0a6230ac',
  '100c18eb-0b3d-48cd-a155-1ad4764a50d0',
  'cd9c22f1-0ba9-473b-ab54-471b657dd3c0'
]
const TASK_IDS = PREFIXES
  ? ALL_TASKS.filter(id => PREFIXES.some(p => id.startsWith(p)))
  : ALL_TASKS
if (PREFIXES && TASK_IDS.length !== PREFIXES.length) {
  console.error(`❌ --tasks 里有前缀没匹配到任务：${PREFIXES.filter(p => !ALL_TASKS.some(id => id.startsWith(p))).join(', ')}`)
  process.exit(1)
}
if (FORCE_UNIT && TASK_IDS.length !== 1) {
  console.error('❌ --force-unit 一次只能作用于 1 个任务（不同作业的单元归属不同，必须分别指定）')
  process.exit(1)
}

const { Pool } = await import('pg')
const { Queue } = await import('bullmq')
const { redisManager } = await import('../redisManager.js')

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

await redisManager.init()
const connection = await redisManager.getAvailableClient()
if (!connection) { console.error('❌ 无可用 Redis 连接'); process.exit(1) }
console.log(`✅ Redis 连接就绪 (实例: ${redisManager.getStats().current})`)

const taskQueue = new Queue('task-processing', { connection })

console.log(`\n===== ${DRY ? 'DRY-RUN(不写库/不入队)' : '应用重跑'} | ${TASK_IDS.length} 个任务${FORCE_UNIT ? ` | forceUnit="${FORCE_UNIT}"` : ''} =====`)
const { rows } = await pool.query(
  `SELECT id, status, image_url, images, student_id, original_name, task_type, worksheet_id,
          (SELECT COUNT(*)::int FROM questions WHERE task_id = tasks.id) AS q_rows
   FROM tasks WHERE id = ANY($1::uuid[])`,
  [TASK_IDS]
)
for (const t of rows) {
  const pages = Array.isArray(t.images) ? t.images.length : 0
  console.log(`  ${t.id}  status=${t.status}  q_rows=${t.q_rows}  pages=${pages}  task_type=${t.task_type}  img=${String(t.image_url).slice(0, 40)}...`)
}

// 去重：队列里已有同 taskId 的 wait/active 作业则跳过，避免重复入队二次覆盖
let existing = []
try { existing = await taskQueue.getJobs(['wait', 'active', 'delayed'], 0, 100) } catch {}
const busyTaskIds = new Set((existing || []).map(j => j?.data?.taskId).filter(Boolean))

if (!DRY) {
  for (const t of rows) {
    const pages = Array.isArray(t.images) ? t.images : null
    if (!pages || pages.length === 0) {
      console.error(`  ⚠️  跳过 ${t.id}：tasks.images 为空，无法多页重跑（会丢页）`)
      continue
    }
    if (busyTaskIds.has(t.id)) {
      console.log(`  ⏭️  跳过 ${t.id}：队列中已有待处理作业，避免重复`)
      continue
    }
    await pool.query(`UPDATE tasks SET status = 'pending', result = NULL, last_error = NULL WHERE id = $1`, [t.id])
    await taskQueue.add('process-task', {
      taskId: t.id,
      studentId: t.student_id,
      imageUrl: t.image_url,
      images: pages,                 // 多页数组：[{page_number, image_url, file_name}]
      originalName: t.original_name,
      taskType: t.task_type,
      worksheetId: t.worksheet_id,
      retryCount: 1,
      ...(FORCE_UNIT ? { forceUnitId: FORCE_UNIT } : {})
    }, {
      attempts: parseInt(process.env.MAX_RETRIES) || 3,
      backoff: { type: 'exponential', delay: 5000 }
    })
    console.log(`  ✅ 已重置为 pending 并入队(${pages.length} 页): ${t.id}`)
  }
}

await taskQueue.close()
await pool.end()
console.log('\n完成。Worker 会自动处理入队的作业，观察 server 日志确认进度。')
process.exit(0)
