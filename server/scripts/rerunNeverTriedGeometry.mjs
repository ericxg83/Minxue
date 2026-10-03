/**
 * 方向二批次执行器 — 把「从未尝试过 tikz 重绘」的 geometry_image 资产跑一遍既有确定性构造管线。
 *
 * 背景（2026-10-03 负责人批准预算，任务书见 docs/auto/backlog.md「方向二批次执行任务书」）：
 * question_assets 里 asset_type='geometry_image' 且 tikz_status='none' 且 last_error 为空的资产，
 * 是从来没有进过几何重绘链线的存量配图（裁片清晰度低于矢量产物）。本脚本按单资产路径
 * 直接调用 geometryWorker.processGeometryReconstruction({data:{assetId}})——不经过 BullMQ/Redis，
 * 只写 DB + 调视觉模型，等价于 worker concurrency=1 的逐个处理。
 *
 * 选材边界（与既有闸门保持一致，不放宽任何门禁）：
 *   - 只选 last_error 为空的（带 last_error 的是闸门确定性拒绝，重跑会再次被拒，白烧额度）
 *   - 只选题干未删除的（q.deleted_at IS NULL）
 *   - 逐张串行 + 间隔，命中限流信号（failed + "N分钟后重试"）应停止，交由生产兜底跨日重试
 *
 * 用法：
 *   node scripts/rerunNeverTriedGeometry.mjs --dry            # 只打印目标清单，零调用
 *   node scripts/rerunNeverTriedGeometry.mjs --limit=2        # 抽样验证管线可用
 *   node scripts/rerunNeverTriedGeometry.mjs                  # 全量后台跑
 *   node scripts/rerunNeverTriedGeometry.mjs --ids=a,b        # 指定资产
 */
import dotenv from 'dotenv'
import fs from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const args = process.argv.slice(2)
const getArg = (n) => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : null }
const LIMIT = getArg('limit') ? parseInt(getArg('limit'), 10) : null
const IDS = (getArg('ids') || '').split(',').map(s => s.trim()).filter(Boolean)
const DRY = args.includes('--dry')
const BETWEEN_MS = getArg('gap') ? parseInt(getArg('gap'), 10) : 3000
const PROGRESS = resolve(__dirname, '../../tmp/rerunNeverTriedGeometry.progress.json')

/** 目标池：从未尝试过（last_error 空）且题干存活的 geometry_image 资产 */
const POOL_SQL_BASE = `
  SELECT a.id, a.question_id, q.question_number, LEFT(COALESCE(q.content,''), 36) AS head
    FROM question_assets a
    JOIN questions q ON q.id = a.question_id
   WHERE q.deleted_at IS NULL
     AND a.asset_type = 'geometry_image'
     AND COALESCE(a.tikz_status, '(none)') = 'none'
     AND COALESCE(a.last_error, '') = ''
   ORDER BY a.updated_at ASC`

const { query } = await import('../config/neon.js')
const { processGeometryReconstruction } = await import('../geometryWorker.js')

let sql = POOL_SQL_BASE
const params = []
if (IDS.length) {
  sql = `SELECT a.id, a.question_id, q.question_number, LEFT(COALESCE(q.content,''), 36) AS head
           FROM question_assets a JOIN questions q ON q.id = a.question_id
          WHERE q.deleted_at IS NULL AND a.asset_type = 'geometry_image'
            AND a.id = ANY($1::uuid[]) ORDER BY a.updated_at ASC`
  params.push(IDS)
} else if (LIMIT) {
  sql += ` LIMIT ${parseInt(LIMIT, 10)}`
}

const { rows: pool } = await query(sql, params)
console.log(`[批次] 目标资产 ${pool.length} 个` + (DRY ? '（DRY，零调用）' : ''))
if (DRY) {
  for (const r of pool) console.log(`  ${r.id}  q=${String(r.question_number || '')}  ${r.head}`)
  process.exit(0)
}

fs.mkdirSync(dirname(PROGRESS), { recursive: true })
let ok = 0, reject = 0, error = 0
const failed = []
for (let i = 0; i < pool.length; i++) {
  const { id: assetId, question_id: questionId, head } = pool[i]
  const startedAt = new Date().toISOString()
  console.log(`\n[批次] ===== ${i + 1}/${pool.length} asset=${assetId.slice(0, 8)} | ${head} =====`)
  let verdict = 'error'
  let detail = ''
  try {
    const result = await processGeometryReconstruction({ data: { assetId } })
    if (result?.success) { verdict = 'ok'; ok++ } else {
      verdict = 'reject'; reject++; failed.push(assetId); detail = JSON.stringify(result || {}).slice(0, 200)
    }
  } catch (e) {
    verdict = 'error'; error++; failed.push(assetId); detail = e.message
  }
  console.log(`[批次] ${verdict === 'ok' ? '✅ 出图' : verdict === 'reject' ? '⛔ 未出图' : '❌ 异常'} asset=${assetId.slice(0, 8)} q=${questionId.slice(0, 8)} ${detail}`)
  fs.writeFileSync(PROGRESS, JSON.stringify({
    startedAt: pool.length ? startedAt : null,
    total: pool.length, done: i + 1, ok, reject, error,
    currentAsset: assetId, lastVerdict: verdict, updatedAt: new Date().toISOString(),
    remaining: pool.length - i - 1
  }, null, 2), 'utf8')
  await new Promise(r => setTimeout(r, BETWEEN_MS))
}
console.log(`\n[批次] 完成：出图 ${ok} / 未出图 ${reject} / 异常 ${error}（共 ${pool.length}）`)
if (failed.length) console.log('[批次] 未出图 asset:\n' + failed.join('\n'))
process.exit(0)
