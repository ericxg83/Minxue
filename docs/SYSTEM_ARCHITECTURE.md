# 敏学App V3 — 系统架构总览

> 生成日期: 2026-06-14
> 范围: 全项目代码扫描（前端+后端+工作台）
> ⚠️ 本文档仅作认知记录，不修改任何代码

---

## 一、项目概览

敏学App V3 是一套面向晚托班老师的**错题管理系统**，核心链路：**上传试卷 → OCR识别 → AI批改 → 错题整理 → 重练卷生成**。

### 技术栈

| 层 | 技术选型 |
|---|---|
| 主前端（移动端） | React 18 + Zustand + motion + Vite 5 |
| PC工作台 | Vue 3 + Pinia + Element Plus + Vue Router |
| 后端 | Express 4 (ESM) + BullMQ + ioredis |
| 数据库 | PostgreSQL (Neon Serverless) |
| 缓存队列 | Redis (BullMQ) |
| AI | ModelScope API (Qwen3-VL-8B-Instruct) |
| 文件存储 | 阿里云 OSS + CDN |
| 移动端 | Capacitor (Android) |
| 部署 | Cloudflare Pages + Render |

---

## 二、项目目录结构

```
minxue-app-v3/
├── src/                          # React 主前端 (移动端 SPA)
│   ├── App.jsx                   # 主入口 ~3200行 (路由/状态/布局)
│   ├── main.jsx                  # React 挂载点
│   ├── index.css                 # Tailwind + 全局样式
│   ├── pages/                    # 9 个页面组件 (懒加载)
│   │   ├── Exam/                 #   组卷记录列表
│   │   ├── ExamReview/           #   试卷审核 (AI批改结果复审)
│   │   ├── Grading/              #   QR批改 (手动批改)
│   │   ├── Home/                 #   首页 (学生卡片+拍照入口)
│   │   ├── PaperBank/            #   试卷库 (多页OCR/校对/导出)
│   │   ├── PrintPreview/         #   打印预览 (PDF生成+QR编码)
│   │   ├── QuestionEdit/         #   题目编辑器 (题干/答案/标签)
│   │   ├── ScanQR/               #   QR扫码 (jsQR)
│   │   └── Students/             #   学生管理 (CRUD)
│   ├── components/               # 共享组件
│   │   ├── Layout/               #   TabBar布局 (未使用)
│   │   ├── StudentSwitcher/      #   学生选择器
│   │   ├── ToastProvider/        #   Toast上下文
│   │   ├── MathText/             #   KaTeX 数学公式渲染
│   │   ├── RectCropper/          #   图片裁剪 (基础版)
│   │   ├── EnhancedRectCropper/  #   图片裁剪 (增强版+拉直)
│   │   ├── ImageCropper/         #   头像裁剪
│   │   └── Skeleton/             #   骨架屏 (5种)
│   ├── store/index.js            # Zustand 5个store
│   ├── services/                 # API服务层
│   │   ├── apiService.js         #   REST API封装 + localStorage缓存
│   │   ├── taskService.js        #   任务上传/轮询 (重复apiRequest)
│   │   ├── aiService.js          #   前端AI/OCR工具 (含judgeAnswer)
│   │   ├── cropImageService.js   #   错题配图裁剪上传
│   │   └── paperBankAIService.js #   试卷库AI版面分析
│   ├── utils/                    # 工具库 (15个文件)
│   │   ├── pdfGenerator.js       #   试卷PDF生成
│   │   ├── docxGenerator.js      #   Word导出
│   │   ├── questionDedup.js      #   错题去重引擎
│   │   ├── imageEnhancer.js      #   图片增强 (二值化)
│   │   └── ...
│   ├── config/ai.js              # AI配置
│   └── data/mockData.js          # Mock数据
│
├── src/workbench/                # Vue 3 PC工作台 (独立SPA)
│   ├── App.vue
│   ├── main.js
│   ├── router/index.js           # 6条路由 (Dashboard/WrongBook/Exam/Growth/AIReview/QuestionBank)
│   ├── views/                    # 6个视图
│   ├── stores/                   # 8个Pinia Store
│   │   ├── workbenchStore.js     #   模式切换
│   │   ├── lifecycleStore.js     #   错题生命周期FSM (无状态)
│   │   ├── wrongBookStore.js     #   错题本 (筛选/去重/分页)
│   │   ├── reviewStore.js        #   人工批改审核
│   │   ├── aiReviewStore.js      #   AI批改复审
│   │   ├── growthStore.js        #   成长仪表板KPI
│   │   ├── questionStore.js      #   题库浏览器 (跨学生聚合)
│   │   └── reviewTaskStore.js    #   重练卷管理
│   ├── store/paperStore.js       #   试卷OCR识别工作流
│   ├── api/paperApi.js           #   试卷API (axios)
│   └── components/               #   Vue组件 (8个)
│
├── server/                       # Node.js后端 (Express)
│   ├── index.js                  # 30+ REST API内联路由
│   ├── worker.js                 # BullMQ Worker (8步处理管道)
│   ├── queue.js                  # BullMQ队列配置
│   ├── redisManager.js           # Redis连接池+故障转移
│   ├── pendingTaskRecovery.js    # 超时任务恢复 (5min扫描)
│   ├── config/
│   │   ├── neon.js               # PostgreSQL连接池
│   │   ├── ai.js                 # AI端点/提示词配置
│   │   └── oss.js                # 阿里云OSS客户端
│   └── services/
│       ├── neonService.js        # 数据库操作 (任务/题目/错题/缓存/判定)
│       ├── ossService.js         # OSS上传/删除/签名URL
│       ├── uploadRetryManager.js # 上传重试 (指数退避)
│       ├── uploadReportLogger.js # 上传报告日志
│       └── uploadValidator.js    # 文件验证 (magic bytes + sharp)
│
├── database/                     # 数据库脚本
│   ├── neon_schema.sql           # 核心表结构 (7表 + 索引 + 触发器)
│   ├── schema.sql                # 旧版模式
│   └── migrations/               # 增量迁移 (003-006)
│
├── multimodal_exam_engine/       # Python试卷处理引擎 (实验性)
│   ├── pipeline.py               #   处理管道
│   ├── image_processor.py        #   图像处理
│   ├── layout_analyzer.py        #   版面分析
│   ├── semantic_parser.py        #   语义解析
│   └── alignment_engine.py       #   对齐引擎
│
├── functions/                    # Cloudflare Pages Functions
│   └── api/[[path]].js           # API代理
│
├── android/                      # Capacitor Android 壳
├── vite.config.js                # Vite配置 (代理: /api → localhost:3001)
└── package.json
```

---

## 三、核心业务流程

### 3.1 完整链路：上传 → OCR → 批改 → 错题 → 复练

```
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐
│ 1.上传    │ →  │ 2.队列   │ →  │ 3.OCR识别 │ →  │ 4.AI批改  │ →  │ 5.错题本  │
│ (拍照/相册)│    │ (BullMQ) │    │ (视觉AI)  │    │ (文本AI)  │    │ (同步)   │
└──────────┘    └──────────┘    └───────────┘    └──────────┘    └──────────┘
                                                                    ↓
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐
│ 8.复练卷  │ ←  │ 7.组卷    │ ←  │ 6.编辑    │    │          │
│ (PDF/打印)│    │ (选错题)  │    │ (题干/答案)│    │          │
└──────────┘    └──────────┘    └───────────┘    └──────────┘
```

#### 步骤详述:

**Step 1 — 上传:** FAB按钮→拍摄/相册→`taskService.uploadFiles()`→POST `/api/tasks/upload`
  - 前端即时创建临时`is_temp: true`任务 (URL.createObjectURL)，实现**乐观UI**
  - 经过：uploadValidator (magic bytes + sharp) → ossService → 创建DB记录 → 入队BullMQ

**Step 2 — 队列:** BullMQ `task-processing` 队列，并发2，最多重试3次
  - `pendingTaskRecovery.js` 每5分钟扫描超时pending任务重新入队
  - 前端8秒轮询 `/api/tasks/student/:studentId` 获取状态更新

**Step 3 — OCR识别 (Worker Step 5/8):**
  - 下载图片 → sharp拉直(rotate+normalize) → 压缩(1920px, JPEG85) → base64
  - 调用AI视觉API (Qwen3-VL-8B-Instruct, 120s超时)
  - AI返回JSON → `repairAIJson()` 修复反斜杠/换行 → `judgeAnswer()` 判断正误
  - 几何配图裁剪 (sharp extract + OSS上传, bbox去重缓存)

**Step 4 — AI答案生成 (Worker Step 7/8):**
  - 先查 `question_cache` (SHA256指纹精确匹配, Levenshtein相似匹配)
  - 未命中则调用AI纯文本接口逐题生成
  - `validateAIAnswer()` 过滤异常 (空答案/占位符/过短分析)
  - 答案更新后**重新判定**题目正误，更新 `is_correct` 和 `wrong_questions`

**Step 5 — 错题本同步:** `addWrongQuestions(studentId, wrongIds)` 去重写入

**Step 6 — AI标签 (Worker Step 8/8):** 批量3题一组调用AI生成知识点标签
  - `TAG_SYNONYM_MAP` 同义词合并 → `deduplicateTags()` 去重 → `batchUpdateQuestionTags()`

**Step 7 — 组卷:** 错题本多选 → "生成试卷" → `createGeneratedExam()` POST `/api/generated-exams`

**Step 8 — 复练卷:** `pdfGenerator.js` → 嵌入QR码 (jsQR扫码可进行Grading) → 下载/打印

### 3.2 Shadow Mode 审计

每一步AI判定都通过 `createJudgement()` 写入 `judgements` 表（`Promise.allSettled` 不阻塞主流程）：

| source | 触发点 | 记录内容 |
|---|---|---|
| `ai_ocr` | OCR完成 | 原始OCR识别结果+判定 |
| `ai_answer_gen` | AI答案生成完成 | 参考答案+重新判定结果 |
| `manual_review` | PC工作台人工审核 | 人工修正结果 |
| `pc_edit` | 题目编辑保存 | 编辑器修改记录 |

---

## 四、页面路由与作用

### 4.1 React 主前端 (移动端 SPA)

不使用 React Router，基于 Zustand `currentPage` 状态驱动渲染：

| currentPage | Tab | 页面作用 | 数据源 |
|---|---|---|---|
| `processing` | 首页 | 上传入口、任务列表、状态筛选(全部/已批改/未批改)、点击已完成任务进入ExamReview | taskStore, apiService |
| `wrongbook` | 错题本 | 错题列表(筛选/排序/多选)、掌握度切换(pending/partial/mastered)、编辑/删除/组卷 | wrongQuestionStore, apiService |
| `exam` | 组卷记录 | 已生成试卷列表、PDF下载、打印、删除 | examStore, apiService |

**懒加载悬浮页面 (Suspence包裹):**

| 组件 | 触发 | 作用 |
|---|---|---|
| ScanQR | 点击QR图标 | jsQR扫码识别，支持相机/相册，返回grading数据 |
| Grading | ScanQR成功 | 逐题手动批改(做对/做错)，进度条，结果汇总 |
| ExamReview | 点击已完成任务 | 原卷图片+题目列表对照，人工复审AI批改结果 (支持触屏拖拽面板) |
| PrintPreview | 错题本→生成试卷 | 选中题目预览，PDF生成，QR码嵌入，下载/打印 |
| QuestionEdit | 错题本→编辑题目 | 三栏编辑器(题干/答案/标签)，支持图片裁剪+几何配图、知识点标签(AI/手动) |
| PaperBank | 试卷库入口 | 多页试卷上传→AI版面分析→逐块校对→Word导出 (全屏模式) |

### 4.2 Vue 3 PC 工作台 (独立 SPA)

| 路由 | 视图 | 作用 |
|---|---|---|
| `/` | DashboardWorkbench | 今日待审总览 + 成长KPI |
| `/wrongbook` | WrongBookWorkbench | 错题本 (增强筛选/去重Toggle/生命周期管理) |
| `/paper` | ExamWorkbench | 试卷导入/OCR/校对 (paperStore+paperApi) |
| `/growth` | GrowthWorkbench | 掌握率趋势/30天统计/科目细分 (growthStore) |
| `/ai-review` | AIReviewWorkbench | AI批改人工复审 (aiReviewStore) |
| `/question-bank` | QuestionBankWorkbench | 跨学生聚合题库/批量编辑 (questionStore) |

---

## 五、数据流架构

### 5.1 状态管理层

```
React 前端                           Vue 工作台
─────────────                       ─────────────────
Zustand Stores                      Pinia Stores
┌──────────────────────┐           ┌──────────────────────┐
│ useStudentStore      │           │ workbenchStore       │
│  currentStudent      │           │  currentMode         │
│  students[]          │           └──────────────────────┘
├──────────────────────┤           ┌──────────────────────┐
│ useTaskStore         │           │ wrongBookStore       │
│  tasks[]             │           │  wrongQuestions[]    │
│  processingTasks[]   │           │  filters/sort/page   │
│  polling/cleanup     │           │  dedupEnabled       │
├──────────────────────┤           ├──────────────────────┤
│ useWrongQuestionStore│           │ reviewStore          │
│  wrongQuestions[]    │           │  currentReviewIndex   │
│  selectedQuestions[] │           │  reviewStatus         │
├──────────────────────┤           ├──────────────────────┤
│ useExamStore         │           │ aiReviewStore        │
│  exams[]             │           │  taskQuestions[]      │
│  generatedExams[]    │           │  reviewStatus         │
├──────────────────────┤           ├──────────────────────┤
│ useUIStore           │           │ growthStore          │
│  currentPage         │           │  masteryRate/trend   │
│  loading             │           │  subjectStats        │
│  toast               │           ├──────────────────────┤
└──────────────────────┘           │ questionStore        │
                                   │  allQuestions[]      │
  (共享) apiService.js             │  filters/pagination  │
   localStorage缓存层               ├──────────────────────┤
   TTL: 学生24h / 任务5min           │ reviewTaskStore     │
   / 题目5min / 错题5min             │  reviewTasks[]       │
   / 试卷10min                      │  statusFilter        │
                                   ├──────────────────────┤
                                   │ lifecycleStore (FSM) │
                                   │  new→review_1→       │
                                   │  review_2→mastered   │
                                   └──────────────────────┘
```

### 5.2 组件通信模式

```
React 前端:
  App.jsx (orchestrator)
    ├─> Zustand stores (state)
    ├─> apiService / taskService (API + cache)
    ├─> aiService / paperBankAIService (AI)
    └─> Lazy pages (props: onClose, onSave, onComplete)

Vue 工作台:
  App.vue
    ├─> Vue Router (6 routes)
    ├─> Pinia stores (state)
    └─> apiService / paperApi (API)
```

### 5.3 后端API层

```
Express (index.js) — 30+ 内联路由，无独立路由/控制器文件
  │
  ├─ config/neon.js ── raw SQL via pg.Pool (无ORM)
  ├─ config/ai.js ──── AI提示词构建器
  ├─ config/oss.js ─── 阿里云OSS客户端
  │
  ├─ services/neonService.js ── DB操作封装
  ├─ services/ossService.js ─── OSS操作封装
  ├─ services/uploadValidator.js
  ├─ services/uploadRetryManager.js
  └─ services/uploadReportLogger.js
  │
  ├─ queue.js ──── BullMQ 队列 (task-processing)
  ├─ worker.js ─── 8步异步处理管道
  └─ redisManager.js ── 连接池+故障转移
```

---

## 六、数据库关系

```
students  ──1:N──>  tasks ──1:N──>  questions
  │                                       │
  │                                       │
  └──1:N──>  wrong_questions              │
  │              (student_id, question_id) │
  │                                       │
  ├──1:N──>  generated_exams              │
  │          (question_ids JSONB[])        │
  │                                       │
  ├──1:N──>  judgements (审计, 只追加)     │
  │                                       │
  └──1:N──>  training_logs                │
                                           │
                               question_cache
                               (指纹索引, 跨学生共享)
```

---

## 七、核心模块依赖关系

```
App.jsx
  ├─ store/index.js ───────────────────────── all stores
  ├─ services/apiService.js ────────────────── all API
  ├─ services/taskService.js ───────────────── upload + polling
  ├─ services/aiService.js ─────────────────── OCR + tag gen
  ├─ services/paperBankAIService.js ────────── 试卷版面分析
  ├─ utils/pdfGenerator.js ─────────────────── PDF + QR
  ├─ utils/docxGenerator.js ────────────────── Word导出
  ├─ utils/questionDedup.js ────────────────── 错题去重
  ├─ components/RectCropper/ ───────────────── 图片裁剪
  └─ components/MathText/ ──────────────────── KaTeX渲染

server/worker.js
  ├─ config/ai.js ──────────────────────────── 提示词构建
  ├─ config/neon.js ────────────────────────── DB查询
  ├─ services/neonService.js ───────────────── DB操作
  ├─ services/ossService.js ────────────────── OSS上传
  ├─ utils/questionFingerprint.js ──────────── SHA256 + phash
  └─ sharp / axios ─────────────────────────── 图片处理 + HTTP

Vue Workbench Stores:
  ├─ apiService.js ─────────────────────────── (共享React端的API层)
  ├─ paperApi.js ───────────────────────────── 试卷API (独立axios)
  ├─ utils/questionDedup.js ────────────────── 去重引擎
  ├─ utils/pdfGenerator.js ─────────────────── PDF生成
  └─ lifecycleStore.js ─────────────────────── 错题状态机 (全store共享)
```

---

## 八、关键设计模式

| 模式 | 实现位置 | 说明 |
|---|---|---|
| 乐观UI | App.jsx uploadViaBackend | 先创建本地临时任务(URL.createObjectURL)，后端确认后替换 |
| 状态驱动路由 | App.jsx currentPage | 无React Router, 三页切换基于Zustand状态 |
| Shadow模式审计 | worker.js + judgements表 | 所有AI判定不阻塞主流程追加写入 |
| 双层缓存 | question_fingerprint + Levenshtein | 精确SHA256指纹 + 编辑距离相似匹配 |
| 指数退避重试 | uploadRetryManager.js | OSS上传重试，上限30s抖动 |
| 生产者-消费者 | BullMQ (queue.js + worker.js) | 上传请求入队，Worker异步处理 |
| 适配器 | vite.config.js proxy | `/api` → localhost:3001 |
| 懒加载 | App.jsx lazyWithRetry | 4个重页面动态导入，失败可重试 |

---

## 九、风险与隐患清单

### 🔴 严重 (可能引发数据丢失/功能不可用)

1. **`apiService.updateTaskStatus` 存在逻辑bug**
   - 位置: [src/services/apiService.js](src/services/apiService.js)
   - 问题: 函数接受 `status` 参数但完全忽略，若 `result` 为 falsy 则返回 null
   - 影响: 调用方以为状态已更新，实际什么都没发生

2. **`subscribeToTaskUpdates` 是空函数 — 轮询体为空**
   - 位置: [src/services/taskService.js](src/services/taskService.js)
   - 问题: 函数在 try/catch 中无任何逻辑，store 中 `startRealtimeSync` 调用它但实际无效果
   - 影响: 页面靠 `startPolling` 轮询工作，这个函数存在误导性

3. **`apiRequest` 重复实现**
   - 位置: [src/services/apiService.js](src/services/apiService.js) 和 [src/services/taskService.js](src/services/taskService.js)
   - 问题: 两处几乎相同的 `apiRequest`，一处改动另一处可能遗漏
   - 影响: 维护负担，修复不一致性时可能漏掉一处

4. **无身份验证**
   - 位置: 所有 API 端点
   - 问题: 无 `Authorization` 头、API 密钥或会话中间件，`studentId` 作为参数明文传递
   - 影响: 生产环境存在安全风险

5. **`getExamsByStudent` 存在 N+1 查询**
   - 位置: [src/services/apiService.js](src/services/apiService.js)
   - 问题: 先取所有已完成任务，对每个任务逐一调 `getQuestionsByTask`
   - 影响: 学生任务数较多时前端请求瀑布，可能导致白屏

### 🟡 中等 (可能引发功能异常或性能问题)

6. **前端答案判断过于简单**
   - 位置: [src/services/aiService.js](src/services/aiService.js) normalizeAnswer + judgeAnswer
   - 问题: 非选择题用 normalizeAnswer 后精确字符串匹配，`"1/2" vs "0.5"`、`"3.14" vs "π"` 等等价答案会被判错
   - 影响: 批改准确性受限

7. **顺序几何图像处理**
   - 位置: [server/worker.js:966](server/worker.js) cropAndUploadGeometryImage
   - 问题: 虽已用 Map 去重，但每个不重复的 bbox 裁剪是串行的 await-for-loop
   - 影响: 多几何图题目处理时间线增长

8. **顺序AI答案生成**
   - 位置: [server/worker.js:680](server/worker.js) generateMissingAnswers
   - 问题: 批次内(3题)是 Promise.all 并行，但批次间是串行
   - 影响: 20道题需要7轮串行AI调用

9. **`confidence` 字段误用 `||` 而非 `??`**
   - 位置: [src/services/paperBankAIService.js](src/services/paperBankAIService.js)
   - 问题: `block.confidence || 0.8` — 若 AI 返回 confidence=0，会被替换为 0.8
   - 影响: 有效值 0 被静默覆盖

10. **两套创建任务的路径**
    - 位置: `apiService.createTask()` (by URL) vs `taskService.uploadFiles()` (multipart)
    - 问题: 同一操作的两种不同实现，行为略有差异

11. **`getStudentById` 低效实现**
    - 位置: [src/services/apiService.js](src/services/apiService.js)
    - 问题: GET `/api/students` 获取全量列表，客户端侧过滤
    - 影响: 如果学生数量增长，性能下降

12. **全部任务在内存中管理**
    - 位置: Zustand stores
    - 问题: 所有任务/错题数据存入内存，不设分页 (前端仅展示时分页)
    - 影响: 学生数据量大时内存占用高

13. **localStorage 无驱逐策略**
    - 位置: [src/services/apiService.js](src/services/apiService.js)
    - 问题: TTL 过期后有清除，但无 LRU 或容量限制
    - 影响: 长期使用可能触及 5MB 配额

### 🟢 轻度 (代码质量问题)

14. **`App.jsx` 单体过大 (~3200 行)**
    - 问题: 三个页面(processing/wrongbook/exam)的渲染、状态、事件处理全在一文件内
    - 影响: 可维护性差，单文件过大

15. **Layout 组件未使用**
    - 位置: [src/components/Layout/index.jsx](src/components/Layout/index.jsx)
    - 问题: antd-mobile TabBar 实现，但 App.jsx 用的是 iOS segmented 风格自制导航

16. **`saveRecognitionResult` 状态硬编码**
    - 位置: [src/services/aiService.js](src/services/aiService.js)
    - 问题: 所有条目的 `status` 字段固定为 `'识别成功'`

17. **错误处理模式不一致**
    - `apiService.js` / `taskService.js`: 出错 throw
    - `aiService.js` / `paperBankAIService.js`: 返回 `{ success: false, error }`

18. **`paperBankAIService` 无 AI 结果缓存**
    - 位置: [src/services/paperBankAIService.js](src/services/paperBankAIService.js)
    - 问题: 每次都调用 AI API，重复识别相同图片

19. **正则提取 JSON 脆弱**
    - 位置: [server/worker.js:330](server/worker.js) + aiService.js
    - 问题: 期望 `` ```json `` 格式的 markdown 代码块，AI 输出格式变化时解析失败
