import { query } from '../config/neon.js'

// ============================================================
// 066: 试卷题库的树形文件夹（2026-11-07 负责人需求）
//
// 需求：左侧要有笔记类 App 那样的文件夹树，可自由新建、嵌套、移动；
//       题集（一套卷 / 一个预设合集）是挂在文件夹下的叶子。
//
// ⛔ 纯加法：只 CREATE TABLE IF NOT EXISTS + 一个索引，
//    不碰任何既有表、列、约束、索引，历史数据零影响。
//    题集归属不新加列，复用已有的 resources.metadata.folderId（jsonb 单键）。
//
// 为什么是独立表：resources 的 resource_type 有 CHECK 约束且被答案库/批改链共享，
//    把「文件夹」混进去会污染所有 SELECT ... WHERE resource_type='exam' 的口径
//    （一个数据两个口径，题库列表会冒出假卷子）。
//
// 删除策略由路由负责（不交给 ON DELETE CASCADE 一把梭）：
//    删文件夹时把子文件夹上移一层、把题集设为「未归类」，绝不连带删题目。
//    这里的 CASCADE 只作为数据库层兜底。
// ============================================================
export const migratePaperBankFolders = async () => {
  try {
    console.log('📦 [迁移066] 建立试卷题库文件夹树...')

    await query(`
      CREATE TABLE IF NOT EXISTS paper_bank_folders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        parent_id UUID REFERENCES paper_bank_folders(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await query(`
      CREATE INDEX IF NOT EXISTS idx_paper_bank_folders_parent
        ON paper_bank_folders(parent_id)
    `)

    const { rows } = await query(`
      SELECT column_name, data_type
        FROM information_schema.columns
       WHERE table_name = 'paper_bank_folders'
       ORDER BY ordinal_position
    `)
    if (rows.length !== 5) {
      throw new Error(`迁移 066 失败：期望 5 列，实际 ${rows.length} 列`)
    }
    console.log(`✅ [迁移066] 文件夹表就绪: ${rows.map(r => `${r.column_name}:${r.data_type}`).join(' ')}`)
  } catch (e) {
    console.error('❌ [迁移066] 失败:', e.message)
    throw e
  }
}
