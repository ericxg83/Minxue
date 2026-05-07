-- ============================================
-- 敏学App 数据库迁移 - 支持后端异步任务处理
-- 在 Supabase SQL Editor 中执行
-- ============================================

-- 1. 为 tasks 表添加 image_url 和 original_name 列（如果不存在）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS original_name TEXT;

-- 2. 为 tasks 表的 result 字段增加更多状态信息
-- result JSONB 已包含: progress, error, questionCount, wrongCount, duration, retryCount, startedAt, completedAt, failedAt
-- 这些都存储在 JSONB 中，无需新增列

-- 3. 为 tasks 表添加 student_id 列（如果不存在，用于直接查询）
-- 注意：当前 tasks 表通过 result JSONB 存储 student_id，但为了查询效率，建议添加外键列
-- 检查 student_id 列是否已存在
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tasks' AND column_name = 'student_id'
  ) THEN
    ALTER TABLE tasks ADD COLUMN student_id UUID REFERENCES students(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4. 为 tasks 表创建 student_id 索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_tasks_student_id ON tasks(student_id);

-- 5. 启用 Supabase Realtime 用于 tasks 表
-- 这样前端可以通过 WebSocket 实时获取任务状态更新
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;

-- 6. 确保 Storage bucket 存在且权限正确
INSERT INTO storage.buckets (id, name, public) 
VALUES ('homework-images', 'homework-images', true)
ON CONFLICT (id) DO NOTHING;

-- 7. 验证迁移结果
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'tasks' 
ORDER BY ordinal_position;
