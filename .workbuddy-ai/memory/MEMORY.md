# 敏学项目长期约定

> 只留「索引 + 最易踩的硬规则」。细节外链 `topics/<名>.md`；过程见 `YYYY-MM-DD.md`；产品原则与循环机制见 `AGENTS.md` + `docs/auto/HANDOFF.md`。

## 0. 产品与自决权
- 单用户系统：唯一用户 = 负责人（晚托班老师）；学生是数据主体，不是软件用户。哲学「小而美」。
- A 级（行为保持型修复 / 死代码 / 顺手化 / 文档）+ 四道闸全过 → 可直接 push main。
- ⛔ 硬禁区（只能提案）：DB Schema/迁移、批改主流程设计、错题生命周期与合并、重练组卷口径、掌握度口径、
  练习册答案质量闸、judgements 语义、公共 API 行为、任务状态机、判题/抽取正则与转义。

## 1. 硬规则速查（每条都够让你白干一天）
- ⛔ 完整性唯一判据 `checkQuestionCompleteness()`；`parent_stem` 必进引擎输入（漏 → 条件题判缺条件、answer 永久空）；
  引擎输入必须 `parent_stem`+`content`+`options` 逐字同构（漏 options → 字母答案被覆盖成选项正文）。→ question-completeness
- ⛔ 配图只认 `geometry_image_url`；禁 `image_bbox`↔`block_coordinates` 互比判归属（假阳~28%）。→ bbox-contract
- ⛔ 判模型能否读图只能实测（`input_modalities` 撒谎）；AI 调用必须关代理；离线脚本禁 `noBackup:true`。→ vision-vendors
- ⛔ 几何显示唯一入口 `getGeometryDisplayUrl`（无 server 镜像）；画图数值必须全部来自题干，绝不靠猜。→ geometry-pipeline
- ⛔ 视觉定位框非确定性 ⇒「先目检再 apply」必须复用同一个框；判裁片好坏无确定性判据，**缩略图会误判**。→ 同上
- ⛔ 校验器只许加规则/测试、不得放宽；判分器两个解析函数都不能单独改（先打补丁 → 全库对跑 → 只翻转可逐条解释的 N 条）。→ answer-validators-and-judge
- ⛔ 参考答案位只能显示 `q.answer`（禁 analysis 兜底）；「AI 自述缺条件」先查 `parent_stem` 非空。→ answer-bank-trust
- ⛔ 错题「同一题」走 `questionIdentity.js`，禁相似度合并；变式题不进重练卷/组卷。→ wrongbook-gate-requeue
- ⛔ 重练卷答卷唯一口径 `retryPaperState.js#isRetryPaperTask`；练习册 published 必经 `getWorksheetPublishRisk`。→ 同上
- ⛔ 含 AI/长事务的 POST 必须 `apiRequest(path, opts, 1)`；错误体 `{error,message}`，前端读 `err?.payload?.message`。→ long-request-and-error-surfacing
- ⛔ 补答案优先级：同卷副本回填 > 文本链重跑 > 读图解题 > 转人工；**错的答案比空答案更糟**。→ blank-answer-recovery
- ⛔ 本地起服务：入口首行 `import './loadEnv.js'`；后台起用 run_in_background **别加 `&`**；`Edit` 报成功 ≠ 落盘
  （改完立刻 grep 复核）；会写文件的命令别用 `| head` 取输出。→ local-dev-process
- ⛔ 白板：内容必走 `MathRender`；激光笔不进 strokes；导出 PNG 走离屏层 + html2canvas（`Teleport to="body"`）；
  `saveStrokes()` 按 `current` 算键 ⇒ **换题动作必须先落盘旧题**；板书永久占 localStorage（~55 题写满），
  r89 已加「清空本机板书」入口。→ board §13/§14
- ⛔ 任务「自愈」判定唯一实现 = `server/pendingTaskRecovery.js#describeAutoRetry`（**照 SQL 判，非照设计意图**）；
  前端 `src/domain/taskAutoRetry.js` 只翻译；缺 `auto_retry` 字段一律按「不自愈」。→ task-self-healing
- ⛔ 多根节点组件（如 `GrowthCardButton`）**收不到 class**（静默丢弃，只留一条 warning）⇒ 定位类挂外层元素，
  **验对齐看几何位置，不能只看「按钮存在」**；工作台内容区**自己滚**（非 `window`）⇒ 验页内滚动看
  `getBoundingClientRect().top`。→ data-pages

## 2. 前端验证纪律
- ⛔ 源码级回归锁必须**反向自检**（套在 `git show HEAD:<file>` 旧版上必须判红），否则是空锁。
- ⛔ 常驻入口锁 `workbenchRouteTargets`（导航目标必须能路由）+ `workbenchClickHandlers`（`@click` 绑的名字必须存在）。
  ⛔ 「点了白屏」只打 vue-router warning、「点了没反应」只打 Vue warning ⇒ **0-error 断言永远抓不到**，别只靠它。
- ⛔ 验证脚本的期望值也会写错：先确认「4xx 是业务响应还是真失败」；预置数据会改状态。
- ⛔ Playwright：`addInitScript` 的 fn 被序列化 ⇒ 闭包变量拿不到，字面量走参数。→ frontend-verify-discipline
