import { query } from '../config/neon.js'

/**
 * 数据库迁移：worksheet_answers 增加题干列
 *
 *   worksheet_answers:
 *     - content TEXT   该题的题干文本（印刷体题目内容），可空
 *
 * 背景：批改练习册时，题目行的 content 之前恒为占位符 "第 N 题"，
 * 因为答案库只存答案键（如 "13. D"）没有题干。
 * 加此列后，凡是来源（预埋答案 / 含题干的答案 PDF）能提供题干时，
 * 就落库到答案库，批改时按题号回填到 questions.content，替换占位符。
 *
 * 幂等：先查 information_schema，缺失才加。
 */
const addColumn = async (table, column, definition) => {
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  )
  if (rows.length > 0) {
    console.log(`  ✅ ${table}.${column} 已存在，跳过`)
    return
  }
  await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  console.log(`  ✅ 已添加 ${table}.${column}`)
}

export const migrateWorksheetAnswerContent = async () => {
  try {
    console.log('📦 [迁移027] 开始为答案库补题干列...')
    await addColumn('worksheet_answers', 'content', 'TEXT')
    console.log('✅ [迁移027] 答案库题干列补齐完成')
  } catch (error) {
    console.error('❌ [迁移027] 失败:', error.message)
  }
}
