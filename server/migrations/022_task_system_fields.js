import { query } from '../config/neon.js'

/**
 * 数据库迁移：补齐异步任务系统的核心运维字段。
 *
 * 目标（统一任务系统字段，覆盖所有任务表）：
 *
 *   tasks（主 OCR/批改任务）：
 *     - retry_count INTEGER DEFAULT 0       重试计数
 *     - last_error   TEXT               最近一次失败原因（供前端/diagnostics 展示）
 *     - started_at   TIMESTAMP WITH TIME ZONE   首次开始处理时刻
 *     - failed_at    TIMESTAMP WITH TIME ZONE   最近一次失败时刻
 *   （已有 status CHECK 含 'failed'，无需改；retry 计数此前藏在 result JSON 里，现提升为独立列。）
 *
 *   question_assets（几何图重建任务）：
 *     - 防御性补齐 tikz_url / tikz_json / retry_count / last_error / processed_at
 *       （迁移 021 已加，但全新从 neon_schema.sql 建的库可能缺这些列/新 CHECK）。
 *     - 修正 tikz_status CHECK：旧 schema 只有 (none,pending,done,failed)，
 *       迁移 021 新增了 'processing' 但几何 worker 还会写入 'completed'（021 语义），
 *       故此处统一为 (none,pending,processing,completed,failed) 防止写入 'completed' 触发 CHECK 失败。
 *
 * 所有 ALTER 均为幂等（先查 information_schema，缺失才加）。
 */
const colExists = async (table, column) => {
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  )
  return rows.length > 0
}

const addColumn = async (table, column, definition) => {
  if (await colExists(table, column)) {
    console.log(`  ✅ ${table}.${column} 已存在，跳过`)
    return
  }
  await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  console.log(`  ✅ 已添加 ${table}.${column}`)
}

const dropConstraintIf = async (table, constraintPrefix) => {
  const { rows } = await query(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = $1::regclass AND conname LIKE $2`,
    [table, constraintPrefix]
  )
  for (const row of rows) {
    await query(`ALTER TABLE ${table} DROP CONSTRAINT ${row.conname}`)
    console.log(`  ✅ 已删除旧约束: ${row.conname}`)
  }
  return rows.length
}

const addConstraint = async (table, constraintName, checkExpr) => {
  const { rows } = await query(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = $1::regclass AND conname = $2`,
    [table, constraintName]
  )
  if (rows.length > 0) {
    console.log(`  ✅ 约束 ${constraintName} 已存在，跳过`)
    return
  }
  await query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} ${checkExpr}`)
  console.log(`  ✅ 已添加约束 ${constraintName}`)
}

export const migrateTaskSystemFields = async () => {
  try {
    console.log('📦 [迁移022] 开始补齐任务系统字段...')

    // ── 1. tasks 表：重试/错误/时间 字段 ──
    console.log('  [tasks] 补齐运维字段...')
    await addColumn('tasks', 'retry_count', 'INTEGER DEFAULT 0')
    await addColumn('tasks', 'last_error', 'TEXT')
    await addColumn('tasks', 'started_at', 'TIMESTAMP WITH TIME ZONE')
    await addColumn('tasks', 'failed_at', 'TIMESTAMP WITH TIME ZONE')

    // ── 2. question_assets 表：防御性补齐异步重建字段 ──
    console.log('  [question_assets] 防御性补齐异步重建字段...')
    await addColumn('question_assets', 'tikz_url', 'TEXT')
    await addColumn('question_assets', 'tikz_json', 'JSONB')
    await addColumn('question_assets', 'retry_count', 'INTEGER DEFAULT 0')
    await addColumn('question_assets', 'last_error', 'TEXT')
    await addColumn('question_assets', 'processed_at', 'TIMESTAMP WITH TIME ZONE')

    // ── 3. 统一 tikz_status CHECK 约束（含 completed / processing） ──
    // 历史不一致：旧流水线 tikzWorker 写 'done'，新流水线 geometryWorker 写 'completed'，
    // 二者操作同一列。先收敛历史数据到 'completed'，再统一约束，避免脏完成态残留。
    console.log('  [question_assets] 收敛历史 tikz_status 完成态 (done -> completed)...')
    try {
      const { rowCount } = await query(
        `UPDATE question_assets SET tikz_status = 'completed' WHERE tikz_status = 'done'`
      )
      if (rowCount > 0) {
        console.log(`  ✅ 已收敛 ${rowCount} 行 tikz_status='done' -> 'completed'`)
      } else {
        console.log("  ✅ 无 tikz_status='done' 历史行需收敛")
      }
    } catch (err) {
      console.warn('  ⚠️ 收敛历史 tikz_status 跳过:', err.message)
    }

    // 删除所有 tikz_status 相关约束后重建，避免命名不一致漏删（含首次运行无约束的情况）。
    console.log('  [question_assets] 统一 tikz_status CHECK 约束...')
    await dropConstraintIf('question_assets', '%tikz_status%')
    await addConstraint(
      'question_assets',
      'question_assets_tikz_status_check',
      `CHECK (tikz_status IN ('none', 'pending', 'processing', 'completed', 'failed'))`
    )

    // ── 4. 索引：加速 pending/failed 扫描与重试调度 ──
    await query(
      `CREATE INDEX IF NOT EXISTS idx_tasks_status_retry
       ON tasks(status, retry_count)`
    ).catch(() => {})
    await query(
      `CREATE INDEX IF NOT EXISTS idx_question_assets_type_status_retry
       ON question_assets(asset_type, tikz_status, retry_count)`
    ).catch(() => {})

    console.log('✅ [迁移022] 任务系统字段补齐完成')
  } catch (error) {
    console.error('❌ [迁移022] 失败:', error.message)
  }
}
