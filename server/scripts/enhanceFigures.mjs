/**
 * 存量配图批量增强脚本
 *
 * 用法：
 *   node enhanceFigures.mjs                    # dry-run（默认）：下载增强，只出报告不写库
 *   node enhanceFigures.mjs --apply            # 写库：clean_geometry_image_url（先落快照）
 *   node enhanceFigures.mjs --limit 20         # 限制处理条数
 *   node enhanceFigures.mjs --grade 初三        # 按年级过滤
 *   node enhanceFigures.mjs --min-short 300    # 短边<300 的裁片 lanczos 放大（超分兜底）
 *
 * 纪律（沿 recrop 系脚本）：
 *   - 只写 clean_geometry_image_url 一列，绝不覆盖 geometry_image_url（原卷证据）
 *   - 只处理 clean_geometry_image_url IS NULL 的题（不覆盖函数图象通道已发布的 URL）
 *   - --apply 前先落快照 server/scripts/logs/enhance-backup-*.json
 *   - 增强失败静默跳过，保留原裁片
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import pg from 'pg'
import { enhanceAndUploadFigure, enhanceFigureBuffer } from '../services/figureEnhanceService.js'

const APPLY = process.argv.includes('--apply')
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? Number(process.argv[i + 1]) : 0 })()
const GRADE = (() => { const i = process.argv.indexOf('--grade'); return i >= 0 ? process.argv[i + 1] : null })()
const MIN_SHORT = (() => { const i = process.argv.indexOf('--min-short'); return i >= 0 ? Number(process.argv[i + 1]) : 300 })()

const LOG_DIR = 'D:/Minxue_App_V3/server/scripts/logs'
fs.mkdirSync(LOG_DIR, { recursive: true })
const log = (s) => fs.appendFileSync(`${LOG_DIR}/enhance-run.log`, s + '\n')

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// 只处理：有裁片 + 无 clean 值（不覆盖函数图象通道/人工产物）
let sql = `
  SELECT q.id, q.geometry_image_url, q.student_id, q.clean_geometry_image_url,
         substring(q.content, 1, 30) AS content
  FROM questions q
  WHERE q.geometry_image_url IS NOT NULL
    AND q.clean_geometry_image_url IS NULL`
const params = []
if (GRADE) {
  params.push(GRADE)
  sql += ` AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = q.task_id AND t.grade = $${params.length})`
}
sql += ` ORDER BY q.updated_at DESC`
if (LIMIT > 0) { params.push(LIMIT); sql += ` LIMIT $${params.length}` }

const rows = (await pool.query(sql, params)).rows
log(`[增强批量] ${APPLY ? 'APPLY' : 'DRY-RUN'} 待处理 ${rows.length} 题${GRADE ? `（年级=${GRADE}）` : ''}`)

const backup = []
let ok = 0, fail = 0, skip = 0
for (const r of rows) {
  try {
    // dry-run：本地增强验证可行性与成功率，不传 OSS、不写库
    let newUrl = null
    if (APPLY) {
      newUrl = await enhanceAndUploadFigure(r.geometry_image_url, r.student_id, r.id, { minShortEdge: MIN_SHORT })
    } else {
      const buf = Buffer.from(await (await fetch(r.geometry_image_url)).arrayBuffer())
      const enhanced = await enhanceFigureBuffer(buf, { minShortEdge: MIN_SHORT })
      if (enhanced && enhanced.length !== buf.length) newUrl = '(dry-run 本地增强成功)'
    }
    if (!newUrl) {
      fail++
      log(`  ✗ ${r.id.slice(0, 8)}: 增强失败（保留原裁片）`)
      continue
    }
    backup.push({ id: r.id, before: r.clean_geometry_image_url, after: newUrl, src: r.geometry_image_url })
    if (APPLY) {
      await pool.query(`UPDATE questions SET clean_geometry_image_url = $1, updated_at = NOW() WHERE id = $2`, [newUrl, r.id])
    }
    ok++
    log(`  ✓ ${r.id.slice(0, 8)}: ${r.geometry_image_url.split('/').pop().slice(0, 30)} -> ${newUrl.split('/').pop().slice(0, 30)}`)
  } catch (e) {
    fail++
    log(`  ✗ ${r.id.slice(0, 8)}: ${e.message.slice(0, 100)}`)
  }
}

// 快照（无论 apply 与否都留记录）
const snap = `${LOG_DIR}/enhance-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`
fs.writeFileSync(snap, JSON.stringify(backup, null, 2), 'utf8')
log(`[增强批量] 完成 ok=${ok} fail=${fail} skip=${skip} 快照=${snap}${APPLY ? '' : '（未写库）'}`)
console.log(`ok=${ok} fail=${fail} snapshot=${snap}`)
await pool.end()
process.exit(0)