import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 questions 表添加 geometry_image_url 字段
 * 用于存储多模态智能切题引擎生成的几何配图 URL
 */
export const migrateGeometryImageUrl = async () => {
  try {
    // 检查字段是否已存在
    const { rows } = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'questions' AND column_name = 'geometry_image_url'
    `)

    if (rows.length > 0) {
      console.log('✅ geometry_image_url 字段已存在，跳过迁移')
      return
    }

    await query(`
      ALTER TABLE questions 
      ADD COLUMN geometry_image_url TEXT
    `)

    console.log('✅ 已添加 geometry_image_url 字段到 questions 表')
  } catch (error) {
    console.error(' geometry_image_url 字段迁移失败:', error.message)
    // 不抛出异常，避免阻塞服务启动
  }
}
