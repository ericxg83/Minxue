#!/usr/bin/env node
/**
 * 数据保险库——每日快照（提案 4，2026-10-02 负责人批准）
 * ─────────────────────────────────────────────────────────────
 * 只读导出核心表到 D:/Minxue_Backup/YYYY-MM-DD/，保留最近 30 份。
 * 纯 SELECT，零写入数据库，零业务链路改动。由 21:30 收工轮调用，也可手动执行：
 *   node scripts/dailyBackup.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(import.meta.dirname, '../server/.env') })
const { getPool } = await import('../server/config/neon.js')

const BACKUP_ROOT = 'D:/Minxue_Backup'
const KEEP_DAYS = 30
const TABLES = ['students', 'tasks', 'wrong_questions', 'questions', 'knowledge_mastery']

const today = new Date().toISOString().slice(0, 10)
const outDir = path.join(BACKUP_ROOT, today)
fs.mkdirSync(outDir, { recursive: true })

// 轮换：清理 30 天前的旧快照目录
for (const dir of fs.readdirSync(BACKUP_ROOT)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dir)) continue
  const ageDays = (Date.now() - new Date(dir + 'T00:00:00+08:00').getTime()) / 86400000
  if (ageDays > KEEP_DAYS) {
    fs.rmSync(path.join(BACKUP_ROOT, dir), { recursive: true, force: true })
    console.log(`[backup] 清理过期快照: ${dir}`)
  }
}

const pool = getPool()
const manifest = { date: today, createdAt: new Date().toISOString(), tables: {} }
try {
  for (const table of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`)
    const file = path.join(outDir, `${table}.json`)
    fs.writeFileSync(file, JSON.stringify(rows))
    manifest.tables[table] = rows.length
    console.log(`[backup] ${table}: ${rows.length} 行 → ${file}`)
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`[backup] 完成：${outDir}`)
} finally {
  await pool.end()
}
