/**
 * 20 张分层样本 before/after 对比页生成器
 *
 * 用法：node scripts/enhanceSampleCompare.mjs
 * 产物：server/scripts/logs/enhance-compare/index.html（本地图片相对引用）
 * 只读：不写库、不传图，仅下载 OSS 裁片本地增强演示。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import pg from 'pg'
import sharp from 'sharp'
import { enhanceFigureBuffer } from '../services/figureEnhanceService.js'

const OUT_DIR = 'D:/Minxue_App_V3/server/scripts/logs/enhance-compare'
fs.mkdirSync(OUT_DIR, { recursive: true })
const log = (s) => fs.appendFileSync(`${OUT_DIR}/report.txt`, s + '\n')

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// 分层取样：识别时生成(早期) / 09-17 补裁 / 09-18 补裁
const layers = [
  { label: '识别时生成', where: "(regexp_match(geometry_image_url, '/(20[0-9]{6})/'))[1] < '20260917'", n: 7 },
  { label: '09-17 补裁', where: "(regexp_match(geometry_image_url, '/(20[0-9]{6})/'))[1] = '20260917'", n: 6 },
  { label: '09-18 补裁', where: "(regexp_match(geometry_image_url, '/(20[0-9]{6})/'))[1] = '20260918'", n: 7 }
]
const samples = []
for (const layer of layers) {
  const rows = (await pool.query(`
    SELECT q.id, q.geometry_image_url, q.image_type,
           substring(q.content, 1, 40) AS content
    FROM questions q
    WHERE q.geometry_image_url IS NOT NULL AND ${layer.where}
    ORDER BY random() LIMIT ${layer.n}`)).rows
  for (const r of rows) samples.push({ ...r, layer: layer.label })
}
log(`总样本 ${samples.length} 张`)

const items = []
for (const [i, s] of samples.entries()) {
  const tag = String(i + 1).padStart(2, '0')
  try {
    const buf = Buffer.from(await (await fetch(s.geometry_image_url)).arrayBuffer())
    const before = await sharp(buf).metadata()
    const t0 = Date.now()
    const enhanced = await enhanceFigureBuffer(buf)
    const ms = Date.now() - t0
    const after = await sharp(enhanced).metadata()
    fs.writeFileSync(`${OUT_DIR}/${tag}_before.png`, buf)
    fs.writeFileSync(`${OUT_DIR}/${tag}_after.png`, enhanced)
    items.push({
      tag, layer: s.layer, id: s.id, type: s.image_type, content: s.content,
      b: `${before.width}x${before.height}`, a: `${after.width}x${after.height}`,
      kb: (enhanced.length / 1024).toFixed(0), ms
    })
    log(`#${tag} ${s.layer} ${s.id.slice(0, 8)}: ${before.width}x${before.height} -> ${after.width}x${after.height} ${ms}ms`)
  } catch (e) {
    log(`#${tag} ERR ${s.id.slice(0, 8)}: ${e.message.slice(0, 80)}`)
  }
}

// 生成对比页
const cards = items.map(it => `
  <div class="card">
    <div class="meta">
      <span class="tag">#${it.tag} ${it.layer}</span>
      <span class="dim">${it.b} → ${it.a} · ${it.kb}KB · ${it.ms}ms</span>
      <div class="content">${it.content || ''}</div>
    </div>
    <div class="imgs">
      <figure><figcaption>before（原裁片）</figcaption><img src="./${it.tag}_before.png" loading="lazy"></figure>
      <figure><figcaption>after（增强）</figcaption><img src="./${it.tag}_after.png" loading="lazy"></figure>
    </div>
  </div>`).join('\n')

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>配图增强 before/after 对比（20 张样本）</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 24px; }
  h1 { font-size: 18px; }
  .hint { color: #666; font-size: 13px; margin-bottom: 16px; }
  .card { background: #fff; border-radius: 10px; padding: 14px 16px; margin-bottom: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .meta { margin-bottom: 10px; font-size: 13px; }
  .tag { display: inline-block; background: #eef; padding: 2px 8px; border-radius: 4px; margin-right: 8px; font-weight: 600; }
  .dim { color: #888; margin-right: 8px; }
  .content { color: #555; margin-top: 4px; }
  .imgs { display: flex; gap: 16px; flex-wrap: wrap; }
  figure { margin: 0; flex: 1 1 400px; }
  figcaption { font-size: 12px; color: #888; margin-bottom: 4px; }
  img { max-width: 100%; border: 1px solid #ddd; background: #fff; }
</style></head><body>
<h1>配图增强 before/after 对比</h1>
<div class="hint">共 ${items.length} 张（分层抽样：识别时生成 / 09-17 补裁 / 09-18 补裁）。请重点检查：① after 是否更清晰；② 几何关系/文字位置是否与原图一致；③ 阴影填充区是否保留灰阶。</div>
${cards}
</body></html>`
fs.writeFileSync(`${OUT_DIR}/index.html`, html, 'utf8')
log('WROTE index.html')
await pool.end()
process.exit(0)