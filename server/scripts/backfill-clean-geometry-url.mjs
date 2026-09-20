/**
 * 存量重画 SVG → 图片 URL 回填（方案 A 的收尾动作）。
 *
 * 背景：几何重画只写 clean_geometry_svg，周末课件读 clean_geometry_image_url，
 * 两个字段不通 ⇒ 存量的 15 题重画结果对课件不可见。本脚本把已有 SVG 补发成 URL。
 *
 * 走生产同款通道 utils/geom/cleanGeometryUrl.js（栅格化 → 空白判定 → OSS → 回写），
 * 不是另写一份实现。
 *
 * 用法：
 *   node server/scripts/backfill-clean-geometry-url.mjs           # 演练（只报不改）
 *   node server/scripts/backfill-clean-geometry-url.mjs --apply   # 实际回写
 *   node server/scripts/backfill-clean-geometry-url.mjs --apply --limit 5
 *   node server/scripts/backfill-clean-geometry-url.mjs --apply --force  # 连已有 URL 的也重发
 */
import dotenv from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const FORCE = argv.includes('--force')
const limitIdx = argv.indexOf('--limit')
const LIMIT = limitIdx >= 0 ? parseInt(argv[limitIdx + 1], 10) || 50 : 50

const { query } = await import('../config/neon.js')
const { publishCleanGeometryUrl } = await import('../utils/geom/cleanGeometryUrl.js')

console.log('='.repeat(72))
console.log(`干净几何图 URL 回填${APPLY ? '【实际回写】' : '【演练模式，不改库】'}`)
console.log('='.repeat(72))

const { rows } = await query(
  `SELECT id, student_id, clean_geometry_svg,
          LEFT(COALESCE(content,''), 40) AS content
     FROM questions
    WHERE deleted_at IS NULL
      AND clean_geometry_svg IS NOT NULL
      AND clean_geometry_svg <> ''
      ${FORCE ? '' : `AND (clean_geometry_image_url IS NULL OR clean_geometry_image_url = '')`}
    ORDER BY updated_at DESC
    LIMIT $1`,
  [LIMIT]
)

console.log(`\n候选题目: ${rows.length} 条\n`)
if (rows.length === 0) {
  console.log('没有需要回填的题目（全部已有 clean_geometry_image_url）。')
  process.exit(0)
}

let ok = 0, fail = 0
const reasons = {}

for (const r of rows) {
  const short = String(r.id).slice(0, 8)
  const svgLen = String(r.clean_geometry_svg).length

  if (!APPLY) {
    // 演练：只做栅格化 + 空白判定，不上传
    const { rasterizeCleanSvg, isBlankRaster } = await import('../utils/geom/cleanGeometryUrl.js')
    const png = await rasterizeCleanSvg(r.clean_geometry_svg)
    const blank = await isBlankRaster(png)
    const tag = blank ? '空白图（不发布）' : `可发布 ${(png?.length / 1024 || 0).toFixed(1)}KB`
    console.log(`  [演练] ${short} svg=${svgLen}字符 → ${tag}`)
    console.log(`         ${r.content}`)
    if (!blank) ok++; else fail++
    continue
  }

  const res = await publishCleanGeometryUrl({
    questionId: r.id,
    svg: r.clean_geometry_svg,
    studentId: r.student_id
  })
  if (res.ok) {
    ok++
    console.log(`  ✅ ${short} → ${res.width}x${res.height} ${(res.bytes / 1024).toFixed(1)}KB`)
    console.log(`     ${res.url}`)
  } else {
    fail++
    reasons[res.reason] = (reasons[res.reason] || 0) + 1
    console.log(`  ❌ ${short} 未发布: ${res.reason}`)
  }
}

console.log('\n' + '='.repeat(72))
console.log(`成功 ${ok} / 失败 ${fail}`)
if (Object.keys(reasons).length) {
  console.log('失败原因分布:')
  for (const [k, v] of Object.entries(reasons)) console.log(`  ${k}: ${v}`)
}
if (!APPLY) console.log('（演练模式，未写库；加 --apply 实际回写）')
process.exit(0)
