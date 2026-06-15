import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 questions 表添加 review_status 列
 * 用于持久化人工复核状态（correct / wrong / exclude）
 */
export const migrateReviewStatus = async () => {
  try {
    const { rows } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'review_status'
    `)

    if (rows.length > 0) {
      console.log('✅ review_status 字段已存在，跳过迁移')
      return
    }

    await query(`
      ALTER TABLE questions
      ADD COLUMN review_status TEXT DEFAULT NULL
    `)

    console.log('✅ 已添加 review_status 字段到 questions 表')
  } catch (error) {
    console.error('review_status 字段迁移失败:', error.message)
  }
}
