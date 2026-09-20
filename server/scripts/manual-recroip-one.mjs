// 单题人工标定补裁：走生产同款 cropAndUploadGeometryImage（含净化/纠偏/上传）
// 用途：自动流程的模型框被收紧判定拦下（框错/框到文字）时，由人工核对原页图后
// 给出精确像素框，仍复用生产裁剪链路，不绕过净化，不手写 OSS URL。
//
// 用法：node scripts/manual-recroip-one.mjs --qid <id前缀> --box x,y,w,h [--apply]
// 坐标空间：原页图【像素】坐标（脚本内部换算成归一化 0-1000 写入 image_bbox）
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import sharp from 'sharp'
import { cropAndUploadGeometryImage, isDegenerateFigureBox, clampImageBboxToBlock } from '../worker.js'
import { syncQuestionCompleteness } from '../services/questionCompletenessSync.js'

const argv = process.argv.slice(2)
const arg = (name, def = null) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const APPLY = argv.includes('--apply')
const QID = arg('qid')
const BOX = (arg('box') || '').split(',').map(Number)

if (!QID || BOX.length !== 4 || !BOX.every(Number.isFinite)) {
  console.error('用法: node scripts/manual-recroip-one.mjs --qid <id前缀> --box x,y,w,h [--apply]')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const { rows } = await pool.query(
  `SELECT q.id, q.student_id, q.question_number, q.sub_no, q.page_number,
          q.content, q.parent_stem, q.geometry_image_url, q.image_url,
          q.image_type, q.block_coordinates, t.images AS task_images
     FROM questions q
     LEFT JOIN tasks t ON t.id = q.task_id
    WHERE q.id::text LIKE $1`,
  [`${QID}%`]
)
if (rows.length !== 1) { console.error(`命中 ${rows.length} 条，需唯一。`); await pool.end(); process.exit(1) }

const r = rows[0]
let imgs = r.task_images
if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs) } catch { imgs = null } }
const pgNo = r.page_number || 1
const url = (imgs || []).find(x => Number(x?.page_number) === pgNo)?.image_url || r.image_url || (imgs || [])[0]?.image_url
if (!url) { console.error('无页图 URL'); await pool.end(); process.exit(1) }

const pageBuf = Buffer.from(await (await fetch(url)).arrayBuffer())
const meta = await sharp(pageBuf).metadata()
const [bx, by, bw, bh] = BOX

console.log('题ID      :', r.id)
console.log('题号      :', r.question_number, r.sub_no ? `(${r.sub_no})` : '', '| page:', pgNo)
console.log('content   :', r.content)
console.log('页图尺寸  :', meta.width, 'x', meta.height)
console.log('人工框(px):', JSON.stringify({ x: bx, y: by, width: bw, height: bh }))

const norm = {
  x: Math.round(bx / meta.width * 1000),
  y: Math.round(by / meta.height * 1000),
  width: Math.round(bw / meta.width * 1000),
  height: Math.round(bh / meta.height * 1000),
}
console.log('归一化框  :', JSON.stringify(norm))

if (isDegenerateFigureBox(norm, r.block_coordinates)) {
  console.error('⛔ 退化框/与题干框重合，拒绝写入')
  await pool.end(); process.exit(1)
}
const safe = clampImageBboxToBlock(norm, r.block_coordinates)
if (!safe) { console.error('⛔ 框与题干框完全对不上，拒绝写入'); await pool.end(); process.exit(1) }
console.log('过闸后框  :', JSON.stringify(safe))

if (!APPLY) {
  const previewPath = `D:/Minxue_App_V3/server/backups/figure-preview/manual_${r.id.slice(0, 8)}.png`
  fs.mkdirSync(path.dirname(previewPath), { recursive: true })
  await sharp(pageBuf).extract({
    left: Math.max(0, bx), top: Math.max(0, by),
    width: Math.min(meta.width - bx, bw), height: Math.min(meta.height - by, bh),
  }).resize({ width: 900 }).png().toFile(previewPath)
  console.log(`DRY-RUN 预览 → ${previewPath}`)
  await pool.end()
  process.exit(0)
}

const upUrl = await cropAndUploadGeometryImage(pageBuf, { x: bx, y: by, width: bw, height: bh }, r.student_id, r.id)
if (!upUrl) { console.error('⛔ 生产线裁剪失败/收紧判定拦下'); await pool.end(); process.exit(1) }

await pool.query(
  `UPDATE questions SET geometry_image_url = $2, image_type = COALESCE(image_type, 'geometry'),
          image_bbox = $3, updated_at = NOW() WHERE id = $1`,
  [r.id, upUrl, JSON.stringify(safe)]
)
console.log('✅ 已裁并写库 →', upUrl)

const { checked, updated } = await syncQuestionCompleteness([r.id])
console.log(`🧮 is_complete 回填：检查 ${checked} 题、更新 ${updated} 题`)

await pool.end()
