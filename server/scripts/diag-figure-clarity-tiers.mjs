/**
 * 错题配图「清晰度分档」统计（只读，不改任何数据）
 *
 * 按前端 src/utils/geometryDisplay.js::getGeometryDisplayUrl 的取图优先级分档：
 *   T1 矢量级  = clean_geometry_svg(SVG源码) 或 display_image_type='tikz'+tikz_svg_url
 *                （无限清晰、可编辑，最理想）
 *   T2 净化位图 = clean_geometry_image_url 是 http URL（去灰底/白化/纠偏/超分后的清晰位图）
 *   T3 仅原卷裁片 = 只有 geometry_image_url（手机拍的印刷图，可能模糊/灰底/歪）
 *   T4 无图     = 三档都没有
 *
 * 目的：量化「全量清晰化通道」的收益——多少错题还停在 T3(可能模糊)/T4，
 * 多少已在 T1/T2(够清晰)。T3 里再抽样测短边分辨率，估算真正"模糊"的占比。
 *
 * 用法：node scripts/diag-figure-clarity-tiers.mjs [--sample 40]
 */
import dotenv from 'dotenv'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import sharp from 'sharp'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env') })
const { query, TABLES } = await import('../config/neon.js')
const { hasFigureReference } = await import('../utils/questionCompleteness.js')

const isUrl = (s) => !!s && /^https?:\/\//i.test(String(s).trim())
const isSvgCode = (s) => !!s && /<svg[\s>]/i.test(String(s)) && !isUrl(s)
const isTikzCode = (s) => !!s && String(s).trim().startsWith('\\begin{tikzpicture}')

const { rows } = await query(
  `SELECT q.id, q.content, q.parent_stem, q.geometry_image_url, q.clean_geometry_image_url,
          q.clean_geometry_svg, q.tikz_svg_url, q.display_image_type
     FROM ${TABLES.QUESTIONS} q LEFT JOIN ${TABLES.TASKS} t ON t.id = q.task_id
    WHERE q.deleted_at IS NULL AND (t.id IS NULL OR t.deleted_at IS NULL)
      AND (q.is_correct = FALSE OR q.answer_source = 'blank')`
)

const tiers = { T1_vector: [], T2_clean: [], T3_raw_only: [], T4_none: [] }
// 只统计「引图错题」（题干含如图/见图/图N 等）——不引图的纯计算题本就无需配图，计入会严重虚高 T4。
let totalWrong = 0, figureWrong = 0
for (const q of rows) {
  totalWrong++
  if (!hasFigureReference(q)) continue
  figureWrong++
  const vector = isSvgCode(q.clean_geometry_svg) || (q.display_image_type === 'tikz' && isUrl(q.tikz_svg_url))
    || isTikzCode(q.clean_geometry_image_url) || isSvgCode(q.clean_geometry_image_url)
  if (vector) { tiers.T1_vector.push(q); continue }
  if (isUrl(q.clean_geometry_image_url)) { tiers.T2_clean.push(q); continue }
  if (isUrl(q.geometry_image_url)) { tiers.T3_raw_only.push(q); continue }
  tiers.T4_none.push(q)
}

// T3 抽样测短边分辨率（估算"模糊"占比：短边 < 300px 视为偏糊/偏小）
const sampleN = Number((process.argv.find(a => a.startsWith('--sample')) || '').split(/\s|=/)[1]) || 40
const sample = tiers.T3_raw_only.slice(0, sampleN)
let small = 0, measured = 0
const shortEdges = []
for (const q of sample) {
  try {
    const buf = Buffer.from(await (await fetch(q.geometry_image_url)).arrayBuffer())
    const m = await sharp(buf).metadata()
    const se = Math.min(m.width || 0, m.height || 0)
    if (se > 0) { measured++; shortEdges.push(se); if (se < 300) small++ }
  } catch { /* 单张失败跳过 */ }
}
const median = shortEdges.slice().sort((a, b) => a - b)[Math.floor(measured / 2)] ?? '-'

const total = figureWrong
const pct = (n) => total ? `${(n / total * 100).toFixed(0)}%` : '0%'
const lines = []
lines.push('# 错题配图清晰度分档统计（只读）')
lines.push('')
lines.push(`错题总数（判错/未作答、未删）：${totalWrong}`)
lines.push(`其中引图错题（本题真正需要配图，以下分档口径）：${figureWrong}`)
lines.push('')
lines.push('| 档 | 含义 | 数量 | 占比 |')
lines.push('|---|---|---|---|')
lines.push(`| T1 矢量级 | SVG/TikZ，无限清晰可编辑 | ${tiers.T1_vector.length} | ${pct(tiers.T1_vector.length)} |`)
lines.push(`| T2 净化位图 | 去灰底/白化/纠偏/超分，清晰 | ${tiers.T2_clean.length} | ${pct(tiers.T2_clean.length)} |`)
lines.push(`| T3 仅原卷裁片 | 手机拍印刷图，可能模糊 | ${tiers.T3_raw_only.length} | ${pct(tiers.T3_raw_only.length)} |`)
lines.push(`| T4 无图 | 三档皆无（引图却无图，需先补图） | ${tiers.T4_none.length} | ${pct(tiers.T4_none.length)} |`)
lines.push('')
lines.push(`## T3 抽样分辨率（前 ${sampleN} 张，实测 ${measured} 张）`)
lines.push(`- 短边中位数：${median}px`)
lines.push(`- 短边 < 300px（偏糊/偏小）：${small}/${measured}${measured ? ` = ${(small / measured * 100).toFixed(0)}%` : ''}`)
lines.push(`- 外推 T3 里"确实偏糊"约：${measured ? Math.round(tiers.T3_raw_only.length * small / measured) : '?'} 道`)
lines.push('')
lines.push('## 结论口径')
lines.push(`- 已够清晰（T1+T2）：${tiers.T1_vector.length + tiers.T2_clean.length}（${pct(tiers.T1_vector.length + tiers.T2_clean.length)}）`)
lines.push(`- 清晰化通道目标集（T3+T4）：${tiers.T3_raw_only.length + tiers.T4_none.length}（${pct(tiers.T3_raw_only.length + tiers.T4_none.length)}）`)
lines.push(`  其中 T3 可走"净化+超分"抬清晰度、T4 需先补图（缺图治理已覆盖大部分）`)

const report = lines.join('\n')
const outPath = join(__dirname, '..', '..', `_错题配图清晰度分档-20260927.md`)
writeFileSync(outPath, report, 'utf8')
console.log(report)
console.log(`\n[报告] ${outPath}`)
process.exit(0)
