-- ============================================
-- 敏学App 数据库迁移 - 通知已读标记
-- 在 Supabase SQL Editor 中执行
--
-- 移动端铃铛数字 = 未读的「批改完成 / 识别失败」任务数。
-- 用户打开通知面板后，将 done/failed 任务标记为已读，
-- 数字归零；新任务完成/失败时重置为未读，重新累计。
-- ============================================

-- 1. tasks 表新增 notification_read_at 列
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notification_read_at TIMESTAMPTZ;

-- 2. 索引（未读统计按状态过滤）
CREATE INDEX IF NOT EXISTS idx_tasks_notif_read ON tasks(status, notification_read_at);

-- 3. 验证迁移结果
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'tasks'
ORDER BY ordinal_position;
