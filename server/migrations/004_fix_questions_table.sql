-- =============================================
-- 修复 questions 表缺失的字段
-- =============================================

-- 添加 answer_exception 字段（布尔值，标记是否解析异常）
ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS answer_exception BOOLEAN DEFAULT FALSE;

-- 添加 answer_exception_reason 字段（异常原因说明）
ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS answer_exception_reason TEXT;

-- 添加索引以便快速查询异常题目
CREATE INDEX IF NOT EXISTS idx_questions_answer_exception 
  ON questions (answer_exception) 
  WHERE answer_exception = TRUE;

-- 验证字段是否添加成功
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'questions' 
  AND column_name IN ('answer_exception', 'answer_exception_reason')
ORDER BY column_name;
