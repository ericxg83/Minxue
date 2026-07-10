import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 questions 表添加 difficulty 列（难度系数 1-5）
 * 由 AI 在提取知识点标签时同步判定，NULL 表示尚未判定（等待回填）。
 * 1=基础识记 2=简单 3=中等 4=较难 5=难题/压轴
 */
export const migrateDifficulty = async () => {
  try {
    const { rows } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'difficulty'
    `)

    if (rows.length > 0) {
      console.log('✅ difficulty 字段已存在，跳过迁移')
      return
    }

    await query(`
      ALTER TABLE questions
      ADD COLUMN difficulty SMALLINT
      CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5)
    `)

    console.log('✅ 已添加 difficulty 字段到 questions 表')
  } catch (error) {
    console.error('difficulty 字段迁移失败:', error.message)
  }
}
