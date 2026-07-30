import { query } from '../config/neon.js'

const columnExists = async (table, column) => {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  )
  return rows.length > 0
}

/**
 * 数据库迁移 034：为 wrong_questions 表添加 subject 列
 *
 * 背景：迁移 033 给 wrong_questions 加了一组自包含字段（worksheet_id / question_no 等），
 * 但漏掉了 subject。workbook 批改在 addSelfContainedWrongQuestion 里给 $13 传了
 * subject，导致生产数据库执行 INSERT 时报：
 *   "INSERT has more expressions than target columns"
 *
 * 此迁移把 subject 补上，与 question_id、source_type 等并列存储。
 */
export const migrateWrongQuestionSubject = async () => {
  try {
    console.log('📦 [迁移034] 开始为 wrong_questions 表添加 subject 字段...')

    if (await columnExists('wrong_questions', 'subject')) {
      console.log('  ✅ wrong_questions.subject 已存在，跳过')
      console.log('✅ [迁移034] 无需变更')
      return
    }

    await query(`ALTER TABLE wrong_questions ADD COLUMN subject TEXT`)
    console.log('  ✅ 已添加 wrong_questions.subject')
    console.log('✅ [迁移034] subject 字段迁移完成')
  } catch (error) {
    console.error('❌ [迁移034] 失败:', error.message)
  }
}
