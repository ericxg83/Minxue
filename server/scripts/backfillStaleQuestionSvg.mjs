/**
 * 第 77 轮（负责人裁决 A）：把「状态位 completed、但展示层没有可用矢量图」的历史资产补回真图。
 *
 * 背景（2026-10-03 第 74 轮登记、第 77 轮纠正）：`question_assets.tikz_status='completed'` 共 455 个，
 * 其中 75 个的 `questions.clean_geometry_svg` 为空或退化。**但“没内联 SVG”≠“看模糊裁片”**：
 * `src/utils/geometryDisplay.js` 的取图链有 7 级，实测这 75 个里 73 个走优先级 5
 * （`clean_geometry_image_url` = 已发布的干净图 URL，TikZ 时代产物），视觉上已经是干净图；
 * 真在显示模糊裁片的只有 2 个。本脚本只处理“资产行确实存着可用 SVG 源码”的那一部分。
 *
 * 关键取证（第 77 轮实测）：这 75 个的 `tikz_code` 内容分为三档——**3 个是 SVG 源码**（可回填）、
 * 71 个是 `\begin{tikzpicture}` 源码（不是 SVG，回填不了，要升级得重跑管线）、1 个为空（真虚标）。
 * 而 `retractPublishedCleanFigure` 作废产物时会把 `tikz_code` 一起清成 NULL —— 所以
 * “资产行还存着 SVG”恰好证明它**不是被主动作废的错图**，回填是安全的，而且**零视觉调用、零额度**。
 *
 * 两道安全闸（只加不减，任一不过就不回填、转重跑）：
 *   ① 产物质量：`tikz_code` 必须含真实图元（line/path/polyline/polygon/circle），
 *      且 `<text>` 里不得有内部变量名（含下划线的 `_a1`/`pt_a` 类脏产物，2026-09-19 旧事故）；
 *   ② 拓扑保真：复用第 75 轮的 `findTopologyInversions` 复核存过的
 *      `tikz_json.points` vs `tikz_json.solved.points`，搬反过的一律不回填。
 *
 * 用法：
 *   node scripts/backfillStaleQuestionSvg.mjs              # 演练：只报清单与分档，零写库
 *   node scripts/backfillStaleQuestionSvg.mjs --apply      # 回填（走生产同款 updateQuestionDenormalizedSvg）
 *   node scripts/backfillStaleQuestionSvg.mjs --apply --publish  # 回填后再发布 clean_geometry_image_url（课件可见）
 *   node scripts/backfillStaleQuestionSvg.mjs --limit=5
 */
import dotenv from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const PUBLISH = args.includes('--publish')
const getArg = (n) => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : null }
const LIMIT = getArg('limit') ? parseInt(getArg('limit'), 10) : null

const { query } = await import('../config/neon.js')
const { updateQuestionDenormalizedSvg } = await import('../services/neonService.js')
const { findTopologyInversions } = await import('../utils/geom/correctedRender.js')

/** 产物里是否混着内部变量名标注（`<text>_a1</text>` / `<text>pt_a</text>` 类脏产物） */
const hasDirtyLabel = (svg) => /<text[^>]*>[^<]*[_$][^<]*<\/text>/.test(svg)
/** 是否含真实图元（与前端 isDegenerateGeometrySvg 同口径） */
const hasShape = (svg) => /<(line|path|polyline|polygon|ellipse|circle)/.test(svg)

const sql = `
  SELECT a.id AS asset_id, a.question_id, a.tikz_code, a.tikz_json,
         q.question_number, LEFT(COALESCE(q.content,''), 30) AS head, a.processed_at,
         (q.clean_geometry_image_url IS NOT NULL AND q.clean_geometry_image_url <> '') AS has_published_product,
         (q.tikz_svg_url IS NOT NULL AND q.tikz_svg_url <> '') AS has_tikz_product
    FROM question_assets a
    JOIN questions q ON q.id = a.question_id
   WHERE a.asset_type = 'geometry_image'
     AND q.deleted_at IS NULL
     AND a.tikz_status = 'completed'
     AND (q.clean_geometry_svg IS NULL
          OR NOT (q.clean_geometry_svg ~ '<(line|path|polyline|polygon|ellipse)'))
   ORDER BY a.processed_at DESC NULLS LAST${LIMIT ? ` LIMIT ${parseInt(LIMIT, 10)}` : ''}`

const { rows } = await query(sql)
console.log(`[回填] 目标池（completed 但展示层无可用 SVG）= ${rows.length} 个${APPLY ? '【实际回写】' : '【演练，零写库】'}`)

const buckets = { backfill: [], dirty: [], degenerate: [], inverted: [], no_svg: [], unverified_switch: [] }
for (const r of rows) {
  const svg = r.tikz_code || ''
  if (!svg.trim()) { buckets.no_svg.push(r); continue }
  if (!hasShape(svg)) { buckets.degenerate.push(r); continue }
  if (hasDirtyLabel(svg)) { buckets.dirty.push(r); continue }
  const pts = Array.isArray(r.tikz_json?.points) ? r.tikz_json.points : []
  const solved = r.tikz_json?.solved?.points
  if (pts.length && solved) {
    const inv = findTopologyInversions(pts, solved)
    if (inv.length > 0) { buckets.inverted.push({ ...r, inv }); continue }
  }
  // 第三道闸（2026-10-03 第 77 轮事故补上）：题目行本来就没有任何已发布干净产物时，
  // 这道回填会把展示从「原卷裁片」切换成「矢量产物」——而矢量产物可能比裁片差
  // （实测 e252aaa5 城门洞抛物线：重画丢了原图上的 A、B 两个顶点标注，回填后反而不如裁片）。
  // 上面两道闸只保证「不是空图/脏标注/拓扑搬反」，保不住「不比原图少东西」，
  // 所以这类一律不自动回填，只列入待人工目检（已不显示干净产物的题不能靠回填变差）。
  if (!r.has_published_product && !r.has_tikz_product) { buckets.unverified_switch.push(r); continue }
  buckets.backfill.push(r)
}

console.log('[回填] 分档：')
console.log(`  ✅ 可安全回填（产物完好且拓扑未搬反）: ${buckets.backfill.length} → 零视觉调用`)
console.log(`  ⛔ 资产行无 SVG（必须重跑管线）      : ${buckets.no_svg.length}`)
console.log(`  ⛔ 产物退化（必须重跑管线）          : ${buckets.degenerate.length}`)
console.log(`  ⛔ 产物含内部变量名脏标注（必须重跑）: ${buckets.dirty.length}`)
console.log(`  ⛔ 存过的解算搬反过拓扑（必须重跑）  : ${buckets.inverted.length}`)
console.log(`  ⚠️ 回填会切换展示来源（需先人工目检）: ${buckets.unverified_switch.length}`)
for (const r of buckets.unverified_switch) {
  console.log(`     待目检 ${r.asset_id.slice(0, 8)} q=${r.question_number} | ${r.head}`)
}
for (const r of buckets.inverted) console.log(`     反转 ${r.asset_id.slice(0, 8)}: ${r.inv.map(i => `${i.pair}@${i.axis}`).join('、')}`)
for (const r of [...buckets.dirty, ...buckets.degenerate, ...buckets.no_svg].slice(0, 12)) {
  console.log(`     待重跑 ${r.asset_id.slice(0, 8)} q=${r.question_number} | ${r.head}`)
}
console.log('\n[回填] 可回填样本（前 10）：')
for (const r of buckets.backfill.slice(0, 10)) console.log(`  ${r.asset_id.slice(0, 8)} q=${String(r.question_number || '').padEnd(3)} svg=${(r.tikz_code || '').length}字符 | ${r.head}`)

if (!APPLY) {
  console.log('\n[回填] 演练结束（未写库）。加 --apply 执行回填。')
  process.exit(0)
}

let ok = 0, fail = 0, published = 0
for (const r of buckets.backfill) {
  try {
    await updateQuestionDenormalizedSvg(r.question_id, r.tikz_code)
    ok++
    if (PUBLISH) {
      const { publishCleanGeometryUrl } = await import('../utils/geom/cleanGeometryUrl.js')
      const res = await publishCleanGeometryUrl({ questionId: r.question_id, svg: r.tikz_code })
      if (res.ok) published++
      else console.log(`  ⚠️ ${r.asset_id.slice(0, 8)} URL 未发布: ${res.reason}`)
    }
  } catch (e) {
    fail++
    console.log(`  ❌ ${r.asset_id.slice(0, 8)} 回填失败: ${e.message}`)
  }
}
console.log(`\n[回填] 完成：题目行 SVG 回填 ${ok} / 失败 ${fail}${PUBLISH ? ` / 已发布课件 URL ${published}` : ''}`)
process.exit(0)
