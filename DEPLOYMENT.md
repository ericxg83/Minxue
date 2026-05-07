# 敏学错题本 - Render 部署完整指南

## 前置准备
你已完成第1步：在 Supabase 执行了数据库迁移脚本。现在继续以下步骤。

---

## 第2步：创建 Upstash Redis（免费额度）

1. 访问 https://upstash.com/
2. 注册/登录账号
3. 点击 **"Create Database"**
4. 选择 **"Redis"**
5. 填写配置：
   - Name: `minxue-redis` (或你喜欢的名字)
   - Region: 选择离你最近的（比如 Singapore 或 Tokyo）
   - Tier: 选择 **"Free"** (免费)
6. 点击 **"Create"**
7. 创建成功后，记录以下信息：
   - `Endpoint` (例如: `minxue-redis-abc123.upstash.io`) → 这是 `REDIS_HOST`
   - `Port` (通常是 `6379`) → 这是 `REDIS_PORT`
   - `Password` → 这是 `REDIS_PASSWORD`

---

## 第3步：获取 Supabase Service Role Key

1. 访问 https://supabase.com/dashboard
2. 进入你的项目
3. 左侧菜单选择 **"Project Settings" → "API"**
4. 找到 **"Project API keys"**
5. 复制 **"service_role secret"** (注意：不是 anon public) → 这是 `SUPABASE_SERVICE_ROLE_KEY`

---

## 第4步：在 Render 上部署

### 4.1 连接代码仓库
1. 访问 https://render.com
2. 注册/登录账号
3. 点击右上角 **"+ New" → "Blueprint"** (或 "Web Service")
4. 连接你的 GitHub/GitLab 账号
5. 选择这个 `Minxue_App_V3` 仓库

### 4.2 部署前准备 - 修改 render.yaml
在部署前，先修改一下 `render.yaml` 里的一个地方：

```yaml
# 在 routes 部分，把 destination 改成你实际的后端 URL
# 先暂时注释掉，等后端部署后再回来改
routes:
  # - type: rewrite
  #   source: /api/*
  #   destination: https://minxue-api.onrender.com/api/:splat
  - type: rewrite
    source: /*
    destination: /index.html
```

### 4.3 使用 Blueprint 部署
1. 在 Render 上，点击 **"+ New" → "Blueprint"**
2. 选择你的仓库，然后选择分支（通常是 main/master）
3. Render 会自动读取 `render.yaml` 并显示两个服务：
   - `minxue-api` (后端)
   - `minxue-app-v3` (前端)
4. 点击 **"Apply"**

### 4.4 填写后端环境变量
在部署过程中，Render 会提示填写环境变量（`sync: false` 的那些），按以下格式填写：

| 环境变量名 | 值 |
|-----------|-----|
| `SUPABASE_URL` | `https://wdwlxbtntuurjtlirwew.supabase.co` |
| `SUPABASE_KEY` | `sb_publishable_vYdDhMLLgSKqsoBIvYBZJA_JBy2JLDh` |
| `SUPABASE_SERVICE_ROLE_KEY` | (第3步获取的 service_role secret) |
| `AI_API_KEY` | `ms-dae707ae-bcc4-4d7e-aa83-e2165d0cdbf5` |
| `REDIS_HOST` | (第2步 Upstash 的 Endpoint，不带 https://，例如 `minxue-redis-abc123.upstash.io`) |
| `REDIS_PASSWORD` | (第2步 Upstash 的 Password) |

然后点击 **"Save Changes"** 开始部署。

---

## 第5步：等待部署完成

部署需要 5-10 分钟，你会看到：
- `minxue-api` 先启动
- 然后 `minxue-app-v3` 部署

---

## 第6步：更新前端配置

### 6.1 获取后端 URL
部署完成后，在 Render 控制台点击 `minxue-api`，复制它的 URL，例如：
`https://minxue-api-abc123.onrender.com`

### 6.2 更新 render.yaml
打开项目里的 `render.yaml`，修改前端的路由配置：

```yaml
routes:
  - type: rewrite
    source: /api/*
    destination: https://minxue-api-abc123.onrender.com/api/:splat  # 替换为你的实际后端 URL
  - type: rewrite
    source: /*
    destination: /index.html
```

### 6.3 提交并推送代码
```bash
git add render.yaml
git commit -m "更新后端路由"
git push
```

### 6.4 更新 .env.production
打开项目里的 `.env.production`，修改：

```
VITE_API_URL=https://minxue-api-abc123.onrender.com/api  # 替换为你的实际后端 URL
```

同样提交并推送。

---

## 第7步：重新部署前端

1. 在 Render 控制台，找到 `minxue-app-v3`
2. 点击 **"Manual Deploy" → "Latest commit"**
3. 等待重新部署完成

---

## 第8步：测试部署

访问你的前端 URL（在 Render 控制台可以看到），例如：
`https://minxue-app-v3-abc123.onrender.com`

测试流程：
1. 选择一个学生
2. 上传一张试卷图片
3. 上传后，你应该能看到任务状态为 "等待处理" 或 "处理中"
4. 可以切换页面或学生，任务会继续在后台处理
5. 处理完成后，状态会更新为 "已完成"

---

## 本地开发测试（可选）

如果你想先在本地测试后端：

1. 在 `server/` 目录下创建 `.env` 文件，填入环境变量
2. 打开两个终端：

**终端1（后端）：**
```bash
cd server
npm install
node index.js
```

**终端2（前端）：**
```bash
npm install
npm run dev
```

然后访问 http://localhost:3000 测试。

---

## 常见问题

### Q: Redis 连接失败？
A: 检查 Upstash 的 endpoint 是否正确，不要包含 `https://`，只保留域名部分，例如 `minxue-redis-abc123.upstash.io`

### Q: 前端调用 API 失败？
A: 检查 render.yaml 里的路由重写是否指向了正确的后端 URL

### Q: 部署很慢？
A: Render 免费计划会在无流量时休眠，首次访问需要 30-60 秒唤醒
