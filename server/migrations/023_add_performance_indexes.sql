-- ═══════════════════════════════════════════════
-- Migration 023: Performance indexes
-- 优化高频查询路径，减少索引扫描/排序开销
-- ═══════════════════════════════════════════════

-- 1. judgements 复合索引：支持 getLatestJudgement 的 WHERE question_id + student_id ORDER BY created_at DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_judgements_question_student_created
  ON judgements (question_id, student_id, created_at DESC);

-- 2. question_cache 复合索引：支持 findSimilarQuestion 的 WHERE subject ORDER BY use_count DESC
CREATE INDEX IF NOT EXISTS idx_question_cache_subject_use_count
  ON question_cache (subject, use_count DESC);

-- 3. questions 复合索引：支持 getQuestionsByTask 的 WHERE task_id ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_questions_task_id_created
  ON questions (task_id, created_at);

-- 4. wrong_questions 复合索引：支持按学生+添加时间排序的错题列表查询
CREATE INDEX IF NOT EXISTS idx_wrong_questions_student_added
  ON wrong_questions (student_id, added_at DESC);