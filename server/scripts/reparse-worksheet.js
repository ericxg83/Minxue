/**
 * 一次性脚本：用已存 OSS PDF 重跑练习册答案解析（单元级重构后的验证用）
 * 用法：node scripts/reparse-worksheet.js <worksheetId>
 * 走与线上完全相同的 doParseOcrBatched 分批链路（清库→分批 OCR→增量写库→状态收尾）。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const { query } = await import('../config/neon.js')
const { getPdfPageCount } = await import('../services/pdfService.js')
const { doParseOcrBatched } = await import('../routes/worksheets.js')
const { updateWorksheetParseStatus } = await import('../services/neonService.js')

const worksheetId = process.argv[2]
if (!worksheetId) {
  console.error('用法: node scripts/reparse-worksheet.js <worksheetId>')
  process.exit(1)
}

const { rows: [w] } = await query('SELECT id, name, pdf_url FROM resources WHERE id = $1', [worksheetId])
if (!w?.pdf_url) {
  console.error('练习册不存在或无 pdf_url')
  process.exit(1)
}
console.log(`[重解析] ${w.name} (${w.id})`)

const buf = Buffer.from(await (await fetch(w.pdf_url)).arrayBuffer())
console.log(`[重解析] PDF 已下载 ${(buf.length / 1024 / 1024).toFixed(1)} MB`)
const totalPages = await getPdfPageCount(buf)
console.log(`[重解析] 共 ${totalPages} 页，开始分批解析`)

await updateWorksheetParseStatus(worksheetId, { status: 'parsing' })
try {
  await doParseOcrBatched(worksheetId, buf, totalPages, null)
  console.log('[重解析] 完成')
} catch (e) {
  console.error('[重解析] 失败:', e.message)
  await updateWorksheetParseStatus(worksheetId, { status: 'failed', error: e.message }).catch(() => {})
  process.exit(1)
}
process.exit(0)
