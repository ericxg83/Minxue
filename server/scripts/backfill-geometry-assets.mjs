/**
 * 存量补建「几何配图资产行」，把练习册的引图题接进几何重绘队列（2026-09-21）。
 *
 * ── 背景 ──
 * 几何重绘的唯一入口是 `question_assets` 里 `asset_type IN ('geometry_image','chart_image')` 的行
 * （`geometryWorker` 批量扫描 + `pendingTaskRecovery` 都只扫 `tikz_status='pending'`）。
 * 练习册管线 2026-09-21 才补上配图裁剪，**没补建资产行** ⇒ 练习册的引图题永远不重绘，
 * 前端只能显示带学生手写、带邻题文字的原始裁片（老师报障 5 例的根因）。
 * 修复分两半：新任务已在 `processWorkbookGrading` 里接上（`utils/geometryAssetQueue.js`），
 * **本脚本负责存量**。
 *
 * ── 与管线同口径 ──
 * 直接调 `registerGeometryAssets`（生产同一个函数），因此：
 *   · 入队前过配图引用闸门（数轴/函数图象/无引图 → `tikz_status='none'`，不进队列）
 *   · 函数图象题走确定性通道当场出图（零视觉调用）
 *   · 只让**会进错题本的题**（`is_correct=false` 或空答）留在 `pending`，其余降级 `none`
 *     —— 否则 `pendingTaskRecovery` 会把判对的题也捞起重绘，白烧额度。
 *
 * 用法：
 *   node scripts/backfill-geometry-assets.mjs                 # 预演：只列清单，不写库
 *   node scripts/backfill-geometry-assets.mjs --apply         # 建行（错的留 pending、其余 none）
 *   node scripts/backfill-geometry-assets.mjs --apply --limit=20
 *   node scripts/backfill-geometry-assets.mjs --apply --enqueue   # 再显式入队（队列不可用时由批量扫描兜底）
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import { registerGeometryAssets, settleGeometryQueue } from '../utils/geometryAssetQueue.js'

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] || ''
const APPLY = process.argv.includes('--apply')
const ENQUEUE = process.argv.includes('--enqueue')
const LIMIT = parseInt(arg('limit') || '0', 10)

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// 有配图、且没有任何资产行的题（`deleted_at IS NULL` 排除软删）
const LIMIT_SQL = LIMIT > 0 ? `LIMIT ${LIMIT}` : ''
const rows = (await pool.query(`
  SELECT q.id, q.content, q.parent_stem, q.options, q.image_type, q.image_bbox, q.page_number,
         q.geometry_image_url, q.is_correct, q.answer_source, q.student_id, q.task_id,
         t.images AS task_images, t.original_name
    FROM questions q
    LEFT JOIN tasks t ON t.id = q.task_id
   WHERE q.geometry_image_url IS NOT NULL AND q.geometry_image_url <> ''
     AND q.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM question_assets a
        WHERE a.question_id = q.id AND a.asset_type IN ('geometry_image', 'chart_image')
     )
   ORDER BY q.created_at DESC
   ${LIMIT_SQL}`)).rows

console.log(`\n=== 待补建资产行的题：${rows.length} 条 ===`)
const byTask = new Map()
for (const r of rows) {
  const k = `${String(r.task_id).slice(0, 8)} ${r.original_name || '-'}`
  byTask.set(k, (byTask.get(k) || 0) + 1)
}
for (const [k, n] of [...byTask.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)

const wrong = rows.filter((r) => r.is_correct === false || r.answer_source === 'blank')
console.log(`  其中会进错题本（判错/空答）= ${wrong.length} 条 → 只有这些留在重绘队列`)

if (!APPLY) {
  console.log('\n预演结束（未写库）。加 --apply 建行。')
  await pool.end()
  process.exit(0)
}

let created = 0
let pending = 0
let demoted = 0
let enqueued = 0

// 按 task 分组：registerGeometryAssets 需要按题取页图
for (const r of rows) {
  const pageImages = Array.isArray(r.task_images) ? r.task_images : []
  const pageImageOf = (pn) => (pageImages.find((x) => (x?.page_number || 1) === (pn || 1)) || {}).image_url || null
  try {
    const reg = await registerGeometryAssets({
      questions: [r],
      pageImageOf,
      fallbackImageUrl: pageImages[0]?.image_url || null,
      studentId: r.student_id,
      log: () => {},
      warn: (m) => console.warn(m),
    })
    created += reg.created
    pending += reg.pending.length
    if (reg.pending.length > 0) {
      const toRedraw = await settleGeometryQueue(
        reg.pending,
        () => r.is_correct === false || r.answer_source === 'blank',
        async (assetIds) => {
          await pool.query(
            `UPDATE question_assets SET tikz_status = 'none', updated_at = NOW() WHERE id = ANY($1::uuid[])`,
            [assetIds],
          )
          demoted += assetIds.length
        },
        () => {},
      )
      if (ENQUEUE && toRedraw.length > 0) {
        try {
          const { getGeometryQueue } = await import('../queue.js')
          const q = await getGeometryQueue()
          if (q) {
            for (const assetId of toRedraw) { await q.add('reconstruct', { assetId }, { attempts: 1 }); enqueued++ }
          }
        } catch (e) {
          console.warn(`   ⚠️ 入队失败（交给批量扫描兜底）: ${e.message.slice(0, 70)}`)
        }
      }
    }
  } catch (e) {
    console.warn(`   ⚠️ ${String(r.id).slice(0, 8)} 建行失败: ${e.message.slice(0, 90)}`)
  }
}

await pool.end()
console.log(`\n完成：建行 ${created} / 保留 pending ${pending} / 降级 none ${demoted} / 显式入队 ${enqueued}`)
console.log('若未显式入队，geometryWorker 的批量扫描会在下个周期自动捞起 pending 资产。')
