import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 questions 表添加 question_number、text_bbox、image_type 字段，
 * 并创建 question_assets 表，用于存储题目相关资源（几何图裁剪、TikZ 代码等）。
 *
 * 页面理解（Page Understanding）步骤产出：
 * - question_number: 题目在试卷上的题号
 * - text_bbox: 仅文字区域的坐标
 * - image_type: 配图类型（geometry/chart/none）
 * - question_assets: 存储裁剪后的配图资源
 */
export const migratePageUnderstanding = async () => {
  try {
    // ── 1. 添加 question_number 字段 ──
    const { rows: colQn } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'question_number'
    `)
    if (colQn.length === 0) {
      await query(`ALTER TABLE questions ADD COLUMN question_number INTEGER`)
      console.log('✅ 已添加 question_number 字段到 questions 表')
    } else {
      console.log('✅ question_number 字段已存在，跳过')
    }

    // ── 2. 添加 text_bbox 字段 ──
    const { rows: colTb } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'text_bbox'
    `)
    if (colTb.length === 0) {
      await query(`ALTER TABLE questions ADD COLUMN text_bbox JSONB`)
      console.log('✅ 已添加 text_bbox 字段到 questions 表')
    } else {
      console.log('✅ text_bbox 字段已存在，跳过')
    }

    // ── 3. 添加 image_type 字段 ──
    const { rows: colIt } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'image_type'
    `)
    if (colIt.length === 0) {
      await query(`ALTER TABLE questions ADD COLUMN image_type VARCHAR(20)`)
      console.log('✅ 已添加 image_type 字段到 questions 表')
    } else {
      console.log('✅ image_type 字段已存在，跳过')
    }

    // ── 3b. 添加 image_bbox 字段 ──
    // 配图区域坐标（归一化 0-1000）。持久化后前端复核页可用 text_bbox ∪ image_bbox
    // 的并集绘制更贴合的题目定位框（block_coordinates 常偏大/偏移）。
    const { rows: colIb } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'image_bbox'
    `)
    if (colIb.length === 0) {
      await query(`ALTER TABLE questions ADD COLUMN image_bbox JSONB`)
      console.log('✅ 已添加 image_bbox 字段到 questions 表')
    } else {
      console.log('✅ image_bbox 字段已存在，跳过')
    }

    // ── 4. 创建 question_assets 表 ──
    const { rows: tblAssets } = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'question_assets'
    `)
    if (tblAssets.length === 0) {
      await query(`
        CREATE TABLE IF NOT EXISTS question_assets (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
          asset_type VARCHAR(30) NOT NULL DEFAULT 'geometry_image',
          original_image_url TEXT,
          cropped_image_url TEXT,
          bbox JSONB,
          tikz_code TEXT,
          tikz_status VARCHAR(10) DEFAULT 'none'
            CHECK (tikz_status IN ('none', 'pending', 'done', 'failed')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `)
      // 索引
      await query(`
        CREATE INDEX IF NOT EXISTS idx_question_assets_question_id
        ON question_assets(question_id)
      `)
      await query(`
        CREATE INDEX IF NOT EXISTS idx_question_assets_asset_type
        ON question_assets(asset_type)
      `)
      console.log('✅ 已创建 question_assets 表')
    } else {
      console.log('✅ question_assets 表已存在，跳过')
    }
  } catch (error) {
    console.error('页面理解迁移失败:', error.message)
  }
}