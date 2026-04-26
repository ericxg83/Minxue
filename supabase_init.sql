-- ============================================
-- Supabase 初始数据插入脚本
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================

-- 插入示例学生数据（使用 UUID 格式）
INSERT INTO students (id, name, grade, class, remark, avatar, created_at, updated_at)
VALUES 
  ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '张三', '五年级', '1班', '', '', NOW(), NOW()),
  ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', '李四', '六年级', '2班', '', '', NOW(), NOW()),
  ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', '王五', '四年级', '1班', '', '', NOW(), NOW()),
  ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', '赵六', '五年级', '2班', '', '', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 验证插入结果
SELECT * FROM students;
