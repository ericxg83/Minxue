import { query } from '../config/neon.js'

// ============================================================
// 054: tasks.task_type 约束扩展（加 'exam' / 'homework'）
//
// 背景（2026-09-02）：
//   移动端 useUploadFlow.js 实际上传 task_type='exam' / 'homework' / 'workbook'，
//   但 server/index.js:206-209 的 normalize 把 'exam' / 'homework' 归一到 'general'，
//   导致：
//     1. 数据库里 task_type 都是 'general'，无法区分"试卷 vs 日常作业"
//     2. worker 自动沉淀答案库无法仅作用于 exam 类型（v4 方案要求）
//
//   修复：
//     1. DB 约束加 'exam' / 'homework'（迁移054）
//     2. server/index.js 补 normalize，让 'exam' / 'homework' 原样落库
//
// 幂等性：DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT，重复跑安全。
// ============================================================
export const migrateTaskTypeEnum = async () => {
  try {
    console.log('📦 [迁移054] tasks.task_type 约束扩展（exam / homework）...')

    // 1. 扩 task_type 约束
    await query(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check`)
    await query(`ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check
      CHECK (task_type IN ('general', 'wrong_retry', 'retry_paper', 'workbook', 'exam', 'homework'))`)
    console.log('✅ tasks.task_type 约束已扩展（含 exam / homework）')

    // 2. 验证
    const { rows: constr } = await query(`
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'tasks' AND con.conname = 'tasks_task_type_check'
    `)
    if (constr.length !== 1) {
      throw new Error(`迁移054 失败：期望 tasks_task_type_check 存在，实际 ${constr.length}`)
    }
    console.log('✅ [迁移054] 完成')
  } catch (error) {
    console.error('❌ [迁移054] 失败:', error.message)
  }
}