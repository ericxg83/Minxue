import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 wrong_questions 表添加 lifecycle_status 列
 * 用于 Vue 工作台的三步闭环状态管理（new → review_1 → review_2 → mastered）
 */
export const migrateLifecycleStatus = async () => {
  try {
    const { rows } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'wrong_questions' AND column_name = 'lifecycle_status'
    `)

    if (rows.length > 0) {
      console.log('✅ lifecycle_status 字段已存在，跳过迁移')
      return
    }

    await query(`
      ALTER TABLE wrong_questions
      ADD COLUMN lifecycle_status TEXT DEFAULT 'new'
    `)

    console.log('✅ 已添加 lifecycle_status 字段到 wrong_questions 表')
  } catch (error) {
    console.error('lifecycle_status 字段迁移失败:', error.message)
  }
}
