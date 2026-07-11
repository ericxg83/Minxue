import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 question_assets 表添加 geometry_crop_type 字段。
 *
 * 几何图处理流程重构第二阶段：
 * - geometry_crop_type: 区分旧 Sharp 处理数据（'raw_crop'）与新 AI 提取数据（'clean_geometry'）
 *   'raw_crop' — 原始裁剪 + Sharp 二值化（旧流程）
 *   'clean_geometry' — AI 视觉模型几何元素提取（新流程，输出 TikZ 代码）
 */
export const migrateGeometryCropType = async () => {
  try {
    const { rows } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'question_assets' AND column_name = 'geometry_crop_type'
    `)
    if (rows.length === 0) {
      await query(`ALTER TABLE question_assets ADD COLUMN geometry_crop_type VARCHAR(20) DEFAULT 'raw_crop'`)
      console.log('✅ 已添加 geometry_crop_type 字段到 question_assets 表')
    } else {
      console.log('✅ geometry_crop_type 字段已存在，跳过')
    }
  } catch (error) {
    console.error('geometry_crop_type 迁移失败:', error.message)
  }
}