/**
 * 一次性回填：workbook 链路历史空学科（2026-09-17）
 *
 * 背景：练习册创建时 `resources.subject` 已正确保存，但 workbook 批改链路没把学科
 * 传播到题目和错题本 ⇒ 历史 `questions.subject` / `wrong_questions.subject` 全空，
 * 导致按学科筛选的接口（年级错题聚合、错题统计、讲义、薄弱点分析）整批漏掉这批数据。
 * 写入逻辑已修（commit 见当日提交，含 worker/index/worksheetPageService），本脚本补存量。
 *
 * 权威来源：`resources.subject`（练习册资源）。tasks.subject 与 job.data.subject 只作兜底。
 *
 * 安全纪律：
 *   - 默认 dry-run，只打印不写库；必须显式 --apply 才执行。
 *   - **只补空值，不覆盖已有非空学科**（WHERE subject IS NULL OR BTRIM(subject) = ''）。
 *   - 只处理 workbook 链路数据（tasks.task_type='workbook' + worksheet_id 关联练习册）。
 *   - 执行前把受影响 id 的旧值 dump 成 JSON 备份，便于回滚核对。
 *
 * 用法：
 *   node server/scripts/backfill-workbook-subject-20260917.mjs           # dry-run
 *   node server/scripts/backfill-workbook-subject-20260917.mjs --apply   # 执行
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const BACKUP_DIR = path.resolve('D:/Minxue_App_V3/server/_backup')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')

// ── 1) 待补 questions：workbook 任务下 subject 为空的题目 ──
const { rows: qTargets } = await pool.query(`
  SELECT q.id, q.subject AS old_subject, r.subject AS resource_subject
    FROM questions q
    JOIN tasks t ON t.id = q.task_id
    JOIN resources r ON r.id = t.worksheet_id AND r.resource_type = 'worksheet'
   WHERE t.task_type = 'workbook'
     AND t.deleted_at IS NULL
     AND q.deleted_at IS NULL
     AND (q.subject IS NULL OR BTRIM(q.subject) = '')
     AND r.subject IS NOT NULL AND BTRIM(r.subject) <> ''`)

// ── 2) 待补 wrong_questions：自包含错题（worksheet_id 关联练习册）subject 为空 ──
const { rows: wTargets } = await pool.query(`
  SELECT w.id, w.subject AS old_subject, r.subject AS resource_subject
    FROM wrong_questions w
    JOIN resources r ON r.id = w.worksheet_id AND r.resource_type = 'worksheet'
   WHERE (w.subject IS NULL OR BTRIM(w.subject) = '')
     AND r.subject IS NOT NULL AND BTRIM(r.subject) <> ''`)

const groupBy = (rows) => {
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.resource_subject)) m.set(r.resource_subject, [])
    m.get(r.resource_subject).push(r.id)
  }
  return m
}
const qGroups = groupBy(qTargets)
const wGroups = groupBy(wTargets)

console.log('════════ workbook 历史空学科补数 ════════')
console.log(`模式: ${APPLY ? '🔴 APPLY（会写库）' : '🟢 DRY-RUN（只读）'}\n`)
console.log(`questions       待补 ${qTargets.length} 条`)
for (const [subject, ids] of qGroups) console.log(`   → ${subject}: ${ids.length} 条`)
console.log(`wrong_questions 待补 ${wTargets.length} 条`)
for (const [subject, ids] of wGroups) console.log(`   → ${subject}: ${ids.length} 条`)

// 兜底校验：权威来源缺失的 workbook 数据（无学科可补，必须显式报告）
const { rows: orphan } = await pool.query(`
  SELECT COUNT(*)::int AS n
    FROM tasks t
    JOIN resources r ON r.id = t.worksheet_id AND r.resource_type = 'worksheet'
   WHERE t.task_type = 'workbook' AND t.deleted_at IS NULL
     AND (r.subject IS NULL OR BTRIM(r.subject) = '')`)
if (orphan[0].n > 0) {
  console.log(`\n⚠️  有 ${orphan[0].n} 个 workbook 任务的练习册资源本身无学科，本脚本跳过（需人工补练习册学科后再跑）`)
}

if (!APPLY) {
  console.log('\n🟢 DRY-RUN 结束，未写库。确认无误后加 --apply 执行。')
  await pool.end()
  process.exit(0)
}

if (qTargets.length === 0 && wTargets.length === 0) {
  console.log('\n✅ 没有需要补的存量数据。')
  await pool.end()
  process.exit(0)
}

// ── 3) 备份快照 ──
fs.mkdirSync(BACKUP_DIR, { recursive: true })
const backupFile = path.join(BACKUP_DIR, `workbook-subject-backfill-${stamp}.json`)
fs.writeFileSync(backupFile, JSON.stringify({
  createdAt: new Date().toISOString(),
  questions: qTargets.map(r => ({ id: r.id, old_subject: r.old_subject, new_subject: r.resource_subject })),
  wrong_questions: wTargets.map(r => ({ id: r.id, old_subject: r.old_subject, new_subject: r.resource_subject }))
}, null, 2), 'utf8')
console.log(`\n💾 备份已写入: ${backupFile}`)

// ── 4) 执行（按学科分组批量 UPDATE，仍然带空值条件二次防覆盖）──
let qUpdated = 0
for (const [subject, ids] of qGroups) {
  const res = await pool.query(
    `UPDATE questions
        SET subject = $1, updated_at = NOW()
      WHERE id = ANY($2::uuid[])
        AND (subject IS NULL OR BTRIM(subject) = '')`,
    [subject, ids]
  )
  qUpdated += res.rowCount
  console.log(`  ✅ questions ← ${subject}: ${res.rowCount} 条`)
}

let wUpdated = 0
for (const [subject, ids] of wGroups) {
  const res = await pool.query(
    `UPDATE wrong_questions
        SET subject = $1, updated_at = NOW()
      WHERE id = ANY($2::uuid[])
        AND (subject IS NULL OR BTRIM(subject) = '')`,
    [subject, ids]
  )
  wUpdated += res.rowCount
  console.log(`  ✅ wrong_questions ← ${subject}: ${res.rowCount} 条`)
}

console.log(`\n✅ 补数完成：questions ${qUpdated} 条 / wrong_questions ${wUpdated} 条`)

// ── 5) 复核：再查一次剩余空值 ──
const { rows: after } = await pool.query(`
  SELECT
    (SELECT COUNT(*)::int FROM questions q
       JOIN tasks t ON t.id = q.task_id
      WHERE t.task_type = 'workbook' AND t.deleted_at IS NULL AND q.deleted_at IS NULL
        AND (q.subject IS NULL OR BTRIM(q.subject) = '')) AS q_empty,
    (SELECT COUNT(*)::int FROM wrong_questions w
       JOIN resources r ON r.id = w.worksheet_id AND r.resource_type = 'worksheet'
      WHERE (w.subject IS NULL OR BTRIM(w.subject) = '')) AS w_empty`)
console.log(`复核：剩余空学科 questions=${after[0].q_empty} / wrong_questions=${after[0].w_empty}`)

await pool.end()
