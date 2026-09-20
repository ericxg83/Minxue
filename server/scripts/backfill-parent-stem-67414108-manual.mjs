/**
 * 手动回填 task 67414108（27.2(3) 二次函数卷）Q10/Q11 两组 parent_stem。
 * 依据：2026-09-17 原卷页图人工核对（_q10zone.png / _q11zone.png）。
 * - Q10：backfill 脚本 OCR 结果正确，被「结尾悬空闸」误杀，人工放行。
 * - Q11：脚本 OCR 截断 + 卷面题号 18 ≠ 内部题号 11 触发撞车闸误杀，人工从页图转录全文。
 * 只写 parent_stem（展示列），先落快照备份，可回滚。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'node:fs'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const STEM_Q10 = '如图，抛物线 y=2(x-2)² 与平行于 x 轴的直线交于点 A、B，抛物线顶点为 C，△ABC 为等边三角形，求：'
const STEM_Q11 = '在平面直角坐标系 xOy 中，将直线 l: y=-3/4x-3 沿 x 轴翻折，得到一条新直线与 x 轴交于点 A，与 y 轴交于点 B，将抛物线 C₁: y=1/3x² 沿 x 轴平移，得到一条新抛物线 C₂ 与 y 轴交于点 D，与直线 AB 交于点 E、F，连接 DF，满足 DF//x 轴. 求：'

const taskId = '67414108-bdfd-484e-ad04-769db7dd67d5'

const rows = await pool.query(`
  SELECT id, question_number, sub_no, parent_stem FROM questions
  WHERE task_id = $1 AND question_number IN (10, 11) AND sub_no IS NOT NULL
  ORDER BY question_number, sub_no`, [taskId])

// 快照备份
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = `D:/Minxue_App_V3/server/backups/parent-stem-manual-67414108-${stamp}.json`
fs.mkdirSync('D:/Minxue_App_V3/server/backups', { recursive: true })
fs.writeFileSync(backupPath, JSON.stringify({ taskId, at: new Date().toISOString(), rows: rows.rows }, null, 2), 'utf8')
console.log('backup ->', backupPath)

const APPLY = process.argv.includes('--apply')
if (!APPLY) {
  console.log('dry-run（加 --apply 写入）。将写入：')
  for (const r of rows.rows) {
    console.log(`  Q${r.question_number}(${r.sub_no}) ${r.id.slice(0, 8)} -> ${r.question_number === 10 ? 'STEM_Q10' : 'STEM_Q11'}`)
  }
  await pool.end()
  process.exit(0)
}

for (const r of rows.rows) {
  const stem = r.question_number === 10 ? STEM_Q10 : STEM_Q11
  const upd = await pool.query(
    'UPDATE questions SET parent_stem = $1 WHERE id = $2 AND parent_stem IS NULL RETURNING id',
    [stem, r.id])
  console.log(upd.rowCount ? `✅ Q${r.question_number}(${r.sub_no}) ${r.id.slice(0, 8)}` : `⚠️ 跳过（已有 parent_stem）Q${r.question_number}(${r.sub_no})`)
}
await pool.end()
