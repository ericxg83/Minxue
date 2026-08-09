# 敏学成长工作台（Minxue App V3）

面向 K12 教师的作业批改与错题管理工具。核心价值：帮助教师从繁琐的作业批改、错题整理、组卷出题中解放出来，学生能收到及时、个性化的学习反馈。

## 功能特性

- 📸 **拍照/相册上传**：FAB 单击直达暂存区，长按展开类型选择（日常作业/普通试卷/错题重练）
- 🤖 **AI 识别批改**：多视觉模型（ModelScope Kimi + 备用厂商）自动识别题目并判题
- ✅ **批改结果**：正确/错误/空题统计，可进入复审面板逐题确认
- 📚 **错题本**：筛选（科目/时间/错次/标签）、掌握状态管理、批量组卷
- 🖨️ **组卷打印**：生成 PDF（LaTeX 数学公式渲染）+ 二维码，学生扫码错题重练
- 📊 **学习报告**：周报告 / 成长曲线（ECharts）生成
- 🧩 **PC 工作台**：Vue 3 + Element Plus，试卷入库校对、练习册管理、深度批改

## 技术栈

| 层 | 技术 |
|---|---|
| **移动端前端** | React 18 + Vite + Tailwind CSS + Zustand + Motion + Ant Design Mobile |
| **PC 工作台** | Vue 3 + Pinia + Element Plus + ECharts（懒加载路由） |
| **后端** | Express.js + Multer + BullMQ (Redis) |
| **数据库** | Neon PostgreSQL |
| **文件存储** | 阿里 OSS（CDN 加速） |
| **AI 服务** | ModelScope（Kimi）+ 备用厂商自动切换 |
| **移动端打包** | Capacitor（Android APK，ML Kit 原生扫码） |
| **部署** | 前端 Cloudflare Pages · 后端 Render · PWA 支持 |

## 快速开始

### 本地开发

```bash
npm install
npm run dev        # 前端 Vite dev server (port 3000)
```

后端需在 `server/` 目录启动：

```bash
node server/index.js   # 后端 API server（默认 port 4000，自动跑 migrations）
```

开发环境代理：`vite.config.js` 将 `/api` 代理到 `http://localhost:4000`。

### 环境变量

见 `.env`（开发）与 `.env.production`。核心变量：

```env
# 数据库（Neon PostgreSQL）
DATABASE_URL=postgresql://...

# 服务器
PORT=4000
ALLOWED_ORIGIN=https://your-domain.com

# 阿里 OSS
OSS_REGION=oss-cn-shanghai
OSS_BUCKET_NAME=minxue-app
OSS_ACCESS_KEY_ID=...
OSS_ACCESS_KEY_SECRET=...

# AI 服务（ModelScope Kimi）
AI_API_KEY=...
AI_ENDPOINT=https://api-inference.modelscope.cn/v1/chat/completions
AI_VISION_MODEL=...
AI_TEXT_MODEL=...
MODELSCOPE_BACKUP_API_KEY=...

# Redis（BullMQ 队列）
REDIS_URL=...
```

### Android 打包（Capacitor）

```bash
npm run android:build   # 构建 + sync
npm run android:run     # 打开 Android Studio 运行
```

## 项目结构

```
server/
  config/          # neon.js / oss.js / ai.js
  routes/          # Express 路由（tasks / worksheets / exams / students...）
  services/        # 业务逻辑（判题、练习册匹配、夜间补解析等）
  worker.js        # BullMQ 任务处理（AI 识别批改）
  index.js         # API 入口

src/
  pages/           # 移动端页面（Processing / WrongBook / Exam / ExamReview...）
  components/      # 公共组件（StagingModal / AppHeader / ImagePreview...）
  hooks/           # 业务 hooks（useUploadFlow / usePolling / useExamReview...）
  features/        # 自包含功能模块（PaperBank / upload）
  services/        # API 层（apiService 带请求去重与超时 abort）
  workbench/       # PC 端 Vue 工作台（独立入口 workbench.html）
  store/           # Zustand stores
  utils/           # 判题、图片、PDF 生成等工具
```

## 部署

- **后端**：Render（见 `render.yaml`），Node 22，自动跑 migrations
- **前端**：Cloudflare Pages（见 `wrangler.toml`），SPA fallback + 静态资源长缓存
- 详细流程见 `DEPLOYMENT.md` / `DEPLOYMENT_CLOUDFLARE_RENDER.md`

## 数据库

- 表结构：`database_schema.sql`
- 初始化：`init_database.sql`（后端启动时自动跑 `migrations/`）

## 核心交互流程

1. **上传批改**：FAB 拍照/相册 → 暂存区确认 → 上传（多图合一任务）→ AI 识别 → 结果统计
2. **复审**：首页已完成任务卡片 → 复审面板逐题核对/修改答案
3. **错题组卷**：错题本筛选 → 多选 → 生成 PDF（含二维码）→ 学生扫码重练
4. **扫码重练**：学生扫二维码 → `/retry-task/:id` 上传答卷 → 自动批改入错题本
