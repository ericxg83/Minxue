import { query } from '../config/neon.js'

// ============================================================
// 063: 启用 resource_questions（试卷题库的「题目清册」）
//
// 背景（2026-10-10 产品评审《_试卷题库与勾题出讲义-产品评审-20261010.md》）：
//   负责人要把纸质中考模拟卷（拍照/PDF）转成结构化题库，永久保存、跨年复用，
//   并能「跨卷按题号/题型/难度/标签勾题 → 出讲义 PDF 去讲题」
//   （例：16 套一模卷的压轴题；所有第 19 题）。
//
//   resource_questions 表在 032 迁移就已建好（列 question_no/sub_no/content/
//   question_type/options/page_no/bbox/image_url + 唯一键
//   (resource_id, unit_id, question_no, sub_no)），注释明写「阶段 2 才写入」——
//   但全仓至今**零写入**，是一张空表。同批加的 resources.question_parse_status /
//   question_parse_total_pages / question_parse_done_pages 三列同样从未被读过。
//   本次迁移只补「阶段 2 真正需要的列」，表本身与唯一键一字不动。
//
// 为什么必须是独立表、绝不写 questions 表：
//   questions.task_id / student_id 均 NOT NULL（database/neon_schema.sql:37-38），
//   且挂着 批改 → 错题 → 掌握度 全链路。试卷题库的题**没有学生、没有作答**，
//   硬塞进 questions 会污染所有统计口径。resource_questions 才是它的家。
//
// 新增列（全部纯加法，ADD COLUMN IF NOT EXISTS，历史行不受影响）：
//   · parent_stem    多小问大题（如 24.(1)(2)）的公共题干，口径与
//                    questions.parent_stem 完全一致（057 迁移同一设计）。
//   · answer         参考答案。answer_source 标明它的可信级别。
//   · answer_source  'printed' 卷面印刷答案 / 'ai' AI 独立解出 / 'manual' 老师手填。
//                    ⚠️ 这一列是给「答案一定要对，不要去猜」这条口径用的：
//                    讲义与列表必须能区分「卷面印着的」与「模型算的」。
//   · analysis       解析（卷面印有才存，不生成）。
//   · difficulty     难度 1-5，NULL = 未判定。口径与 questions.difficulty（013）一致。
//   · tags           题目标签（如 {压轴题}）。用 TEXT[] 而非 JSONB：只需等值/包含查询。
//   · page_image_url 该题所在**整页图**的 OSS 地址。存它是为了让裁片可重做
//                    （换切段算法 / 补配图）而不必让老师重传卷子。
//
// 不动的部分（刻意为之）：
//   · 不加相似度合并、不加任何「同题」推断 —— 题目身份就是
//     (resource_id, unit_id, question_no, sub_no) 这条既有唯一键（AGENTS.md 第 9/10 条）。
//   · 不建 tags 的 GIN 索引：单用户系统，卷子量级是「几十套」，顺序扫足够。
// ============================================================
export const migratePaperBankQuestions = async () => {
  try {
    console.log('📦 [迁移063] 启用 resource_questions（试卷题库题目清册）...')

    await query(`
      ALTER TABLE resource_questions
      ADD COLUMN IF NOT EXISTS parent_stem TEXT
    `)
    await query(`
      ALTER TABLE resource_questions
      ADD COLUMN IF NOT EXISTS answer TEXT
    `)
    await query(`
      ALTER TABLE resource_questions
      ADD COLUMN IF NOT EXISTS answer_source TEXT
    `)
    await query(`
      ALTER TABLE resource_questions
      ADD COLUMN IF NOT EXISTS analysis TEXT
    `)
    await query(`
      ALTER TABLE resource_questions
      ADD COLUMN IF NOT EXISTS difficulty SMALLINT
    `)
    await query(`
      ALTER TABLE resource_questions
      ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[]
    `)
    await query(`
      ALTER TABLE resource_questions
      ADD COLUMN IF NOT EXISTS page_image_url TEXT
    `)

    // answer_source 取值闸门。用 DO 块加约束，避免重复执行时报「约束已存在」。
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'resource_questions_answer_source_check'
        ) THEN
          ALTER TABLE resource_questions
          ADD CONSTRAINT resource_questions_answer_source_check
          CHECK (answer_source IS NULL OR answer_source IN ('printed', 'ai', 'manual'));
        END IF;
      END $$;
    `)

    // difficulty 取值闸门（与 questions.difficulty 同口径）。
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'resource_questions_difficulty_check'
        ) THEN
          ALTER TABLE resource_questions
          ADD CONSTRAINT resource_questions_difficulty_check
          CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5);
        END IF;
      END $$;
    `)

    const { rows } = await query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'resource_questions'
        AND column_name IN (
          'parent_stem', 'answer', 'answer_source', 'analysis',
          'difficulty', 'tags', 'page_image_url'
        )
      ORDER BY column_name
    `)
    if (rows.length !== 7) {
      throw new Error(`迁移 063 失败：期望 7 列，实际 ${rows.length} 列（${rows.map(r => r.column_name).join(',')}）`)
    }
    console.log(`✅ [迁移063] 题目清册列就绪: ${rows.map(r => `${r.column_name}:${r.data_type}`).join(' ')}`)
  } catch (e) {
    console.error('❌ [迁移063] 失败:', e.message)
    throw e
  }
}
