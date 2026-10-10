#!/usr/bin/env node
/**
 * 数据保险库——每日快照（提案 4，2026-10-02 负责人批准）
 * ───────────────────────────────────────────────────────────────────────
 * 只读导出核心表到 D:/Minxue_Backup/YYYY-MM-DD/，保留最近 30 份。
 * 纯 SELECT，零写入数据库，零业务链路改动。也可手动执行：
 *   node scripts/dailyBackup.mjs
 *
 * ⛔ 调用方是谁（2026-10-10 更正，**旧注释写「由 21:30 收工轮调用」是假的**）：
 *    真实调用方是 WorkBuddy 自动化「**敏学每日数据备份**」，**每日 03:00** 跑一次
 *    （2026-10-10 负责人拍板「要挂」时建立；见 docs/auto/DECISIONS.md ⑲）。
 *    旧注释宣称有21:30 收工轮在调，实际**全仓零调用方** —— 脚本静静躺着、
 *    备份断档三晚（10-03/04/06）又断 3 天（10-08/09/10）都没人发现，
 *    「注释写了自动」被当成了「自动真的在跑」。**别再靠注释声称谁会调它。**
 *    ⚠️ 仍依赖主机在 03:00 在线；关机/休眠则当天无备份。
 *
 * ⛔ 退出码是这份脚本最重要的产出之一（2026-10-05 r159 修）：
 *    调用方（定时任务 / 手工脚本 / 负责人）只能靠退出码判断「今天有没有真备份上」。
 *    旧版全文没有 process.exit，且「核心表 0 行」也会打「完成」——
 *    连错库、库被清空时会导出一堆空 JSON 然后报成功，**谎报平安**。
 *    现行口径：备份成功 exit 0；中断 / 核心表空 ⇒ exit 1。manifest.json 无论成败都写，
 *    事后能一眼看出这份快照是不是完整的。
 */
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import {
  BACKUP_ROOT,
  KEEP_DAYS,
  TABLES,
  assessBackupResult,
  planExpiredSnapshots,
  snapshotDirName,
} from './backupKit.mjs'

dotenv.config({ path: path.resolve(import.meta.dirname, '../server/.env') })
const { getPool } = await import('../server/config/neon.js')

// 快照目录名走本地日历日（Asia/Shanghai），与轮换判断同口径（见 backupKit.mjs）
const today = snapshotDirName(new Date())
const outDir = path.join(BACKUP_ROOT, today)
fs.mkdirSync(outDir, { recursive: true })

// 轮换：清理超过保留天数的旧快照目录（非快照目录一律不碰）
for (const dir of planExpiredSnapshots(fs.readdirSync(BACKUP_ROOT), new Date(), KEEP_DAYS)) {
  fs.rmSync(path.join(BACKUP_ROOT, dir), { recursive: true, force: true })
  console.log(`[backup] 清理过期快照: ${dir}`)
}

const pool = getPool()
const manifest = {
  date: today,
  ok: false,
  createdAt: new Date().toISOString(),
  tables: {},
  error: null,
}
let interrupted = null

try {
  for (const table of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`)
    const file = path.join(outDir, `${table}.json`)
    fs.writeFileSync(file, JSON.stringify(rows))
    manifest.tables[table] = rows.length
    console.log(`[backup] ${table}: ${rows.length} 行 → ${file}`)
  }
  manifest.ok = true
} catch (err) {
  // ⛔ 核心写盘/取数路径禁止静默 catch：必须上抛并变成非零退出码
  interrupted = err?.message || String(err)
  manifest.error = interrupted
  console.error(`[backup] 备份中断（${outDir}）：${interrupted}`)
} finally {
  // 无论成败都留 manifest：没有 manifest 的快照没人敢用，
  // 但它的存在本身也不代表这份快照是完整的（看 ok 字段）
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await pool.end()
}

const { ok, emptyTables } = assessBackupResult(manifest)
const success = !interrupted && ok && manifest.ok

if (!success) {
  const why = interrupted
    ? `取数/写盘中断：${interrupted}`
    : `核心表为空（备份不成立，多半是连错库或库被清空）：${emptyTables.join('、')}`
  console.error(`[backup] 失败：${why}`)
  console.error(`[backup] 该快照已标记 ok:false，目录 ${outDir}（请勿拿它恢复数据）`)
  process.exit(1)
}

console.log(`[backup] 完成：${outDir}`)
process.exit(0)
