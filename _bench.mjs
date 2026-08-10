// 测首跑/二跑耗时
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

const PORT = process.env.PORT || 4000
const url = `http://localhost:${PORT}/api/handout/from-diagnosis`
const body = JSON.stringify({ mode: 'all', offset: 0, subject: '英语', maxItems: 12, template: 'english_default' })

async function call(label) {
  const t0 = Date.now()
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const j = await r.json()
  const dt = (Date.now() - t0) / 1000
  console.log(`${label} ${dt.toFixed(1)}秒 pages=${j.handout?.pages?.length || 'null'}`)
  return j
}

await call('首跑(AI 12次):')
await call('二跑(全缓存):')
process.exit(0)
