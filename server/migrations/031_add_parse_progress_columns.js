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

  // worksheets 可能是 VIEW 而非 BASE TABLE，
  // 在 VIEW 上 ALTER TABLE ADD COLUMN 会报错（42809: not supported for views）。
  // 实际数据存储在 resources 表，需要加到 resources 然后重建视图。
  const { rows: tblInfo } = await query(
    `SELECT table_type FROM information_schema.tables WHERE table_name = $1`,
    [table]
  )
  if (tblInfo.length > 0 && tblInfo[0].table_type === 'VIEW') {
    // 1. 列加到 resources 基础表
    const { rows: baseCols } = await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'resources' AND column_name = $1`,
      [column]
    )
    if (baseCols.length === 0) {
      await query(`ALTER TABLE resources ADD COLUMN ${column} ${definition}`)
      console.log(`  ✅ 已添加 resources.${column}`)
    } else {
      console.log(`  ✅ resources.${column} 已存在，跳过`)
    }
    // 2. 重建 worksheets 视图包含新列
    await rebuildWorksheetsView()
    console.log(`  ✅ 已重建 worksheets 视图（含新增列）`)
  } else {
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    console.log(`  ✅ 已添加 ${table}.${column}`)
  }
}

const rebuildWorksheetsView = async () => {
  // 收集 resources 表所有列，过滤出 worksheets 视图需要的列
  const { rows: allCols } = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'resources' AND column_name NOT IN ('resource_type', 'metadata', 'exam_date', 'answer_status')
     ORDER BY ordinal_position`
  )
  const colNames = allCols.map(r => r.column_name).join(', ')
  await query('DROP VIEW IF EXISTS worksheets')
  await query(
    `CREATE VIEW worksheets AS SELECT ${colNames} FROM resources WHERE resource_type = 'worksheet'`
  )
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
