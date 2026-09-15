/**
 * 本地重跑练习册答案 PDF 解析（不走 HTTP，不进队列）
 *
 * 为什么需要它：
 *   `POST /worksheets/:id/parse-pdf` 的后台解析任务寄生在 Web 进程内，进程一旦重启
 *   （Render 部署切换 / 实例崩溃），任务被杀但 parse_status 永远停在 'parsing'，
 *   前端一直转圈、重新上传又被 409 拦。夜间补解析服务也跳过 parsing 状态的记录。
 *   本脚本在本机直调 doParseOcrBatched（与线上接口同一实现），不受线上重启影响。
 *
 * 动作：
 *   1) 读 worksheet（pdf_url / parse_status / answer_count）
 *   2) 下载 PDF → 数页数 → 置 parsing + 进度归零
 *   3) doParseOcrBatched：分批渲染 + OCR + 每批增量落库
 *
 * ⚠️ 会先 clearWorksheetAnswers / clearResourceUnits（该 worksheet 既有答案会被清空重建）。
 *
 * 用法:
 *   node server/scripts/rerun-worksheet-parse.mjs --worksheet=<id或前缀> [--dry]
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })

const arg = (name) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(`--${name}=`.length) || null
const DRY = process.argv.includes('--dry')
const WS_PREFIX = arg('worksheet')

if (!WS_PREFIX) {
  console.error('❌ 缺少 --worksheet=<id或前缀>')
  process.exit(1)
}

const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const { rows } = await pool.query(
  `SELECT id, name, pdf_url, parse_status, parse_count, answer_count,
          parse_total_pages, parse_done_pages, updated_at,
          EXTRACT(EPOCH FROM (NOW() - updated_at))::int AS idle_sec
   FROM worksheets WHERE id::text LIKE $1`,
  [WS_PREFIX + '%']
)
if (rows.length === 0) { console.error(`❌ 未找到 worksheet ${WS_PREFIX}`); await pool.end(); process.exit(1) }
if (rows.length > 1) { console.error(`❌ 前缀 ${WS_PREFIX} 匹配到多个：${rows.map(r => r.id).join(', ')}`); await pool.end(); process.exit(1) }
const w = rows[0]

console.log('\n===== 本地重跑练习册解析 =====')
console.log(`  worksheet   = ${w.id}`)
console.log(`  name        = ${w.name}`)
console.log(`  parse_status= ${w.parse_status}   answer_count=${w.answer_count}`)
console.log(`  progress    = ${w.parse_done_pages}/${w.parse_total_pages}`)
console.log(`  updated_at  = ${w.updated_at?.toISOString()}  (${w.idle_sec}s 无推进)`)
console.log(`  pdf_url     = ${w.pdf_url}`)

if (!w.pdf_url) { console.error('❌ pdf_url 为空，无法重跑'); await pool.end(); process.exit(1) }
if (DRY) { console.log('\n--dry：仅诊断，不执行。'); await pool.end(); process.exit(0) }

// 下载 PDF（Node 原生 fetch 不走 HTTP_PROXY，直连 OSS）
console.log('\n[1/3] 下载 PDF...')
const res = await fetch(w.pdf_url)
if (!res.ok) { console.error(`❌ PDF 下载失败 HTTP ${res.status}`); await pool.end(); process.exit(1) }
const fileBuffer = Buffer.from(await res.arrayBuffer())
console.log(`      ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB`)

const { getPdfPageCount } = await import('../services/pdfService.js')
const { updateWorksheetParseStatus, updateWorksheetParseProgress } = await import('../services/neonService.js')
const totalPages = await getPdfPageCount(fileBuffer)
console.log(`      共 ${totalPages} 页`)

console.log('\n[2/3] 置 parsing 并清空进度...')
await updateWorksheetParseStatus(w.id, { status: 'parsing' })
await updateWorksheetParseProgress(w.id, { totalPages, donePages: 0 }).catch(e =>
  console.warn('      清零进度列失败（可能列不存在）:', e.message))

console.log('\n[3/3] 分批渲染 + OCR（增量落库，中断也不丢已完成批次）...')
const { doParseOcrBatched } = await import('../routes/worksheets.js')
const t0 = Date.now()
let ok = true
try {
  await doParseOcrBatched(w.id, fileBuffer, totalPages, null)
  console.log(`\n✅ 解析完成，耗时 ${((Date.now() - t0) / 1000 / 60).toFixed(1)} 分钟`)
} catch (e) {
  ok = false
  console.error(`\n❌ 解析失败: ${e.message}`)
  await updateWorksheetParseStatus(w.id, { status: 'failed', error: e.message }).catch(() => {})
}

const after = await pool.query(
  `SELECT parse_status, parse_count, answer_count, parse_total_pages, parse_done_pages,
          left(coalesce(parse_warning,''), 300) AS parse_warning, parse_error
   FROM worksheets WHERE id=$1`, [w.id])
console.log('\n最终状态:', JSON.stringify(after.rows[0], null, 1))
// ⚠️ resource_answers 是底表，外键列是 resource_id（worksheets/worksheet_answers 才是视图）
const cnt = await pool.query('SELECT count(*)::int AS c FROM resource_answers WHERE resource_id=$1', [w.id])
console.log('resource_answers 行数 =', cnt.rows[0].c)

await pool.end()
process.exit(ok ? 0 : 1)
