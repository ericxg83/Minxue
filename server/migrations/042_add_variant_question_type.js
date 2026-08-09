import { query } from '../config/neon.js'

const columnExists = async (table, column) => {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  )
  return rows.length > 0
}

// ============================================================
// 变式题表加 question_type 字段（英语题型）
//
// 背景：P3 英语集成时，英语变式题需要保留题型（cloze / grammar_blank /
// error_correction / translation / writing / reading / choice / fill_blank / other）
// 供讲义模板按题型选用不同排版（完形 4 选 1 vs 语法填空 vs 翻译 vs 写作）。
//
// 与数学无关：数学变式题 question_type 留空。
// ============================================================
export const migrateVariantQuestionType = async () => {
  try {
    console.log('📦 [迁移042] 变式题表加 question_type 字段...')

    if (!(await columnExists('variant_questions', 'question_type'))) {
      await query(
        `ALTER TABLE variant_questions
         ADD COLUMN question_type TEXT
         CHECK (question_type IS NULL OR question_type IN
           ('cloze', 'grammar_blank', 'error_correction', 'translation', 'writing',
            'reading', 'choice', 'fill_blank', 'sentence_pattern', 'other'))`
      )
      await query(`CREATE INDEX idx_vq_question_type ON variant_questions(question_type)`)
      console.log('  ✅ 已加 question_type 列')
    } else {
      console.log('  ℹ️ question_type 已存在，跳过')
    }

    console.log('✅ [迁移042] 变式题 question_type 迁移完成')
  } catch (error) {
    console.error('❌ [迁移042] 失败:', error.message)
    console.error(error)
  }
}
