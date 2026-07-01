import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 wrong_questions 表添加 practice_count 列
 * 用于追踪每道错题的练习次数（组卷批改功能）
 */
export const migratePracticeCount = async () => {
  try {
    const { rows } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'wrong_questions' AND column_name = 'practice_count'
    `)

    if (rows.length > 0) {
      console.log('✅ practice_count 字段已存在，跳过迁移')
      return
    }

    await query(`
      ALTER TABLE wrong_questions
      ADD COLUMN practice_count INTEGER DEFAULT 0
    `)

    console.log('✅ 已添加 practice_count 字段到 wrong_questions 表')
  } catch (error) {
    console.error('practice_count 字段迁移失败:', error.message)
  }
}
