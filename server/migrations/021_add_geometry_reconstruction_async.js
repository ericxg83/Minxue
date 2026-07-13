import { query } from '../config/neon.js'

/**
 * 数据库迁移：几何图重建异步化。
 *
 * 把几何图净化+TikZ重建从同步流程改为后台异步任务。
 *
 * 变更：
 * 1. tikz_status CHECK 约束：`done` → `completed`，新增 `processing`
 * 2. 新增列：tikz_url, tikz_json, retry_count, last_error, processed_at
 * 3. 新增索引：asset_type + tikz_status 联合索引（Worker 扫描用）
 */
export const migrateGeometryReconstructionAsync = async () => {
  try {
    // 1. 删除旧 CHECK 约束并重新添加
    const { rows: constraintRows } = await query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'question_assets'::regclass
      AND conname LIKE '%tikz_status%'
    `)
    for (const row of constraintRows) {
      await query(`ALTER TABLE question_assets DROP CONSTRAINT ${row.conname}`)
      console.log(`  ✅ 已删除约束: ${row.conname}`)
    }

    // 检查是否已存在新约束
    const { rows: newConstraintCheck } = await query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'question_assets'::regclass
      AND conname = 'question_assets_tikz_status_check'
    `)
    if (newConstraintCheck.length === 0) {
      await query(`
        ALTER TABLE question_assets
        ADD CONSTRAINT question_assets_tikz_status_check
        CHECK (tikz_status IN ('none', 'pending', 'processing', 'completed', 'failed'))
      `)
      console.log('  ✅ 已添加新 CHECK 约束 (none/pending/processing/completed/failed)')
    } else {
      console.log('  ✅ 新 CHECK 约束已存在，跳过')
    }

    // 2. 新增 tikz_url 列
    const { rows: colTikzUrl } = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'question_assets' AND column_name = 'tikz_url'
    `)
    if (colTikzUrl.length === 0) {
      await query(`ALTER TABLE question_assets ADD COLUMN tikz_url TEXT`)
      console.log('  ✅ 已添加 tikz_url 列')
    } else {
      console.log('  ✅ tikz_url 列已存在，跳过')
    }

    // 3. 新增 tikz_json 列
    const { rows: colTikzJson } = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'question_assets' AND column_name = 'tikz_json'
    `)
    if (colTikzJson.length === 0) {
      await query(`ALTER TABLE question_assets ADD COLUMN tikz_json JSONB`)
      console.log('  ✅ 已添加 tikz_json 列')
    } else {
      console.log('  ✅ tikz_json 列已存在，跳过')
    }

    // 4. 新增 retry_count 列
    const { rows: colRetryCount } = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'question_assets' AND column_name = 'retry_count'
    `)
    if (colRetryCount.length === 0) {
      await query(`ALTER TABLE question_assets ADD COLUMN retry_count INTEGER DEFAULT 0`)
      console.log('  ✅ 已添加 retry_count 列')
    } else {
      console.log('  ✅ retry_count 列已存在，跳过')
    }

    // 5. 新增 last_error 列
    const { rows: colLastError } = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'question_assets' AND column_name = 'last_error'
    `)
    if (colLastError.length === 0) {
      await query(`ALTER TABLE question_assets ADD COLUMN last_error TEXT`)
      console.log('  ✅ 已添加 last_error 列')
    } else {
      console.log('  ✅ last_error 列已存在，跳过')
    }

    // 6. 新增 processed_at 列
    const { rows: colProcessedAt } = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'question_assets' AND column_name = 'processed_at'
    `)
    if (colProcessedAt.length === 0) {
      await query(`ALTER TABLE question_assets ADD COLUMN processed_at TIMESTAMP WITH TIME ZONE`)
      console.log('  ✅ 已添加 processed_at 列')
    } else {
      console.log('  ✅ processed_at 列已存在，跳过')
    }

    // 7. 新增联合索引 (asset_type, tikz_status) — Worker 高频查询用
    const { rows: idxRows } = await query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'question_assets' AND indexname = 'idx_question_assets_type_status'
    `)
    if (idxRows.length === 0) {
      await query(`
        CREATE INDEX idx_question_assets_type_status
        ON question_assets(asset_type, tikz_status)
      `)
      console.log('  ✅ 已创建联合索引 (asset_type, tikz_status)')
    } else {
      console.log('  ✅ 联合索引已存在，跳过')
    }

    // 8. 将旧数据 tikz_status='done' 迁移为 'completed'
    const { rows: migrated } = await query(`
      UPDATE question_assets
      SET tikz_status = 'completed'
      WHERE tikz_status = 'done'
      RETURNING id
    `)
    if (migrated.length > 0) {
      console.log(`  ✅ 已将 ${migrated.length} 条 tikz_status='done' 迁移为 'completed'`)
    } else {
      console.log('  ✅ 无旧数据需要迁移')
    }

  } catch (error) {
    console.error('几何重建异步化迁移失败:', error.message)
  }
}