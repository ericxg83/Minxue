-- ============================================
-- 修复 wrong_questions 表缺少的 added_at 字段
-- ============================================

-- 添加 added_at 字段（如果不存在）
ALTER TABLE wrong_questions 
ADD COLUMN IF NOT EXISTS added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 为现有数据设置 added_at 值（使用 created_at 或当前时间）
UPDATE wrong_questions 
SET added_at = COALESCE(created_at, NOW()) 
WHERE added_at IS NULL;
