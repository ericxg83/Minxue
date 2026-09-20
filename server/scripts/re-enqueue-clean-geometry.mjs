/**
 * 重跑：把「有裁片但无干净图」的题重新入队，走 DSL 强制通道重画。
 *
 * 背景：旧 JSON 通道（模型目测坐标）产物被回退（rollback-unverified-geometry），
 * 现在 DSL 构造式通道已修复并设为强制（含视觉闭环对照原图确认 OK 才入库），
 * 重新把这些题入队。
 *
 * 幂等：对每题——
 *   - 已有 geometry_image 资产 → 重置为 pending
 *   - 无资产 → 按 worker 同款闸门建资产（函数图象走确定性通道，数轴/无引用跳过）
 *
 * 用法：node server/scripts/re-enqueue-clean-geometry.mjs [--all] [--limit N]
 *   --all     全库（默认只处理课件范围：30 天内非 mastered 错题）
 */
import dotenv from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const argv = process.argv.slice(2)
const ALL = argv.includes('--all')
const limitIdx = argv.indexOf('--limit')
const LIMIT = limitIdx >= 0 ? parseInt(argv[limitIdx + 1], 10) || 100 : 200

const { query } = await import('../config/neon.js')
const { checkFigureReference } = await import('../utils/geometryFigureGate.js')
const { buildFunctionGraphSvg } = await import('../utils/functionGraph/index.js')
const { renderGeometrySvg } = await import('../utils/geometrySvg.js')
const { createQuestionAsset, updateQuestionDenormalizedSvg } = await import('../services/neonService.js')
const { publishCleanGeometryUrl } = await import('../utils/geom/cleanGeometryUrl.js')

const scopeClause = ALL ? '' : `AND EXISTS (
  SELECT 1 FROM wrong_questions wq
  WHERE wq.question_id = q.id
    AND COALESCE(wq.lifecycle_status,'new') <> 'mastered'
    AND wq.added_at >= NOW() - INTERVAL '30 days'
)`

const { rows } = await query(
  `SELECT q.id, q.student_id, q.geometry_image_url, q.parent_stem, q.content,
          EXISTS (SELECT 1 FROM question_assets a
                  WHERE a.question_id = q.id AND a.asset_type='geometry_image') AS has_asset,
          (SELECT a.id FROM question_assets a
           WHERE a.question_id = q.id AND a.asset_type='geometry_image'
           ORDER BY a.created_at DESC LIMIT 1) AS asset_id
     FROM questions q
    WHERE q.deleted_at IS NULL
      AND q.geometry_image_url IS NOT NULL
      AND q.clean_geometry_image_url IS NULL
      ${scopeClause}
    ORDER BY q.updated_at DESC
    LIMIT $1`,
  [LIMIT]
)

console.log('='.repeat(72))
console.log(`重跑几何重画（${ALL ? '全库' : '课件范围'}），候选 ${rows.length} 题`)
console.log('='.repeat(72))

let enqueue = 0, funcOk = 0, skipGate = 0, reset = 0

for (const r of rows) {
  const short = String(r.id).slice(0, 8)
  const gate = checkFigureReference(r.content, r.parent_stem)

  // 函数图象：确定性通道直接出图（零视觉额度）
  if (!gate.ok && gate.reason === 'function_graph') {
    const built = buildFunctionGraphSvg(r.parent_stem || '', r.content, renderGeometrySvg)
    if (built && built.svg) {
      try {
        if (!r.has_asset) {
          await createQuestionAsset({
            question_id: r.id, asset_type: 'geometry_image',
            cropped_image_url: r.geometry_image_url,
            tikz_status: 'completed', tikz_code: built.svg, tikz_json: built.structure
          })
        }
        await updateQuestionDenormalizedSvg(r.id, built.svg)
        await publishCleanGeometryUrl({ questionId: r.id, svg: built.svg, studentId: r.student_id })
        funcOk++
        console.log(`  ✅ ${short} 函数图象确定性出图`)
      } catch (e) { console.log(`  ❌ ${short} 函数图象出图异常: ${e.message}`) }
    } else {
      skipGate++
      console.log(`  ➖ ${short} 函数图象出不了（${built?.reason || '无漏洞'}），保持原图`)
    }
    continue
  }
  if (!gate.ok) {
    skipGate++
    console.log(`  ➖ ${short} 闸门拦截(${gate.reason})，保持原图`)
    continue
  }

  // 真几何题：确保有 pending 资产
  try {
    if (r.has_asset && r.asset_id) {
      await query(`UPDATE question_assets SET tikz_status='pending', retry_count=0, last_error='', processed_at=NULL WHERE id=$1`, [r.asset_id])
      reset++
    } else {
      await createQuestionAsset({
        question_id: r.id, asset_type: 'geometry_image',
        cropped_image_url: r.geometry_image_url,
        tikz_status: 'pending'
      })
      enqueue++
    }
    console.log(`  📥 ${short} 已入队（${r.has_asset ? '重置' : '新建'} pending）`)
  } catch (e) {
    console.log(`  ❌ ${short} 入队失败: ${e.message}`)
  }
}

console.log('\n' + '='.repeat(72))
console.log(`新建入队 ${enqueue} / 重置 pending ${reset} / 函数图象直出 ${funcOk} / 闸门跳过 ${skipGate}`)
console.log(`下一步跑批量：node scripts/_run-batch-geometry.mjs（会重复跑已 pending，可继续）`)
process.exit(0)