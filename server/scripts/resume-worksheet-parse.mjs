/**
 * 断点续跑练习册答案解析（**不清库**，从指定页继续；与 rerun-worksheet-parse.mjs 的区别）
 *
 * 为什么需要（2026-09-15 八上数学_上海作业 事故）：
 *   全量重跑开头 clearWorksheetAnswers，若中段配额耗尽/进程中断，已完成批次的干净数据
 *   会被下一次全量重跑再次清掉重算，白烧配额。本脚本保留已有数据，只补缺失页：
 *   - 页 1~30 已用修复后解析器入库（506 条，25 单元，伪单元已清零）
 *   - 缺失 = 页 27~56（21.3(1) 起到书尾，含期末测试(一)/(二)）
 *
 * 用法:
 *   node scripts/resume-worksheet-parse.mjs --worksheet=<id或前缀> --from-page=27 \
 *        [--to-page=56] [--carry-unit=<unit_key>] [--dry]
 *
 * --carry-unit：起始页可能处于上一单元的续页（无标题行），指定其 unit_key 让续页答案
 *               正确挂靠（如 '阶段练习2(21.1~21.2)'）。不指定则起始页的无标题答案挂空。
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })

const arg = (name) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(`--${name}=`.length) || null
const DRY = process.argv.includes('--dry')
const WS_PREFIX = arg('worksheet')
const FROM_PAGE = parseInt(arg('from-page'), 10) || 1
const TO_PAGE = parseInt(arg('to-page'), 10) || null
const CARRY_UNIT = arg('carry-unit')

if (!WS_PREFIX) { console.error('❌ 缺少 --worksheet=<id或前缀>'); process.exit(1) }

const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const { rows } = await pool.query(
  `SELECT id, name, pdf_url, parse_status, answer_count, parse_total_pages, parse_done_pages
   FROM worksheets WHERE id::text LIKE $1`, [WS_PREFIX + '%'])
if (rows.length !== 1) { console.error(`❌ worksheet 前缀 ${WS_PREFIX} 匹配到 ${rows.length} 条`); await pool.end(); process.exit(1) }
const w = rows[0]
console.log('\n===== 断点续跑练习册解析 =====')
console.log(`  worksheet = ${w.id}  ${w.name}`)
console.log(`  当前状态  = ${w.parse_status}  已有答案 ${w.answer_count} 条  进度 ${w.parse_done_pages}/${w.parse_total_pages}`)
console.log(`  续跑区间  = 页 ${FROM_PAGE} ~ ${TO_PAGE || w.parse_total_pages}  carry-unit=${CARRY_UNIT || '(无)'}`)
if (!w.pdf_url) { console.error('❌ pdf_url 为空'); await pool.end(); process.exit(1) }
if (DRY) { console.log('\n--dry：仅诊断，不执行。'); await pool.end(); process.exit(0) }

console.log('\n[1/4] 下载 PDF...')
const buf = Buffer.from(await (await fetch(w.pdf_url)).arrayBuffer())
console.log(`      ${(buf.length / 1024 / 1024).toFixed(1)} MB`)
const { getPdfPageCount, renderPdfToJpegs } = await import('../services/pdfService.js')
const totalPages = TO_PAGE ? Math.min(TO_PAGE, await getPdfPageCount(buf)) : await getPdfPageCount(buf)

const { uploadImage } = await import('../services/ossService.js')
const { callVisionCompletion } = await import('../config/ai.js')
const { ANSWER_OCR_SYSTEM_PROMPT } = await import('../routes/worksheets.js')
const {
  updateWorksheetParseStatus, updateWorksheetParseProgress, upsertWorksheetAnswers,
  updateWorksheetAnswerCount, upsertResourceUnitPageRanges,
} = await import('../services/neonService.js')
const { parseAnswerText } = await import('../services/answerParseService.js')

const BATCH = 15
const OCR_CONCURRENCY = Math.max(1, parseInt(process.env.OCR_PAGE_CONCURRENCY, 10) || 3)
const failedPages = []
let carryState = CARRY_UNIT
  ? { unit: { unit_key: CARRY_UNIT, unit_title: CARRY_UNIT, lesson_code: null, ordinal: null }, group: null, pageRanges: new Map() }
  : null
const t0 = Date.now()
let anySaved = false

await updateWorksheetParseStatus(w.id, { status: 'parsing' })

const ocrOne = async (imgBuffer, realPage) => {
  const url = await uploadImage(imgBuffer, `resume_p${realPage}.jpg`, 'system')
  const call = () => callVisionCompletion({
    imageDataURL: url,
    systemPrompt: ANSWER_OCR_SYSTEM_PROMPT,
    userText: '请提取这份练习册答案中的所有单元标题、题号和对应答案。',
    temperature: 0.0,
    maxTokens: 8192,
    noBackup: true,
  })
  let content = ''
  try { content = (await call()).content || '' } catch (e) {
    console.warn(`[续跑] 页 ${realPage} 首试失败: ${e.message}，重试 1 次`)
    try { content = (await call()).content || '' } catch (e2) {
      console.error(`[续跑] 页 ${realPage} 重试仍失败: ${e2.message}`)
    }
  }
  if (!(content || '').trim()) { failedPages.push(realPage); return null }
  return content
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i) }
  })
  await Promise.all(workers)
  return results
}

for (let start = FROM_PAGE; start <= totalPages; start += BATCH) {
  const end = Math.min(start + BATCH - 1, totalPages)
  console.log(`\n[2/4] 渲染 + OCR 页 ${start}-${end} / ${totalPages}`)
  const { images } = await renderPdfToJpegs(buf, { scale: 3, startPage: start, endPage: end, maxPages: BATCH })
  const contents = await mapWithConcurrency(images, OCR_CONCURRENCY, (img, i) => ocrOne(img, start + i))

  console.log(`[3/4] 解析页 ${start}-${end} 并入库`)
  for (let i = 0; i < contents.length; i++) {
    const realPage = start + i
    const content = contents[i]
    if (content == null) continue // 失败页跳过（已登记）
    const parsed = parseAnswerText(content, [], carryState, realPage)
    carryState = parsed.lastState
    if (parsed.answers.length > 0) {
      await upsertWorksheetAnswers(w.id, parsed.answers)
      anySaved = true
      console.log(`  页 ${realPage}: +${parsed.answers.length} 条`)
    } else {
      console.log(`  页 ${realPage}: 0 条`)
    }
  }
  await updateWorksheetParseProgress(w.id, { totalPages: w.parse_total_pages || totalPages, donePages: end })
}

// 单元页范围落库（顺带修复此前 answer_page_start/end 全 null 的遗留）
try {
  const ranges = []
  for (const [key, r] of (carryState?.pageRanges?.entries?.() || [])) {
    if (!key || r?.start == null) continue
    const end2 = r.end != null ? r.end : totalPages
    if (end2 >= r.start) ranges.push({ unit_key: key, answer_page_start: r.start, answer_page_end: end2 })
  }
  if (ranges.length > 0) await upsertResourceUnitPageRanges(w.id, ranges)
} catch (e) { console.warn('页范围落库失败（不影响答案）:', e.message) }

const failedMsg = failedPages.length
  ? `第 ${failedPages.join('、')} 页 OCR 失败，对应页答案缺失`
  : null
await updateWorksheetParseStatus(w.id, {
  status: failedPages.length && !anySaved ? 'failed' : 'done',
  warning: failedMsg,
  error: null,
})
await updateWorksheetAnswerCount(w.id)

const after = await pool.query(
  `SELECT parse_status, parse_count, answer_count, parse_done_pages, parse_total_pages,
          left(coalesce(parse_warning,''),200) AS parse_warning FROM worksheets WHERE id=$1`, [w.id])
console.log(`\n✅ 续跑结束，耗时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`)
console.log('最终状态:', JSON.stringify(after.rows[0], null, 1))
if (failedPages.length) console.log(`⚠️ 失败页: ${failedPages.join('、')}（可再次运行本脚本仅补这些页）`)
await pool.end()
process.exit(0)
