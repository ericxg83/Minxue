import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 questions 表添加 images 字段
 * 用于存储题目关联的多张图片（缩略图、原图、bbox 等）
 */
export const migrateQuestionImages = async () => {
  try {
    // 检查字段是否已存在
    const { rows } = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'questions' AND column_name = 'images'
    `)

    if (rows.length > 0) {
      console.log('✅ images 字段已存在，跳过迁移')
      return
    }

    await query(`
      ALTER TABLE questions 
      ADD COLUMN images JSONB DEFAULT '[]'
    `)

    console.log('✅ 已添加 images 字段到 questions 表')
  } catch (error) {
    console.error('images 字段迁移失败:', error.message)
    // 不抛出异常，避免阻塞服务启动
  }
}
