import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 question_assets 和 questions 表添加 clean_geometry_svg 字段。
 *
 * 几何图处理流程重构第三阶段：几何重建（geometry reconstruction）
 * - 不再做图片清理（灰度化/二值化/滤镜），而是：
 *   原始裁剪图 → 视觉模型识别结构化几何数据（点/线/圆/标注 JSON）
 *   → 服务端确定性渲染成干净 SVG（白底黑线，仅含几何元素）
 * - clean_geometry_svg: 存储重建后的干净 SVG 源码字符串（<svg>...</svg>）
 *   这才是后续 TikZ 生成的输入。
 */
export const migrateCleanGeometrySvg = async () => {
  try {
    // 1. question_assets.clean_geometry_svg
    const { rows: colAsset } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'question_assets' AND column_name = 'clean_geometry_svg'
    `)
    if (colAsset.length === 0) {
      await query(`ALTER TABLE question_assets ADD COLUMN clean_geometry_svg TEXT`)
      console.log('✅ 已添加 clean_geometry_svg 字段到 question_assets 表')
    } else {
      console.log('✅ clean_geometry_svg 字段已存在 (question_assets)，跳过')
    }

    // 2. questions.clean_geometry_svg（反范式写入，避免 API 查询 JOIN）
    const { rows: colQ } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'clean_geometry_svg'
    `)
    if (colQ.length === 0) {
      await query(`ALTER TABLE questions ADD COLUMN clean_geometry_svg TEXT`)
      console.log('✅ 已添加 clean_geometry_svg 字段到 questions 表')
    } else {
      console.log('✅ clean_geometry_svg 字段已存在 (questions)，跳过')
    }
  } catch (error) {
    console.error('clean_geometry_svg 迁移失败:', error.message)
  }
}
