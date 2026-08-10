// 加载 server/.env
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, 'server/.env')
const content = readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
for (const line of content.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const { query, TABLES } = await import('./server/config/neon.js')

// questions 表里有多少英语题
const { rows: counts } = await query(
  `SELECT COALESCE(NULLIF(subject,''),'其他') AS subject, COUNT(*)::int AS cnt
   FROM ${TABLES.QUESTIONS} GROUP BY subject ORDER BY cnt DESC`
)
console.log('=== 题目按学科 ===')
console.log(JSON.stringify(counts, null, 2))

// 最近 5 道英语题
const { rows: eng } = await query(
  `SELECT id, subject, LEFT(content, 100) AS preview, answer
   FROM ${TABLES.QUESTIONS}
   WHERE subject = '英语'
   ORDER BY created_at DESC NULLS LAST
   LIMIT 5`
)
console.log('\n=== 最近 5 道英语题 ===')
console.log(JSON.stringify(eng, null, 2))

// variant_questions 表有多少题
const { rows: vq } = await query(
  `SELECT COALESCE(NULLIF(question_type, 'NULL'), 'NULL') AS qtype, COUNT(*)::int AS cnt
   FROM variant_questions GROUP BY question_type ORDER BY cnt DESC`
)
console.log('\n=== variant_questions 按类型 ===')
console.log(JSON.stringify(vq, null, 2))

process.exit(0)
