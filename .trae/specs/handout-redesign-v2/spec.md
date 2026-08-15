# 投屏讲义重设计 Spec (v2)

## Why
当前投屏讲义存在三个核心问题：
1. **排版不清晰**：标签字号过小（14px）、知识点层次视觉区分度不够、投屏时学生难以聚焦
2. **数学公式乱码**：LaTeX 公式（`$x+5=10$`）需转换为学生可读的渲染格式
3. **作答过程是通用模板而非真实解题步骤**：`buildSolutionSteps` 生成的都是"审题→列式→计算→验证"通用话术，没有针对具体题目的实际解题过程。用户明确要求"作答过程等于学生做题的步骤"——即针对每道具体题目，展示学生应该如何一步步求解的完整过程

## What Changes
- **BREAKING** 重写 `buildSolutionSteps` 函数，改为基于题目具体内容的真实解题步骤（非通用模板）
- 调整 AI prompt（`generateKnowledgeExplanation`），要求输出更细致的分层次讲解
- 优化知识点页排版：标签字号加大（≥18px），重点/难点/易错视觉层次更分明
- 错题页：对比卡片 + 针对具体题目的完整分步作答过程
- 题型页：每种题型包含完整解题过程（学生做题步骤风格）
- 整体排版更简洁、层次更清晰

## Impact
- Affected specs: 讲义模板系统、前端 HandoutPreview.vue 渲染
- Affected code:
  - `server/services/handoutTemplates/classroomProjection.js` — 重写 `buildSolutionSteps`
  - `src/workbench/views/HandoutPreview.vue` — 优化知识点排版样式 + 分步作答样式
  - `server/services/handoutService.js` — 调整 AI prompt

## ADDED Requirements

### Requirement: 真实解题步骤（非通用模板）
系统 SHALL 为每道错题生成针对该题具体内容的解题步骤，而非通用话术。

#### Scenario: 针对具体题目的解题步骤
- **WHEN** 生成一道错题的作答过程
- **THEN** 步骤 SHALL 包含：
  - 基于题目具体内容的求解步骤（如"将 x=3 代入方程 2x+5=11"而非"列式：写出关键公式"）
  - 每步有具体的公式（用 KaTeX 渲染，如 `$2 \times 3 + 5 = 11$`）
  - 步骤数为 3-5 步，匹配题目实际难度
  - 步骤语言为学生视角（"我先把…代入…"）
  - 若题目有正确答案，步骤应推导出该答案

#### Scenario: 空题的解题步骤
- **WHEN** 学生未作答（空题）
- **THEN** 步骤 SHALL 包含：
  - 从零开始的完整解题过程
  - 每步推导出中间结果
  - 最终得到正确答案

### Requirement: 极简投屏模板
系统 SHALL 提供重设计的投屏模板，风格简洁、信息层次分明。

#### Scenario: 知识点精讲页
- **WHEN** 渲染知识点讲解
- **THEN** 页面 SHALL 包含：
  - 知识点标题（28px、加粗）
  - 核心定义（18px 正文）
  - 重点内容（20px bold，蓝色标签"重点"≥18px）
  - 难点内容（20px bold + 橙色左边框，标签"难点"≥18px）
  - 易错点（18px 列表，红色标签"易错警示"≥18px）
  - 记忆口诀（18px，绿色高亮背景框）
  - 课堂时间建议（顶部 14px 提示条）

#### Scenario: 错题精讲页
- **WHEN** 渲染学生错题
- **THEN** 每道错题 SHALL 包含：
  - 题号 + 题型标签
  - 题干（18px，清晰可读）
  - 学生作答（红底卡片，标注"学生作答"）
  - 正确答案（绿底卡片，标注"正确答案"）
  - 完整分步作答过程（编号步骤，每步有具体解释文字和公式，KaTeX 渲染）
  - 错因简析（一句话）
  - 不包含：冗余图标、多余装饰线

#### Scenario: 题型全览页
- **WHEN** 渲染题型归纳
- **THEN** 每种题型 SHALL 包含：
  - 题型名称 + 序号（20px bold）
  - 典型例题（题干，18px）
  - 完整解题过程（分步，每步有具体公式和说明，学生做题步骤风格）
  - 关键技巧提示（16px）

### Requirement: 数学公式正确渲染
`renderMarkdown` 函数 SHALL 在处理完 Markdown 语法后调用 `renderMath`，确保 LaTeX 公式被 KaTeX 渲染为数学符号。

#### Scenario: 行内公式
- **WHEN** 内容包含 `$x+5=10$`
- **THEN** 渲染为 KaTeX 行内数学公式，非原始文本

#### Scenario: 块级公式
- **WHEN** 内容包含 `$$ax+b=0$$`
- **THEN** 渲染为 KaTeX 居中块级数学公式

### Requirement: 分步作答过程渲染
系统 SHALL 支持渲染具体的分步作答过程。

#### Scenario: 分步作答渲染
- **WHEN** 遇到 `block.type === 'solution-steps'`
- **THEN** 渲染编号步骤列表，每步包含步骤说明和公式（KaTeX 渲染），步骤说明使用学生视角语言

## MODIFIED Requirements

### Requirement: 投屏级 CSS 样式
原投屏 CSS 标签字号过小、层次不够分明，改为放大标签、强化视觉层次。

#### Scenario: 极简样式
- **WHEN** 渲染投屏讲义
- **THEN** 样式 SHALL 满足：
  - 背景纯白，无渐变
  - 正文 ≥18px，标题 26-28px，重点 20px bold
  - 知识点标签（核心定义/重点/难点/易错警示）≥18px bold
  - 仅保留必要的对比色（红=错误、绿=正确、蓝=重点、橙=难点）
  - 卡片仅保留细边框 + 微阴影，无彩色背景
  - 页眉页脚简洁（细线分隔，12px）
  - 无多余图标

## REMOVED Requirements

### Requirement: 知识卡片四栏网格
**Reason**: 四栏网格（定义/要点/易错点/口诀）视觉上过于拥挤，投屏时学生难以聚焦。改为纵向分层次排版。
**Migration**: 知识点页改为纵向结构：定义 → 重点 → 难点 → 易错点 → 口诀

### Requirement: 板书建议区域
**Reason**: 板书由教师现场决定，预设板书建议在投屏时占用空间且无实际价值。
**Migration**: 移除 `board-hint` 块类型及渲染

### Requirement: 题型归纳卡片式展示
**Reason**: 原卡片仅罗列题型名+考法描述，缺少解题过程，不符合教学需求。
**Migration**: 改为题型全览，每种题型包含完整解题过程