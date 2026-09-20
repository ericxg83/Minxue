/**
 * 止血：回退「无视觉闭环校验」的目测重画图。
 *
 * 背景（2026-09-18）：批量重画时 GEOMETRY_FORCE_DSL 未开启，34 张 completed 资产
 * 全部走了旧 JSON 通道（视觉模型对模糊裁片目测坐标 → 一次渲染 → 入库）。该通道
 * 没有「画完把原图和重画并排给模型看、确认一致才入库」的闭环，产物拓扑可能对、
 * 但形态（角度/位置/分布/朝向）与原卷不一致——用户实测截图反馈"跟原图根本不一样"。
 *
 * 本脚本把这类资产从 questions 反范式字段撤掉：
 *   clean_geometry_svg / clean_geometry_image_url / display_image_type
 * 白板（读 clean_geometry_image_url）与错题本/重练卷/PDF（读 clean_geometry_svg）
 * 全部回退显示原卷裁片（geometry_image_url），保证"宁可模糊、不给错图"。
 *
 * 不删 asset 记录：tikz_code 里保留 SVG 与 tikz_status='none' 标注，
 * 待 DSL 视觉闭环通道（GEOMETRY_FORCE_DSL=1）额度恢复后统一重跑。
 * 函数图象确定性通道产物（tikz_json 含 expression/spec，数学精确）不受影响。
 *
 * 用法：node server/scripts/rollback-unverified-geometry.mjs [--apply]
 */
import dotenv from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const APPLY = process.argv.includes('--apply')
const { query, transaction } = await import('../config/neon.js')

const { rows } = await query(
  `SELECT a.id AS asset_id, q.id AS qid, a.tikz_json::text LIKE '%expression%' OR a.tikz_json::text LIKE '%spec%' AS is_func
     FROM question_assets a
     JOIN questions q ON q.id = a.question_id
    WHERE a.asset_type = 'geometry_image' AND a.tikz_status = 'completed'`
)
const funcIds = rows.filter(r => r.is_func).map(r => r.qid)
const rollbackRows = rows.filter(r => !r.is_func)

console.log('='.repeat(72))
console.log(`回退未闭环目测重画图${APPLY ? '【实际执行】' : '【演练】'}`)
console.log(`completed 总数: ${rows.length} | 函数图象(保留): ${funcIds.length} | 需回退: ${rollbackRows.length}`)
for (const r of rollbackRows.slice(0, 40)) console.log(`  → ${String(r.qid).slice(0, 8)}`)

if (!APPLY) {
  console.log('\n（演练模式，未动库；加 --apply 实际执行）')
  process.exit(0)
}

// 事务：撤 questions 反范式字段 + 资产标 none
await transaction(async (client) => {
  const ids = rollbackRows.map(r => r.qid)
  if (ids.length === 0) return
  const { rowCount } = await client.query(
    `UPDATE ${(await import('../config/neon.js')).TABLES.QUESTIONS}
        SET clean_geometry_svg = NULL,
            clean_geometry_image_url = NULL,
            display_image_type = 'geometry',
            updated_at = NOW()
      WHERE id = ANY($1::uuid[])`,
    [ids]
  )
  console.log(`\n✅ questions 反范式字段已撤销: ${rowCount} 行`)

  const assetIds = rollbackRows.map(r => r.asset_id)
  const { rowCount: rc2 } = await client.query(
    `UPDATE question_assets
        SET tikz_status = 'none',
            last_error = '未通过视觉闭环校验（DSL 未启用时旧通道产物），已回退原图；待 DSL 闭环重跑',
            processed_at = NOW(),
            updated_at = NOW()
      WHERE id = ANY($1::uuid[])`,
    [assetIds]
  )
  console.log(`✅ 资产已标 none（SVG 仍在 tikz_code，可随时恢复）: ${rc2} 行`)
})

// 验证
const { rows: c } = await query(
  `SELECT COUNT(*)::int AS n FROM questions WHERE clean_geometry_image_url IS NOT NULL`
)
console.log(`\n回退后仍有干净 URL 的题: ${c[0].n}（应为函数图象等确定性产物）`)
process.exit(0)