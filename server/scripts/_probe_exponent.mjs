import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })
import { Pool } from 'pg'
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (sql, params) => (await pool.query(sql, params)).rows

// 搜索所有类似"15-4"的题目内容，看看有没有已转换成 \sqrt 且缺左括号的版本
const rows = await q(`
  SELECT q.id, q.question_type, q.content
  FROM questions q
  WHERE q.content LIKE '%15-4%' OR q.content LIKE '%15+4%'
  ORDER BY q.id DESC
  LIMIT 30
`)

console.log('rows:', rows.length)
for (const r of rows) {
  console.log(`[${r.question_type}] ${r.id}`)
  console.log('  ', JSON.stringify(r.content))
}
await pool.end()
