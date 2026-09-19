/**
 * 存量回填：错题行「入册快照」补齐（只补空，不覆盖）
 * ==========================================================
 * 把 wrong_questions 里缺失的出处/卷面字段（last_wrong_task_id / page_number /
 * question_no / content / question_type / block_coordinates）从 questions 行补齐。
 * 口径只有一份：server/utils/wrongQuestionSnapshot.js（结算写入侧也在用）。
 *
 * 为什么需要：重练卷结算路径历史写入没落这些列，导致
 *   · 周末班白板「学生原卷（整页图）」弹窗显示「无原卷图」；
 *   · 错题本/课件的页码、题号只能靠 JOIN questions 现算。
 *
 * 用法（在 server 目录执行，读 server/.env 的 NEON_DATABASE_URL）：
 *   node scripts/backfill-wrong-question-snapshot.mjs                 # 预演（事务内跑完回滚）
 *   node scripts/backfill-wrong-question-snapshot.mjs --apply         # 真写
 *   node scripts/backfill-wrong-question-snapshot.mjs --student=张诗蕊  # 限定学生
 *   node scripts/backfill-wrong-question-snapshot.mjs --apply --student=<uuid>
 */
import 'dotenv/config'
import pg from 'pg'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { buildWrongQuestionSnapshotSql } from '../utils/wrongQuestionSnapshot.js'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const studentArg = argv.find(a => a.startsWith('--student='))?.slice('--student='.length) || null

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let studentId = null
if (studentArg) {
  if (UUID_RE.test(studentArg)) studentId = studentArg
  else {
    const { rows } = await pool.query(`SELECT id, name FROM students WHERE name = $1`, [studentArg.trim()])
    if (!rows.length) throw new Error(`找不到学生：${studentArg}`)
    studentId = rows[0].id
    console.log(`学生 ${rows[0].name} → ${studentId}`)
  }
}

const GAP_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE wq.question_id IS NOT NULL) AS total_rows,
    COUNT(*) FILTER (WHERE wq.last_wrong_task_id IS NULL) AS gap_task,
    COUNT(*) FILTER (WHERE wq.page_number IS NULL) AS gap_page,
    COUNT(*) FILTER (WHERE wq.question_no IS NULL) AS gap_qno,
    COUNT(*) FILTER (WHERE NULLIF(wq.content,'') IS NULL) AS gap_content,
    COUNT(*) FILTER (WHERE wq.question_type IS NULL) AS gap_qtype,
    COUNT(*) FILTER (WHERE wq.block_coordinates IS NULL) AS gap_block
  FROM wrong_questions wq
  WHERE wq.question_id IS NOT NULL
    AND ($1::uuid IS NULL OR wq.student_id = $1::uuid)`

const { rows: before } = await pool.query(GAP_SQL, [studentId])
console.log('\n=== 回填前缺口 ===')
console.log(JSON.stringify(before[0], null, 1))

const SQL = buildWrongQuestionSnapshotSql()

if (!APPLY) {
  // 预演：真跑一遍再回滚，拿到精确影响行数与抽样（样板同 _diag_grade_dryrun.mjs）
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(SQL, [null, studentId])
    console.log(`\n[预演] 将补齐 ${rows.length} 行（事务已回滚，未写库）`)
    const sample = rows.slice(0, 3).map(r => r.id)
    if (sample.length) {
      const { rows: after } = await client.query(
        `SELECT id, last_wrong_task_id, page_number, question_no, LEFT(COALESCE(content,''), 24) AS content
           FROM wrong_questions WHERE id = ANY($1::uuid[])`, [sample])
      for (const a of after) console.log('  样本（补完后事务内的值）:', JSON.stringify(a))
    }
    await client.query('ROLLBACK')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  console.log('\n加 --apply 才真写。')
} else {
  // 写前备份：把将被修改的行的**原值**整份落盘（可据此逐行还原），再执行 UPDATE。
  const { rows: targets } = await pool.query(
    `SELECT wq.id, wq.question_id, wq.student_id, wq.last_wrong_task_id, wq.question_no,
            wq.page_number, wq.content, wq.question_type, wq.block_coordinates
       FROM wrong_questions wq
      WHERE wq.question_id IS NOT NULL
        AND ($1::uuid IS NULL OR wq.student_id = $1::uuid)
        AND (wq.last_wrong_task_id IS NULL OR wq.question_no IS NULL OR wq.page_number IS NULL
             OR NULLIF(wq.content,'') IS NULL OR wq.question_type IS NULL OR wq.block_coordinates IS NULL)`,
    [studentId]
  )
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = new URL('./logs/wrong-question-snapshot/', import.meta.url)
  await mkdir(dir, { recursive: true })
  const backupPath = new URL(`${stamp}-before.json`, dir)
  await writeFile(backupPath, JSON.stringify({ createdAt: stamp, studentId, rows: targets }, null, 1))
  console.log(`\n[备份] ${targets.length} 行原值 → ${fileURLToPath(backupPath)}`)

  const { rows } = await pool.query(SQL, [null, studentId])
  console.log(`[已写] 补齐 ${rows.length} 行`)
  const { rows: after } = await pool.query(GAP_SQL, [studentId])
  console.log('=== 回填后缺口 ===')
  console.log(JSON.stringify(after[0], null, 1))
}

await pool.end()
process.exit(0)
