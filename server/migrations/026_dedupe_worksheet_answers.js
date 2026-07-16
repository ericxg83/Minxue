import { query } from '../config/neon.js'

/**
 * 数据库迁移：清理 worksheet_answers 重复条目
 *
 * 旧版 parsePdfInBackground 中 clear + insert 无事务保护，
 * 并发解析或重复上传 PDF 产生了大量重复行（同 worksheet_id + question_no + NULL section）。
 * NULL != NULL 跳过了 ON CONFLICT 唯一约束，导致同题号多条答案，取错答案风险高。
 *
 * 修复方案：
 * 1. 删除每组 (worksheet_id, question_no, section) 中非最新的行
 * 2. 保留最新一条 = 最近一次解析结果
 * 3. 配合新版 replaceWorksheetAnswers（事务性替换）防止复发
 */
export const migrateDeduplicateWorksheetAnswers = async () => {
  try {
    // 仅当表存在且有重复时执行
    const { rows: dupCheck } = await query(`
      SELECT COUNT(*)::int - COUNT(DISTINCT (worksheet_id, question_no, COALESCE(section, '')))::int AS dup_count
      FROM worksheet_answers
    `)
    const dupCount = dupCheck[0]?.dup_count || 0
    if (dupCount === 0) {
      console.log(`✅ worksheet_answers 无重复行，跳过去重`)
      return
    }

    console.log(`📦 [迁移026] 开始清理 worksheet_answers 重复行 (${dupCount} 行冗余)...`)

    // 删除每组内 non-latest 行（ctid 是物理行标识；这里用 id 更直观）
    const { rowCount: deleted } = await query(`
      DELETE FROM worksheet_answers wa1
      WHERE EXISTS (
        SELECT 1 FROM worksheet_answers wa2
        WHERE wa2.worksheet_id = wa1.worksheet_id
          AND wa2.question_no = wa1.question_no
          AND (wa2.section = wa1.section OR (wa2.section IS NULL AND wa1.section IS NULL))
          AND wa2.created_at > wa1.created_at
      )
    `)

    console.log(`✅ [迁移026] 已删除 ${deleted} 行重复数据，每组保留最新一条`)
  } catch (e) {
    console.error('❌ [迁移026] 清理失败:', e.message)
  }
}