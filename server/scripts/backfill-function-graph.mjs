/**
 * 存量函数图象题回填：把已入库的几何资产跑一遍确定性函数图象通道。
 *
 * 背景：阶段 0 之前入队的 66 条资产里 65 条失败（98.5%），其中约一半是函数图象题
 * ——它们被塞进了画不出曲线的点线渲染器。本脚本把这些题重新过一遍确定性通道，
 * 能出图的直接写 completed，**零视觉调用、不消耗模型额度**。
 *
 * 只处理**已有 question_assets 记录**的题：没有资产的题说明 OCR 当初没判定为配图题，
 * 不在本通道职责内（那是回填 asset 的事，涉及另一套判定，不在本脚本范围）。
 *
 * 用法：
 *   node server/scripts/backfill-function-graph.mjs                 # 干跑，只报告
 *   node server/scripts/backfill-function-graph.mjs --apply         # 实际写库
 *   node server/scripts/backfill-function-graph.mjs --status none   # 只处理指定 tikz_status（默认 pending,none,failed）
 *   node server/scripts/backfill-function-graph.mjs --only <id前缀> # 只处理指定题
 */

import dotenv from 'dotenv'
import { resolve } from 'node:path'
dotenv.config({ path: 'D:/Minxue_App_V3/server/.env' })

const { query } = await import('../config/neon.js')
const { buildFunctionGraphSvg } = await import('../utils/functionGraph/index.js')
const { renderGeometrySvg } = await import('../utils/geometrySvg.js')
const { updateGeometryReconstructionStatus, updateQuestionDenormalizedSvg } =
  await import('../services/neonService.js')

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const argOf = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const STATUSES = (argOf('status', 'pending,none,failed')).split(',').map(s => s.trim()).filter(Boolean)
const ONLY = argOf('only', null)

const { rows } = await query(
  `SELECT a.id AS asset_id, a.question_id, a.tikz_status, a.tikz_code,
          q.content, q.parent_stem, q.clean_geometry_svg
     FROM question_assets a
     JOIN questions q ON q.id = a.question_id
    WHERE q.deleted_at IS NULL
      AND a.asset_type = 'geometry_image'
      AND a.tikz_status = ANY($1)
    ORDER BY a.question_id`,
  [STATUSES]
)

console.log(`模式：${APPLY ? '⚠️  实际写库 (--apply)' : '干跑（只报告，不写库）'}`)
console.log(`扫描范围：tikz_status ∈ {${STATUSES.join(', ')}}，共 ${rows.length} 条资产`)

const hits = []
const miss = []
for (const r of rows) {
  if (ONLY && !String(r.question_id).startsWith(ONLY)) continue
  let built = null
  try {
    built = buildFunctionGraphSvg(r.parent_stem || '', r.content || '', renderGeometrySvg)
  } catch (e) {
    miss.push({ r, why: `异常: ${e.message}` })
    continue
  }
  if (built) hits.push({ r, built })
  else miss.push({ r, why: '无法从题干确定图形（开口/顶点不明，或题干另有三角形/辅助线）' })
}

console.log('')
console.log(`✅ 可确定性出图：${hits.length} 条`)
for (const h of hits) {
  const s = h.built.spec
  console.log(
    `   [${String(h.r.question_id).slice(0, 8)}] ${s.expression}  开口${s.opens === 'up' ? '上' : '下'} ` +
    `顶点(${s.vertex.x}, ${s.vertex.y})  来源 ${s.solvedFrom}${s.approximate ? ' [代表元]' : ''}  ` +
    `(原状态 ${h.r.tikz_status}${h.r.tikz_code ? '，已有 SVG' : ''})`
  )
}
console.log('')
console.log(`⏭️  跳过：${miss.length} 条（保持原状态，前端回退裁剪原图）`)

if (!APPLY) {
  console.log('')
  console.log('（干跑结束。确认无误后加 --apply 实际写库。）')
  process.exit(0)
}

let ok = 0
let fail = 0
for (const h of hits) {
  try {
    await updateGeometryReconstructionStatus(h.r.asset_id, {
      tikz_status: 'completed',
      tikz_json: h.built.structure,
      tikz_code: h.built.svg,
      last_error: '',
      processed_at: new Date().toISOString()
    })
    await updateQuestionDenormalizedSvg(h.r.question_id, h.built.svg)
    ok++
  } catch (e) {
    fail++
    console.error(`   ❌ [${String(h.r.question_id).slice(0, 8)}] 写库失败: ${e.message}`)
  }
}
console.log('')
console.log(`写库完成：成功 ${ok} / 失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
