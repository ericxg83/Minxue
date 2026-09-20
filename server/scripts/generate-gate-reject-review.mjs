/**
 * 生成闸门拒稿人工核对页：原图 vs 重绘图 并排 + 拒稿原因。
 * 数据源：non-c3（progress.json 里 gateRejected 由 publish 脚本运行时输出 → 这里用预演口径重算）
 *        + c3-redo/progress.json 的 gateRejected 记录。
 * 输出 D:/Minxue_App_V3/_gate_reject_review_20260920.html —— 只读核对工具，不写库。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { renderGeometrySvg } from '../utils/geometrySvg.js'
import { normalizeStructure } from '../utils/geom/structure.js'

const NONC3 = 'D:/Minxue_App_V3/server/scripts/logs/non-c3-test'
const C3REDO = 'D:/Minxue_App_V3/server/scripts/logs/c3-redo'

// ── 1. 收集拒稿清单 ──
const items = []

// non-c3 侧：重算闸门（与 publish 同口径，含 options）
const { validateStructureAgainstContent } = await import('../utils/geometryContentGate.js')
const ncDone = JSON.parse(fs.readFileSync(path.join(NONC3, 'progress.json'), 'utf8'))
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const ncIds = Object.keys(ncDone).filter((id) => {
  const t = id.slice(0, 8)
  return fs.existsSync(path.join(NONC3, t, 'structure.json'))
})
const q1 = await pool.query(`SELECT id, parent_stem, content, options, geometry_image_url, clean_geometry_image_url FROM questions WHERE id = ANY($1::uuid[])`, [ncIds])
for (const row of q1.rows) {
  const tag = String(row.id).slice(0, 8)
  const rec = ncDone[String(row.id)]
  if (!rec?.ok || rec.published) continue // 已发布的（含 --allow 人工放行）不再列入
  const sp = path.join(NONC3, tag, 'structure.json')
  const s = normalizeStructure(JSON.parse(fs.readFileSync(sp, 'utf8')))
  const text = [String(row.parent_stem || ''), String(row.content || '')].join('\n')
  const options = Array.isArray(row.options) ? row.options.filter(Boolean) : null
  const v = validateStructureAgainstContent(s, text, options)
  if (!v.ok) {
    items.push({
      side: 'non-c3', tag, id: row.id, reasons: (v.reasons || []).slice(0, 3),
      origUrl: row.geometry_image_url,
      svgPath: path.join(NONC3, tag, 'draw.svg'),
      stem: (text || '').replace(/\s+/g, ' ').slice(0, 120),
    })
  }
}

// c3 侧：progress.json gateRejected
const c3Done = JSON.parse(fs.readFileSync(path.join(C3REDO, 'progress.json'), 'utf8'))
const c3Rejected = Object.entries(c3Done).filter(([, r]) => r.gateRejected)
const q2 = await pool.query(`SELECT id, parent_stem, content, geometry_image_url FROM questions WHERE id = ANY($1::uuid[])`, [c3Rejected.map(([id]) => id)])
const q2map = new Map(q2.rows.map((r) => [String(r.id), r]))
for (const [id, rec] of c3Rejected) {
  const row = q2map.get(id)
  if (!row) continue
  const tag = id.slice(0, 8)
  const sp = path.join(C3REDO, tag, 'structure.json')
  items.push({
    side: 'c3', tag, id, reasons: (rec.reasons || []).slice(0, 3),
    origUrl: row.geometry_image_url,
    svgPath: fs.existsSync(sp) ? sp : null,
    stem: ([row.parent_stem, row.content].filter(Boolean).join(' ')).replace(/\s+/g, ' ').slice(0, 120),
  })
}
await pool.end()

// 人工初判注记（2026-09-20 原卷逐张核对结论）：allow=建议放行 / reject=建议不放行 / unsure=需并排确认
let VERDICT = {}
try { VERDICT = JSON.parse(fs.readFileSync('D:/Minxue_App_V3/server/scripts/logs/_gate_reject_verdict_20260920.json', 'utf8')) } catch {}

// 同题副本归并（2026-09-20 全库 Dice 扫描）：同组只裁决一次，结论整组同步
const GROUP = {
  c3: {
    '1f0275fe': { name: '立体 BC₁ 题（求 BC₁ 长）', members: 'f6b75ddf、adec1f84' },
    'f6b75ddf': { name: '立体 BC₁ 题（求 BC₁ 长）', members: '1f0275fe、adec1f84' },
    'adec1f84': { name: '立体 BC₁ 题（求 BC₁ 长）', members: '1f0275fe、f6b75ddf' },
    '2964cd93': { name: '抛物线 y=ax²+bx-4（点 Q，DQ/FQ）', members: '9c34bed7' },
    '9c34bed7': { name: '抛物线 y=ax²+bx-4（点 Q，DQ/FQ）', members: '2964cd93' },
  },
  nonc3: {
    'eeb4ec52': { name: '正方形沿数轴移动（A′ 折叠）', members: '7ddc666d、3e47df1c' },
    '7ddc666d': { name: '正方形沿数轴移动（A′ 折叠）', members: 'eeb4ec52、3e47df1c' },
    '3e47df1c': { name: '正方形沿数轴移动（A′ 折叠）', members: 'eeb4ec52、7ddc666d' },
  },
}
const GROUP_NAME = {}
for (const [side, m] of Object.entries(GROUP)) for (const [tag, g] of Object.entries(m)) GROUP_NAME[tag] = g

console.log('拒稿总数:', items.length)

// ── 2. 渲染素材 ──
const svgToPngData = async (svg) => {
  const buf = await sharp(Buffer.from(svg)).resize({ width: 560 }).png().toBuffer()
  return 'data:image/png;base64,' + buf.toString('base64')
}
const rowsHtml = []
for (const it of items) {
  // keep = 无需人工处理（如：昨晚已发布且核对过的图维持现状）
  if (((VERDICT[it.side === 'c3' ? 'c3' : 'nonc3'] || {})[it.tag] || {}).suggest === 'keep') { console.log('跳过(keep):', it.side, it.tag); continue }
  let redrawImg = '<div style="color:#c00">无重绘产物</div>'
  try {
    if (it.svgPath && fs.existsSync(it.svgPath)) redrawImg = `<img src="${await svgToPngData(fs.readFileSync(it.svgPath, 'utf8'))}" style="max-width:560px;border:1px solid #ddd">`
  } catch (e) { redrawImg = `<div style="color:#c00">渲染失败: ${e.message.slice(0, 60)}</div>` }
  let origImg = '<div style="color:#999">原图缺失</div>'
  if (it.origUrl) {
    try {
      const raw = Buffer.from(await (await fetch(it.origUrl)).arrayBuffer())
      const buf = await sharp(raw).resize({ width: 560 }).png().toBuffer()
      origImg = `<img src="data:image/png;base64,${buf.toString('base64')}" style="max-width:560px;border:1px solid #ddd">`
    } catch (e) { origImg = `<div style="color:#c00">原图下载失败: ${e.message.slice(0, 60)}</div>` }
  }
  const vd = (VERDICT[it.side === 'c3' ? 'c3' : 'nonc3'] || {})[it.tag]
  const g = GROUP_NAME[it.tag]
  const gHtml = g
    ? `<div style="margin-bottom:6px;color:#036;background:#eef4fb;display:inline-block;padding:3px 10px;border-radius:4px">♻️ 同题组：${g.name}（本组 ${g.members}，只裁决一次，结论整组同步）</div>`
    : ''
  const vdHtml = vd
    ? `<div style="margin-bottom:8px"><b>初判建议：${vd.suggest === 'allow' ? '<span style="color:#080">✅ 可放行</span>' : vd.suggest === 'reject' ? '<span style="color:#c00">⛔ 不放行</span>' : '<span style="color:#b60">⚠️ 需并排确认</span>'}</b> <span style="color:#555">${vd.note || ''}</span></div>`
    : ''
  rowsHtml.push(`
  <div style="margin:24px 0;padding:16px;border:1px solid #ccc;border-radius:8px">
    ${gHtml}
    <div style="font-weight:bold;margin-bottom:6px">${it.side} · ${it.tag} <span style="font-weight:normal;color:#666">｜${it.stem}</span></div>
    <div style="color:#b00;margin-bottom:8px">⛔ ${(it.reasons || []).join('；')}</div>
    ${vdHtml}
    <div style="display:flex;gap:12px;align-items:flex-start">
      <div><div style="font-size:12px;color:#666;margin-bottom:4px">原卷裁片</div>${origImg}</div>
      <div><div style="font-size:12px;color:#666;margin-bottom:4px">重绘图（未发布）</div>${redrawImg}</div>
    </div>
  </div>`)
}

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>闸门拒稿人工核对 ${new Date().toISOString().slice(0, 10)}</title></head>
<body style="font-family:system-ui;max-width:1200px;margin:0 auto;padding:20px">
<h2>闸门拒稿人工核对页（${items.length} 张）</h2>
<p style="color:#666">判定标准：重绘图与原卷图形一致（标注/线段同原卷）→ 可放行；重绘图凭空多画/漏画主体 → 不可放行，需重跑或人工修。放行命令见文末。</p>
${rowsHtml.join('\n')}
</body></html>`
fs.writeFileSync('D:/Minxue_App_V3/_gate_reject_review_20260920.html', html)
console.log('已生成: D:/Minxue_App_V3/_gate_reject_review_20260920.html')
console.log('\nnon-c3 侧 tag:', items.filter(i => i.side === 'non-c3').map(i => i.tag).join(','))
console.log('c3 侧 tag:', items.filter(i => i.side === 'c3').map(i => i.tag).join(','))
process.exit(0)
