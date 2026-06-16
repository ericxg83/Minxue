import { query } from '../config/neon.js'

/**
 * 数据库迁移：为 questions 表增加 is_complete 列
 * 用于标识题目是否"完整"（配图/选项/答案/题型齐全）
 * 回填现有数据，确保存量题目也有 is_complete 标记
 */
export const migrateIsComplete = async () => {
  try {
    const { rows } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'is_complete'
    `)

    if (rows.length > 0) {
      console.log('✅ is_complete 列已存在，跳过迁移')
      return
    }

    // 1. 加列
    await query(`
      ALTER TABLE questions
      ADD COLUMN is_complete BOOLEAN DEFAULT FALSE
    `)

    // 2. 回填现有数据
    const result = await query(`
      UPDATE questions SET is_complete = TRUE WHERE
        (answer IS NOT NULL AND TRIM(answer) <> '')
        AND (question_type IS NOT NULL AND question_type IN ('choice', 'fill', 'answer'))
        AND (
          question_type <> 'choice'
          OR (options IS NOT NULL AND jsonb_array_length(options::jsonb) > 0)
        )
        AND (
          content !~ '如图|图1|图示|附图|见图'
          OR (geometry_image_url IS NOT NULL AND TRIM(geometry_image_url) <> '')
        )
    `)
    console.log(`✅ is_complete 回填完成，${result.rowCount || 0} 道题被标记为完整`)

    // 3. 索引
    await query(`
      CREATE INDEX IF NOT EXISTS idx_questions_is_complete
      ON questions(is_complete)
    `)

    console.log('✅ is_complete 索引已创建')
  } catch (error) {
    console.error('is_complete 迁移失败:', error.message)
  }
}
