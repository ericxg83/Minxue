/**
 * 存量几何题补入队：把「有裁片、闸门放行、但从未建过重画资产」的题补建资产并标 pending，
 * 让 geometryWorker 批量扫描把它们真正重画。
 *
 * 背景：用户在白板看到的是模糊原图——因为大量题只有 `geometry_image_url`（原始裁片），
 * 没有 `clean_geometry_image_url`（干净重画图）。进一步查：这些题根本没进过重画队列
 * （question_assets 无记录），原因是它们入库早于「几何资产入队」功能，worker 只在处理
 * 新任务时才建资产，存量题成了漏网之鱼。
 *
 * 本脚本模拟 worker.js 的入队前闸门：
 *   - checkFigureReference 放行        → 建 pending 资产（等 geometryWorker 重画）
 *   - function_graph 且确定性通道出图  → 直接 completed + 回写 SVG + 发布 URL（零视觉额度）
 *   - function_graph 出不了 / 数轴 / 无引用 → 标 none（与 worker 口径一致）
 *
 * 用法：
 *   node server/scripts/backfill-enqueue-geometry-assets.mjs            # 演练
 *   node server/scripts/backfill-enqueue-geometry-assets.mjs --apply    # 实际补资产
 *   node server/scripts/backfill-enqueue-geometry-assets.mjs --apply --limit 20
 *   node server/scripts/backfill-enqueue-geometry-assets.mjs --all      # 不限定课件范围（全库）
 */
import dotenv from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const ALL = argv.includes('--all')
const limitIdx = argv.indexOf('--limit')
const LIMIT = limitIdx >= 0 ? parseInt(argv[limitIdx + 1], 10) || 100 : 100

const { query, transaction } = await import('../config/neon.js')
const { createQuestionAsset } = await import('../services/neonService.js')
const { checkFigureReference } = await import('../utils/geometryFigureGate.js')
const { buildFunctionGraphSvg } = await import('../utils/functionGraph/index.js')
const { renderGeometrySvg } = await import('../utils/geometrySvg.js')
const { publishCleanGeometryUrl } = await import('../utils/geom/cleanGeometryUrl.js')
const { updateQuestionDenormalizedSvg } = await import('../services/neonService.js')

const figRe = ALL ? '' : `AND EXISTS (
  SELECT 1 FROM wrong_questions wq
  WHERE wq.question_id = questions.id
    AND COALESCE(wq.lifecycle_status,'new') <> 'mastered'
    AND wq.added_at >= NOW() - INTERVAL '30 days'
)`

const { rows } = await query(
  `SELECT id, student_id, geometry_image_url, parent_stem, content, question_type
     FROM questions
    WHERE deleted_at IS NULL
      AND geometry_image_url IS NOT NULL
      AND clean_geometry_image_url IS NULL
      AND NOT EXISTS (SELECT 1 FROM question_assets a
                      WHERE a.question_id = questions.id AND a.asset_type = 'geometry_image')
      ${figRe}
    ORDER BY updated_at DESC
    LIMIT $1`,
  [LIMIT]
)

console.log('='.repeat(72))
console.log(`存量几何题补入队${APPLY ? '【实际执行】' : '【演练模式，不改库】'}${ALL ? '（全库）' : '（课件范围：30天非 mastered 错题）'}`)
console.log('='.repeat(72))
console.log(`候选题目: ${rows.length} 条\n`)

const stats = { enqueue: 0, func_completed: 0, none_no_figure: 0, none_number_line: 0, none_func_fail: 0, skip_no_geo_url: 0, fail: 0 }

for (const r of rows) {
  const short = String(r.id).slice(0, 8)
  const gate = checkFigureReference(r.content, r.parent_stem)

  // 闸门不放行：数轴 / 无引用 → 与 worker 一样标 none（但这里根本不建资产，避免噪音）
  if (!gate.ok && gate.reason !== 'function_graph') {
    stats[gate.reason === 'number_line' ? 'none_number_line' : 'none_no_figure']++
    if (!APPLY) console.log(`  [演练] ${short} 闸门拦截(${gate.reason}) → 不建资产`)
    continue
  }

  // 函数图象：优先走确定性通道（零视觉额度）
  if (gate.reason === 'function_graph') {
    const built = buildFunctionGraphSvg(r.parent_stem || '', r.content, renderGeometrySvg)
    if (built) {
      stats.func_completed++
      if (APPLY) {
        await createQuestionAsset({
          question_id: r.id,
          asset_type: 'geometry_image',
          cropped_image_url: r.geometry_image_url,
          tikz_status: 'completed',
          tikz_code: built.svg,
          tikz_json: built.structure,
          last_error: ''
        })
        await updateQuestionDenormalizedSvg(r.id, built.svg)
        const pub = await publishCleanGeometryUrl({ questionId: r.id, svg: built.svg, studentId: r.student_id })
        console.log(`  ✅ ${short} 函数图象确定性出图 + URL${pub.ok ? '✅' : '❌(' + pub.reason + ')'}`)
      } else {
        console.log(`  [演练] ${short} 函数图象可确定性出图 → completed（零视觉额度）`)
      }
      continue
    }
    stats.none_func_fail++
    if (!APPLY) console.log(`  [演练] ${short} 函数图象出不了 → 标 none`)
    continue
  }

  // 真几何题：入队 pending
  stats.enqueue++
  if (!APPLY) {
    console.log(`  [演练] ${short} 入队 pending（待视觉重画） | ${String(r.parent_stem || r.content).slice(0, 34)}`)
    continue
  }
  try {
    await createQuestionAsset({
      question_id: r.id,
      asset_type: 'geometry_image',
      cropped_image_url: r.geometry_image_url,
      tikz_status: 'pending',
      last_error: ''
    })
    console.log(`  📥 ${short} 已建 pending 资产，等待几何 Worker 批量重画`)
  } catch (e) {
    stats.fail++
    console.log(`  ❌ ${short} 建资产失败: ${e.message}`)
  }
}

console.log('\n' + '='.repeat(72))
console.log(`结果：入队 ${stats.enqueue} / 函数图象直接完成 ${stats.func_completed} / 数轴 ${stats.none_number_line} / 无引用 ${stats.none_no_figure} / 函数出不了 ${stats.none_func_fail} / 失败 ${stats.fail}`)
if (stats.enqueue > 0) {
  console.log(`\n下一步：${APPLY ? '运行几何 Worker 批量处理这些 pending 资产' : '加 --apply 实际建资产'}`)
  console.log(`  方式：node -e "import('./server/geometryWorker.js').then(m=>m.processGeometryReconstruction({data:{batch:true}}))"`)
}
process.exit(0)
