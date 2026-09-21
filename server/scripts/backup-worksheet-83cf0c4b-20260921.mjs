/**
 * 备份（2026-09-21）：答案册 83cf0c4b《八上精练与拓展》的单元 + 答案全量快照
 * 用于重解析前后的回滚与对照。只读，不改库。
 * 用法：node server/scripts/backup-worksheet-83cf0c4b-20260921.mjs [tag]
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '..', '.env') })

const WS = '83cf0c4b-ca07-46dd-b9ca-fc5ffdb6be45'
const tag = process.argv[2] || 'before'
const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const units = (await pool.query(
  `SELECT * FROM resource_units WHERE resource_id = $1::uuid ORDER BY id`, [WS])).rows
const answers = (await pool.query(
  `SELECT * FROM resource_answers WHERE resource_id = $1::uuid ORDER BY unit_id, question_no`, [WS])).rows
const meta = (await pool.query(
  `SELECT id, name, parse_status, parse_count, answer_count, parse_warning, parse_error,
          parse_total_pages, parse_done_pages
   FROM worksheets WHERE id = $1::uuid`, [WS])).rows

const dir = resolve(__dirname, '..', 'backups')
fs.mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
const file = resolve(dir, `worksheet-83cf0c4b-${tag}-${stamp}.json`)
fs.writeFileSync(file, JSON.stringify({ worksheetId: WS, tag, meta: meta[0], units, answers }, null, 1), 'utf8')

const byUnit = new Map()
for (const a of answers) {
  const k = a.unit_id
  if (!byUnit.has(k)) byUnit.set(k, [])
  byUnit.get(k).push(a)
}
console.log(`\n备份完成 → ${file}`)
console.log(`  meta    : ${JSON.stringify(meta[0])}`)
console.log(`  units   : ${units.length}`)
console.log(`  answers : ${answers.length}`)
console.log('\n单元清单（unit_key / 题号范围 / 行数）:')
for (const u of units) {
  const rows = byUnit.get(u.id) || []
  const qs = [...new Set(rows.map(r => Number(r.question_no)))].filter(Number.isFinite).sort((a, b) => a - b)
  const max = qs.length ? qs[qs.length - 1] : 0
  const missing = []
  for (let i = 1; i <= max; i++) if (!qs.includes(i)) missing.push(i)
  console.log(`  ${String(u.unit_key).padEnd(24)} ${String(rows.length).padStart(3)}行  题号 ${qs.length ? qs[0] : '-'}..${max}  ${missing.length ? '⚠缺 ' + missing.join(',') : ''}`)
}
await pool.end()
