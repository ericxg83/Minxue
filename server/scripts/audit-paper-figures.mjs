/**
 * 存量配图「裹文字」审计：逐个下载 resource_questions.image_url，量成行文字。
 * 只读，不改库。用法：node scripts/audit-paper-figures.mjs [--resource <prefix>]
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import sharp from 'sharp'
import { inspectFigureTextRows } from '../services/paperFigureAssign.js'

const argv = process.argv.slice(2)
const i = argv.indexOf('--resource')
const prefix = i >= 0 ? argv[i + 1] : null

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const sql = prefix
  ? `SELECT rq.id, rq.resource_id, r.name, rq.page_no, rq.question_no, rq.sub_no, rq.image_url
     FROM resource_questions rq LEFT JOIN resources r ON r.id = rq.resource_id
     WHERE rq.image_url IS NOT NULL AND rq.resource_id::text LIKE $1
     ORDER BY rq.resource_id, rq.page_no, rq.question_no`
  : `SELECT rq.id, rq.resource_id, r.name, rq.page_no, rq.question_no, rq.sub_no, rq.image_url
     FROM resource_questions rq LEFT JOIN resources r ON r.id = rq.resource_id
     WHERE rq.image_url IS NOT NULL
     ORDER BY rq.resource_id, rq.page_no, rq.question_no`
const q = await pool.query(sql, prefix ? [prefix + '%'] : [])
await pool.end()

const byRes = new Map()
for (const r of q.rows) {
  const key = r.resource_id
  if (!byRes.has(key)) byRes.set(key, { name: r.name, rows: [] })
  byRes.get(key).rows.push(r)
}

let dirtyTotal = 0
let done = 0
for (const [rid, info] of byRes) {
  let dirty = 0
  const hits = []
  for (const r of info.rows) {
    done++
    let meta = null
    let text = { textRowCount: 0, right: -1 }
    try {
      const buf = Buffer.from(await (await fetch(r.image_url)).arrayBuffer())
      meta = await sharp(buf).metadata()
      text = await inspectFigureTextRows(buf)
    } catch (e) {
      hits.push(`q${r.question_no}${r.sub_no || ''} 下载/解码失败 ${e.message}`)
      continue
    }
    const w = meta?.width || 0
    const h = meta?.height || 0
    // 「整页宽横条 + 有字」= 典型裹题干；窄图里只有 1 行也可能只是图注，先都列出
    if (text.textRowCount >= 1 && w >= 600) {
      dirty++
      hits.push(`q${r.question_no}${r.sub_no || ''} ${w}x${h} textRows=${text.textRowCount}`)
    }
  }
  dirtyTotal += dirty
  const tag = dirty ? 'DIRTY' : 'ok   '
  console.log(`${tag} ${rid.slice(0, 8)} ${String(dirty).padStart(2)}/${String(info.rows.length).padEnd(2)} ${info.name || ''}`)
  for (const h of hits) console.log('        ' + h)
}
console.log(`\nchecked ${done} images, dirty ${dirtyTotal}`)
