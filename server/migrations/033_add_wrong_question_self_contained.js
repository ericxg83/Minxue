import { query } from '../config/neon.js'

const columnExists = async (table, column) => {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  )
  return rows.length > 0
}

export const migrateWrongQuestionSelfContained = async () => {
  try {
    console.log('📦 [迁移033] 开始为 wrong_questions 表添加自包含字段...')

    const cols = [
      ['question_image_url', 'TEXT'],
      ['worksheet_id', 'UUID'],
      ['page_number', 'INTEGER'],
      ['question_no', 'INTEGER'],
      ['student_answer', 'TEXT'],
      ['correct_answer', 'TEXT'],
      ['answer_type', "TEXT DEFAULT 'choice'"],
      ['question_type', 'TEXT'],
      ['content', 'TEXT'],
      ['block_coordinates', 'JSONB'],
      ['source_type', "TEXT DEFAULT 'workbook'"],
    ]

    let added = 0
    for (const [name, def] of cols) {
      if (await columnExists('wrong_questions', name)) {
        console.log(`  ✅ wrong_questions.${name} 已存在，跳过`)
        continue
      }
      await query(`ALTER TABLE wrong_questions ADD COLUMN ${name} ${def}`)
      console.log(`  ✅ 已添加 wrong_questions.${name}`)
      added++
    }

    if (added > 0) {
      console.log('  ✅ 新增列完成')
    } else {
      console.log('  ✅ 所有列已存在，无需变更')
    }

    // 创建索引
    for (const idx of [
      'CREATE INDEX IF NOT EXISTS idx_wrong_questions_worksheet_id ON wrong_questions(worksheet_id)',
      'CREATE INDEX IF NOT EXISTS idx_wrong_questions_source_type ON wrong_questions(source_type)',
    ]) {
      await query(idx)
    }
    console.log('  ✅ 索引已创建')

    console.log('✅ [迁移033] wrong_questions 自包含字段迁移完成')
  } catch (error) {
    console.error('❌ [迁移033] 失败:', error.message)
  }
}