# Tasks

- [x] Task 1: 优化知识点讲解 AI prompt（分层次、字号区分重难点）
  - [x] SubTask 1.1: 修改 `generateKnowledgeExplanation` 的 prompt，要求 AI 输出清晰的 ## 核心定义 / ## 重点内容 / ## 难点突破 / ## 易错警示 / ## 记忆口诀 五段式结构
  - [x] SubTask 1.2: 确保每段内容有实质性讲解（非通用模板），定义准确、重点突出、难点有突破方法、易错有具体案例
  - [x] SubTask 1.3: 增强 `isPromptEcho` 检测，确保 AI 不回显提示词文本

- [x] Task 2: 重写 `buildSolutionSteps` 为真实解题步骤（学生做题步骤风格）
  - [x] SubTask 2.1: 重写 `buildSolutionSteps` 函数，基于题目具体内容（题干、正确答案、错因、题目类型）生成针对性解题步骤
  - [x] SubTask 2.2: 丰富 `parseLinearEquation` 支持更多方程类型（二元一次方程、分式方程、不等式等）
  - [x] SubTask 2.3: 新增 `buildArithmeticSteps` 处理算术/计算类题目的分步计算
  - [x] SubTask 2.4: 新增 `buildGeometrySteps` 处理几何类题目的分步推理
  - [x] SubTask 2.5: 步骤语言使用学生视角（"我先把…代入…"），每步包含具体公式（KaTeX 渲染）
  - [x] SubTask 2.6: 空题从零开始完整解题，每步推导中间结果

- [x] Task 3: 优化题型全览（覆盖所有可能考到的题型 + 完整作答过程）
  - [x] SubTask 3.1: 修改 `generateQuestionTypeSummary` 的 prompt，要求 AI 输出 3-6 种题型，每种包含完整解题步骤
  - [x] SubTask 3.2: 确保题型全览中的 solutionSteps 为具体解题步骤（非通用模板）
  - [x] SubTask 3.3: 题型全览页包含明确标题"本知识点考试题型全览"

- [x] Task 4: 优化知识点页排版（字号加大、层次分明、极简风格）
  - [x] SubTask 4.1: 知识点标签（核心定义/重点/难点/易错警示）字号确保 ≥18px bold
  - [x] SubTask 4.2: 核心定义正文 18px，重点内容列表项 20px bold，难点内容 20px bold
  - [x] SubTask 4.3: 易错点列表项 18px，记忆口诀 18px 绿色高亮背景框
  - [x] SubTask 4.4: 确保知识点页为纵向结构（定义→重点→难点→易错点→口诀），层次清晰

- [x] Task 5: 优化错题页和题型页排版
  - [x] SubTask 5.1: 题干字号 18px，对比卡片字号 18px
  - [x] SubTask 5.2: 分步作答步骤文字 18px，步骤编号圆 32px
  - [x] SubTask 5.3: 题型名称 20px bold，例题题干 18px
  - [x] SubTask 5.4: 确保整体排版简洁，无多余装饰，纯白背景

- [x] Task 6: 修复数学公式渲染（确保无乱码）
  - [x] SubTask 6.1: 确认 `renderMarkdown` 函数末尾调用 `renderMath`
  - [x] SubTask 6.2: 确认 `renderMath` 正确处理行内 `$...$` 和块级 `$$...$$` 公式
  - [x] SubTask 6.3: 确认分步作答中的公式、知识点讲解中的公式均正确渲染
  - [x] SubTask 6.4: 验证中文内容与 KaTeX 混排无乱码

- [x] Task 7: 浏览器全面验证
  - [x] SubTask 7.1: 启动本地服务，确认服务正常运行
  - [x] SubTask 7.2: 生成讲义，确认数学公式正确渲染（无 LaTeX 原始代码乱码）
  - [x] SubTask 7.3: 确认知识点页层次分明，标签字号 ≥18px，重点/难点视觉区分清晰
  - [x] SubTask 7.4: 确认错题作答过程是具体步骤（非通用模板），步骤针对题目内容
  - [x] SubTask 7.5: 确认题型页包含完整解题过程（学生做题步骤风格）
  - [x] SubTask 7.6: 确认整体排版简洁，投屏可读，无多余装饰

# Task Dependencies
- Task 2 和 Task 4 可并行执行
- Task 5 依赖 Task 2 和 Task 4
- Task 6 依赖 Task 1-5
- Task 7 依赖 Task 1-6 全部完成