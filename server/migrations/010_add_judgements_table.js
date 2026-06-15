import { query } from '../config/neon.js'

/**
 * 数据库迁移：创建 judgements 表（判定记录/审计日志）
 * 存储 AI 判题和人工复核的所有判定记录
 */
export const migrateJudgements = async () => {
  try {
    const { rows } = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'judgements'
    `)

    if (rows.length > 0) {
      console.log('✅ judgements 表已存在，跳过迁移')
      return
    }

    await query(`
      CREATE TABLE judgements (
        id SERIAL PRIMARY KEY,
        question_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'ai_ocr',
        confidence REAL DEFAULT NULL,
        is_correct BOOLEAN DEFAULT NULL,
        content TEXT DEFAULT NULL,
        answer TEXT DEFAULT NULL,
        student_answer TEXT DEFAULT NULL,
        ai_answer TEXT DEFAULT NULL,
        analysis TEXT DEFAULT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)

    await query(`
      CREATE INDEX idx_judgements_question_student
      ON judgements (question_id, student_id, created_at DESC)
    `)

    console.log('✅ judgements 表已创建')
  } catch (error) {
    console.error('judgements 表迁移失败:', error.message)
  }
}
