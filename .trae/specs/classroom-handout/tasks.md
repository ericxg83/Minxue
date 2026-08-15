# Tasks

- [x] Task 1: 创建投屏级讲义模板 `classroomProjection.js`
  - [x] SubTask 1.1: 实现 `buildSections` 主函数，按知识点→错题→题型归纳三页结构组织
  - [x] SubTask 1.2: 实现 `buildKnowledgeCard` 函数，将 AI 讲解文本解析为结构化知识卡片（定义/要点/易错点/口诀）
  - [x] SubTask 1.3: 改造 `buildLectureGuidance` 为投屏版，增加板书建议和时间建议
  - [x] SubTask 1.4: 实现 `buildCompareCard` 函数，生成学生作答 vs 正确答案对比卡片
  - [x] SubTask 1.5: 实现题型归纳页的卡片化展示

- [x] Task 2: 注册新模板到系统
  - [x] SubTask 2.1: 在 `handoutTemplates/index.js` 中 import 并 register 新模板

- [x] Task 3: 前端 HandoutPreview.vue 渲染升级
  - [x] SubTask 3.1: 新增 `knowledge-card` 块类型渲染（四栏网格 + 图标 + 色块）
  - [x] SubTask 3.2: 新增 `compare-card` 块类型渲染（左右对比布局）
  - [x] SubTask 3.3: 新增 `board-hint` 块类型渲染（黑板图标 + 虚线边框）
  - [x] SubTask 3.4: 新增 `time-hint` 块类型渲染（时钟图标 + 提示条）
  - [x] SubTask 3.5: 新增页面页眉（学科/知识点）和页脚（页码）渲染
  - [x] SubTask 3.6: 投屏级 CSS：大字体（≥16px正文，≥24px标题）、高对比度、卡片阴影、圆角

- [x] Task 4: 封面页视觉升级（投屏版）
  - [x] SubTask 4.1: 渐变背景 + 装饰分割线
  - [x] SubTask 4.2: 大标题 + 学科标签 + 日期

- [x] Task 5: 浏览器验证
  - [x] SubTask 5.1: 启动本地服务，访问讲义预览页
  - [x] SubTask 5.2: 选择"投屏备课讲义"模板生成讲义
  - [x] SubTask 5.3: 验证封面、知识点页、错题页、题型归纳页视觉效果
  - [x] SubTask 5.4: 截图保存验证结果

# Task Dependencies
- Task 2 依赖 Task 1
- Task 3 依赖 Task 1
- Task 4 依赖 Task 3
- Task 5 依赖 Task 1-4 全部完成