# 敏学App 部署指南

## 部署架构

- **数据库 & 文件存储**: Supabase (Smart Mistake Book 项目)
- **前端部署**: Render (Static Site)

---

## 部署前准备

### 1. 确认生产环境配置

检查 `.env.production` 文件是否配置正确：

```env
# Supabase 配置 - 生产环境
VITE_SUPABASE_URL=https://wdwlxbtntuurjtlirwew.supabase.co
VITE_SUPABASE_KEY=sb_publishable_vYdDhMLLgSKqsoBIvYBZJA_JBy2JLDh

# AI 服务配置
VITE_AI_API_KEY=您的魔搭社区API_Key  # ⚠️ 需要填写
VITE_AI_ENDPOINT=https://api-inference.modelscope.cn/v1/chat/completions
VITE_AI_MODEL=Qwen/Qwen3-VL-8B-Instruct

VITE_APP_ENV=production
```

**注意**: `VITE_AI_API_KEY` 需要填入您自己的魔搭社区 API Key。

---

## Render 部署步骤

### 方式一：通过 Blueprint 部署（推荐）

1. 登录 [Render](https://render.com)
2. 点击 **New +** → **Blueprint**
3. 连接您的 GitHub/GitLab 仓库
4. Render 会自动识别 `render.yaml` 配置
5. 点击 **Apply**

### 方式二：手动创建 Static Site

1. 登录 [Render](https://render.com)
2. 点击 **New +** → **Static Site**
3. 连接您的代码仓库
4. 填写配置：
   - **Name**: `minxue-app-v3`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
5. 点击 **Create Static Site**

---

## 配置环境变量

在 Render 控制台中设置以下环境变量：

| 变量名 | 值 | 说明 |
|-------|-----|------|
| `VITE_SUPABASE_URL` | `https://wdwlxbtntuurjtlirwew.supabase.co` | Supabase 项目 URL |
| `VITE_SUPABASE_KEY` | `sb_publishable_vYdDhMLLgSKqsoBIvYBZJA_JBy2JLDh` | Supabase API Key |
| `VITE_AI_API_KEY` | 您的魔搭社区 Key | AI 识别服务 |
| `VITE_AI_ENDPOINT` | `https://api-inference.modelscope.cn/v1/chat/completions` | AI API 端点 |
| `VITE_AI_MODEL` | `Qwen/Qwen3-VL-8B-Instruct` | AI 模型 |
| `VITE_APP_ENV` | `production` | 环境标识 |

**设置路径**: Dashboard → 您的服务 → Environment → Add Environment Variable

---

## 部署后验证

1. 访问 Render 分配的域名（如 `https://minxue-app-v3.onrender.com`）
2. 测试以下功能：
   - ✅ 添加学生
   - ✅ 上传作业图片
   - ✅ 查看错题本
   - ✅ 数据是否正确保存到 Supabase

---

## 自定义域名（可选）

1. 在 Render 控制台点击 **Settings** → **Custom Domains**
2. 添加您的域名（如 `minxue.yourdomain.com`）
3. 按提示配置 DNS 记录
4. 等待 SSL 证书自动签发

---

## 常见问题

### 1. 构建失败
检查 `render.yaml` 配置是否正确，或尝试手动部署。

### 2. 环境变量不生效
- 确认变量名以 `VITE_` 开头
- 修改环境变量后需要重新部署

### 3. 页面刷新 404
已在 `render.yaml` 中配置路由重写规则，确保前端路由正常工作。

### 4. Supabase 连接失败
- 检查 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_KEY` 是否正确
- 确认 Supabase 项目已启用 Row Level Security (RLS) 规则

---

## 更新部署

代码推送后，Render 会自动重新构建和部署。

如需手动触发：Dashboard → 您的服务 → Manual Deploy → Deploy Latest Commit
