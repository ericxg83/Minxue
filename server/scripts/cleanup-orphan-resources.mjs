/**
 * 清理孤儿草稿答案库（task 关联丢失，dry-run 默认）
 *
 * 场景：
 *   worker 跑完一份 exam 任务会自动建 `resources` 草稿（status='draft'），
 *   然后 `UPDATE tasks SET resource_id = $1` 回填关联。如果中途某一步异常
 *   （资源建成但 task 回填失败/超时、worker 进程重启、旧版逻辑建的资源等），
 *   资源就变成"孤儿"：
 *     - 列表里看得到
 *     - 但点"复核" → getTasksByResource 返回 0 条 → 弹窗提示"该资源暂无可用任务"
 *     - 也无法被移动端答案库选择器复用（那里只看 published）
 *
 * 与 cleanup-draft-resources.mjs 的区别：
 *   - cleanup-draft-resources.mjs 清"30 天没老师动过"的过期草稿（task 可能还关联）
 *   - 本脚本清"task 关联丢失"的孤儿草稿（老师想复核也复不了，没救）
 *
 * 删除标准：
 *   resources.status='draft' AND resource_type='exam' AND task_count=0
 *   （按 teacher 视角：进不去复核页 = 死资源 = 可清）
 *
 * 为什么硬删除而不是软删？
 *   - 资源是 AI 自动沉淀的草稿，没老师显式投入精力
 *   - 老师想重新批同一份卷 → 上传新照片 → worker 重建新草稿
 *   - tasks.resource_id 外键 ON DELETE SET NULL，task 自动解绑
 *   - 已判过这道题的历史 task 不受影响（判题结果已落 questions / wrong_questions）
 *
 * 边界：
 *   - 仅 exam 类型（不碰 worksheets / retry_paper）
 *   - 仅 status='draft'（不动 reviewing/published，老师发起的复核中态不能误删）
 *   - dry-run 默认；--apply 才执行
 *
 * 用法：
 *   node scripts/cleanup-orphan-resources.mjs          # dry-run
 *   node scripts/cleanup-orphan-resources.mjs --apply  # 真删
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const APPLY = process.argv.includes('--apply')

if (APPLY) {
  console.log('⚠️  APPLY 模式：将硬删除孤儿草稿答案库资源（task_count=0）。\n')
} else {
  console.log('🔍 DRY-RUN 模式（不删数据）。加 --apply 才会执行。\n')
}

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const client = await pool.connect()
try {
  const { rows: candidates } = await client.query(
    `SELECT
       r.id, r.name, r.subject, r.grade, r.status, r.answer_count,
       r.answer_status, r.created_at, r.updated_at,
       (SELECT COUNT(*)::int FROM tasks t
        WHERE t.resource_id = r.id AND t.deleted_at IS NULL) AS task_count
     FROM resources r
     WHERE r.status = 'draft'
       AND r.resource_type = 'exam'
       AND NOT EXISTS (
         SELECT 1 FROM tasks t
         WHERE t.resource_id = r.id AND t.deleted_at IS NULL
       )
     ORDER BY r.created_at DESC`
  )

  console.log(`📊 待清理候选：${candidates.length} 个孤儿草稿资源（status=draft, exam 类型, task_count=0）\n`)

  if (candidates.length === 0) {
    console.log('✅ 无可清理项')
    process.exit(0)
  }

  // 汇总：按科目分组
  const bySubject = candidates.reduce((acc, r) => {
    const k = r.subject || '未填科目'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})
  console.log('📈 科目分布：')
  for (const [k, v] of Object.entries(bySubject)) {
    console.log(`   ${k}: ${v} 个`)
  }
  console.log('')

  // 打印每个候选
  console.log('📋 清单：')
  for (const r of candidates) {
    const createdDate = new Date(r.created_at).toISOString().slice(0, 10)
    console.log(
      `  - [${r.id.slice(0, 8)}] "${r.name}" ` +
      `(${r.subject || '?'}/${r.grade || '?'}) ` +
      `${r.answer_count} 题 · answer_status=${r.answer_status} · ${createdDate} 建`
    )
  }

  // 子表影响估算
  const { rows: answerRows } = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM resource_answers ra
     WHERE ra.resource_id = ANY($1::uuid[])`,
    [candidates.map((r) => r.id)]
  )
  const totalAnswers = answerRows[0]?.n || 0
  console.log(`\n📈 影响范围：删除 ${candidates.length} 个 resource，连带 CASCADE 清掉 ${totalAnswers} 条 resource_answers\n`)

  if (!APPLY) {
    console.log('💡 加 --apply 才会真实删除。')
    process.exit(0)
  }

  await client.query('BEGIN')
  try {
    let deletedCount = 0
    for (const r of candidates) {
      const { rows: deleted } = await client.query(
        `DELETE FROM resources WHERE id = $1 RETURNING id, name`,
        [r.id]
      )
      if (deleted.length > 0) deletedCount++
    }
    await client.query('COMMIT')
    console.log(`✅ 已删除 ${deletedCount} 个孤儿草稿资源`)
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
