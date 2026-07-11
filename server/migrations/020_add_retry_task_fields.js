import { query } from '../config/neon.js'

/**
 * 数据库迁移：为「错题重练任务入口」流程补充字段
 *
 *   generated_exams:
 *     - retry_task_id UUID      关联 tasks.id（AI 批改任务），上传答卷后写入
 *     - status 枚举新增 'grading'（批改中）
 *
 *   tasks:
 *     - task_type TEXT DEFAULT 'general'  业务类型，错题重练写入 'wrong_retry'
 *     - generated_exam_id UUID           回链到错题重练卷
 *
 * 二维码只承载唯一 retry task 定位（/retry-task/{id}），不再绑定具体批改页面。
 */
export const migrateRetryTaskFields = async () => {
  try {
    // generated_exams.retry_task_id
    let { rows } = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'generated_exams' AND column_name = 'retry_task_id'
    `)
    if (rows.length === 0) {
      await query(`ALTER TABLE generated_exams ADD COLUMN retry_task_id UUID`)
      console.log('✅ generated_exams.retry_task_id 字段已添加')
    } else {
      console.log('✅ generated_exams.retry_task_id 已存在，跳过')
    }

    // tasks.task_type
    ;({ rows } = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'task_type'
    `))
    if (rows.length === 0) {
      await query(`ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'general'`)
      console.log('✅ tasks.task_type 字段已添加')
    } else {
      console.log('✅ tasks.task_type 已存在，跳过')
    }

    // tasks.generated_exam_id
    ;({ rows } = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'generated_exam_id'
    `))
    if (rows.length === 0) {
      await query(`ALTER TABLE tasks ADD COLUMN generated_exam_id UUID`)
      console.log('✅ tasks.generated_exam_id 字段已添加')
    } else {
      console.log('✅ tasks.generated_exam_id 已存在，跳过')
    }

    // 索引
    await query(`CREATE INDEX IF NOT EXISTS idx_generated_exams_retry_task_id ON generated_exams(retry_task_id)`).catch(() => {})
    await query(`CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type)`).catch(() => {})
    await query(`CREATE INDEX IF NOT EXISTS idx_tasks_generated_exam_id ON tasks(generated_exam_id)`).catch(() => {})
  } catch (error) {
    console.error('retry_task_fields 迁移失败:', error.message)
  }
}
