import { query } from '../config/neon.js'

// 048: 题型卡自动整理元数据，仅承载教师教学候选，不改变学习事实。
export const migrateTeachingQuestionTypeAuto = async () => {
  try {
    console.log('📦 [迁移048] 题型库自动整理字段...')
    await query(`ALTER TABLE teaching_question_types ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'`)
    await query(`ALTER TABLE teaching_question_types ADD COLUMN IF NOT EXISTS auto_summary jsonb NOT NULL DEFAULT '{}'::jsonb`)
    await query(`CREATE INDEX IF NOT EXISTS idx_teaching_question_types_user_source ON teaching_question_types(user_id, source, status, updated_at DESC)`)
    console.log('✅ [迁移048] 题型库自动整理字段已就绪')
  } catch (error) {
    console.error('❌ [迁移048] 失败:', error.message)
    throw error
  }
}
