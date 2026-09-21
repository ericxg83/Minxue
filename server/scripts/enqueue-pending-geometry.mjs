/**
 * enqueue-pending-geometry.mjs — 把 pending 的几何资产立即入队重绘
 *
 * 背景（2026-09-21）：事后补登记的 pending 资产行（recrop/人工框补裁等）没有走
 * 「判题终定 → settleGeometryQueue → 入队」的正路，只能等 pendingTaskRecovery 的
 * 30 分钟超时兜底扫描（且该扫描有「入队后 30 分钟静默窗」防重复，见
 * pendingTaskRecovery.js）。本脚本跳过等待立即入队；BullMQ job 存 Redis，
 * 跨实例休眠存活，实例一醒 worker 即消费。
 *
 * ⚠️ 实现注意：不能 import ../queue.js 的 getGeometryQueue —— initQueue 会同时
 * 创建本地 Worker，与本进程无关的机器上跑起来会抢线上 job（2026-09-21 实测）。
 * 这里直接 new BullMQ Queue（只有生产者，没有消费者）。
 *
 * 用法（在 server/ 目录下）：
 *   node scripts/enqueue-pending-geometry.mjs            # dry-run：列出将入队的 pending 资产
 *   node scripts/enqueue-pending-geometry.mjs --apply    # 入队（自动查重：已在队列中的跳过）
 *   node scripts/enqueue-pending-geometry.mjs --id 309f6e8f,de002462 --apply   # 只处理指定题
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const argOf = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const ID_FILTER = (argOf('--id') || '').split(',').map(x => x.trim()).filter(Boolean)

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const { rows } = await pool.query(`
  SELECT a.id, a.question_id, a.created_at, a.retry_count,
         COALESCE(NULLIF(a.cropped_image_url,''), NULLIF(q.geometry_image_url,'')) AS crop_url
    FROM question_assets a
    LEFT JOIN questions q ON q.id = a.question_id
   WHERE a.asset_type = 'geometry_image' AND a.tikz_status = 'pending'
     AND COALESCE(NULLIF(a.cropped_image_url,''), NULLIF(q.geometry_image_url,'')) IS NOT NULL
     ${ID_FILTER.length ? 'AND a.question_id::text LIKE ANY($1)' : ''}
   ORDER BY a.created_at ASC`, ID_FILTER.length ? [ID_FILTER.map(p => p + '%')] : [])

if (!rows.length) { console.log('没有待入队的 pending 资产'); await pool.end(); process.exit(0) }

const conn = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
const queue = new Queue('geometry-reconstruction', { connection: conn })

// 查重：waiting/delayed/active 里已有同 assetId 的 job 就跳过，避免重复烧额度
const existing = new Set()
for (const st of ['waiting', 'delayed', 'active']) {
  try {
    const jobs = await queue.getJobs([st], 0, -1)
    for (const j of jobs) if (j?.data?.assetId) existing.add(j.data.assetId)
  } catch (e) { console.warn(`查重读取 ${st} 失败: ${e.message}`) }
}

console.log(`${APPLY ? '🛠 APPLY' : '🔍 DRY-RUN'} — pending ${rows.length} 条，队列中已有 job ${existing.size} 个\n`)
let enqueued = 0, skippedDup = 0
for (const r of rows) {
  const label = `${r.question_id.slice(0, 8)} created=${r.created_at?.toISOString?.().slice(5, 16)} retry=${r.retry_count}`
  if (existing.has(r.id)) { console.log(`  ⏭ 队列中已有，跳过: ${label}`); skippedDup++; continue }
  if (!APPLY) { console.log(`  将入队: ${label}`); continue }
  try {
    await queue.add('reconstruct', { assetId: r.id }, { attempts: 1 })
    // 与 pendingTaskRecovery 同口径：入队后刷新 updated_at，给兜底扫描开启静默窗
    await pool.query(`UPDATE question_assets SET updated_at = NOW() WHERE id = $1`, [r.id])
    console.log(`  ✅ 已入队: ${label}`)
    enqueued++
  } catch (e) {
    console.log(`  ❌ ${label}: ${e.message}`)
  }
}
console.log(`\n汇总: 入队 ${enqueued}，已在队列跳过 ${skippedDup}`)
await queue.close()
await conn.quit()
await pool.end()
