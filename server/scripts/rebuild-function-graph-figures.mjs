/**
 * 重建函数图象通道产物（V2：确定性骨架 + 视觉标注补全）。
 *
 * 用法：node server/scripts/rebuild-function-graph-figures.mjs [--apply] [--limit N] [--no-vision]
 *   --no-vision  跳过视觉补标注（纯确定性骨架）
 *
 * 2026-09-18 V2：旧版纯文本正则解析"读字不读图"，题干没写坐标的字母被静默丢弃。
 * 新版对每题：确定性骨架 → 视觉模型看原图识别全部字母 → 坐标映射合并 → 入库。
 */
import dotenv from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const APPLY = process.argv.includes('--apply')
const NO_VISION = process.argv.includes('--no-vision')
const limitIdx = process.argv.indexOf('--limit')
const LIMIT = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) || 200 : 200

const { query } = await import('../config/neon.js')
const { buildFunctionGraphSvg } = await import('../utils/functionGraph/index.js')
const { renderGeometrySvg } = await import('../utils/geometrySvg.js')
const { callVisionCompletion } = await import('../config/ai.js')
const { updateQuestionDenormalizedSvg } = await import('../services/neonService.js')
const { publishCleanGeometryUrl } = await import('../utils/geom/cleanGeometryUrl.js')
const { identifyVisionLabels, mergeVisionLabels } = await import('../utils/functionGraph/visionAnnotate.js')

const { rows } = await query(
  `SELECT q.id, q.student_id, q.parent_stem, q.content, q.geometry_image_url
     FROM question_assets a
     JOIN questions q ON q.id = a.question_id
    WHERE a.asset_type = 'geometry_image'
      AND a.tikz_status = 'completed'
      AND q.clean_geometry_svg IS NOT NULL
      AND a.tikz_json::text LIKE '%expression%'
    ORDER BY a.updated_at DESC
    LIMIT $1`,
  [LIMIT]
)

console.log('='.repeat(72))
console.log(`重建函数图象产物（V2 视觉标注）${APPLY ? '【实际执行】' : '【演练】'}${NO_VISION ? '（纯确定性）' : '（含视觉补标）'}，候选 ${rows.length}`)

const visionCache = new Map() // questionId -> Buffer

async function downloadImage(url) {
  const key = String(url)
  if (visionCache.has(key)) return visionCache.get(key)
  try {
    const { default: axios } = await import('axios')
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, proxy: false })
    const buf = Buffer.from(resp.data)
    visionCache.set(key, buf)
    return buf
  } catch {
    visionCache.set(key, null)
    return null
  }
}

let rebuilt = 0, skipped = 0, fail = 0, annotated = 0
for (const r of rows) {
  const short = String(r.id).slice(0, 8)
  const built = buildFunctionGraphSvg(r.parent_stem || '', r.content, renderGeometrySvg)
  if (!built || !built.svg) {
    skipped++
    console.log(`  ➖ ${short} 重建失败/出不了图，保持现状`)
    continue
  }
  rebuilt++

  let finalSvg = built.svg
  let finalStructure = built.structure

  // 视觉补标注
  if (!NO_VISION && r.geometry_image_url) {
    try {
      const rawBuf = await downloadImage(r.geometry_image_url)
      if (rawBuf) {
        const imageDataURL = `data:image/png;base64,${rawBuf.toString('base64')}`
        const callVision = async ({ systemPrompt, userText, imageDataURL: img }) => {
          const vr = await callVisionCompletion({ imageDataURL: img, systemPrompt, userText, temperature: 0.1, maxTokens: 2048 })
          return vr.content
        }
        const vision = await identifyVisionLabels({ imageDataURL, callVision })
        if (vision.length > 0) {
          const merged = mergeVisionLabels(built.structure, vision, built.spec, [r.parent_stem, r.content].join(' '))
          if (merged.points.length > built.structure.points.length) {
            finalStructure = merged
            finalSvg = renderGeometrySvg(merged)
            annotated++
          }
        }
      }
    } catch (e) {
      console.log(`  ⚠️ ${short} 视觉补标注失败（降级确定性）: ${e.message}`)
    }
  }

  if (!APPLY) {
    console.log(`  [演练] ${short} SVG ${finalSvg.length} 字符${annotated ? ' +视觉标注' : ''}`)
    continue
  }
  try {
    await updateQuestionDenormalizedSvg(r.id, finalSvg)
    const pub = await publishCleanGeometryUrl({ questionId: r.id, svg: finalSvg, studentId: r.student_id })
    console.log(`  ✅ ${short} 已重建（${finalStructure.points.length} 点）URL${pub.ok ? '' : '❌(' + pub.reason + ')'}`)
  } catch (e) {
    fail++
    console.log(`  ❌ ${short} 写入失败: ${e.message}`)
  }
}

console.log('\n' + '='.repeat(72))
console.log(`重建 ${rebuilt} / 视觉补标注 ${annotated} / 跳过 ${skipped} / 失败 ${fail}`)
if (!APPLY) console.log('（演练，未动库；加 --apply 执行）')
process.exit(0)