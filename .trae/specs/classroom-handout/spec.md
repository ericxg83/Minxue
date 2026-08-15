# 投屏级备课讲义 Spec

## Why
当前讲义生成面向"老师自己看"，视觉风格偏草稿/笔记，不适用于课堂投屏展示。老师需要一份可以直接投到大屏幕上、学生能看清、视觉精美正式的教育文档，按知识点→错题→题型组织，丰富且结构化。

## What Changes
- 新增 `classroom_projection` 投屏级讲义模板，保留现有 `lecture_prep` 不变
- 讲义封面、知识点页、错题页、题型归纳页全面视觉升级
- 大字体、高对比度、卡片式布局，适配投影仪分辨率
- 错题展示增加"学生作答 vs 正确答案"对比卡片
- 知识点讲解区域增加"知识卡片"结构化展示
- 每页增加页眉（学科/知识点）和页脚（页码）
- 增加"课堂时间建议"辅助教师把控节奏
- 增加"板书建议"区域，提示教师投屏时可板书什么

## Impact
- Affected specs: 讲义模板系统、前端 HandoutPreview.vue 渲染
- Affected code:
  - `server/services/handoutTemplates/` — 新增 `classroomProjection.js` 模板
  - `server/services/handoutTemplates/index.js` — 注册新模板
  - `src/workbench/views/HandoutPreview.vue` — 新增投屏模板的 block 类型渲染
  - `server/services/handoutService.js` — 可能微调

## ADDED Requirements

### Requirement: 投屏级备课讲义模板
系统 SHALL 提供 `classroom_projection` 模板，生成的讲义适合教室投影仪投屏使用。

#### Scenario: 封面页
- **WHEN** 讲义生成完成
- **THEN** 封面 SHALL 包含：渐变背景、品牌标识"敏学 · 备课讲义"、大标题、学科/时间范围、装饰元素

#### Scenario: 知识点页
- **WHEN** 渲染知识点讲解
- **THEN** 页面 SHALL 包含：知识点标题（大号）、知识卡片（定义/要点/易错点/口诀 四栏网格）、课堂时间建议（如"建议讲解 8-10 分钟"）

#### Scenario: 错题例题页
- **WHEN** 渲染错题
- **THEN** 每道错题 SHALL 以卡片形式展示，包含：题型标签、题干（大号字体）、学生作答与正确答案的对比卡片、错因分析、讲解引导。卡片应有清晰的视觉层次（阴影/边框/色块）。

#### Scenario: 题型归纳页
- **WHEN** 渲染题型归纳
- **THEN** 每种题型 SHALL 以独立卡片展示，包含：序号、题型名、考法描述、典型例题、应对策略。卡片按重要性排序。

#### Scenario: 页眉页脚
- **WHEN** 渲染讲义内容页
- **THEN** 每页 SHALL 显示页眉（学科 + 知识点名称）和页脚（页码）

### Requirement: 前端渲染支持新块类型
HandoutPreview.vue SHALL 支持投屏模板新增的块类型。

#### Scenario: 知识卡片
- **WHEN** 遇到 `block.type === 'knowledge-card'`
- **THEN** 渲染四栏网格布局（定义/要点/易错点/口诀），每栏有独立图标和背景色

#### Scenario: 对比卡片
- **WHEN** 遇到 `block.type === 'compare-card'`
- **THEN** 渲染左右对比布局：左侧"学生作答"（红底/浅红）、右侧"正确答案"（绿底/浅绿）

#### Scenario: 板书建议
- **WHEN** 遇到 `block.type === 'board-hint'`
- **THEN** 渲染带黑板图标的提示卡片，灰底虚线边框

#### Scenario: 时间建议
- **WHEN** 遇到 `block.type === 'time-hint'`
- **THEN** 渲染带时钟图标的提示条，显示建议讲解时长

### Requirement: 模板注册
系统 SHALL 在 `handoutTemplates/index.js` 中注册新模板，使其可通过 `GET /api/handout/templates` 获取。

### Requirement: 按知识点生成支持新模板
"按知识点生成讲义"（`POST /api/handout/by-knowledge`）SHALL 支持 `template: 'classroom_projection'` 参数。