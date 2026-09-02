/**
 * 双 task 合并诊断（只读）
 *
 * 两路匹配：
 *   1. content_hash 命中：同 student + 同 hash + 都未软删 + 都非 failed 状态
 *   2. 名称匹配（hash 缺失时）：同 student + 同 original_name + 创建时间 ≤ 30 分钟 + 都未软删
 *
 * 输出每组要保留哪条、要删除哪些。
 *
 * ⚠️ dry-run 默认，--apply 才会真正 UPDATE/DELETE。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const APPLY = process.argv.includes('--apply')

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const fmt = (n) => String(n).padStart(6, ' ')

if (!APPLY) {
  console.log('🔍 DRY-RUN 模式（不删数据）。加 --apply 才会执行。\n')
} else {
  console.log('⚠️  APPLY 模式：以下操作会真实改数据库，软删多余 task 并合并关联。\n')
}

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // ── 1. 按 content_hash 分组 ──
  const hashGroups = await client.query(`
    SELECT student_id, content_hash, COUNT(*)::int as n,
           array_agg(id ORDER BY created_at ASC) as task_ids,
           array_agg(original_name ORDER BY created_at ASC) as names,
           array_agg(status ORDER BY created_at ASC) as statuses,
           array_agg(created_at ORDER BY created_at ASC) as times
    FROM tasks
    WHERE content_hash IS NOT NULL
      AND deleted_at IS NULL
      AND status IN ('pending', 'processing', 'done', 'reviewed')
    GROUP BY student_id, content_hash
    HAVING COUNT(*) >= 2
    LIMIT 50
  `)

  // ── 2. 按 original_name 分组（hash 缺失时）──
  //     30 分钟窗口：连点上传 2 次一般在 1 分钟内，但给点缓冲避免误合并跨日任务
  const nameGroups = await client.query(`
    SELECT student_id, original_name,
           array_agg(id ORDER BY created_at ASC) as task_ids,
           array_agg(status ORDER BY created_at ASC) as statuses,
           array_agg(created_at ORDER BY created_at ASC) as times,
           COUNT(*)::int as n,
           EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))::int as span_sec
    FROM tasks
    WHERE content_hash IS NULL
      AND deleted_at IS NULL
      AND status IN ('pending', 'processing', 'done', 'reviewed')
    GROUP BY student_id, original_name
    HAVING COUNT(*) >= 2
       AND EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) <= 1800
    LIMIT 50
  `)

  console.log('═══════════════════════════════════════════════════════')
  console.log('📊 双 task 合并诊断')
  console.log('═══════════════════════════════════════════════════════\n')
  console.log(`🔹 按 content_hash: ${fmt(hashGroups.rowCount)} 组`)
  console.log(`🔹 按 original_name (hash 缺失): ${fmt(nameGroups.rowCount)} 组`)
  console.log('')

  const allGroups = []

  for (const r of hashGroups.rows) {
    allGroups.push({
      matchType: 'hash',
      studentId: r.student_id,
      contentHash: r.content_hash,
      taskIds: r.task_ids,
      names: r.names,
      statuses: r.statuses,
      times: r.times
    })
  }
  for (const r of nameGroups.rows) {
    allGroups.push({
      matchType: 'name',
      studentId: r.student_id,
      originalName: r.original_name,
      taskIds: r.task_ids,
      statuses: r.statuses,
      times: r.times
    })
  }

  if (allGroups.length === 0) {
    console.log('✅ 没有发现双 task 组，无需合并。')
    await client.query('ROLLBACK')
    process.exit(0)
  }

  // ── 3. 输出每个组 + 关联 question 数 ──
  console.log('📋 详情：\n')
  let totalKeep = 0
  let totalDelete = 0
  const mergePlan = []  // {keepId, deleteIds[], matchType}

  for (const g of allGroups) {
    const keepId = g.taskIds[0]  // 最早创建的那条
    const deleteIds = g.taskIds.slice(1)

    // 查询每个 task 关联的 question 数
    const qCount = await client.query(`
      SELECT task_id, COUNT(*) as n FROM questions
      WHERE task_id = ANY($1) AND deleted_at IS NULL
      GROUP BY task_id
    `, [g.taskIds])
    const qMap = Object.fromEntries(qCount.rows.map(r => [r.task_id, parseInt(r.n, 10)]))

    const label = g.matchType === 'hash'
      ? `hash=${g.contentHash.slice(0, 12)}..`
      : `name="${g.originalName}"`
    const t1 = new Date(g.times[0]).toISOString().slice(0, 19)
    console.log(`  student=${g.studentId.slice(0,8)}..  ${label}`)
    console.log(`    状态序列: [${g.statuses.join(', ')}]`)
    console.log(`    时间序列: [${g.times.map(t => new Date(t).toISOString().slice(11, 19)).join(', ')}]`)
    console.log(`    保留 → ${keepId.slice(0,8)}.. (created=${t1}, q=${qMap[keepId] || 0})`)
    for (let i = 1; i < g.taskIds.length; i++) {
      const tid = g.taskIds[i]
      const ti = new Date(g.times[i]).toISOString().slice(0, 19)
      console.log(`    删除 → ${tid.slice(0,8)}.. (created=${ti}, q=${qMap[tid] || 0}, status=${g.statuses[i]})`)
    }
    console.log('')

    totalKeep++
    totalDelete += deleteIds.length
    mergePlan.push({ keepId, deleteIds, matchType: g.matchType })
  }

  console.log(`📊 计划：保留 ${fmt(totalKeep)} 条，删除 ${fmt(totalDelete)} 条\n`)

  // ── 4. 检查"待删除 task 关联的 questions"会被 question_id 引用保留 task 的 wrong_questions 影响 ──
  //     合并方案：把待删除 task 的 questions.task_id 改成保留 task 的 id，
  //               这样 wrong_questions 通过 question_id 仍然能 join 到保留 task。
  console.log('🔗 关联合并：待删除 task 的 questions.task_id 会改为保留 task 的 id，')
  console.log('              这样 wrong_questions → questions → tasks 这条引用链不断。\n')

  if (!APPLY) {
    console.log('💡 加 --apply 真正执行。建议先在生产库备份：')
    console.log('   CREATE TABLE tasks_backup_20260902 AS SELECT * FROM tasks;')
    console.log('   CREATE TABLE questions_backup_20260902 AS SELECT * FROM questions;')
    await client.query('ROLLBACK')
    process.exit(0)
  }

  // ── 5. 真实合并 ──
  console.log('⏳ 开始合并...\n')
  let migratedQuestions = 0
  let softDeletedTasks = 0

  for (const { keepId, deleteIds } of mergePlan) {
    if (deleteIds.length === 0) continue

    // 5a. 把待删 task 的 questions.task_id 改为保留 task
    const m = await client.query(`
      UPDATE questions
      SET task_id = $1, updated_at = NOW()
      WHERE task_id = ANY($2) AND deleted_at IS NULL
      RETURNING id
    `, [keepId, deleteIds])
    migratedQuestions += m.rowCount

    // 5b. 软删多余 task（deleted_at = NOW()，不删 OSS）
    //     不删 OSS 是因为：原始图片可能仍被前端轮询显示；OSS 删除走异步 GC
    const d = await client.query(`
      UPDATE tasks
      SET deleted_at = NOW()
      WHERE id = ANY($1)
      RETURNING id
    `, [deleteIds])
    softDeletedTasks += d.rowCount
  }

  console.log(`✅ questions.task_id 迁移: ${fmt(migratedQuestions)} 条`)
  console.log(`✅ tasks 软删: ${fmt(softDeletedTasks)} 条`)

  // 6. 验证
  const after = await client.query(`
    SELECT COUNT(*) as n FROM (
      SELECT 1 FROM tasks
      WHERE content_hash IS NOT NULL AND deleted_at IS NULL
        AND status IN ('pending','processing','done','reviewed')
      GROUP BY student_id, content_hash HAVING COUNT(*) >= 2
    ) t
  `)
  console.log(`\n📋 合并后剩余双 task 组: ${after.rows[0].n}（应为 0）`)

  if (APPLY) {
    await client.query('COMMIT')
    console.log('\n✅ 已提交。')
    console.log('📌 注意：原多余 task 的 OSS 图片未删，避免影响前端轮询显示；')
    console.log('   如需清理孤儿图片，单独跑 gc-orphan-oss.mjs。')
  } else {
    await client.query('ROLLBACK')
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('\n❌ 失败:', err.message)
  console.error(err.stack)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}