/**
 * DSL 重绘效果演示：真实生产几何题 → gemini-3.8-flash → DSL 闭环 → SVG/PNG
 * 产出 server/scripts/logs/dsl-demo/index.html 对比页（左=原题裁片，右=DSL 重绘）。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { correctDslByVision } from '../utils/geom/dsl/reactLoop.js'
import { renderDslToSvg } from '../utils/geom/dsl/render.js'
import { renderGeometrySvg } from '../utils/geometrySvg.js'
import { checkFigureReference } from '../utils/geometryFigureGate.js'

const OUT = 'D:/Minxue_App_V3/server/scripts/logs/dsl-demo'
fs.mkdirSync(OUT, { recursive: true })

const GEMINI = {
  endpoint: 'https://api.huihuiyun.top/v1/chat/completions',
  key: process.env.HUIHUIYUN_GEMINI_API_KEY,
  model: 'gemini-3.8-flash',
  maxTokens: 8192,
}
async function callGemini({ systemPrompt, userText, imageDataURL }) {
  const res = await fetch(GEMINI.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GEMINI.key}` },
    body: JSON.stringify({ model: GEMINI.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: [{ type: 'image_url', image_url: { url: imageDataURL } }, { type: 'text', text: userText }] }], max_tokens: GEMINI.maxTokens, temperature: 0.1 }),
  })
  const text = await res.text()
  if (res.status !== 200) throw new Error(`gemini HTTP ${res.status}: ${text.slice(0, 120)}`)
  const msg = JSON.parse(text).choices?.[0]?.message
  const content = typeof msg?.content === 'string' ? msg.content : (Array.isArray(msg?.content) ? msg.content.map(x => x?.text || '').join('') : '')
  if (!content) throw new Error('gemini 空 content')
  return content
}

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// 支持指定题目：--ids=<qid1>,<qid2>…（周末班课件前 N 题批量重绘用）；否则随机取样
const idsArg = process.argv.find(a => a.startsWith('--ids='))
let sample
if (idsArg) {
  const ids = idsArg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean)
  sample = await pool.query(`SELECT q.id, q.geometry_image_url, q.content FROM questions q WHERE q.id = ANY($1::uuid[])`, [ids])
} else {
  sample = await pool.query(`
  SELECT q.id, q.geometry_image_url, q.content FROM questions q
  WHERE q.geometry_image_url IS NOT NULL AND q.clean_geometry_svg IS NULL
  ORDER BY random() LIMIT 30`)
}
// --ids 模式：用户明确指定的题直接做（子题题干可能不带"如图"但确有配图），不过闸门过滤
const items = idsArg
  ? sample.rows
  : sample.rows.filter(r => checkFigureReference(r.content || '', '').ok).slice(0, 6)
console.log(`演示 ${items.length} 张`)

const cards = []
for (const [i, q] of items.entries()) {
  console.log(`\n[${i + 1}/${items.length}] ${q.id.slice(0, 8)} ${(q.content || '').slice(0, 20)}`)
  try {
    const raw = Buffer.from(await (await fetch(q.geometry_image_url)).arrayBuffer())
    const origPath = `${OUT}/orig_${i + 1}.png`
    fs.writeFileSync(origPath, raw)
    const r = await correctDslByVision({
      content: q.content || '（题干为空）',
      originalImageDataUrl: `data:image/png;base64,${raw.toString('base64')}`,
      dsl: null, callVision: callGemini, maxRounds: 5,
    })
    if (r.ok && r.structure) {
      const svg = renderGeometrySvg(r.structure) || renderDslToSvg(r.structure)
      const pngBuf = await sharp(Buffer.from(svg)).resize({ width: 520, fit: 'inside' }).png().toBuffer()
      const outPath = `${OUT}/draw_${i + 1}.png`
      fs.writeFileSync(outPath, pngBuf)
      cards.push({ head: (q.content || '').slice(0, 30), rounds: r.rounds, weakOk: !!r.weakOk, pts: (r.structure.points || []).length, segs: (r.structure.segments || []).length, ok: true, error: '' })
      console.log(`   ✅ ${r.rounds} 轮${r.weakOk ? '(弱OK)' : ''} ${(r.structure.points || []).length}点 ${(r.structure.segments || []).length}线`)
    } else {
      cards.push({ head: (q.content || '').slice(0, 30), rounds: r.rounds, weakOk: false, pts: 0, segs: 0, ok: false, error: r.reason || '?' })
      console.log(`   ❌ ${r.reason}`)
    }
  } catch (e) {
    cards.push({ head: (q.content || '').slice(0, 30), rounds: 0, weakOk: false, pts: 0, segs: 0, ok: false, error: e.message.slice(0, 80) })
    console.log(`   ❌ ${e.message.slice(0, 100)}`)
  }
}

// 生成对比页
const rows = cards.map((c, i) => {
  const badge = c.ok
    ? `<span style="background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:10px;font-size:12px">✅ ${c.rounds} 轮${c.weakOk ? ' 弱OK' : ''} · ${c.pts}点/${c.segs}线</span>`
    : `<span style="background:#fdecea;color:#c62828;padding:2px 8px;border-radius:10px;font-size:12px">❌ ${c.error}</span>`
  const right = c.ok
    ? `<img src="draw_${i + 1}.png" style="max-width:300px;border:1px solid #ddd;border-radius:6px"/>`
    : `<div style="width:300px;height:200px;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#999">重绘失败</div>`
  return `<div style="border:1px solid #e0e0e0;border-radius:10px;padding:14px;background:#fff">
    <div style="font-size:13px;color:#333;margin-bottom:10px">${c.head} ${badge}</div>
    <div style="display:flex;gap:14px;align-items:flex-start">
      <div><div style="font-size:11px;color:#999;margin-bottom:4px">原题裁片</div><img src="orig_${i + 1}.png" style="max-width:300px;border:1px solid #ddd;border-radius:6px"/></div>
      <div><div style="font-size:11px;color:#999;margin-bottom:4px">DSL 重绘（gemini-3.8-flash）</div>${right}</div>
    </div>
  </div>`
}).join('\n')

const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>DSL 重绘效果对比</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#f5f5f5;margin:0;padding:24px}h1{font-size:20px}h2{font-size:14px;color:#666;font-weight:normal}</style></head>
<body><h1>几何题配图 · DSL 重绘效果对比</h1>
<h2>通道：gemini-3.8-flash（辉辉云）｜闭环：correctDslByVision ≤5 轮｜渲染：renderGeometrySvg（SVG→PNG）｜2026-09-19</h2>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">${rows}</div></body></html>`
fs.writeFileSync(path.join(OUT, 'index.html'), html)
console.log(`\n对比页: ${OUT}/index.html`)
await pool.end()