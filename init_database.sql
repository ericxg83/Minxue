-- ============================================
-- 敏学App V3 - Neon 数据库初始化脚本
-- 在 Neon 控制台或 psql 中执行
-- ============================================

-- 1. 创建 students 表
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  grade TEXT,
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 创建 tasks 表（上传的试卷任务）
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  image_url TEXT,
  original_name TEXT,
  status TEXT DEFAULT 'pending', -- pending, processing, done, failed
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_student_id ON tasks(student_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- 3. 创建 questions 表（识别出的题目）
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  question_type TEXT, -- 选择题, 填空题, 解答题
  subject TEXT, -- 数学, 语文, 英语, 物理, 化学
  options JSONB,
  answer TEXT,
  analysis TEXT,
  status TEXT DEFAULT 'pending', -- pending, wrong, correct
  is_suspicious BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_questions_student_id ON questions(student_id);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
CREATE INDEX IF NOT EXISTS idx_questions_task_id ON questions(task_id);

-- 4. 创建 wrong_questions 表（错题本）
CREATE TABLE IF NOT EXISTS wrong_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  subject TEXT,
  error_count INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending', -- pending, mastered
  added_at TIMESTAMPTZ DEFAULT NOW(),
  mastered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wrong_questions_student_id ON wrong_questions(student_id);
CREATE INDEX IF NOT EXISTS idx_wrong_questions_status ON wrong_questions(status);

-- 5. 创建 generated_exams 表（生成的试卷）
CREATE TABLE IF NOT EXISTS generated_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  question_ids JSONB, -- 题目 ID 数组
  status TEXT DEFAULT 'ungraded', -- ungraded, graded
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generated_exams_student_id ON generated_exams(student_id);
CREATE INDEX IF NOT EXISTS idx_generated_exams_status ON generated_exams(status);

-- 6. 插入测试学生数据
INSERT INTO students (id, name, grade) VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', '诸葛亮', '高三·1班'),
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', '周瑜', '高三·2班')
ON CONFLICT (id) DO NOTHING;

-- 验证表创建成功
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('students', 'tasks', 'questions', 'wrong_questions', 'generated_exams')
ORDER BY table_name;
