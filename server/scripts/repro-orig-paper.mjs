/**
 * 最小复现：OriginalPaperSource.vue「原卷出处」弹窗空白问题
 * 用真实原卷图 + 组件同款 cropStyle 渲染，对比 crop 模式 / 整页模式 / 无 bbox 模式
 */
import { config as dotenvConfig } from 'dotenv'
dotenvConfig({ path: 'D:/Minxue_App_V3/server/.env' })
import { chromium } from 'playwright'
import pg from 'pg'
import { parseBbox, unionBbox, padBbox } from '../../src/utils/questionBbox.js'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// 组件同款 cropStyle
const cropStyle = (b) => {
  if (!b) return {}
  return {
    width: `${100000 / b.width}%`,
    transform: `translate(-${b.x / 10}%, -${b.y / 10}%)`
  }
}

// 组件同款 getQuestionDisplayBox
const getBox = (q, pad = 0) => {
  const box = unionBbox(parseBbox(q.text_bbox), parseBbox(q.image_bbox)) || parseBbox(q.block_coordinates)
  return padBbox(box, pad)
}

// 组件同款 origin 计算
const buildOrigin = (q) => {
  const images = Array.isArray(q.task_images) ? q.task_images : []
  const pageIdx = Number(q.page_number || 0) - 1
  const pageEntry = pageIdx >= 0 ? images[pageIdx] : null
  const pageImageUrl = typeof pageEntry === 'string' ? pageEntry : (pageEntry?.image_url || '')
  const imageUrl = pageImageUrl || q.task_image_url || q.image_url || ''
  return {
    imageUrl,
    box: getBox(q),
    crop: getBox(q, 15),
    pageLabel: q.page_number ? `原卷第 ${q.page_number} 页` : ''
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function main () {
  // 取 page_number=3 且有 images 的真实重练题（原卷出处典型场景）
  const r = await pool.query(`
    SELECT q.id, q.task_id, q.page_number, q.content, q.text_bbox, q.block_coordinates,
           tk.images AS task_images, tk.image_url AS task_image_url, q.image_url
    FROM questions q
    JOIN tasks tk ON tk.id = q.task_id
    WHERE q.page_number >= 3 AND jsonb_array_length(tk.images) >= 3
    LIMIT 1`)
  const q = r.rows[0]
  console.log('样本题:', q.id, 'page:', q.page_number)
  const origin = buildOrigin(q)
  console.log('origin.imageUrl:', (origin.imageUrl || '').slice(0, 90))
  console.log('origin.box:', JSON.stringify(origin.box))
  console.log('origin.crop:', JSON.stringify(origin.crop))

  const stemStyle = origin.crop ? cropStyle(origin.crop) : {}
  const stemStyleStr = Object.entries(stemStyle).map(([k, v]) => `${k}:${v}`).join(';')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:sans-serif;background:#f5f5f5;padding:20px;margin:0}
    h3{margin:20px 0 8px;font-size:14px;color:#333}
    .stage{border:1px solid #ddd;border-radius:6px;background:#fafbfc;height:60vh;overflow:hidden;position:relative;margin-bottom:30px}
    .stage.scroll{overflow:auto}
    .canvas{position:relative;width:100%;line-height:0}
    .img{display:block;max-width:none;transform-origin:0 0}
    .box{position:absolute;border:2px solid #409eff;background:rgba(64,158,255,.12)}
  </style></head><body>
    <h2>样本：${esc((q.content || '').slice(0, 30))}（${origin.pageLabel}）</h2>

    <h3>① 题干区域（crop）模式 —— 组件同款 cropStyle</h3>
    <div class="stage"><div class="canvas">
      <img class="img" src="${esc(origin.imageUrl)}" style="${stemStyleStr}" />
      <div class="box" style="left:${origin.box.x / 10}%;top:${origin.box.y / 10}%;width:${origin.box.width / 10}%;height:${origin.box.height / 10}%"></div>
    </div></div>

    <h3>② 整页模式（宽度 100%）</h3>
    <div class="stage scroll"><div class="canvas">
      <img class="img" src="${esc(origin.imageUrl)}" style="width:100%" />
    </div></div>

    <h3>③ 直接完整展示（对照组）</h3>
    <div class="stage scroll"><div class="canvas">
      <img class="img" src="${esc(origin.imageUrl)}" style="width:600px" />
    </div></div>
  </body></html>`

  const fs = await import('fs')
  const OUT = 'D:/Minxue_App_V3/server/scripts/logs/dsl-demo/orig-repro.html'
  fs.writeFileSync(OUT, html)
  console.log('HTML 已写:', OUT)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } })
  await page.goto('file://' + OUT)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: OUT.replace('.html', '.png'), fullPage: true })
  console.log('截图已写:', OUT.replace('.html', '.png'))
  await browser.close()
  await pool.end()
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
