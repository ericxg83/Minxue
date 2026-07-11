import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 question_assets 表添加 original_geometry_image_url、tikz_svg_url 字段；
 * 为 questions 表添加 clean_geometry_image_url、tikz_svg_url、display_image_type 字段。
 *
 * 几何图处理流程重构：
 * - original_geometry_image_url: 原始裁剪几何图（与 cropped_image_url 等价，语义更清晰）
 * - clean_geometry_image_url (questions): 反范式写入，避免 API 查询 JOIN
 * - tikz_svg_url: TikZ 生成的矢量图（第一版存源码字符串，前端用 tikzToSvg 渲染）
 * - display_image_type: 控制前端显示 'clean' | 'tikz'，默认 clean
 */
export const migrateGeometryTikzDisplay = async () => {
  try {
    // ── Question Assets 表 ──

    // 1. original_geometry_image_url
    const { rows: colOrig } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'question_assets' AND column_name = 'original_geometry_image_url'
    `)
    if (colOrig.length === 0) {
      await query(`ALTER TABLE question_assets ADD COLUMN original_geometry_image_url TEXT`)
      console.log('✅ 已添加 original_geometry_image_url 字段到 question_assets 表')
    } else {
      console.log('✅ original_geometry_image_url 字段已存在，跳过')
    }

    // 2. tikz_svg_url (question_assets)
    const { rows: colSvg } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'question_assets' AND column_name = 'tikz_svg_url'
    `)
    if (colSvg.length === 0) {
      await query(`ALTER TABLE question_assets ADD COLUMN tikz_svg_url TEXT`)
      console.log('✅ 已添加 tikz_svg_url 字段到 question_assets 表')
    } else {
      console.log('✅ tikz_svg_url 字段已存在 (question_assets)，跳过')
    }

    // ── Questions 表 ──

    // 3. clean_geometry_image_url (questions)
    const { rows: colClean } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'clean_geometry_image_url'
    `)
    if (colClean.length === 0) {
      await query(`ALTER TABLE questions ADD COLUMN clean_geometry_image_url TEXT`)
      console.log('✅ 已添加 clean_geometry_image_url 字段到 questions 表')
    } else {
      console.log('✅ clean_geometry_image_url 字段已存在 (questions)，跳过')
    }

    // 4. tikz_svg_url (questions)
    const { rows: colSvgQ } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'tikz_svg_url'
    `)
    if (colSvgQ.length === 0) {
      await query(`ALTER TABLE questions ADD COLUMN tikz_svg_url TEXT`)
      console.log('✅ 已添加 tikz_svg_url 字段到 questions 表')
    } else {
      console.log('✅ tikz_svg_url 字段已存在 (questions)，跳过')
    }

    // 5. display_image_type
    const { rows: colDisp } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'display_image_type'
    `)
    if (colDisp.length === 0) {
      await query(`ALTER TABLE questions ADD COLUMN display_image_type VARCHAR(10) DEFAULT 'clean'`)
      console.log('✅ 已添加 display_image_type 字段到 questions 表')
    } else {
      console.log('✅ display_image_type 字段已存在，跳过')
    }
  } catch (error) {
    console.error('几何图 TikZ 显示迁移失败:', error.message)
  }
}