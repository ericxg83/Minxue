/**
 * 落库 4 道确定性重绘图（2026-09-27）：数轴枚举模式 / functionGraph 归一 / 分数长方形。
 *
 * 已完成的验证（落库前置条件，缺一不可）：
 *   1. 每道都做了「原图裁片 vs 新图」并排放大目检（server/_figcheck_0927/new4_vs_orig.png）；
 *   2. 图形全部由题干明写的数值/表达式确定性生成，零目测、零视觉调用；
 *   3. findSuspiciousSvgLabels 抽查图面标注必须为空。
 *
 * 写库语义与 geometryWorker 发布路径逐字段同款：
 *   questions.clean_geometry_svg   ← SVG 源码（前端 getGeometryDisplayUrl 优先级 1）
 *   questions.clean_geometry_image_url ← 栅格化 PNG 上传 OSS（周末课件 resolveFigure）
 *   question_assets.tikz_status/completed + last_error='' + clean_geometry_svg/tikz_code
 *
 * 用法：node server/scripts/publish-figredraws-0927.mjs          # 预演（构建+校验，不写库）
 *       node server/scripts/publish-figredraws-0927.mjs --apply  # 实发
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { buildNumberAxisSvg } from '../utils/numberAxis/index.js'
import { buildFractionRectSvg } from '../utils/fractionRect/index.js'
import { parseFunctionGraphSpec } from '../utils/functionGraph/parseSpec.js'
import { hasOtherGeometry } from '../utils/functionGraph/index.js'
import { specToGeometryStructure, sampleParabola, xInterceptsOf } from '../utils/functionGraph/buildStructure.js'
import { renderGeometrySvg } from '../utils/geometrySvg.js'
import { findSuspiciousSvgLabels } from '../utils/geometryContentGate.js'
import { publishCleanGeometryUrl } from '../utils/geom/cleanGeometryUrl.js'

const APPLY = process.argv.includes('--apply')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// ── 构建器：question 行 → { svg, note } 或 null ──────────────────────────

function buildB6b1112e(q) {
  const b = buildNumberAxisSvg(q.parent_stem, q.content, renderGeometrySvg)
  return b ? { svg: b.svg, note: 'numberAxis 枚举模式 O/0 A/2 B/3 C/4 D/5' } : null
}

function buildC1619a2e(q) {
  const text = `${q.parent_stem ?? ''} ${q.content ?? ''}`
  if (hasOtherGeometry(text)) return null
  const spec = parseFunctionGraphSpec(q.parent_stem, q.content)
  if (!spec) return null
  const a = spec.a, h = spec.vertex.x, k = spec.vertex.y
  const roots = xInterceptsOf(a, h, k)
  if (roots.length !== 2) return null
  const t0 = Math.min(...roots), t1 = Math.max(...roots)
  if (t0 < -1e-9) return null // 物理情境要求时间非负，负根说明不是本形态
  const st = specToGeometryStructure(spec)
  st.curves = [{ points: sampleParabola(a, h, k, t0, t1), style: 'solid' }]
  st.points.push({ label: String(Math.round(t1 * 1e6) / 1e6), x: t1, y: 0, type: 'vertex' })
  st.points.push({ label: String(Math.round(k * 1e6) / 1e6), x: h, y: k, type: 'vertex' })
  let svg = renderGeometrySvg(st)
  // 物理情境轴字母：渲染器硬编码 x/y，替换为题干变量 t/h（纯记号）
  const varM = /([a-z])\s*\(\s*(?:秒|s)\s*\)/.exec(text)
  const tv = varM ? varM[1] : 't'
  const hv = /([a-z])\s*\(\s*(?:米|m)\s*\)/.exec(text)?.[1] || 'h'
  svg = svg.replace(/>x<\/text>/g, `>${tv}</text>`).replace(/>y<\/text>/g, `>${hv}</text>`)
  return { svg, note: `functionGraph 归一 ${spec.expression}，弧段[${t0},${t1}]，顶点(${h},${k})，轴字母 ${tv}/${hv}` }
}

function buildFraction(q) {
  const b = buildFractionRectSvg(q.parent_stem, q.content)
  return b ? { svg: b.svg, note: `fractionRect ${JSON.stringify(b.spec)}` } : null
}

const TARGETS = [
  { id8: '00dd9f69', build: buildFraction },
  { id8: 'd3bd5ed2', build: buildFraction },
  { id8: 'b6b1112e', build: buildB6b1112e },
  { id8: 'c1619a2e', build: buildC1619a2e },
]

let ok = 0, fail = 0
for (const t of TARGETS) {
  const rs = await pool.query('SELECT id, parent_stem, content FROM questions WHERE id::text LIKE $1', [t.id8 + '%'])
  const q = rs.rows[0]
  if (!q) { console.log(`✗ ${t.id8}: 未找到`); fail++; continue }
  let built
  try { built = t.build(q) } catch (e) { built = null; console.log(`  build throw: ${e.message}`) }
  if (!built) { console.log(`✗ ${t.id8}: 构建失败`); fail++; continue }
  const susp = findSuspiciousSvgLabels(built.svg, `${q.parent_stem ?? ''}\n${q.content ?? ''}`)
  if (susp.length) { console.log(`✗ ${t.id8}: 图面可疑标注 ${susp.join(',')}`); fail++; continue }

  console.log(`✔ ${t.id8}: ${built.note}`)
  if (!APPLY) { ok++; continue }

  await pool.query(
    `UPDATE questions SET clean_geometry_svg = $2, display_image_type = COALESCE(display_image_type, 'clean'), updated_at = NOW() WHERE id = $1`,
    [q.id, built.svg],
  )
  const pub = await publishCleanGeometryUrl({ questionId: q.id, svg: built.svg })
  if (!pub.ok) console.log(`  ⚠ URL 发布未成功: ${pub.reason}（SVG 已写，前端仍显示）`)
  await pool.query(
    `UPDATE question_assets SET tikz_status = 'completed', last_error = '', clean_geometry_svg = $2, tikz_code = $2, processed_at = NOW(), updated_at = NOW()
      WHERE question_id = $1 AND asset_type = 'geometry_image'`,
    [q.id, built.svg],
  )
  ok++
  console.log(`  已落库${pub.ok ? ` + ${pub.url.slice(-30)}` : ''}`)
}
console.log(`\n${APPLY ? '已发布' : '预演'}：成功 ${ok}，失败 ${fail}`)
await pool.end()
