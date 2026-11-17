import { query } from '../config/neon.js'

// ============================================================
// 068: 好题甄选的章节归属（2026-11-17 负责人需求）
//
// 需求：甄选的好题多是考点丰富的综合难题，按「单一章节」归档会丢信息
//       （一道矩形十字架题同时考矩形/相似/勾股，硬塞一格就捞不全）。
//       改为「一题挂多个教材章节」，筛选时命中任一即可。
//
// 章节轴用静态教材目录 textbookCatalog.js（初二/初三逐章逐节，节点 id 稳定）。
// ⛔ 只存节点 id 数组，不复制章节名（沿用教材目录「只引用 id」的设计原则）。
// ⛔ 纯加法：ADD COLUMN IF NOT EXISTS，不碰既有 6 列、不回填、不改任何题目表。
// ============================================================
export const migrateCuratedChapterIds = async () => {
  try {
    console.log('📦 [迁移068] curated_questions.chapter_ids 章节归属...')

    await query(`
      ALTER TABLE curated_questions
      ADD COLUMN IF NOT EXISTS chapter_ids TEXT[] NOT NULL DEFAULT '{}'::text[]
    `)

    const { rows } = await query(`
      SELECT column_name, data_type, column_default
        FROM information_schema.columns
       WHERE table_name = 'curated_questions' AND column_name = 'chapter_ids'
    `)
    if (rows.length !== 1) {
      throw new Error('迁移 068 失败：chapter_ids 列校验未通过')
    }
    console.log('✅ [迁移068] chapter_ids 就绪', rows[0])
  } catch (e) {
    console.error('❌ [迁移068] 失败:', e.message)
    throw e
  }
}
