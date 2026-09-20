/**
 * 收尾：把仍有重画价值的 none 资产重置为 pending，交给后端 watchdog 自动重画。
 *
 * 哪些值得重试（2026-09-18 DSL 强制通道已修复后）：
 *   A. 过期标记「待约束求解器接入」——求解器早已接入，旧结论不再成立
 *   B. DSL 波动（max_rounds / dsl_unchanged / DSL 强制…）——模型随机性，重跑常成功
 *   E. 已回退待重画（rollback-unverified-geometry 标记）——当初撤掉旧 JSON 目测图，
 *      现在该由 DSL 通道重画
 *   C. 内容核对未过 且 题干引图 —— 部分是对齐平行线组豁免修复前的旧误杀，
 *      重新入队由新代码判定（数轴/无引用会被新闸门拦下，无副作用）
 *
 * 排除（确定性不该画）：数轴/实物/统计图（无可重绘结构）、无引用。
 *
 * 用法：node server/scripts/reset-retryable-geometry.mjs [--apply] [--scope=handout]
 */
import dotenv from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const APPLY = process.argv.includes('--apply')
const scopeArg = process.argv.find(a => a.startsWith('--scope='))
const SCOPE = scopeArg ? scopeArg.slice(8) : 'handout'

const { query } = await import('../config/neon.js')
const { checkFigureReference } = await import('../utils/geometryFigureGate.js')

const scopeJoin = SCOPE === 'all' ? '' : `
  JOIN questions q ON q.id = a.question_id
  JOIN wrong_questions wq ON wq.question_id = q.id
 WHERE COALESCE(wq.lifecycle_status,'new') <> 'mastered'
   AND wq.added_at >= NOW() - INTERVAL '30 days'
   AND`

const { rows } = await query(
  `SELECT a.id, a.question_id,
          q.parent_stem, q.content, q.geometry_image_url
     FROM question_assets a
     ${scopeJoin}
     a.asset_type = 'geometry_image' AND a.tikz_status = 'none'
     AND (
       a.last_error LIKE '%待约束求解器接入%'
       OR a.last_error LIKE '%max_rounds%'
       OR a.last_error LIKE '%dsl_unchanged%'
       OR a.last_error LIKE '%DSL 强制%'
       OR a.last_error LIKE '%未通过视觉闭环%'
       OR (
         a.last_error LIKE '%在题干中无引用%'
         AND (COALESCE(q.parent_stem,'') || COALESCE(q.content,'')) ~ '如图|图1|图示|附图|见图|直线l|∥|//'
       )
     )
     ORDER BY a.updated_at DESC`
)

console.log('='.repeat(72))
console.log(`重置可重试 none 资产${APPLY ? '【实际执行】' : '【演练】'}（范围: ${SCOPE}）候选 ${rows.length}`)

let canRetry = 0, gateBlocked = 0
for (const r of rows) {
  // 闸门复核：数轴/无引用的旧误判（如平行线豁免修复前）交给新闸门重判
  const gate = checkFigureReference(r.content, r.parent_stem)
  if (!gate.ok && gate.reason !== 'function_graph') {
    gateBlocked++
    if (!APPLY) console.log(`  ➖ ${String(r.question_id).slice(0,8)} 闸门拦截(${gate.reason})，不重置`)
    continue
  }
  canRetry++
  if (!APPLY) {
    console.log(`  📥 ${String(r.question_id).slice(0,8)} 重置 pending | ${String(r.content || r.parent_stem).slice(0, 34)}`)
    continue
  }
  await query(
    `UPDATE question_assets SET tikz_status='pending', retry_count=0, last_error='', processed_at=NULL, updated_at=NOW() WHERE id=$1`,
    [r.id]
  )
  console.log(`  ✅ ${String(r.question_id).slice(0,8)} 已重置 pending`)
}

console.log('\n' + '='.repeat(72))
console.log(`可重试 ${canRetry} / 闸门拦截 ${gateBlocked}`)
if (!APPLY) console.log('（演练，未动库；加 --apply 执行）')
process.exit(0)