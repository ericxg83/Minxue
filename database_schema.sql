-- ============================================
-- 敏学App 数据库表结构
-- 用于生产环境 (Smart Mistake Book)
-- 在 Supabase SQL Editor 中执行
-- ============================================

-- 1. 学生表
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    grade TEXT,
    class TEXT,
    remark TEXT,
    avatar TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 任务表
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    result JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 题目表
CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    options JSONB,
    answer TEXT,
    student_answer TEXT,
    is_correct BOOLEAN,
    confidence NUMERIC,
    analysis TEXT,
    question_type TEXT CHECK (question_type IN ('choice', 'fill', 'answer')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'wrong', 'mastered')),
    ai_tags JSONB DEFAULT '[]'::jsonb,
    manual_tags JSONB DEFAULT '[]'::jsonb,
    tags_source TEXT DEFAULT 'ai' CHECK (tags_source IN ('ai', 'manual')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. 错题表
CREATE TABLE IF NOT EXISTS wrong_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'mastered')),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(student_id, question_id)
);

-- 5. 练习记录表
CREATE TABLE IF NOT EXISTS training_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
    result JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_tasks_student_id ON tasks(student_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_questions_task_id ON questions(task_id);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
CREATE INDEX IF NOT EXISTS idx_wrong_questions_student_id ON wrong_questions(student_id);
CREATE INDEX IF NOT EXISTS idx_wrong_questions_question_id ON wrong_questions(question_id);
CREATE INDEX IF NOT EXISTS idx_training_logs_student_id ON training_logs(student_id);

-- 创建 Storage bucket 用于存储作业图片
INSERT INTO storage.buckets (id, name, public) 
VALUES ('homework-images', 'homework-images', true)
ON CONFLICT (id) DO NOTHING;

-- 设置 Storage 访问权限
CREATE POLICY "Allow public read access" ON storage.objects
    FOR SELECT USING (bucket_id = 'homework-images');

CREATE POLICY "Allow authenticated uploads" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'homework-images');

-- ============================================
-- 增量迁移：为 questions 表添加 AI 标签字段
-- 如果是已有数据库，请在 Supabase SQL Editor 中单独执行以下语句
-- ============================================
-- ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_tags JSONB DEFAULT '[]'::jsonb;
-- ALTER TABLE questions ADD COLUMN IF NOT EXISTS manual_tags JSONB DEFAULT '[]'::jsonb;
-- ALTER TABLE questions ADD COLUMN IF NOT EXISTS tags_source TEXT DEFAULT 'ai' CHECK (tags_source IN ('ai', 'manual'));
-- CREATE INDEX IF NOT EXISTS idx_questions_ai_tags ON questions USING gin(ai_tags);
-- CREATE INDEX IF NOT EXISTS idx_questions_manual_tags ON questions USING gin(manual_tags);
