/**
 * 函数图象通道覆盖率与对照页（默认只读 DB、零视觉调用）。
 *
 * 用途：把「被配图闸门拦下的题」跑一遍确定性函数图象解析，回答两个问题：
 *   1. 覆盖率：多少道题能从题干文本推出图形规格（不需要视觉模型）；
 *   2. 正确性：抽出来的规格和渲染出的 SVG 长什么样，供人工目检。
 *
 * 用法：
 *   node server/scripts/functionGraphCoverage.mjs            # 扫描 DB，输出统计 + 对照页
 *   node server/scripts/functionGraphCoverage.mjs --json     # 额外打印未命中题目的题干（调参用）
 *   node server/scripts/functionGraphCoverage.mjs --out <dir>
 */

import dotenv from 'dotenv'
import fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFigureReference } from '../utils/geometryFigureGate.js'
import { buildFunctionGraphSvg, hasOtherGeometry } from '../utils/functionGraph/index.js'
import { renderGeometrySvg } from '../utils/geometrySvg.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
dotenv.config({ path: resolve(__dirname, '../.env') })

const args = process.argv.slice(2)
const argOf = (name, dflt = null) => {
  const eq = args.find(a => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  return dflt
}
const PRINT_MISSES = args.includes('--json')
const OUT_DIR = resolve(ROOT, argOf('out', 'server/scripts/logs/function-graph'))

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function loadQuestions() {
  const { query } = await import('../config/neon.js')
  const { rows } = await query(
    `SELECT q.id, q.content, q.parent_stem, q.image_type,
            a.tikz_status, a.cropped_image_url, q.geometry_image_url
       FROM questions q
       LEFT JOIN question_assets a ON a.question_id = q.id
      WHERE q.deleted_at IS NULL
        AND (q.parent_stem IS NOT NULL AND q.parent_stem <> ''
             OR q.content ~ '如图|图1|图示|附图|见图')
      ORDER BY q.id`
  )
  return rows.map(r => ({
    questionId: r.id,
    shortId: String(r.id).slice(0, 8),
    content: r.content || '',
    parentStem: r.parent_stem || '',
    imageType: r.image_type || '',
    tikzStatus: r.tikz_status || '(无资产)',
    cropUrl: r.cropped_image_url || r.geometry_image_url || null
  }))
}

async function main() {
  const all = await loadQuestions()

  const buckets = { number_line: [], function_graph: [], other: [], eligible: [] }
  for (const q of all) {
    const r = checkFigureReference(q.content, q.parentStem)
    if (r.ok) buckets.eligible.push(q)
    else if (r.reason === 'function_graph') buckets.function_graph.push(q)
    else if (r.reason === 'number_line') buckets.number_line.push(q)
    else buckets.other.push(q)
  }

  // 对被拦下的两类跑确定性解析
  const candidates = [...buckets.function_graph, ...buckets.number_line]
  const hits = []
  const misses = []
  const impure = []
  let parseHits = 0
  for (const q of candidates) {
    const text = `${q.parentStem} ${q.content}`
    const built = buildFunctionGraphSvg(q.parentStem, q.content, renderGeometrySvg)
    if (built) { hits.push({ ...q, ...built }); continue }
    // 区分"解析不出来"与"解析出来但题干含其他几何构造（画出来会残缺）"
    const theoretical = buildFunctionGraphSvg(q.parentStem, q.content, renderGeometrySvg, { ignorePurity: true })
    if (theoretical) { parseHits++; impure.push({ ...q, ...theoretical }) }
    else misses.push(q)
  }

  const byBucket = {}
  for (const h of hits) {
    const r = checkFigureReference(h.content, h.parentStem)
    byBucket[r.reason] = (byBucket[r.reason] || 0) + 1
  }

  console.log('── 语料分布（引图题）──')
  console.log(`  引图题总数: ${all.length}`)
  console.log(`  闸门放行(真几何题，走视觉重画): ${buckets.eligible.length}`)
  console.log(`  拦下·函数图象: ${buckets.function_graph.length}`)
  console.log(`  拦下·数轴:     ${buckets.number_line.length}`)
  console.log(`  拦下·其他:     ${buckets.other.length}`)
  console.log('')
  console.log('── 确定性函数图象通道 ──')
  console.log(`  候选(函数图象+数轴): ${candidates.length}`)
  console.log(`  解析命中:             ${parseHits + hits.length}`)
  console.log(`  ├ 实际出图(纯抛物线): ${hits.length}`)
  console.log(`  └ 被纯度闸拦下:       ${impure.length}（题干另有三角形/辅助线，画出来会残缺，回退原图更完整）`)
  console.log(`  解析未命中:           ${misses.length}`)
  console.log(`  命中分布: ${Object.entries(byBucket).map(([k, v]) => `${k}=${v}`).join(' ') || '（无）'}`)

  if (PRINT_MISSES) {
    console.log('')
    console.log('── 未命中题干（用于调参）──')
    for (const m of misses.slice(0, 40)) {
      console.log(`  [${m.shortId}] ${(m.parentStem + ' ' + m.content).replace(/\s+/g, ' ').slice(0, 150)}`)
    }
  }

  await fs.mkdir(OUT_DIR, { recursive: true })
  const out = resolve(OUT_DIR, 'index.html')
  await fs.writeFile(out, buildHtml(hits, impure, misses), 'utf8')
  console.log('')
  console.log(`📄 对照页：${out}`)
}

const STYLE = `
body{font:14px/1.6 -apple-system,"Segoe UI",sans-serif;margin:24px;color:#222}
h1{font-size:18px} h2{font-size:15px;margin-top:28px} .sub{color:#666;margin-bottom:16px}
table{border-collapse:collapse;width:100%} td,th{border:1px solid #ddd;padding:8px;vertical-align:top}
th{background:#f6f6f6;text-align:left;font-weight:600}
td.meta{width:100px} td.fig{width:300px;text-align:center;background:#fafafa}
td.fig img{max-width:280px;max-height:240px} td.fig svg{max-width:280px;height:auto}
.sid{font-family:monospace;font-weight:600}
.spec{margin-top:6px;font-size:12px;color:#0a5;font-family:monospace;white-space:pre-wrap}
.content{font-size:13px} .none{color:#999;font-size:12px}
.miss{color:#a11;font-size:12px;font-family:monospace;padding:4px 0;border-bottom:1px solid #eee}
`

function buildHtml(hits, impure, misses) {
  const rows = hits.map(h => `<tr>
  <td class="meta"><div class="sid">${esc(h.shortId)}</div></td>
  <td class="fig">${h.cropUrl ? `<img src="${esc(h.cropUrl)}" loading="lazy" alt="裁剪原图">` : '<span class="none">无裁剪图</span>'}</td>
  <td class="fig">${h.svg}</td>
  <td class="txt">
    <div class="content">${esc(h.parentStem ? h.parentStem + ' ' : '')}${esc(h.content).slice(0, 400)}</div>
    <div class="spec">${esc(`表达式 ${h.spec.expression}\n开口 ${h.spec.opens}  顶点 (${h.spec.vertex.x}, ${h.spec.vertex.y})  来源 ${h.spec.solvedFrom}${h.spec.approximate ? '（代表元，陡缓为示意）' : ''}`)}</div>
  </td>
</tr>`).join('\n')

  const impureRows = impure.map(m =>
    `<div class="miss">[${esc(m.shortId)}] ${esc((m.parentStem + ' ' + m.content).replace(/\s+/g, ' ').slice(0, 170))}</div>`
  ).join('\n')

  const missRows = misses.map(m =>
    `<div class="miss">[${esc(m.shortId)}] ${esc((m.parentStem + ' ' + m.content).replace(/\s+/g, ' ').slice(0, 170))}</div>`
  ).join('\n')

  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>函数图象确定性渲染对照</title><style>${STYLE}</style>
<h1>函数图象确定性渲染对照</h1>
<div class="sub">出图 ${hits.length} 条 · 纯度闸拦下 ${impure.length} 条 · 解析未命中 ${misses.length} 条 · 生成于 ${new Date().toLocaleString('zh-CN')}</div>
<h2>出图（左：原裁剪图 · 中：确定性渲染）</h2>
<table><thead><tr><th>题目</th><th>裁剪原图</th><th>确定性渲染</th><th>题干与规格</th></tr></thead>
<tbody>${rows}</tbody></table>
<h2>纯度闸拦下（题干另有三角形/辅助线，画出来残缺 → 回退裁剪原图）</h2>
${impureRows || '<div class="none">无</div>'}
<h2>解析未命中（开口或位置无法确定 → 回退裁剪原图）</h2>
${missRows || '<div class="none">无</div>'}
</html>`
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e); process.exit(1) })
