-- 题目缓存表 - 用于题目去重和复用AI解析结果
CREATE TABLE IF NOT EXISTS question_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_fingerprint VARCHAR(64) NOT NULL,
  content_type VARCHAR(32) NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  options JSONB DEFAULT '[]'::jsonb,
  answer TEXT,
  analysis TEXT,
  question_type VARCHAR(32) DEFAULT 'choice',
  subject VARCHAR(32),
  ai_tags JSONB DEFAULT '[]'::jsonb,
  phash VARCHAR(64),
  embedding TEXT,
  parser_version VARCHAR(16) DEFAULT 'v1',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  use_count INT DEFAULT 0
);

-- 唯一索引：题目指纹 + 解析版本 确保同一题目同一版本只有一条记录
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_cache_fingerprint_version 
  ON question_cache (question_fingerprint, parser_version);

-- 感知哈希索引 - 用于相似图片题目查找
CREATE INDEX IF NOT EXISTS idx_question_cache_phash 
  ON question_cache (phash) 
  WHERE phash IS NOT NULL;

-- 内容类型 + 学科组合索引 - 用于分类查询
CREATE INDEX IF NOT EXISTS idx_question_cache_content_type_subject 
  ON question_cache (content_type, subject);

-- 使用次数索引 - 用于热门题目查询
CREATE INDEX IF NOT EXISTS idx_question_cache_use_count 
  ON question_cache (use_count DESC);
