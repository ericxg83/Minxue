/**
 * recrop-q22-manual.mjs — 定向修复第22题(7d5fda9a)配图
 *
 * 背景：上次自动补裁模型把框选到了同页第4题的图+手写区域（经典"多图集中一行"排版陷阱：
 * 第2/3/6题图集中排成一行，第6题图是最右那格）。本次由人工在整页图上核实框：
 *   page1 原图 3072x4096，第6题图形外接框 ≈ (1830,1195) 尺寸 450x377
 * 绕过模型框选与 clampImageBboxToBlock（图与题干行框相距远，clamp 必拦），直接走生产
 * cropAndUploadGeometryImage 上传，并写回三列（可整列回滚，先落快照）。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { cropAndUploadGeometryImage } from '../worker.js'

const QID_PREFIX = '7d5fda9a'
// 人工核实的像素框。FIGURE_REFINE=0 时生产函数会外扩 20% padding，
// 故此处预内缩，使「框+20%padding」恰好落在理想图形区 (1830,1195)-(2280,1580)：
//   box.x - 0.2w = 1830, box.y - 0.2h = 1195, box.x + 1.2w = 2280, box.y + 1.2h = 1580
const PX = { x: 1894, y: 1250, width: 321, height: 275 }
const PAGE_URL = 'https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/afae6ef7-d071-42c5-b229-faaef0e443f7/20260908/1d471c73-713f-40ed-9dc7-8bda8e54ed34.jpg'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const rows = (await pool.query(`
  SELECT q.id, q.student_id, q.page_number, q.image_type, q.geometry_image_url, q.image_bbox
  FROM questions q WHERE q.id::text LIKE $1`, [QID_PREFIX + '%'])).rows
if (rows.length !== 1) { console.log('❌ 命中', rows.length, '行，预期 1，终止'); await pool.end(); process.exit(1) }
const q = rows[0]
console.log('目标题:', q.id, '| student:', q.student_id, '| 旧 geometry:', q.geometry_image_url)

// 快照
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const snap = `D:/Minxue_App_V3/server/backups/recrop-q22-manual-${stamp}.json`
fs.mkdirSync(path.dirname(snap), { recursive: true })
fs.writeFileSync(snap, JSON.stringify({ at: new Date().toISOString(), before: q, manualBox: PX, pageUrl: PAGE_URL }, null, 2), 'utf8')
console.log('快照:', snap)

// 下载页图
const pageBuf = Buffer.from(await (await fetch(PAGE_URL)).arrayBuffer())
const meta = await sharp(pageBuf).metadata()
console.log('页图尺寸:', meta.width, 'x', meta.height)

// 生产同款裁剪上传
const upUrl = await cropAndUploadGeometryImage(pageBuf, PX, q.student_id, q.id)
if (!upUrl) { console.log('❌ 上传失败/被收紧闸拦'); await pool.end(); process.exit(1) }
console.log('✅ 新裁片:', upUrl)

// 写库（仅三列）
const norm = {
  x: Math.round(PX.x / meta.width * 1000),
  y: Math.round(PX.y / meta.height * 1000),
  width: Math.round(PX.width / meta.width * 1000),
  height: Math.round(PX.height / meta.height * 1000),
}
await pool.query(
  `UPDATE questions SET geometry_image_url = $2, image_type = 'geometry', image_bbox = $3, updated_at = NOW() WHERE id = $1`,
  [q.id, upUrl, JSON.stringify(norm)])
console.log('✅ 已写库 image_bbox =', JSON.stringify(norm))

// 本地预览复核
const prev = 'D:/Minxue_App_V3/server/backups/figure-preview/7d5fda9a_Q6_manual_fix.png'
await sharp(pageBuf).extract({ left: PX.x, top: PX.y, width: PX.width, height: PX.height }).resize({ width: 900 }).png().toFile(prev)
console.log('预览:', prev)
await pool.end()
