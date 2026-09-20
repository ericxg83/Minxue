/** Q6 折纸图精确重裁 v3 (2026-09-18)
 *
 * OCR(本地 rapidocr, 已修正坐标)确认真实版面:
 *   y906-993  题干两行
 *   y1000-1215 折纸图(左矩形+中分线+右阴影块+右上数字标注 x1176-1405)
 *   y1218-1238 选项 A/B/C/D
 *   y1293     二、填空题标题
 * 上一版 v2 裁框 {595,1005,480,285} 问题: 左侧矩形(x380-595)与右上标注(x1075-1405)被切,
 *   且底部 y1218-1290 带进了选项 C —— OCR 在裁图内识别到 "C.4-/5"。
 * 本版按完整范围 x330-1410, y1005-1215 直接裁切+trim。
 */
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'
import sharp from 'sharp'
import { uploadFile } from '../services/ossService.js'
import { syncQuestionCompleteness } from '../services/questionCompletenessSync.js'

const APPLY = process.argv.includes('--apply')
const QID = 'c6cde3ec-1ea2-4ceb-b38b-43bf2d6b72d4'
const STUDENT = '5c7a5ea1-d46b-40f1-a80b-a424aabe7303'
const TASK = '9eff748b-3cfb-4a23-83ea-233d2731e2bf'
const PAGE_NO = 1

// 折纸图完整范围(x330-1410, y1005-1215) + 少量安全边距
const PX = { x: 330, y: 1005, width: 1080, height: 210 }

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const { rows: [r] } = await pool.query(
  `SELECT id, student_id, question_number, image_bbox, geometry_image_url FROM questions WHERE id = $1`, [QID])

const { rows: [t] } = await pool.query(`SELECT images FROM tasks WHERE id = $1`, [TASK])
const imgs = typeof t.images === 'string' ? JSON.parse(t.images) : (t.images || [])
const page = imgs.find(i => Number(i.page_number) === PAGE_NO) || imgs[0]
console.log(`题号 ${r.question_number} 旧 bbox: ${JSON.stringify(r.image_bbox)}`)
console.log(`页图: ${page.image_url}`)

const pageBuf = Buffer.from(await (await fetch(page.image_url)).arrayBuffer())
const meta = await sharp(pageBuf).metadata()
if (meta.width !== 1650) console.log(`⚠️ 页图尺寸 ${meta.width}x${meta.height}, 与预期 1650x2200 不同`)

const left = Math.max(0, PX.x)
const top = Math.max(0, PX.y)
const width = Math.min(meta.width - left, PX.width)
const height = Math.min(meta.height - top, PX.height)
console.log(`裁切框(px): ${JSON.stringify({ left, top, width, height })}`)

const norm = {
  x: Math.round(left / meta.width * 1000),
  y: Math.round(top / meta.height * 1000),
  width: Math.round(width / meta.width * 1000),
  height: Math.round(height / meta.height * 1000),
}
console.log(`归一化 bbox: ${JSON.stringify(norm)}`)

if (!APPLY) {
  const preview = `backups/figure-preview/q6_v3_${Date.now()}.png`
  fs.mkdirSync('backups/figure-preview', { recursive: true })
  await sharp(pageBuf).extract({ left, top, width, height }).resize({ width: 1200 }).png().toFile(preview)
  console.log(`DRY-RUN 预览 → ${preview}`)
  await pool.end()
  process.exit(0)
}

let out = await sharp(pageBuf)
  .extract({ left, top, width, height })
  .trim({ threshold: 10 })
  .png()
  .toBuffer()
const outMeta = await sharp(out).metadata()
if (outMeta.width < 800 || outMeta.height < 800) {
  const scale = Math.max(800 / outMeta.width, 800 / outMeta.height)
  const nw = Math.min(2400, Math.round(outMeta.width * scale))
  const nh = Math.min(2400, Math.round(outMeta.height * scale))
  out = await sharp(out).resize(nw, nh, { fit: 'fill' }).png().toBuffer()
}
const outM2 = await sharp(out).metadata()
console.log(`裁切+trim后: ${outM2.width}x${outM2.height}`)

const url = await uploadFile(out, 'png', 'images', STUDENT)
console.log(`已上传 → ${url}`)

await pool.query(
  `UPDATE questions SET geometry_image_url = $2, image_bbox = $3, updated_at = NOW() WHERE id = $1`,
  [QID, url, JSON.stringify(norm)])
console.log('✅ 已写库 geometry_image_url + image_bbox')

const { checked, updated } = await syncQuestionCompleteness([QID])
console.log(`🧮 is_complete 回填: 检查 ${checked} 题、更新 ${updated} 题`)

await pool.end()