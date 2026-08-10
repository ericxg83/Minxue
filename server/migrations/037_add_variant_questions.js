import { query } from '../config/neon.js'

const tableExists = async (table) => {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [table]
  )
  return rows.length > 0
}

// ============================================================
// 变式题表（variant_questions）
//
// 用途：存储 AI 生成的同类题/变式题，供讲义引擎和重练使用。
// 每道题变式 4 种策略：改数字 / 改条件 / 逆命题 / 情境迁移
// ============================================================
export const migrateVariantQuestions = async () => {
  try {
    console.log('📦 [迁移037] 开始建立变式题表...')

    if (!(await tableExists('variant_questions'))) {
      await query(`
        CREATE TABLE variant_questions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          source_question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
          strategy TEXT NOT NULL CHECK (strategy IN ('change_number', 'change_condition', 'inverse', 'context_shift')),
          content TEXT NOT NULL,
          options JSONB,
          answer TEXT NOT NULL,
          analysis TEXT,
          difficulty INTEGER DEFAULT 3 CHECK (difficulty >= 1 AND difficulty <= 5),
          kp_id UUID REFERENCES knowledge_points(id) ON DELETE SET NULL,
          subject TEXT NOT NULL DEFAULT '数学',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `)
      await query(`CREATE INDEX idx_vq_source ON variant_questions(source_question_id)`)
      await query(`CREATE INDEX idx_vq_strategy ON variant_questions(strategy)`)
      await query(`CREATE INDEX idx_vq_kp ON variant_questions(kp_id)`)
      console.log('  ✅ 已创建 variant_questions 表')
    } else {
      console.log('  ℹ️ variant_questions 表已存在，跳过')
    }

    console.log('✅ [迁移037] 变式题表迁移完成')
  } catch (error) {
    console.error('❌ [迁移037] 失败:', error.message)
    console.error(error)
  }
}