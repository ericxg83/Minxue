import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 question_assets 表添加 clean_geometry_image_url 和 geometry_structure_json 字段。
 *
 * 几何图净化层（Geometry Cleaning Layer）产出：
 * - clean_geometry_image_url: 经 Sharp 处理后的干净几何图（白底黑线、去除非几何文字/手写痕迹）
 * - geometry_structure_json: 几何结构 JSON（点、线、标签等抽象结构）
 */
export const migrateGeometryCleanup = async () => {
  try {
    // ── 1. 添加 clean_geometry_image_url 字段 ──
    const { rows: colClean } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'question_assets' AND column_name = 'clean_geometry_image_url'
    `)
    if (colClean.length === 0) {
      await query(`ALTER TABLE question_assets ADD COLUMN clean_geometry_image_url TEXT`)
      console.log('✅ 已添加 clean_geometry_image_url 字段到 question_assets 表')
    } else {
      console.log('✅ clean_geometry_image_url 字段已存在，跳过')
    }

    // ── 2. 添加 geometry_structure_json 字段 ──
    const { rows: colStruct } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'question_assets' AND column_name = 'geometry_structure_json'
    `)
    if (colStruct.length === 0) {
      await query(`ALTER TABLE question_assets ADD COLUMN geometry_structure_json JSONB`)
      console.log('✅ 已添加 geometry_structure_json 字段到 question_assets 表')
    } else {
      console.log('✅ geometry_structure_json 字段已存在，跳过')
    }
  } catch (error) {
    console.error('几何图净化迁移失败:', error.message)
  }
}