-- 敏学错题本数据库表结构

-- 学生表
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    class VARCHAR(100),
    avatar VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 任务表（拍照上传的作业）
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    image_url VARCHAR(500) NOT NULL,
    original_name VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    result JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 题目表（AI识别的题目）
CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    options JSONB DEFAULT '[]',
    answer VARCHAR(500),
    student_answer VARCHAR(500),
    is_correct BOOLEAN DEFAULT FALSE,
    confidence DECIMAL(3,2) DEFAULT 0.00,
    analysis TEXT,
    question_type VARCHAR(20) DEFAULT 'answer' CHECK (question_type IN ('choice', 'fill', 'answer')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'wrong', 'mastered')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 错题本表
CREATE TABLE wrong_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'mastered')),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(student_id, question_id)
);

-- 练习记录表
CREATE TABLE training_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
    result JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_tasks_student_id ON tasks(student_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_questions_task_id ON questions(task_id);
CREATE INDEX idx_questions_student_id ON questions(student_id);
CREATE INDEX idx_questions_status ON questions(status);
CREATE INDEX idx_wrong_questions_student_id ON wrong_questions(student_id);
CREATE INDEX idx_wrong_questions_status ON wrong_questions(status);
CREATE INDEX idx_training_logs_student_id ON training_logs(student_id);

-- 创建更新时间触发器
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

-- 生成试卷表（从错题本组卷生成的试卷）
CREATE TABLE generated_exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL DEFAULT '错题重练卷',
    question_ids JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_generated_exams_student_id ON generated_exams(student_id);

CREATE TRIGGER update_generated_exams_updated_at BEFORE UPDATE ON generated_exams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE generated_exams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON generated_exams FOR ALL USING (true) WITH CHECK (true);

-- 启用 RLS (Row Level Security)
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wrong_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_logs ENABLE ROW LEVEL SECURITY;

-- 创建允许所有操作的策略（开发阶段）
CREATE POLICY "Allow all" ON students FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON questions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON wrong_questions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON training_logs FOR ALL USING (true) WITH CHECK (true);
