import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 questions 表添加 source_type 列
 * 标记题目复核的来源场景，用于统一批改工作台区分业务处理：
 *   - 'homework'    日常作业（题目校对）
 *   - 'wrong_retry' 错题重练卷批改
 */
export const migrateSourceType = async () => {
  try {
    const { rows } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'source_type'
    `)

    if (rows.length > 0) {
      console.log('✅ source_type 字段已存在，跳过迁移')
      return
    }

    await query(`
      ALTER TABLE questions
      ADD COLUMN source_type VARCHAR(20) DEFAULT 'homework'
    `)

    console.log('✅ 已添加 source_type 字段到 questions 表')
  } catch (error) {
    console.error('source_type 字段迁移失败:', error.message)
  }
}
