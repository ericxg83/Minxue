# 敏学App V3 轻量化秒开部署指南

## 架构概览

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   前端      │──────▶│   后端API   │──────▶│  Neon DB    │
│ (Vercel)    │      │ (Render)    │      │ (PostgreSQL)│
└─────────────┘      └─────────────┘      └─────────────┘
       │
       ▼
┌─────────────┐
│ 阿里OSS CDN │
│ (图片/PDF)  │
└─────────────┘
```

## 免费资源额度

| 服务 | 免费额度 | 说明 |
|------|---------|------|
| Neon | 500MB 存储, 190h 计算/月 | 足够支持 1000+ 学生 |
| 阿里OSS | 5GB 存储, 50GB 流量/月 | 新用户首年免费 |
| Vercel | 100GB 带宽/月 | 前端托管 |
| Render | 750h 运行/月 | 后端服务 |

---

## 1. Neon 数据库配置

### 1.1 注册与创建
1. 访问 https://neon.tech
2. 使用 GitHub 账号注册
3. 创建新项目，选择最接近用户的区域（推荐 `Asia Pacific (Singapore)`）
4. 复制连接字符串：`postgresql://...`

### 1.2 创建数据表
在 Neon SQL Editor 中执行：

```sql
-- 学生表
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

-- 任务表
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

-- 题目表
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 错题表
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

-- 练习记录表
CREATE TABLE IF NOT EXISTS training_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
    result JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 生成试卷表
CREATE TABLE IF NOT EXISTS generated_exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    name TEXT DEFAULT '错题重练卷',
    question_ids JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_tasks_student_id ON tasks(student_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_questions_task_id ON questions(task_id);
CREATE INDEX IF NOT EXISTS idx_questions_student_id ON questions(student_id);
CREATE INDEX IF NOT EXISTS idx_wrong_questions_student_id ON wrong_questions(student_id);
CREATE INDEX IF NOT EXISTS idx_wrong_questions_question_id ON wrong_questions(question_id);
CREATE INDEX IF NOT EXISTS idx_generated_exams_student_id ON generated_exams(student_id);
```

---

## 2. 阿里 OSS 配置

### 2.1 开通服务
1. 访问 https://www.aliyun.com
2. 注册账号，完成实名认证
3. 开通 OSS 服务（新用户免费试用 3 个月）

### 2.2 创建 Bucket
1. 进入 OSS 控制台
2. 创建 Bucket：
   - 名称：`minxue-app`（全局唯一）
   - 区域：华东1（杭州）或根据用户位置选择
   - 存储类型：标准存储
   - 读写权限：公共读
3. 配置跨域规则：
   - 来源：`http://localhost:3000`, `https://your-domain.vercel.app`
   - 允许 Methods：`GET`, `POST`, `PUT`
   - 允许 Headers：`*`

### 2.3 配置 CDN 加速
1. 进入 CDN 控制台
2. 添加加速域名：
   - 加速域名：`cdn.yourdomain.com`
   - 源站类型：OSS 域名
   - 选择刚才创建的 Bucket
3. 配置 HTTPS 证书（免费）
4. CNAME 解析到分配的 CDN 域名

### 2.4 获取访问密钥
1. 进入 RAM 控制台
2. 创建用户（仅编程访问）
3. 添加权限：`AliyunOSSFullAccess`
4. 保存 AccessKey ID 和 AccessKey Secret

---

## 3. 后端部署 (Render)

### 3.1 准备代码
1. 确保 `package.json` 包含 `pg` 和 `ali-oss` 依赖
2. 添加启动脚本：
```json
{
  "scripts": {
    "start": "node server/index.js"
  }
}
```

### 3.2 部署到 Render
1. 访问 https://render.com
2. 新建 Web Service
3. 连接 GitHub 仓库
4. 配置：
   - Build Command：`npm install`
   - Start Command：`npm start`
5. 添加环境变量（参考 `.env.example`）
6. 部署

---

## 4. 前端部署 (Vercel)

### 4.1 准备代码
1. 确保 `vite.config.js` 配置正确
2. 添加 `vercel.json`：
```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://your-render-app.onrender.com/api/$1" }
  ]
}
```

### 4.2 部署到 Vercel
1. 访问 https://vercel.com
2. 导入 GitHub 仓库
3. 配置框架预设：Vite
4. 添加环境变量：
   - `VITE_API_URL=/api`
   - `VITE_OSS_CDN_DOMAIN=https://cdn.yourdomain.com`
5. 部署

---

## 5. 数据迁移（从 Supabase 到 Neon）

### 5.1 导出 Supabase 数据
```bash
# 使用 pg_dump 导出数据
pg_dump "postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres" > backup.sql
```

### 5.2 导入到 Neon
```bash
# 使用 psql 导入
psql "postgresql://[user]:[password]@[host].neon.tech/[database]?sslmode=require" < backup.sql
```

### 5.3 验证迁移
```sql
-- 检查各表数据量
SELECT 'students' as table_name, COUNT(*) as count FROM students
UNION ALL
SELECT 'tasks', COUNT(*) FROM tasks
UNION ALL
SELECT 'questions', COUNT(*) FROM questions
UNION ALL
SELECT 'wrong_questions', COUNT(*) FROM wrong_questions;
```

---

## 6. 性能验证

### 6.1 缓存命中测试
打开浏览器 DevTools → Application → Local Storage，确认缓存已写入：
- `minxue_v3.1_students_cache`
- `minxue_v3.1_tasks_cache_[studentId]`
- `minxue_v3.1_wrong_questions_cache_[studentId]`

### 6.2 页面切换测试
1. 首次加载：观察骨架屏 → 数据渲染
2. 切换页面：应 < 0.3s 显示内容
3. 返回已访问页面：应瞬间显示（缓存命中）

### 6.3 网络面板检查
- 首次请求：200 OK
- 缓存命中：从 memory cache / disk cache
- 后台刷新：200 OK (size: 0 B from cache)

---

## 7. 监控与维护

### 7.1 Neon 监控
- 控制台查看连接数、查询性能
- 设置告警：连接数 > 8 时通知

### 7.2 OSS 监控
- 查看流量使用情况
- 设置告警：日流量 > 1GB 时通知

### 7.3 缓存清理
用户可在设置页面添加"清除缓存"按钮：
```javascript
import { clearAllCache } from './services/supabaseService'
// 调用 clearAllCache() 清除所有本地缓存
```

---

## 8. 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 页面加载慢 | 缓存未命中 | 检查 localStorage 空间是否已满 |
| 图片加载慢 | 未走 CDN | 检查 OSS_CDN_DOMAIN 配置 |
| 数据库连接失败 | Neon 连接数超限 | 减少连接池大小，或升级套餐 |
| 上传失败 | OSS 权限问题 | 检查 RAM 用户权限和 Bucket 策略 |
| 数据不一致 | 缓存过期 | 手动清除缓存，或缩短缓存时间 |
