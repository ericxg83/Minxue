# 敏学App V3 - 修复记录

## 修复日期
2026-05-08

## 已修复问题

### 1. 数据库配置 ✅
- **问题**: 后端未配置 NEON_DATABASE_URL，导致无法连接真实数据库
- **修复**: 
  - 在 `server/.env` 中添加 Neon 连接字符串
  - 创建数据库初始化脚本 `server/init-db.mjs`
  - 成功创建5个表：students, tasks, questions, wrong_questions, generated_exams
  - 插入测试学生数据（诸葛亮、周瑜）

### 2. 首页"处理"页面筛选功能 ✅
- **问题**: 筛选标签（全部/处理中/已完成/失败）切换时列表数据不更新
- **修复**: 
  - 将 `safeTasks` 替换为 `filteredTasks`
  - `filteredTasks` 根据 `processingFilter` 状态过滤数据

### 3. "待确认"页面筛选功能 ✅
- **问题**: 筛选标签（待核对/疑似错题/判定正确）切换时列表数据不更新
- **修复**:
  - 将 `safePending` 替换为 `filteredQuestions`
  - 全选/反选功能使用 `filteredQuestions` 数据
  - Tab计数使用过滤后的数据

### 4. "错题本"页面筛选功能 ✅
- **问题**: 筛选标签（全部/未掌握/已掌握）切换时列表数据不更新
- **修复**:
  - 将 `safeWrong` 替换为 `filteredWrongQuestions`
  - 全选按钮使用 `filteredWrongQuestions` 数据
  - 支持多维度筛选：科目、时间、错次、标签

### 5. "试卷"页面筛选功能 ✅
- **问题**: 筛选标签（未批改/已批改）切换时列表数据不更新
- **修复**:
  - 将 `safeExams` 替换为 `filteredExams`
  - Tab计数使用过滤后的数据

### 6. 试卷页面移除"批改"功能 ✅
- **问题**: 列表页仍有"批改"按钮
- **修复**: 只保留"打印"按钮

### 7. 点击试卷标题打开打印预览 ✅
- **问题**: 点击试卷标题只显示详情，不打开打印预览
- **修复**: `handleViewExamDetail` 函数新增 `handlePrintExam(exam)` 调用

### 8. 错题本生成试卷功能 ✅
- **问题**: 点击生成试卷提示"请先选择错题"
- **修复**: `handleGenerateExam` 直接使用 `selectedQuestions` 而不是过滤

## 修复日期
2026-07-21

### 9. 练习册大 PDF 解析卡死："解析了几分钟还是出现错误" ✅
- **问题**: 扫描版答案 PDF 上传后长时间显示"正在解析"，最终报错；重新上传被 409"正在解析中"永久拒绝。
- **根因**（生产环境复现确认）: 后台解析在路由进程内执行，`renderPdfToJpegs` 对高 DPI 扫描页无条件按 scale=3 放大，在 Render 512MB 实例上渲染 20 页导致进程 OOM 被杀。10 分钟超时兜底是内存态的，进程死后 `parse_status` 永远停在 `'parsing'`——前端无限轮询、重试全被 409 挡住，且无任何恢复机制。
- **修复**:
  - `server/services/pdfService.js`: 渲染尺寸上限 `maxEdge=2400px`（effective scale = min(scale, maxEdge/页面最长边)），杜绝巨型 canvas OOM
  - `server/routes/worksheets.js`: 409 守卫加卡死判定——`parsing` 超过 12 分钟（`updated_at`）视为进程已死，放行重新解析（parse-pdf 与 parse-images 均生效）
  - `server/pendingTaskRecovery.js`: 新增 `scanStuckWorksheetParsing` 周期扫描（每 5 分钟），把卡死超过 15 分钟的 `parsing` 重置为 `failed` 并写明"解析进程中断，请重新上传"
  - `server/routes/worksheets.js`: 单页 OCR 失败不再连坐整批（此前 Promise.all 一页 reject 丢弃全部结果 → done+0 条）；全部页失败按 failed 处理；部分页失败在警告中列出页码
  - `src/workbench/views/WorksheetManagement.vue`: 前端轮询 12.5 分钟后停止并提示重新上传（此前无限转圈）；补齐图片上传 Tab 缺失的 `startImageParse`/`selectedImages` 等实现（模板引用了但 script 里从未定义，点击图片上传会直接报错）
  - `server/index.js`: 修正误导性的 multer 文件大小报错文案（写死"最大20MB"，实际练习册 PDF 限 50MB）

## 数据库连接信息
- **类型**: Neon PostgreSQL
- **存储**: 阿里 OSS（图片）
- **缓存**: Redis（异步处理）

## 测试状态
- ✅ 数据库连接成功
- ✅ 学生数据加载成功（3个学生）
- ✅ 筛选功能代码修复完成
- 🔄 需要用户验证UI交互

## 下一步
1. 测试所有筛选功能
2. 验证图片上传和 OSS 集成
3. 验证 Redis 异步任务处理
4. 提交到 GitHub
