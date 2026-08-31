/**
 * 几何重建黄金集回归工具（默认离线、只读、不写库）。
 *
 * 几何重建改造的回归基线：把库里的几何资产（结构 JSON + 题干 + 裁剪原图 URL）冻结成
 * fixture，之后每次改渲染器/求解器都从 fixture 重跑，产出 HTML 对照页供人工目检。
 * 从 fixture 跑不需要任何视觉模型调用，也不连数据库——ModelScope 视觉配额很紧，
 * 回归验证绝不能依赖重新识图。
 *
 * 用法：
 *   node server/scripts/geometryGolden.mjs --export      # 从 DB 导出/刷新黄金集 fixture（只读 DB，零视觉调用）
 *   node server/scripts/geometryGolden.mjs               # 从 fixture 渲染黄金集对照页（默认，离线）
 *   node server/scripts/geometryGolden.mjs --from db     # 直接连库渲染全量 57 条基线页（不落 fixture）
 *     [--id <shortId>] [--limit N] [--out <dir>] [--fixture <path>]
 */

import dotenv from 'dotenv'
import fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderGeometrySvg } from '../utils/geometrySvg.js'
import { checkFigureReference } from '../utils/geometryFigureGate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
dotenv.config({ path: resolve(__dirname, '../.env') })

const args = process.argv.slice(2)
/** 仓库里存在 --key=value（rerunGeometry）与 --key value（scripts/*.mjs）两种风格，都接受 */
const argOf = (name, dflt = null) => {
  const eq = args.find(a => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  return dflt
}

const DO_EXPORT = args.includes('--export')
const FROM = argOf('from', DO_EXPORT ? 'db' : 'fixture')
const ONLY_ID = argOf('id')
const LIMIT = argOf('limit') ? Number(argOf('limit')) : null
const FIXTURE = resolve(ROOT, argOf('fixture', 'e2e/fixtures/geometry-golden.json'))
const OUT_DIR = resolve(ROOT, argOf('out', 'server/scripts/logs/geometry-golden'))

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * 从库里取全部几何资产。结构存在两个列：worker 写 tikz_json，rerunGeometry 写
 * geometry_structure_json（实测后者 0 条有值），两列都读以免漏。
 */
async function loadFromDb() {
  const { query } = await import('../config/neon.js')
  const { rows } = await query(
    `SELECT a.id AS asset_id, a.question_id, a.tikz_status, a.last_error, a.retry_count,
            a.cropped_image_url, a.tikz_json, a.geometry_structure_json,
            q.geometry_image_url, q.content
       FROM question_assets a
       JOIN questions q ON q.id = a.question_id
      WHERE q.deleted_at IS NULL
      ORDER BY a.tikz_status, a.question_id`
  )
  return rows.map(r => ({
    assetId: r.asset_id,
    questionId: r.question_id,
    shortId: String(r.question_id).slice(0, 8),
    tikzStatus: r.tikz_status,
    lastError: r.last_error,
    retryCount: r.retry_count,
    content: r.content || '',
    croppedImageUrl: r.cropped_image_url || null,
    geometryImageUrl: r.geometry_image_url || null,
    structure: r.tikz_json || r.geometry_structure_json || null,
    structureColumn: r.tikz_json ? 'tikz_json' : (r.geometry_structure_json ? 'geometry_structure_json' : null)
  }))
}

async function loadFromFixture() {
  const raw = await fs.readFile(FIXTURE, 'utf8').catch(() => null)
  if (!raw) {
    console.error(`❌ 找不到 fixture: ${FIXTURE}`)
    console.error(`   先跑一次：node server/scripts/geometryGolden.mjs --export`)
    process.exit(1)
  }
  return JSON.parse(raw).items || []
}

function selectItems(items) {
  let list = items
  if (ONLY_ID) list = list.filter(i => i.shortId?.startsWith(ONLY_ID) || i.questionId === ONLY_ID)
  if (LIMIT) list = list.slice(0, LIMIT)
  return list
}

/** 结构摘要：一眼看出模型识别到了什么，以及是否带 derived / constraints */
function summarize(s) {
  if (!s) return '—'
  const pts = Array.isArray(s.points) ? s.points : []
  const derived = pts.filter(p => p?.derived && Object.keys(p.derived).length > 0).map(p => p.label)
  const bits = [
    `${pts.length} 点 / ${(s.segments || []).length} 段 / ${(s.circles || []).length} 圆`,
    `type=${s.figure_type || '(缺)'}`
  ]
  const labels = s.geometry_labels || s.labels
  if (labels?.length) bits.push(`labels=${labels.length}`)
  if (s.rightAngles?.length) bits.push(`直角标记=${s.rightAngles.length}`)
  if (s.constraints?.length) bits.push(`constraints=${s.constraints.length}`)
  bits.push(derived.length ? `derived: ${derived.join(',')}` : 'derived: 无')
  return bits.join(' · ')
}

function renderRow(item) {
  let svg = null
  let renderErr = null
  if (item.structure) {
    try { svg = renderGeometrySvg(item.structure) } catch (e) { renderErr = e.message }
  }
  const cropUrl = item.croppedImageUrl || item.geometryImageUrl
  const cropCell = cropUrl
    ? `<img src="${esc(cropUrl)}" loading="lazy" alt="裁剪原图">`
    : '<span class="none">无裁剪图</span>'
  const svgCell = svg
    ? svg
    : `<span class="none">${item.structure ? (renderErr ? '渲染异常: ' + esc(renderErr) : '渲染返回 null') : '无结构'}</span>`
  return `<tr>
  <td class="meta">
    <div class="sid">${esc(item.shortId)}</div>
    <div class="st st-${esc(item.tikzStatus)}">${esc(item.tikzStatus)}</div>
    ${item.lastError ? `<div class="err">${esc(item.lastError)}</div>` : ''}
  </td>
  <td class="fig">${cropCell}</td>
  <td class="fig">${svgCell}</td>
  <td class="txt">
    <div class="content">${esc(item.content).slice(0, 400) || '<无题干>'}</div>
    <div class="struct">${esc(summarize(item.structure))}</div>
  </td>
</tr>`
}

const STYLE = `
body{font:14px/1.6 -apple-system,"Segoe UI",sans-serif;margin:24px;color:#222}
h1{font-size:18px} .sub{color:#666;margin-bottom:16px}
table{border-collapse:collapse;width:100%} td,th{border:1px solid #ddd;padding:8px;vertical-align:top}
th{background:#f6f6f6;text-align:left;font-weight:600}
td.meta{width:110px} td.fig{width:280px;text-align:center;background:#fafafa}
td.fig img{max-width:260px;max-height:240px} td.fig svg{max-width:260px;height:auto}
.sid{font-family:monospace;font-weight:600} .st{margin-top:4px;font-size:12px;padding:1px 6px;border-radius:3px;display:inline-block}
.st-completed{background:#e6f6e6;color:#176117} .st-failed{background:#fdeaea;color:#a11}
.st-none{background:#eee;color:#555} .st-pending{background:#fff4e0;color:#8a5a00}
.err{margin-top:4px;font-size:11px;color:#a11;word-break:break-all}
.content{font-size:13px} .struct{margin-top:6px;font-size:12px;color:#0a5;font-family:monospace}
.none{color:#999;font-size:12px} .tally{margin-top:20px;font-family:monospace;font-size:13px}
`

function buildHtml(items, tally) {
  const rows = items.map(renderRow).join('\n')
  const tallyHtml = Object.entries(tally)
    .map(([k, v]) => `${k}: ${v}`).join(' &nbsp;|&nbsp; ')
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>几何重建黄金集对照</title><style>${STYLE}</style>
<h1>几何重建黄金集对照</h1>
<div class="sub">来源 ${esc(FROM)} · ${items.length} 条 · 生成于 ${new Date().toLocaleString('zh-CN')}</div>
<table><thead><tr><th>资产</th><th>裁剪原图</th><th>当前渲染 (v1)</th><th>题干与结构</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="tally">${tallyHtml}</div>
</html>`
}

/**
 * 把全量资产按黄金集口径导出：fixture 仅冻结「带结构的存量资产」，
 * 并把 57 条全量基线汇总与 failed 的纯文本配图闸门估算一起存入元数据。
 * 只读 DB、不写库、不调视觉模型。
 */
async function exportGoldenFixture(all) {
  const golden = all.filter(i => i.structure)
  const byStatus = {}
  for (const i of all) byStatus[i.tikzStatus] = (byStatus[i.tikzStatus] || 0) + 1

  // Phase 0 附带估算：41 条 failed 中多少条有资格重绘（纯文本闸门，零视觉调用）
  const failed = all.filter(i => i.tikzStatus === 'failed')
  const estimate = { failedTotal: failed.length, eligible: 0, number_line: 0, no_figure_reference: 0 }
  for (const f of failed) {
    const r = checkFigureReference(f.content)
    if (r.ok) estimate.eligible++
    else estimate[r.reason] = (estimate[r.reason] || 0) + 1
  }

  await fs.mkdir(dirname(FIXTURE), { recursive: true })
  await fs.writeFile(FIXTURE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: '几何配图重建黄金集（Phase 0）。仅含带结构的存量资产（tikz_json，9 条），结构与题干 content、裁剪图 URL 一起冻结，供离线回归与 before/after 对照。零视觉调用、零库写入。',
    baseline: { total: all.length, byStatus },
    figureGateEstimate: estimate,
    items: golden
  }, null, 2), 'utf8')

  console.log(`✅ golden fixture 已写入 ${FIXTURE}`)
  console.log(`   黄金集 ${golden.length} 条（全为带结构存量资产）；总资产 ${all.length} 条 = ${Object.entries(byStatus).map(([k, v]) => `${k}:${v}`).join(', ')}`)
  console.log(`   failed(${estimate.failedTotal}) 纯文本闸门估算：可重绘 ${estimate.eligible} 条 / 数轴 ${estimate.number_line} / 无图指代 ${estimate.no_figure_reference}`)
  return golden
}

async function main() {
  const all = FROM === 'db' ? await loadFromDb() : await loadFromFixture()

  // --export：刷新 fixture（只读 DB），对照页立即按黄金集渲染
  let golden = all.filter(i => i.structure)
  if (DO_EXPORT) golden = await exportGoldenFixture(all)

  const isFullView = FROM === 'db' && !DO_EXPORT
  const items = selectItems(isFullView ? all : golden)

  const tally = {}
  for (const i of items) {
    const key = i.structure ? `${i.tikzStatus}(有结构)` : i.tikzStatus
    tally[key] = (tally[key] || 0) + 1
  }
  tally['来源'] = isFullView ? 'db·全量基线' : `${FROM === 'db' ? 'db' : 'fixture'}·黄金集`

  await fs.mkdir(OUT_DIR, { recursive: true })
  const out = resolve(OUT_DIR, 'index.html')
  await fs.writeFile(out, buildHtml(items, tally), 'utf8')
  console.log(`📄 对照页：${out}`)
  console.log(`   ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' ')}`)

  // --export 时额外存档一份全量 57 条基线页，方便核对存量状态（completed/failed/none）
  if (DO_EXPORT && FROM === 'db') {
    const fullTally = {}
    for (const i of all) fullTally[i.tikzStatus] = (fullTally[i.tikzStatus] || 0) + 1
    const fullOut = resolve(OUT_DIR, 'index.full.html')
    await fs.writeFile(fullOut, buildHtml(selectItems(all), fullTally), 'utf8')
    console.log(`📄 全量基线存档：${fullOut}（${all.length} 条）`)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e); process.exit(1) })



