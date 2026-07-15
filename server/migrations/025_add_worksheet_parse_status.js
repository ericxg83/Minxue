import { query } from '../config/neon.js'

/**
 * 数据库迁移：练习册 PDF 解析状态
 *
 *   worksheets:
 *     - parse_status TEXT    'idle' | 'parsing' | 'done' | 'failed'
 *     - parse_count INTEGER  最近一次解析出的答案条数
 *     - parse_warning TEXT   最近一次解析的警告（如 OCR 截断、疑似混入题干）
 *     - parse_error TEXT     最近一次解析失败的原因
 *
 * 背景：parse-pdf 接口改为"上传即返回、后台解析、前端轮询"，
 * 解析结果落在这些列上供 GET /worksheets/:id 轮询读取。
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

export const migrateWorksheetParseStatus = async () => {
  try {
    console.log('📦 [迁移025] 开始补齐练习册解析状态字段...')
    await addColumn('worksheets', 'parse_status', `TEXT DEFAULT 'idle'`)
    await addColumn('worksheets', 'parse_count', 'INTEGER')
    await addColumn('worksheets', 'parse_warning', 'TEXT')
    await addColumn('worksheets', 'parse_error', 'TEXT')
    console.log('✅ [迁移025] 练习册解析状态字段补齐完成')
  } catch (error) {
    console.error('❌ [迁移025] 失败:', error.message)
  }
}
