// 测试 /api/handout/from-diagnosis（避免 PowerShell 中文乱码问题）
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
const baseUrl = `http://localhost:${PORT}`

// 1) 测试模板列表
const tplRes = await fetch(`${baseUrl}/api/handout/templates?subject=英语`)
const tplJson = await tplRes.json()
console.log('=== 模板列表(英语) ===')
console.log(JSON.stringify(tplJson, null, 2))

// 2) 测试 from-diagnosis
const fdRes = await fetch(`${baseUrl}/api/handout/from-diagnosis`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'all',
    offset: 0,
    subject: '英语',
    maxItems: 12,
    template: 'english_default',
  }),
})
const fdJson = await fdRes.json()
console.log('\n=== /api/handout/from-diagnosis ===')
console.log('success:', fdJson.success)
console.log('handout null?', fdJson.handout == null)
if (fdJson.handout) {
  console.log('讲义标题:', fdJson.handout.title)
  console.log('讲义模板:', fdJson.handout.template, '-', fdJson.handout.templateLabel)
  console.log('页数:', fdJson.handout.pages.length)
  console.log('知识点页:', fdJson.handout.pages.filter(p => p.name !== 'cover' && p.name !== 'toc').map(p => p.name))
  const kpPages = fdJson.handout.pages.filter(p => p.name !== 'cover' && p.name !== 'toc')
  if (kpPages[0]) {
    console.log('\n=== 第一个知识点页块 ===')
    console.log(JSON.stringify(kpPages[0].blocks, null, 2))
  }
} else {
  console.log('message:', fdJson.message)
}

process.exit(0)
