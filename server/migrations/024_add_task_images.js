import { query } from '../config/neon.js'

/**
 * 数据库迁移：为「多图一任务」补充字段。
 *
 *   tasks:
 *     - images JSONB   一个任务的多页图片数组，形状：
 *                      [{ page_number, image_url, file_name }, ...]
 *   questions:
 *     - page_number INTEGER   题目来源页码（1 起），单页任务为 1
 *
 * tasks.image_url 列保留 = 第 1 页（首页缩略图 / 旧代码向后兼容）。
 * 单图上传时 images 为单元素数组，行为与改造前一致。
 *
 * 幂等：先查 information_schema，缺失才加。
 */
const addColumn = async (table, column, definition) => {
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  )
  if (rows.length > 0) {
    console.log(`  ✅ ${table}.${column} 已存在，跳过`)
    return
  }
  await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  console.log(`  ✅ 已添加 ${table}.${column}`)
}

export const migrateTaskImages = async () => {
  try {
    console.log('📦 [迁移024] 开始补齐多图一任务字段...')
    await addColumn('tasks', 'images', 'JSONB')
    await addColumn('questions', 'page_number', 'INTEGER')
    console.log('✅ [迁移024] 多图一任务字段补齐完成')
  } catch (error) {
    console.error('❌ [迁移024] 失败:', error.message)
  }
}
