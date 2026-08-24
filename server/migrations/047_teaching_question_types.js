import { query } from '../config/neon.js'

// 047: 教师私有数学题型库。题型卡是教学内容，不承载学生学习状态。
export const migrateTeachingQuestionTypes = async () => {
  try {
    console.log('📦 [迁移047] 教师题型库...')
    await query(`
      CREATE TABLE IF NOT EXISTS teaching_question_types (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL,
        kp_id uuid NOT NULL REFERENCES knowledge_points(id) ON DELETE RESTRICT,
        subject text NOT NULL DEFAULT '数学',
        name text NOT NULL,
        teaching_notes text NOT NULL DEFAULT '',
        common_mistakes text NOT NULL DEFAULT '',
        tags jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id, kp_id, name)
      )
    `)
    await query(`CREATE INDEX IF NOT EXISTS idx_teaching_question_types_user_kp ON teaching_question_types(user_id, kp_id, sort_order, updated_at DESC)`)
    await query(`
      CREATE TABLE IF NOT EXISTS teaching_question_type_examples (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type_id uuid NOT NULL REFERENCES teaching_question_types(id) ON DELETE CASCADE,
        source_question_id uuid REFERENCES questions(id) ON DELETE SET NULL,
        source_wrong_question_id uuid REFERENCES wrong_questions(id) ON DELETE SET NULL,
        snapshot jsonb NOT NULL,
        note text NOT NULL DEFAULT '',
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT teaching_question_type_examples_source_check CHECK (
          source_question_id IS NOT NULL OR source_wrong_question_id IS NOT NULL
        )
      )
    `)
    await query(`CREATE INDEX IF NOT EXISTS idx_teaching_question_type_examples_type ON teaching_question_type_examples(type_id, sort_order, created_at)`)
    console.log('✅ [迁移047] 教师题型库已就绪')
  } catch (error) {
    console.error('❌ [迁移047] 失败:', error.message)
    throw error
  }
}
