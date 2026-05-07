# 敏学错题本 - Cloudflare + Render 部署指南

## 架构方案
- **前端**: Cloudflare Pages（国内访问快）
- **后端**: Render（提供 API 和任务队列）
- **数据库**: Supabase
- **任务队列**: Upstash Redis + BullMQ

---

## 步骤概览
1. ✅ 已完成：执行数据库迁移
2. 创建 Upstash Redis
3. 获取 Supabase Service Role Key
4. 部署后端到 Render
5. 部署前端到 Cloudflare Pages
6. 配置 CORS 和环境变量

---

## 第1步：创建 Upstash Redis（免费额度）

1. 访问 https://upstash.com/
2. 注册/登录账号
3. 点击 **"Create Database"**
4. 选择 **"Redis"**
5. 填写配置：
   - Name: `minxue-redis`
   - Region: 选择 Singapore 或 Tokyo（离国内近）
   - Tier: **"Free"**
6. 点击 **"Create"**
7. 记录信息：
   - `Endpoint` (例如: `minxue-redis-abc123.upstash.io`) → `REDIS_HOST`
   - `Port` (通常是 `6379`) → `REDIS_PORT`
   - `Password` → `REDIS_PASSWORD`

---

## 第2步：获取 Supabase Service Role Key

1. 访问 https://supabase.com/dashboard
2. 进入项目
3. 左侧菜单选择 **"Project Settings" → "API"**
4. 复制 **"service_role secret"** → `SUPABASE_SERVICE_ROLE_KEY`

---

## 第3步：部署后端到 Render

### 3.1 修改 render.yaml（只保留后端）

```yaml
services:
  - type: web
    name: minxue-api
    runtime: node
    buildCommand: cd server && npm install
    startCommand: cd server && node index.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3001
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_KEY
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: AI_API_KEY
        sync: false
      - key: AI_ENDPOINT
        value: https://api-inference.modelscope.cn/v1/chat/completions
      - key: AI_MODEL
        value: Qwen/Qwen3-VL-8B-Instruct
      - key: REDIS_HOST
        sync: false
      - key: REDIS_PORT
        value: 6379
      - key: REDIS_PASSWORD
        sync: false
      - key: MAX_RETRIES
        value: 3
      - key: TASK_TIMEOUT_MS
        value: 1800000
      - key: CONCURRENCY
        value: 2
      # 允许 Cloudflare 跨域访问
      - key: ALLOWED_ORIGIN
        sync: false
```

### 3.2 在 Render 上部署

1. 访问 https://render.com
2. 点击 **"+ New" → "Web Service"**
3. 选择你的 GitHub 仓库
4. 配置：
   - Build Command: `cd server && npm install`
   - Start Command: `cd server && node index.js`
   - Runtime: Node
   - Region: 选择 Singapore（离国内近）
5. 添加环境变量：

| 环境变量名 | 值 |
|-----------|-----|
| `SUPABASE_URL` | `https://wdwlxbtntuurjtlirwew.supabase.co` |
| `SUPABASE_KEY` | `sb_publishable_vYdDhMLLgSKqsoBIvYBZJA_JBy2JLDh` |
| `SUPABASE_SERVICE_ROLE_KEY` | (第2步获取的) |
| `AI_API_KEY` | `ms-dae707ae-bcc4-4d7e-aa83-e2165d0cdbf5` |
| `REDIS_HOST` | Upstash Endpoint（不带 https://） |
| `REDIS_PASSWORD` | Upstash Password |
| `ALLOWED_ORIGIN` | 先填 `*`（后面改成 Cloudflare 域名） |

6. 点击 **"Create Web Service"**

### 3.3 测试后端

部署完成后，访问 `https://你的后端URL.onrender.com/api/health`，应该返回：
```json
{"status":"ok","timestamp":"..."}
```

---

## 第4步：部署前端到 Cloudflare Pages

### 4.1 准备工作

先修改 `.env.production` 文件：

```
VITE_SUPABASE_URL=https://wdwlxbtntuurjtlirwew.supabase.co
VITE_SUPABASE_KEY=sb_publishable_vYdDhMLLgSKqsoBIvYBZJA_JBy2JLDh
VITE_AI_API_KEY=ms-dae707ae-bcc4-4d7e-aa83-e2165d0cdbf5
VITE_AI_ENDPOINT=https://api-inference.modelscope.cn/v1/chat/completions
VITE_AI_MODEL=Qwen/Qwen3-VL-8B-Instruct
VITE_APP_ENV=production
VITE_API_URL=https://你的后端URL.onrender.com/api  # ← 替换为你的 Render 后端 URL
```

提交并推送代码。

### 4.2 在 Cloudflare 上部署

1. 访问 https://dash.cloudflare.com/
2. 注册/登录账号
3. 点击 **"Pages" → "Create a project"**
4. 连接 GitHub/GitLab 仓库，选择这个项目
5. 配置构建：
   - Framework preset: **React**
   - Build command: `npm run build`
   - Build output directory: `dist`
6. 添加环境变量（可选，因为我们已经在 .env.production 里配置了）：
   - `VITE_API_URL`: `https://你的后端URL.onrender.com/api`
7. 点击 **"Save and Deploy"**

### 4.3 配置 Cloudflare Pages

部署完成后：
1. 进入你的 Pages 项目
2. 点击 **"Settings" → "Functions" → "Routes"**
3. 添加路由规则（用于代理 API 请求）：

| Route | Type | Value |
|-------|------|-------|
| `/api/*` | HTTP Proxy | `https://你的后端URL.onrender.com/api/$1` |

或者，你也可以不配置路由，直接在前端代码里调用完整的后端 URL（我们已经在 .env.production 里配置了）。

---

## 第5步：配置后端 CORS

回到 Render，更新 `ALLOWED_ORIGIN` 环境变量：
```
ALLOWED_ORIGIN=https://你的cloudflare域名.pages.dev
```

然后重启后端服务。

---

## 第6步：测试部署

访问 Cloudflare Pages 域名，测试流程：
1. 选择一个学生
2. 上传一张试卷图片
3. 上传后，任务状态为 "等待处理"
4. 可以切换页面或学生，任务继续在后台处理
5. 处理完成后状态更新为 "已完成"

---

## 可选：配置自定义域名

### 后端（Render）
1. 在 Render 控制台，点击你的后端服务
2. 点击 **"Settings" → "Custom Domains"**
3. 添加域名（需要先在 DNS 服务商配置 CNAME 记录）

### 前端（Cloudflare Pages）
1. 在 Cloudflare Pages 项目里，点击 **"Custom Domains"**
2. 添加域名（Cloudflare 会自动配置 DNS）

---

## 常见问题

### Q: Cloudflare Pages 构建失败？
A: 检查 `npm run build` 是否能在本地正常运行

### Q: 前端调用 API 失败，跨域错误？
A: 检查 Render 的 `ALLOWED_ORIGIN` 环境变量是否正确设置

### Q: 后端启动失败？
A: 检查环境变量是否完整，特别是 Redis 连接信息

### Q: 任务处理很慢？
A: Render 免费计划会休眠，首次请求需要唤醒（30-60秒）
