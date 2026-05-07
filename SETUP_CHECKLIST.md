# 敏学App V3 配置步骤清单

## 架构确认

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Cloudflare     │ ──────▶ │   Render        │ ──────▶ │   Neon          │
│  Pages (前端)   │         │   (后端API)     │         │   PostgreSQL    │
└─────────────────┘         └─────────────────┘         └─────────────────┘
         │
         ▼
┌─────────────────┐
│  阿里 OSS CDN   │
│  (图片/PDF加速) │
└─────────────────┘
```

---

## 步骤 1: Neon 数据库（5分钟）

### 1.1 注册 Neon
- [ ] 访问 https://neon.tech
- [ ] 用 GitHub 账号登录
- [ ] 创建新项目，选择 **Asia Pacific (Singapore)**

### 1.2 获取连接字符串
- [ ] 进入项目 → Connection Details
- [ ] 复制 `postgresql://...` 连接串
- [ ] 格式类似：`postgresql://user:pass@host.neon.tech/db?sslmode=require`

### 1.3 创建数据表
- [ ] 进入 SQL Editor
- [ ] 粘贴并执行 `database/neon_schema.sql`（见下方）

---

## 步骤 2: 阿里 OSS（10分钟）

### 2.1 开通 OSS
- [ ] 访问 https://www.aliyun.com
- [ ] 注册/登录，完成实名认证
- [ ] 进入 OSS 控制台，点击"创建 Bucket"

### 2.2 创建 Bucket
```
Bucket 名称: minxue-app（全局唯一，已被占用则加后缀）
区域: 华东1（杭州）或根据你的位置选择
存储类型: 标准存储
读写权限: 公共读
```

### 2.3 配置跨域 (CORS)
- [ ] 进入 Bucket → 权限控制 → 跨域设置
- [ ] 添加规则：
```
来源: https://minxue-app.pages.dev
允许 Methods: GET, POST, PUT, DELETE, HEAD
允许 Headers: *
暴露 Headers: ETag
缓存时间: 600
```

### 2.4 配置 CDN 加速
- [ ] 进入 CDN 控制台 → 域名管理
- [ ] 添加加速域名：`cdn.yourdomain.com`（或直接用 OSS 域名）
- [ ] 源站类型：OSS 域名，选择你的 Bucket
- [ ] 等待 CNAME 生效（通常几分钟）

### 2.5 获取访问密钥
- [ ] 进入 RAM 控制台 → 用户 → 创建用户
- [ ] 登录名称：`minxue-oss`
- [ ] 访问方式：勾选"OpenAPI 调用访问"
- [ ] 保存 AccessKey ID 和 AccessKey Secret
- [ ] 给用户添加权限：`AliyunOSSFullAccess`

---

## 步骤 3: Render 后端部署（5分钟）

### 3.1 准备代码
确保 `server/package.json` 包含以下依赖：
```json
{
  "dependencies": {
    "pg": "^8.11.0",
    "ali-oss": "^6.20.0",
    "express": "^4.21.1",
    "cors": "^2.8.5",
    "multer": "^1.4.5-lts.1",
    "dotenv": "^16.4.7",
    "bullmq": "^5.34.8"
  }
}
```

### 3.2 部署到 Render
- [ ] 访问 https://render.com
- [ ] New → Web Service
- [ ] 连接你的 GitHub 仓库
- [ ] 配置：
```
Name: minxue-api
Region: Singapore (最接近 Neon)
Branch: main
Build Command: npm install
Start Command: npm start
```

### 3.3 添加环境变量
在 Render Dashboard → Environment 中添加：

```bash
# Neon 数据库
NEON_DATABASE_URL=postgresql://你的连接字符串

# 阿里 OSS
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=minxue-app
OSS_ACCESS_KEY_ID=你的AccessKeyID
OSS_ACCESS_KEY_SECRET=你的AccessKeySecret
OSS_CDN_DOMAIN=https://cdn.yourdomain.com

# AI 服务
AI_API_KEY=你的AI密钥
AI_ENDPOINT=https://api-inference.modelscope.cn/v1/chat/completions
AI_MODEL=Qwen/Qwen3-VL-8B-Instruct

# Redis (Upstash)
REDIS_HOST=你的redis主机
REDIS_PORT=6379
REDIS_PASSWORD=你的redis密码

# 服务器
PORT=3001
NODE_ENV=production

# 任务队列
MAX_RETRIES=3
TASK_TIMEOUT_MS=1800000
CONCURRENCY=2
```

---

## 步骤 4: Cloudflare Pages 前端部署（5分钟）

### 4.1 准备代码
- [ ] 确保已提交所有代码到 GitHub
- [ ] 确认 `_routes.json` 和 `wrangler.toml` 已提交

### 4.2 部署到 Cloudflare Pages
- [ ] 访问 https://dash.cloudflare.com
- [ ] Pages → Create a project
- [ ] 连接 GitHub 仓库
- [ ] 构建设置：
```
Framework preset: None
Build command: npm run build
Build output directory: dist
```

### 4.3 添加环境变量
在 Pages → Settings → Environment variables 中添加：

```bash
VITE_API_URL=https://minxue-api.onrender.com/api
VITE_OSS_CDN_DOMAIN=https://cdn.yourdomain.com
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_KEY=你的anon-key
VITE_AI_API_KEY=你的AI密钥
VITE_AI_ENDPOINT=https://api-inference.modelscope.cn/v1/chat/completions
VITE_AI_MODEL=Qwen/Qwen3-VL-8B-Instruct
VITE_APP_ENV=production
```

### 4.4 重新部署
- [ ] 保存环境变量后触发重新部署
- [ ] 等待构建完成

---

## 步骤 5: 数据迁移（10分钟）

### 5.1 导出 Supabase 数据
```bash
# 安装 supabase-cli（如果还没有）
npm install -g supabase

# 登录
supabase login

# 导出数据
supabase db dump --db-url "postgresql://postgres:密码@db.项目ID.supabase.co:5432/postgres" > backup.sql
```

### 5.2 导入到 Neon
```bash
# 使用 psql（PostgreSQL 客户端）
psql "你的Neon连接字符串" < backup.sql
```

### 5.3 验证数据
```sql
-- 检查各表数据量
SELECT 'students' as table_name, COUNT(*) as count FROM students
UNION ALL
SELECT 'tasks', COUNT(*) FROM tasks
UNION ALL
SELECT 'questions', COUNT(*) FROM questions
UNION ALL
SELECT 'wrong_questions', COUNT(*) FROM wrong_questions
UNION ALL
SELECT 'generated_exams', COUNT(*) FROM generated_exams;
```

---

## 步骤 6: 联调测试

### 6.1 测试后端 API
```bash
curl https://minxue-api.onrender.com/api/health
# 应返回: {"status":"ok"}
```

### 6.2 测试前端页面
- [ ] 打开 https://minxue-app.pages.dev
- [ ] 检查学生列表是否正常加载
- [ ] 切换页面测试秒开效果
- [ ] 上传图片测试 OSS 是否正常

### 6.3 检查缓存
- [ ] 打开浏览器 DevTools → Application → Local Storage
- [ ] 确认有 `minxue_v3.1_*` 开头的缓存键

---

## 故障排查速查表

| 问题 | 排查方向 |
|------|---------|
| 页面空白 | 检查 Cloudflare Pages 构建日志 |
| API 请求失败 | 检查 Render 服务是否运行，CORS 配置 |
| 数据库连接失败 | 检查 Neon 连接字符串，IP 白名单 |
| 图片上传失败 | 检查 OSS 权限，Bucket 跨域配置 |
| 缓存不生效 | 检查 localStorage 空间是否已满 |

---

## 成本预估（每月）

| 服务 | 免费额度 | 预估用量 | 费用 |
|------|---------|---------|------|
| Neon | 500MB + 190h | 200MB + 100h | ¥0 |
| 阿里OSS | 5GB + 50GB流量 | 2GB + 20GB | ¥0（首年） |
| Cloudflare Pages | 100GB 带宽 | 10GB | ¥0 |
| Render | 750h | 720h | ¥0 |
| **总计** | | | **¥0** |
