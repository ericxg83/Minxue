/**
 * 本地直接调用 processSlimGrading 重跑指定错题重练批改任务（**不走 Redis 队列**）
 *
 * 背景：Redis(Upstash) 与 Neon 都是云端共享，线上 Render worker 也消费同一队列；
 * 本地入队的作业可能被线上旧代码抢走。本脚本在本机进程内直调，保证跑的是本机代码。
 *
 * [2026-09-13] 用途：slim 管线多页 OCR 修复后，为历史多页答卷重跑补判
 * （此前只 OCR 第 1 页，第 2 页答案从未识别）。
 *
 * 动作：
 *   1) 备份 task.result + 该 task 全部 questions 行 → server/backups/slim-rerun-backup-<ts>.json
 *   2) 构造与正常上传一致的 job.data（含 images 多页数组）
 *   3) 直接 await processSlimGrading(job)
 *
 * 用法:
 *   node server/scripts/rerun-slim-direct.mjs --task=<taskId前缀> [--dry]
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { writeFileSync, mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })

const arg = (name) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(`--${name}=`.length) || null
const DRY = process.argv.includes('--dry')
const TASK_PREFIX = arg('task')

if (!TASK_PREFIX) {
  console.error('❌ 缺少 --task=<taskId前缀>')
  process.exit(1)
}

const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const { rows } = await pool.query(
  `SELECT id, status, image_url, images, student_id, original_name, task_type,
          generated_exam_id, worksheet_id, resource_id, result
   FROM tasks WHERE id::text LIKE $1`,
  [TASK_PREFIX + '%']
)
if (rows.length === 0) { console.error(`❌ 未找到任务 ${TASK_PREFIX}`); process.exit(1) }
if (rows.length > 1) { console.error(`❌ 前缀 ${TASK_PREFIX} 匹配到多个任务`); process.exit(1) }
const t = rows[0]

const images = Array.isArray(t.images) ? t.images : []
const oldResult = typeof t.result === 'string' ? JSON.parse(t.result || '{}') : (t.result || {})
console.log('\n===== slim 直调重跑 =====')
console.log(`  taskId      = ${t.id}`)
console.log(`  examId      = ${t.generated_exam_id}`)
console.log(`  status      = ${t.status}   images 页数 = ${images.length}`)
console.log(`  旧对位: OCR=${oldResult.retryAlignMeta?.ocrCount ?? '?'} 卷面=${oldResult.retryAlignMeta?.paperCount ?? '?'} 未对位=${oldResult.retryAlignMeta?.unmatchedPaper ?? '?'}`)

if (t.task_type !== 'wrong_retry' || !t.generated_exam_id) {
  console.error(`❌ 该任务不是错题重练任务（task_type=${t.task_type}, exam=${t.generated_exam_id}），不应走 processSlimGrading`)
  process.exit(1)
}

const job = {
  data: {
    taskId: t.id,
    studentId: t.student_id,
    imageUrl: t.image_url,
    images: images.length ? images : null,
    originalName: t.original_name,
    generatedExamId: t.generated_exam_id,
    taskType: t.task_type,
    worksheetId: t.worksheet_id || null,
    resourceId: t.resource_id || null,
  },
  updateProgress: async () => {},
}

if (DRY) {
  console.log('\n--dry：不执行。将构造的 job.data：')
  console.log(JSON.stringify({ ...job.data, images: `[${images.length} 页]` }, null, 2))
  await pool.end()
  process.exit(0)
}

// ── 备份（questions 当前判定 + task.result）──
mkdirSync(resolve(__dirname, '..', 'backups'), { recursive: true })
const backupPath = resolve(__dirname, '..', 'backups', `slim-rerun-backup-${Date.now()}.json`)
const { rows: qRows } = await pool.query(
  `SELECT id, student_answer, is_correct, confidence, answer_source, review_status,
          answer_exception_reason, updated_at
   FROM questions WHERE task_id = $1`,
  [t.id]
)
writeFileSync(backupPath, JSON.stringify({
  backedUpAt: new Date().toISOString(),
  taskId: t.id,
  examId: t.generated_exam_id,
  taskResult: oldResult,
  questions: qRows,
}, null, 2))
console.log(`\n📦 已备份 ${qRows.length} 行 questions + task.result → ${backupPath}`)

console.log('\n开始执行（本机代码）...')
const { processSlimGrading } = await import('../worker.js')
const t0 = Date.now()
try {
  await processSlimGrading(job)
  console.log(`\n✅ 执行完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
} catch (e) {
  console.error('\n❌ 执行失败:', e?.message)
  console.error(e?.stack?.split('\n').slice(0, 5).join('\n'))
}

const after = await pool.query(`SELECT status, result FROM tasks WHERE id = $1`, [t.id])
const res = typeof after.rows[0].result === 'string' ? JSON.parse(after.rows[0].result || '{}') : (after.rows[0].result || {})
console.log(`\n结果: status=${after.rows[0].status} OCR=${res.retryAlignMeta?.ocrCount ?? '?'} 卷面=${res.retryAlignMeta?.paperCount ?? '?'} ` +
  `页数=${res.retryAlignMeta?.pageCount ?? '?'} 未对位=${res.retryAlignMeta?.unmatchedPaper ?? '?'} ` +
  `自动判定=${res.autoCount ?? '?'} 需人工=${res.manualCount ?? '?'} 空白=${res.emptyCount ?? '?'}`)

const { rows: afterQ } = await pool.query(
  `SELECT is_correct, COUNT(*)::int AS n FROM questions WHERE task_id = $1 GROUP BY is_correct ORDER BY is_correct NULLS LAST`,
  [t.id]
)
console.log('is_correct 分布:', afterQ.map(r => `${r.is_correct === null ? '未判定' : r.is_correct}=${r.n}`).join('  '))

await pool.end()
process.exit(0)
