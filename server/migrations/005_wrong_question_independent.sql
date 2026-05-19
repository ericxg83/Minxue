-- ============================================
-- 敏学App V3 - 错题独立存储迁移
-- 目标：删除试卷时不删除错题
-- ============================================

-- 1. 移除 questions 表对 tasks 的级联删除
-- 改为 SET NULL，保留题目但断开与任务的关联
ALTER TABLE questions 
DROP CONSTRAINT IF EXISTS questions_task_id_fkey;

ALTER TABLE questions 
ADD CONSTRAINT questions_task_id_fkey 
FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;

-- 2. 移除 wrong_questions 表对 questions 的级联删除
-- 改为 SET NULL，保留错题记录但断开与题目的关联
ALTER TABLE wrong_questions 
DROP CONSTRAINT IF EXISTS wrong_questions_question_id_fkey;

ALTER TABLE wrong_questions 
ADD CONSTRAINT wrong_questions_question_id_fkey 
FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE SET NULL;

-- 3. 为 tasks 表添加 deleted_at 字段（软删除标记）
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- 4. 为 questions 表添加 deleted_at 字段（软删除标记）
ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- 5. 添加索引优化查询
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at);
CREATE INDEX IF NOT EXISTS idx_questions_task_id_null ON questions(task_id) WHERE task_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_wrong_questions_question_id_null ON wrong_questions(question_id) WHERE question_id IS NULL;
