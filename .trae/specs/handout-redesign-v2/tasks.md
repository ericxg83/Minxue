# Tasks

- [ ] Task 1: 重写 `buildSolutionSteps` 为真实解题步骤（非通用模板）
  - [ ] SubTask 1.1: 重写 `buildSolutionSteps` 函数，基于题目具体内容（题干、正确答案、错因）生成针对性解题步骤，而非通用"审题→列式→计算→验证"话术
  - [ ] SubTask 1.2: 步骤语言使用学生视角（如"我先把…代入…"），每步包含具体公式（用 KaTeX 渲染）
  - [ ] SubTask 1.3: 空题从零开始完整解题，每步推导中间结果
  - [ ] SubTask 1.4: 验证：生成讲义预览，确认错题作答过程是具体步骤而非通用模板

- [ ] Task 2: 优化知识点页排版（字号加大、层次分明）
  - [ ] SubTask 2.1: 知识点标签（核心定义/重点/难点/易错警示）字号从 14px 加大到 ≥18px bold
  - [ ] SubTask 2.2: 核心定义正文从 16px 加大到 18px
  - [ ] SubTask 2.3: 重点内容列表项从 18px 加大到 20px bold
  - [ ] SubTask 2.4: 难点内容列表项加大到 20px，橙色左边框更明显
  - [ ] SubTask 2.5: 易错点列表项加大到 18px
  - [ ] SubTask 2.6: 记忆口诀字号加大到 18px

- [ ] Task 3: 优化错题页和题型页排版
  - [ ] SubTask 3.1: 题干活字从 16px 加大到 18px
  - [ ] SubTask 3.2: 对比卡片字号加大到 18px
  - [ ] SubTask 3.3: 分步作答步骤文字从 15px 加大到 18px，步骤编号从 28px 加大到 32px
  - [ ] SubTask 3.4: 题型名称字号加大到 20px bold
  - [ ] SubTask 3.5: 题型例题字号加大到 18px

- [ ] Task 4: 浏览器验证
  - [ ] SubTask 4.1: 确认数学公式正确渲染（无 LaTeX 原始代码乱码）
  - [ ] SubTask 4.2: 确认知识点页层次分明，标签字号 ≥18px，重点/难点/易错视觉区分清晰
  - [ ] SubTask 4.3: 确认错题作答过程是具体步骤（非通用模板），针对题目内容
  - [ ] SubTask 4.4: 确认题型页包含完整解题过程
  - [ ] SubTask 4.5: 确认整体排版简洁，投屏可读

# Task Dependencies
- Task 2 和 Task 3 可并行执行
- Task 4 依赖 Task 1-3 全部完成