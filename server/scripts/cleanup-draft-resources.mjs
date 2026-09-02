/**
 * 清理 30 天未复核的草稿答案库（dry-run 默认）
 *
 * 场景：
 *   v4 上线后，worker 批改完一份 exam 任务会自动建 `resources` 草稿（status='draft'）。
 *   如果老师一直没在 PC 复核页"完成复核"，草稿会一直挂着：
 *     - 不出现在答案库列表/移动端选择器（hidden）
 *     - 但每行有 ~20-30 行 resource_answers，长期不清理会占 DB
 *
 * 删除标准：
 *   resources.status='draft' AND updated_at < NOW() - N days
 *   （updated_at 是最近一次写操作：worker 建草稿时设 NOW()，P0-F/syncDraftAnswerBank 也会刷；
 *    一旦老师开始改题，updated_at 就被刷新，30 天窗口从那时重算）
 *
 * 为什么硬删除而不是软删？
 *   - 资源是老师没复核的草稿，没老师显式投入精力
 *   - tasks.resource_id 外键 ON DELETE SET NULL，task 自动解绑
 *   - 老师决定重新批改同一份试卷 → worker 自动建新草稿
 *   - 已判过这道题的历史 task 不受影响（判题结果已落 questions / wrong_questions）
 *
 * 边界：
 *   - 默认 30 天（--days=N 自定义）
 *   - 仅 exam 类型（不碰 worksheets / retry_paper）
 *   - dry-run 默认；--apply 才执行
 *
 * 用法：
 *   node scripts/cleanup-draft-resources.mjs                  # dry-run, 30 天
 *   node scripts/cleanup-draft-resources.mjs --days=7         # dry-run, 7 天
 *   node scripts/cleanup-draft-resources.mjs --apply          # 真删，30 天
 *   node scripts/cleanup-draft-resources.mjs --days=7 --apply # 真删，7 天
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const APPLY = process.argv.includes('--apply')
const daysArg = process.argv.find((a) => a.startsWith('--days='))?.slice('--days='.length)
const DAYS = Number.parseInt(daysArg || '30', 10)
if (!Number.isFinite(DAYS) || DAYS <= 0) {
  console.error('❌ --days 必须是正整数')
  process.exit(2)
}

if (APPLY) {
  console.log(`⚠️  APPLY 模式：将硬删除 ${DAYS} 天未更新的 draft 答案库资源。\n`)
} else {
  console.log(`🔍 DRY-RUN 模式（不删数据）。加 --apply 才会执行。\n`)
}

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const client = await pool.connect()
try {
  // 1. 找出候选草稿 + 它们的关联 task 数
  const { rows: candidates } = await client.query(
    `SELECT
       r.id, r.name, r.subject, r.grade, r.status, r.answer_count,
       r.created_at, r.updated_at,
       (SELECT COUNT(*)::int FROM tasks t
        WHERE t.resource_id = r.id AND t.deleted_at IS NULL) AS task_count
     FROM resources r
     WHERE r.status = 'draft'
       AND r.resource_type = 'exam'
       AND r.updated_at < NOW() - ($1 || ' days')::interval
     ORDER BY r.updated_at ASC`,
    [DAYS]
  )

  console.log(`📊 待清理候选：${candidates.length} 个资源（status=draft, exam 类型, > ${DAYS} 天未更新）\n`)

  if (candidates.length === 0) {
    console.log('✅ 无可清理项')
    process.exit(0)
  }

  // 2. 打印每个候选
  const now = new Date()
  const totalTasksToUnlink = candidates.reduce((sum, r) => sum + r.task_count, 0)
  for (const r of candidates) {
    const updatedDays = Math.floor((now - new Date(r.updated_at)) / (1000 * 60 * 60 * 24))
    console.log(
      `  - [${r.id.slice(0, 8)}] "${r.name}" ` +
      `(${r.subject || '?'}/${r.grade || '?'}) ` +
      `${r.answer_count} 题 · 关联 ${r.task_count} 个 task · ${updatedDays} 天未更新`
    )
  }
  console.log(`\n📈 影响范围：删除 ${candidates.length} 个 resource，${totalTasksToUnlink} 个 task 的 resource_id 自动置空\n`)

  if (!APPLY) {
    console.log('💡 加 --apply 才会真实删除。')
    process.exit(0)
  }

  // 3. 真删（单事务：ON DELETE SET NULL + CASCADE 由 DB 约束处理）
  await client.query('BEGIN')
  try {
    let deletedCount = 0
    for (const r of candidates) {
      // 用 RETURNING 拿被删的资源名（用于日志）
      const { rows: deleted } = await client.query(
        `DELETE FROM resources WHERE id = $1 RETURNING id, name`,
        [r.id]
      )
      if (deleted.length > 0) deletedCount++
    }
    await client.query('COMMIT')
    console.log(`✅ 已删除 ${deletedCount} 个 draft 答案库资源`)
    console.log(`   tasks.resource_id 自动 SET NULL；resource_answers 自动 CASCADE 删除`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌ 事务回滚，删除失败:', e.message)
    process.exit(1)
  }
} catch (e) {
  console.error('❌ 执行失败:', e.message)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}