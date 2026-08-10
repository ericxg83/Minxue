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

for (const t of ['questions', 'wrong_questions', 'variant_questions', 'students', 'handouts', 'knowledge_points', 'error_causes']) {
  const { rows } = await query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = $1 ORDER BY ordinal_position`,
    [t]
  )
  console.log(`\n=== ${t} 列 ===`)
  console.log(JSON.stringify(rows.map(r => `${r.column_name}:${r.data_type}`), null, 2))
}

process.exit(0)
