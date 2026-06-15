import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 questions 表添加 cache_id 列（FK → question_cache.id）
 * 实现「改一处、全局同步」：同一道题在多个学生之间的 content/options/answer 等
 * 权威字段从此指向共享的 question_cache 条目，编辑时自动同步。
 */
export const migrateQuestionCacheId = async () => {
  try {
    const { rows } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'cache_id'
    `)

    if (rows.length > 0) {
      console.log('✅ cache_id 字段已存在，跳过迁移')
      return
    }

    // 添加可空外键（已有数据的 cache_id 为 NULL，行为不变）
    await query(`
      ALTER TABLE questions
      ADD COLUMN cache_id UUID
      REFERENCES question_cache(id) ON DELETE SET NULL
    `)

    // 索引：加速按 cache_id 查询（仅对非空行）
    await query(`
      CREATE INDEX IF NOT EXISTS idx_questions_cache_id
      ON questions (cache_id)
      WHERE cache_id IS NOT NULL
    `)

    console.log('✅ 已添加 cache_id 字段到 questions 表')
  } catch (error) {
    console.error('cache_id 字段迁移失败:', error.message)
  }
}
