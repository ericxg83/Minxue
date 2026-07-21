import { query } from '../config/neon.js'

/**
 * 数据库迁移：练习册 PDF 分批解析进度
 *
 *   worksheets:
 *     - parse_total_pages INTEGER  本次解析的总页数（OCR 分批路径写入）
 *     - parse_done_pages INTEGER   已完成解析的页数
 *
 * 背景：大 PDF（>15 页扫描版）改为每 15 页一批串行 OCR、增量写库，
 * 前端轮询这两列展示"正在解析第 X-Y 页 / 共 N 页 (P%)"。
 * NULL 语义 = 本次解析无页级进度（文字版 PDF / 小文件单趟路径 / 旧数据），
 * 前端据此降级为原有的不确定态转圈。
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

export const migrateParseProgressColumns = async () => {
  try {
    console.log('📦 [迁移031] 开始补齐练习册分批解析进度字段...')
    await addColumn('worksheets', 'parse_total_pages', 'INTEGER')
    await addColumn('worksheets', 'parse_done_pages', 'INTEGER')
    console.log('✅ [迁移031] 分批解析进度字段补齐完成')
  } catch (error) {
    console.error('❌ [迁移031] 失败:', error.message)
  }
}
