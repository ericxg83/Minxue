import { query } from '../config/neon.js'

/**
 * 数据库迁移：练习册新增 question_pdf_url 字段
 *
 * 新增字段：
 *   resources.question_pdf_url  — 题目PDF（学生做题时看到的试卷）
 *
 * 向后兼容：question_pdf_url 为 nullable，已有练习册不受影响
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

export const migrateQuestionPdfUrl = async () => {
  try {
    console.log('📦 [迁移029] 开始添加 question_pdf_url 字段...')

    // 先检查 resources 表是否存在（迁移028创建）
    const { rows: tableCheck } = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'resources'
    `)
    if (tableCheck.length === 0) {
      console.log('  ⏭️ resources 表不存在，跳过迁移029（请先确保迁移028已执行）')
      return
    }

    // resources 表（worksheets 视图的实表）新增 question_pdf_url
    await addColumn('resources', 'question_pdf_url', 'TEXT')

    // 重建 worksheets 视图，暴露 question_pdf_url 列
    // 注意：CREATE OR REPLACE VIEW 不能增删列，需先 DROP
    const { rows: viewInfo } = await query(`
      SELECT table_name FROM information_schema.views
      WHERE table_name = 'worksheets'
    `)
    if (viewInfo.length > 0) {
      await query(`DROP VIEW IF EXISTS worksheets CASCADE`)
      await query(`
        CREATE VIEW worksheets AS
        SELECT id, name, subject, grade, pdf_url, question_pdf_url, status, answer_count, parse_status, parse_count, parse_warning, parse_error, created_at, updated_at
        FROM resources
        WHERE resource_type = 'worksheet'
      `)
      console.log('  ✅ worksheets 视图已重建（含 question_pdf_url）')
    }

    console.log('✅ [迁移029] 完成')
  } catch (e) {
    console.error('❌ [迁移029] 失败:', e.message)
    throw e
  }
}

// 直接执行
migrateQuestionPdfUrl().catch(e => {
  console.error(e)
  process.exit(1)
})