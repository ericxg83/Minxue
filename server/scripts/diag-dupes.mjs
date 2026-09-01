/**
 * 重复数据规模诊断（只读）
 *
 * 数两类重复：
 * 1. tasks: (student_id, content_hash) 出现 >=2 次的非软删任务
 * 2. wrong_questions: (student_id, worksheet_id, question_no) 出现 >=2 次的错题
 *
 * 用法： node scripts/diag-dupes.mjs
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const fmt = (n) => n.toString().padStart(8, ' ')

try {
  console.log('🔍 诊断重复数据规模 (只读)\n')

  // ── 1. tasks 重复 ──
  const tasksDup = await pool.query(`
    SELECT student_id, content_hash, COUNT(*) as n,
           array_agg(id ORDER BY created_at) as task_ids,
           array_agg(status ORDER BY created_at) as statuses,
           array_agg(created_at ORDER BY created_at) as times
    FROM tasks
    WHERE content_hash IS NOT NULL AND deleted_at IS NULL
    GROUP BY student_id, content_hash
    HAVING COUNT(*) >= 2
    ORDER BY n DESC, MIN(created_at) DESC
    LIMIT 30
  `)
  console.log(`📋 tasks 重复组: 共 ${tasksDup.rowCount} 组`)
  if (tasksDup.rowCount > 0) {
    for (const r of tasksDup.rows) {
      const t1 = new Date(r.times[0]).toISOString().slice(0, 19)
      const t2 = new Date(r.times[1]).toISOString().slice(0, 19)
      console.log(`  student=${r.student_id.slice(0,8)}..  n=${r.n}  hash=${r.content_hash.slice(0,12)}..  [${r.statuses.join(',')}]  ${t1} / ${t2}`)
    }
  }

  const tasksTotals = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE content_hash IS NOT NULL AND deleted_at IS NULL) as hash_present,
           COUNT(*) FILTER (WHERE content_hash IS NULL) as hash_null,
           COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as soft_deleted
    FROM tasks
  `)
  const tt = tasksTotals.rows[0]
  console.log(`\n  tasks 总览: 有 hash=${fmt(tt.hash_present)}  无 hash=${fmt(tt.hash_null)}  软删=${fmt(tt.soft_deleted)}`)

  // ── 2. wrong_questions 重复 ──
  const wqDup = await pool.query(`
    SELECT student_id, worksheet_id, question_no, COUNT(*) as n,
           array_agg(id ORDER BY created_at) as wq_ids,
           array_agg(error_count ORDER BY created_at) as counts,
           array_agg(created_at ORDER BY created_at) as times
    FROM wrong_questions
    WHERE student_id IS NOT NULL AND worksheet_id IS NOT NULL AND question_no IS NOT NULL
    GROUP BY student_id, worksheet_id, question_no
    HAVING COUNT(*) >= 2
    ORDER BY n DESC, MIN(created_at) DESC
    LIMIT 30
  `)
  console.log(`\n📚 wrong_questions 重复组 (worksheet_id 不空): 共 ${wqDup.rowCount} 组`)
  if (wqDup.rowCount > 0) {
    for (const r of wqDup.rows) {
      const t1 = new Date(r.times[0]).toISOString().slice(0, 19)
      console.log(`  student=${r.student_id.slice(0,8)}..  ws=${String(r.worksheet_id).slice(0,8)}..  q=${r.question_no}  n=${r.n}  err=${r.counts.join(',')}  since=${t1}`)
    }
  }

  const wqTotals = await pool.query(`
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE worksheet_id IS NOT NULL AND question_no IS NOT NULL) as has_natural_key,
           COUNT(*) FILTER (WHERE worksheet_id IS NULL OR question_no IS NULL) as no_natural_key
    FROM wrong_questions
  `)
  const wt = wqTotals.rows[0]
  console.log(`\n  wrong_questions 总览: 总=${fmt(wt.total)}  有自然键=${fmt(wt.has_natural_key)}  无自然键=${fmt(wt.no_natural_key)}`)

  // ── 3. 内容 hash 全部为 NULL 的 task 比例 (说明老版本没算 hash) ──
  const nullHashByDate = await pool.query(`
    SELECT DATE(created_at) as d, COUNT(*) as n, COUNT(*) FILTER (WHERE content_hash IS NULL) as null_n
    FROM tasks
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at)
    ORDER BY d DESC
    LIMIT 15
  `)
  console.log(`\n📅 近 30 天 tasks 每日 hash 覆盖率:`)
  for (const r of nullHashByDate.rows) {
    const cov = r.n > 0 ? ((1 - r.null_n / r.n) * 100).toFixed(0) : '0'
    console.log(`  ${r.d.toISOString().slice(0,10)}  total=${String(r.n).padStart(3)}  无hash=${String(r.null_n).padStart(3)}  覆盖率=${cov}%`)
  }
} catch (err) {
  console.error('诊断失败:', err.message)
  console.error(err.stack)
} finally {
  await pool.end()
}