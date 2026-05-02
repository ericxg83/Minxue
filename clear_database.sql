-- ============================================
-- 清空数据库所有数据脚本
-- 在 Supabase SQL Editor 中执行此脚本
-- 注意：此操作不可恢复！
-- ============================================

-- 按照外键依赖顺序清空数据（从子表到父表）
TRUNCATE TABLE training_logs CASCADE;
TRUNCATE TABLE wrong_questions CASCADE;
TRUNCATE TABLE questions CASCADE;
TRUNCATE TABLE tasks CASCADE;
TRUNCATE TABLE students CASCADE;

-- 验证清空结果
SELECT 'students' as table_name, COUNT(*) as count FROM students
UNION ALL
SELECT 'tasks', COUNT(*) FROM tasks
UNION ALL
SELECT 'questions', COUNT(*) FROM questions
UNION ALL
SELECT 'wrong_questions', COUNT(*) FROM wrong_questions
UNION ALL
SELECT 'training_logs', COUNT(*) FROM training_logs;
