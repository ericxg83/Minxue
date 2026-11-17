import { query } from '../config/neon.js'

// ============================================================
// 067: 好题甄选表（2026-11-17 负责人需求）
//
// 需求：老师把散落在「每日错题」和「试卷/截图题」里的好题收起来，
//       打标签分类，集中筛选后导出 PDF 讲义 / 课件。
//
// ⛔ 只存「引用 + 标签」，不复制题目内容：
//    - 题干、选项、答案、配图全部留在原表（questions / resource_questions），
//      列表接口按 source_id 实时 JOIN 取回。
//    - 理由：① 避免两份真值漂移（触碰试卷题库零错字铁律）；
//           ② 源题被删/修正后甄选视图自动跟随，不留幽灵条目；
//           ③ 不回写任何题目表、错题表、掌握度。
//
// source_type 两值：
//    'question'           -> questions.id（学生作答链路的题，含每日错题）
//    'resource_question'  -> resource_questions.id（试卷题库的纯教学素材）
//
// 标签体系（自由文本数组，推荐四值：易错 / 高难 / 典型 / 好素材）：
//    - question 来源：收藏时由系统按 difficulty>=4 / 错次>=2 自动打标
//    - resource_question 来源：继承该题在试卷题库已打的 tags（加题时老师顺手标的）
//    - 两种来源都可在甄选页手动增删标签
//
// ⛔ 纯加法：只 CREATE TABLE IF NOT EXISTS + 索引，不碰任何既有表。
// ============================================================
export const migrateCuratedQuestions = async () => {
  try {
    console.log('📦 [迁移067] 建立好题甄选表...')

    await query(`
      CREATE TABLE IF NOT EXISTS curated_questions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_type TEXT NOT NULL CHECK (source_type IN ('question', 'resource_question')),
        source_id UUID NOT NULL,
        tags TEXT[] NOT NULL DEFAULT '{}'::text[],
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (source_type, source_id)
      )
    `)
    await query(`
      CREATE INDEX IF NOT EXISTS idx_curated_questions_created_at
        ON curated_questions (created_at DESC)
    `)
    await query(`
      CREATE INDEX IF NOT EXISTS idx_curated_questions_tags
        ON curated_questions USING GIN (tags)
    `)

    const { rows } = await query(`
      SELECT column_name, data_type
        FROM information_schema.columns
       WHERE table_name = 'curated_questions'
       ORDER BY ordinal_position
    `)
    if (rows.length !== 6) {
      throw new Error(`迁移 067 失败：期望 6 列，实际 ${rows.length} 列`)
    }
    console.log(`✅ [迁移067] 好题甄选表就绪: ${rows.map(r => `${r.column_name}:${r.data_type}`).join(' ')}`)
  } catch (e) {
    console.error('❌ [迁移067] 失败:', e.message)
    throw e
  }
}
