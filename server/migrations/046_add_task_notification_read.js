import { query } from '../config/neon.js'

// ============================================================
// 046: 通知已读标记（修复 commit 65d46c2 漏写的 migration）
//
// 背景：
//   commit 65d46c2 在 server/services/neonService.js:44 (updateTaskStatus) 和
//   server/index.js:390,441（铃铛 summary + markNotificationsRead）里
//   引用了 tasks.notification_read_at 列，但当时把 SQL 写到了
//   根目录的 migrations/002_add_task_notification_read.sql，
//   既不在 server/migrations/ 也没在 server/index.js 的 migration loop
//   里 import/run，所以 Render 部署时这个列从未被创建。
//
// 症状：
//   - 任务处理第一步（updateTaskStatus → PROCESSING）直接 42703 失败，
//     AI 完全没机会被调用（用户日志里 taskId cf233480... 撞这个错）
//   - 铃铛数字 GET /api/tasks/summary 持续报 column does not exist
//   - markNotificationsRead POST 同样报 column does not exist
//
// 修复：
//   把那个 .sql 的内容移植到 server/migrations 下，纳入 .js loop 自动跑。
//   幂等：ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS，重复跑安全。
// ============================================================
export const migrateTaskNotificationRead = async () => {
  try {
    console.log('📦 [迁移046] tasks.notification_read_at 已读标记列（修复 commit 65d46c2 漏 migration）...')

    // 1. tasks 表新增 notification_read_at 列（NULL=未读；非 NULL=已读时间）
    await query(`
      ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS notification_read_at TIMESTAMPTZ
    `)

    // 2. 索引：未读统计按 status 过滤 + 已读时间排序
    await query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_notif_read
      ON tasks(status, notification_read_at)
    `)

    // 3. 验证：列出 tasks 表的 notification_read_at 列信息
    const { rows } = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'notification_read_at'
    `)
    if (rows.length === 0) {
      throw new Error('迁移 046 失败：tasks.notification_read_at 列未创建')
    }
    console.log(`✅ [迁移046] notification_read_at 列就绪: ${JSON.stringify(rows[0])}`)
  } catch (e) {
    console.error('❌ [迁移046] 失败:', e.message)
    throw e
  }
}
