-- ============================================
-- 敏学App V3 - Neon PostgreSQL 数据库表结构
-- 在 Neon SQL Editor 中执行
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
    image_url TEXT,
    original_name TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    result JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 题目表
CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    options JSONB DEFAULT '[]'::jsonb,
    answer TEXT,
    analysis TEXT,
    question_type TEXT DEFAULT 'choice' CHECK (question_type IN ('choice', 'fill', 'answer')),
    subject TEXT,
    is_correct BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'wrong', 'mastered')),
    image_url TEXT,
    ai_tags JSONB DEFAULT '[]'::jsonb,
    manual_tags JSONB DEFAULT '[]'::jsonb,
    tags_source TEXT DEFAULT 'ai' CHECK (tags_source IN ('ai', 'manual')),
    block_coordinates JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. 错题表
CREATE TABLE IF NOT EXISTS wrong_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'mastered')),
    error_count INTEGER DEFAULT 1,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_wrong_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
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

-- 6. 生成试卷表
CREATE TABLE IF NOT EXISTS generated_exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    name TEXT DEFAULT '错题重练卷',
    question_ids JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 索引优化
-- ============================================

CREATE INDEX IF NOT EXISTS idx_tasks_student_id ON tasks(student_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_questions_task_id ON questions(task_id);
CREATE INDEX IF NOT EXISTS idx_questions_student_id ON questions(student_id);
CREATE INDEX IF NOT EXISTS idx_wrong_questions_student_id ON wrong_questions(student_id);
CREATE INDEX IF NOT EXISTS idx_wrong_questions_question_id ON wrong_questions(question_id);
CREATE INDEX IF NOT EXISTS idx_training_logs_student_id ON training_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_generated_exams_student_id ON generated_exams(student_id);

-- GIN 索引用于 JSONB 查询
CREATE INDEX IF NOT EXISTS idx_questions_ai_tags ON questions USING gin(ai_tags);
CREATE INDEX IF NOT EXISTS idx_questions_manual_tags ON questions USING gin(manual_tags);
CREATE INDEX IF NOT EXISTS idx_tasks_result ON tasks USING gin(result);

-- ============================================
-- 触发器：自动更新 updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_questions_updated_at BEFORE UPDATE ON questions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wrong_questions_updated_at BEFORE UPDATE ON wrong_questions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_training_logs_updated_at BEFORE UPDATE ON training_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. �ж���¼����Shadow Mode - ֻ׷�Ӳ����ǣ�
CREATE TABLE IF NOT EXISTS judgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL,
    student_id UUID NOT NULL,
    source VARCHAR(20) NOT NULL CHECK (source IN ('ai_ocr', 'ai_answer_gen', 'manual_review', 'pc_edit')),
    confidence DECIMAL(3,2),
    is_correct BOOLEAN,
    content TEXT,
    answer TEXT,
    student_answer TEXT,
    ai_answer TEXT,
    analysis TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_judgements_question_id ON judgements(question_id);
CREATE INDEX IF NOT EXISTS idx_judgements_student_id ON judgements(student_id);
CREATE INDEX IF NOT EXISTS idx_judgements_source ON judgements(source);
CREATE INDEX IF NOT EXISTS idx_judgements_created_at ON judgements(created_at DESC);
