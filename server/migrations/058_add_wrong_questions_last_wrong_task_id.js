import { query } from '../config/neon.js'

/**
 * 数据库迁移 058：为 wrong_questions 表添加 last_wrong_task_id 列
 *
 * 用途：修复「练习册批改重跑 → error_count 无条件 +1」的污染（2026-09-14 清洗 36 行实证）。
 * 记录"上次把本题判错的是哪个任务"，addSelfContainedWrongQuestion 冲突时据此判断：
 *   同一任务重跑 → error_count 不变（幂等）；不同任务真做错 → +1。
 *
 * 兼容：可空、无外键（仅溯源用，不约束删除行为）；历史行用 question_id → questions.task_id
 * 反查回填一次，回填不到的保持 NULL（NULL 情况下不增量，宁少勿多）。
 */
export const migrateWrongQuestionsLastWrongTaskId = async () => {
  try {
    const { rows } = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'wrong_questions' AND column_name = 'last_wrong_task_id'
    `)

    if (rows.length > 0) {
      console.log('✅ last_wrong_task_id 字段已存在，跳过迁移')
      return
    }

    await query(`
      ALTER TABLE wrong_questions
      ADD COLUMN last_wrong_task_id UUID
    `)
    console.log('✅ 已添加 last_wrong_task_id 字段到 wrong_questions 表')

    // 回填：有 question_id 的行，其真实判错来源就是该题目行所属任务
    const { rowCount } = await query(`
      UPDATE wrong_questions wq
      SET last_wrong_task_id = q.task_id
      FROM questions q
      WHERE wq.question_id = q.id
        AND q.task_id IS NOT NULL
        AND wq.last_wrong_task_id IS NULL
    `)
    console.log(`✅ 已回填 last_wrong_task_id：${rowCount} 行（来源 question_id → task_id）`)
  } catch (error) {
    console.error('last_wrong_task_id 字段迁移失败:', error.message)
    throw error
  }
}
