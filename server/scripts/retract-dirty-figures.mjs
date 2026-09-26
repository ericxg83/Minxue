/**
 * retract-dirty-figures.mjs — 作废「图上印着内部变量名」的存量脏重绘图（默认 dry-run）
 *
 * 背景（2026-09-26 全库实测）：182 条正在以重绘 SVG 展示的错题里，有 8 条的 SVG
 * **把内部变量名当顶点标签渲染出来了** —— `X_start` / `X_end` / `Y_end` / `arr_x1` /
 * `P0…P10` / `L_left` / `O_curve` / `BC_top`。肉眼一看就是错的，而学生正在看。
 *
 * 成因：这批产物生成于 2026-09-19 之前，早于 `isVertexSymbolLabel` 的占位符过滤；
 * 且这些名字走的是**曲线/坐标轴端点标签**通道，绕过了 vertex 与 labels[] 的过滤
 * （`server/utils/geom/structure.js:49`）。所以只重跑「新题」不会修好它们。
 *
 * 处置：作废重绘产物 → 前端回退原卷裁片（原图永远正确）；随后可用
 * `recrop-figures-hires.mjs` + `vectorize-figures.mjs` 把回退的裁片变清晰。
 *
 * 判据（可复跑，不写死 id）：`getGeometryDisplayUrl` 判定当前展示的是 svg_code，
 * 且 SVG 的 `<text>` 内容命中内部变量名正则。
 *
 * 用法（在 server/ 目录下）：
 *   node scripts/retract-dirty-figures.mjs            # dry-run：只列清单
 *   node scripts/retract-dirty-figures.mjs --apply    # 真作废（先落快照）
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fsp from 'node:fs/promises'
import pg from 'pg'
import { hasFigureReference } from '../utils/questionCompleteness.js'
import { getGeometryDisplayUrl } from '../../src/utils/geometryDisplay.js'

const APPLY = process.argv.includes('--apply')
const argOf = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
// --ids a,b：强制作废指定题（用于「suspect 档经人工看图确认确实脏」的题，如 74eb0e24）。
//   ⛔ 只允许在人工目检后使用；脚本会把 why 标成「人工目检」，便于日后审计。
const FORCE_IDS = (argOf('--ids') || '').split(',').map(s => s.trim()).filter(Boolean)
const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

/**
 * 内部变量名当标签的判据 —— **分两档，只自动处置「确定脏」的**。
 *
 * 为什么不一把梭（2026-09-26 实测教训）：`C1` / `E1` / `V1` 这类「字母+半角数字」
 * 既可能是模型的内部编号，也可能是 `C₁` / `E₁` 的**ASCII 写法**（教材真实标注，
 * 只是下标没渲染成 Unicode）。把后者也一起作废，等于拿正确的图去换一张更差的裁片。
 * 用户口径是「宁可不标，不可误标」，所以：
 *   · definite —— 命中下划线占位符，或同一字母编号 ≥4 个（内部采样点 P0…P22），
 *                 或出现 X1/X2/Y1/Y2 坐标轴端点对，或短编号总数 ≥4 ⇒ 自动作废
 *   · suspect  —— 只剩 1~2 个短编号 ⇒ 只列清单，交人工判断，不自动动
 */
export const PLACEHOLDER_RE = /(_start|_end|_left|_right|_curve|_top|_bottom|_axis|^arr_|^pt_|^seg_|^Axis)/
export const SHORT_ID_RE = /^[A-Z]\d{1,2}$/

export const RETRACT_REASON = '重绘产物把内部变量名当顶点标注（2026-09-19 前的存量脏产物），已作废并回退原卷裁片'

/** @returns {{labels:string[], verdict:'definite'|'suspect'|'clean', why:string}} */
export function classifyLabels(svg) {
  const texts = [...String(svg || '').matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
    .map(m => m[1].trim()).filter(Boolean)
  const labels = [...new Set(texts)]
  const placeholders = labels.filter(t => PLACEHOLDER_RE.test(t))
  if (placeholders.length) return { labels, verdict: 'definite', why: `占位符命名: ${placeholders.slice(0, 4).join(' ')}` }

  const shorts = labels.filter(t => SHORT_ID_RE.test(t))
  if (shorts.length >= 4) return { labels, verdict: 'definite', why: `短编号 ${shorts.length} 个（内部采样点）` }
  const set = new Set(shorts)
  if (set.has('X1') && set.has('X2') && set.has('Y1') && set.has('Y2')) {
    return { labels, verdict: 'definite', why: '坐标轴端点对 X1/X2/Y1/Y2' }
  }
  if (shorts.length) return { labels, verdict: 'suspect', why: `短编号 ${shorts.length} 个，可能是 C₁ 的 ASCII 写法` }
  return { labels, verdict: 'clean', why: '' }
}

const rows = (await pool.query(`
  SELECT q.id, q.question_number, q.content, q.parent_stem, q.geometry_image_url,
         q.clean_geometry_svg, q.clean_geometry_image_url, q.tikz_svg_url, q.display_image_type,
         q.geometry_manual_override,
         a.tikz_status, a.last_error AS asset_last_error, a.id AS asset_id
  FROM questions q
  LEFT JOIN LATERAL (
    SELECT id, tikz_status, last_error FROM question_assets
    WHERE question_id = q.id AND asset_type = 'geometry_image'
    ORDER BY created_at DESC LIMIT 1
  ) a ON TRUE
  WHERE q.deleted_at IS NULL
`)).rows

const definite = []
const suspect = []
const byId = new Map()
for (const r of rows) {
  if (!hasFigureReference({ content: r.content, parent_stem: r.parent_stem })) continue
  byId.set(r.id, r)
  const d = getGeometryDisplayUrl({
    clean_geometry_svg: r.clean_geometry_svg, tikz_svg_url: r.tikz_svg_url,
    clean_geometry_image_url: r.clean_geometry_image_url, geometry_image_url: r.geometry_image_url,
    tikz_status: r.tikz_status, asset_last_error: r.asset_last_error,
    display_image_type: r.display_image_type, geometry_manual_override: r.geometry_manual_override,
  })
  // 覆盖两种「展示脏图」的形态：
  //  ① 展示内联 SVG（d.url 是 SVG 源码）
  //  ② clean_geometry_svg 画残被判退化 → 前端落到 clean_geometry_image_url，
  //     而那张 URL 图正是由这份脏 SVG 栅格化出来的（实测 69ad87d3 / 332711ac）
  const candidates = []
  if (d.type === 'svg_code') candidates.push(d.url)
  if (d.type === 'clean' || d.type === 'svg_code') candidates.push(r.clean_geometry_svg)
  if (/^<svg/i.test(String(r.clean_geometry_image_url || ''))) candidates.push(r.clean_geometry_image_url)
  const judged = candidates.map(classifyLabels).filter(c => c.verdict !== 'clean')
  if (!judged.length) continue
  const worst = judged.some(c => c.verdict === 'definite') ? 'definite' : 'suspect'
  const labels = [...new Set(judged.flatMap(c => c.labels))]
  const why = judged.map(c => c.why).join('; ')
  // ⚠️ 只有「正在内联展示的 SVG 就是脏的」才自动作废。
  // 展示类型为 'clean'（clean_geometry_image_url 是 URL）时，那张 URL 图**可能来自
  // 后续一次成功的重绘**，而 clean_geometry_svg 只是更早的残留 —— 直接作废会把好图也清掉。
  // 这类一律进人工清单，看图再定。
  const auto = worst === 'definite' && d.type === 'svg_code'
  ;(auto ? definite : suspect).push({ ...r, labels, why, shownType: d.type })
}

// --ids 强制作废（人工目检后使用）
for (const p of FORCE_IDS) {
  const r = [...byId.entries()].find(([id]) => id.startsWith(p))?.[1]
  if (!r) { console.log(`⚠ --ids ${p}: 未找到该题，跳过`); continue }
  if (definite.some(h => h.id === r.id)) continue
  const i = suspect.findIndex(h => h.id === r.id)
  const base = i > -1 ? suspect.splice(i, 1)[0] : { ...r, labels: [], shownType: '(强制作废)' }
  definite.push({ ...base, why: '人工目检确认脏（--ids 强制）' })
}

console.log(`${APPLY ? '🛠  APPLY' : '🔍 DRY-RUN'} — 确定脏且正在内联展示（自动作废）：${definite.length} 条；需人工看图：${suspect.length} 条\n`)
console.log('== 确定脏（自动作废）==')
for (const h of definite) {
  console.log(`  ${h.id.slice(0, 8)} 第${h.question_number ?? '?'}题 | ${h.why} | ${String(h.content).replace(/\s+/g, '').slice(0, 26)}`)
}
console.log('\n== 需人工看图（不自动动）==')
for (const h of suspect) {
  console.log(`  ${h.id.slice(0, 8)} 第${h.question_number ?? '?'}题 | shown=${h.shownType} | ${h.why} | ${String(h.content).replace(/\s+/g, '').slice(0, 24)}`)
}

const hits = definite
if (!APPLY) {
  console.log('\n（dry-run：未写库。确认后加 --apply）')
  await pool.end()
  process.exit(0)
}
if (!hits.length) { await pool.end(); process.exit(0) }

const backupPath = new URL(`./logs/retract-dirty-backup-${Date.now()}.json`, import.meta.url)
await fsp.mkdir(new URL('./logs/', import.meta.url), { recursive: true })
await fsp.writeFile(backupPath, JSON.stringify(hits.map(h => ({
  id: h.id, assetId: h.asset_id, labels: h.labels,
  clean_geometry_svg: h.clean_geometry_svg, clean_geometry_image_url: h.clean_geometry_image_url,
  tikz_svg_url: h.tikz_svg_url, display_image_type: h.display_image_type, tikz_status: h.tikz_status,
})), null, 1), 'utf8')
console.log(`💾 回滚快照: ${backupPath.pathname}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const h of hits) {
    // 与 geometryWorker#retractPublishedCleanFigure 同口径：questions 与 assets 两处都清
    await client.query(
      `UPDATE questions SET clean_geometry_svg = NULL, clean_geometry_image_url = NULL,
              tikz_svg_url = NULL, display_image_type = 'raw', updated_at = NOW() WHERE id = $1`, [h.id])
    if (h.asset_id) {
      await client.query(
        `UPDATE question_assets SET clean_geometry_svg = NULL, geometry_structure_json = NULL,
                tikz_code = NULL, tikz_json = NULL, tikz_status = 'none', last_error = $2,
                updated_at = NOW() WHERE id = $1`, [h.asset_id, RETRACT_REASON])
    }
  }
  await client.query('COMMIT')
  console.log(`✅ 已作废 ${hits.length} 条（questions + question_assets）`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error('❌ 已回滚：', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
