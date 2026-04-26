-- 修改 tasks 表，让 title 可以为空
ALTER TABLE tasks ALTER COLUMN title DROP NOT NULL;

-- 或者添加一个默认值
-- ALTER TABLE tasks ALTER COLUMN title SET DEFAULT '未命名任务';

-- 验证修改
SELECT column_name, is_nullable, data_type 
FROM information_schema.columns 
WHERE table_name = 'tasks';
