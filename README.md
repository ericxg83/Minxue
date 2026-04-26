# 敏学错题本 - 晚托班老师错题管理系统

## 项目简介

手机端网页应用（PWA），帮助晚托班老师高效批改作业、管理学生错题。

## 功能特性

- 📸 **拍照上传**：支持相机拍照和相册选择
- 🤖 **AI识别**：使用 Kimi-2.5 自动识别题目内容
- ✅ **待确认**：批量查看识别结果，一键加入错题本
- 📚 **错题本**：管理所有错题，支持编辑和打印
- 🖨️ **打印功能**：生成精美错题练习卷
- 📱 **扫码重练**：学生扫码进行错题重练
- 👨‍🎓 **学生管理**：添加、编辑、切换学生

## 技术栈

- **前端**：React 18 + Vite + Ant Design Mobile
- **状态管理**：Zustand
- **数据库**：Supabase (PostgreSQL)
- **AI接口**：魔搭社区 Kimi-2.5
- **部署**：Render

## 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 数据库配置

1. 在 Supabase 创建项目
2. 执行 `database/schema.sql` 创建表结构
3. 在 Supabase Storage 创建 `homework-images` bucket

### 环境变量

```env
VITE_SUPABASE_URL=https://bedphahmxdpnzwvsnjay.supabase.co
VITE_SUPABASE_KEY=sb_publishable_Az5Yk8dG6elDjm4QWkc1cw_sMLOne4t
VITE_AI_API_KEY=ms-dae707ae-bcc4-4d7e-aa83-e2165d0cdbf5
```

### 部署到 Render

1. 推送代码到 GitHub
2. 在 Render 创建 Web Service
3. 连接 GitHub 仓库
4. 配置环境变量
5. 部署完成

## 项目结构

```
src/
├── components/      # 公共组件
│   └── Layout/      # 页面布局
├── pages/           # 页面组件
│   ├── Home/        # 拍照上传页
│   ├── Pending/     # 待确认页
│   ├── WrongBook/   # 错题本页
│   └── Students/    # 学生管理页
├── services/        # 服务层
│   ├── supabaseService.js  # Supabase 操作
│   └── aiService.js        # AI 识别服务
├── store/           # 状态管理
│   └── index.js     # Zustand stores
├── config/          # 配置文件
│   ├── supabase.js  # Supabase 配置
│   └── ai.js        # AI 接口配置
└── App.jsx          # 应用入口
```

## 数据库表结构

| 表名 | 说明 |
|------|------|
| students | 学生信息 |
| tasks | 拍照上传任务 |
| questions | AI识别的题目 |
| wrong_questions | 错题本 |
| training_logs | 练习记录 |

## API 文档

### AI 接口

- **Endpoint**: `https://api-inference.modelscope.cn/v1/chat/completions`
- **Method**: POST
- **Headers**: `Authorization: Bearer <API_KEY>`
- **Model**: kimi-2.5

## 许可证

MIT
