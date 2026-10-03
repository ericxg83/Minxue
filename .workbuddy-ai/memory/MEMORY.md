# 敏学项目长期约定

> 只留索引+硬规则。细节外链 `topics/`；过程见日期日志；产品原则见 `AGENTS.md`。

## 0. 产品与自决权
- 单用户系统：唯一用户 = 负责人（晚托班老师）；学生是数据主体。哲学「小而美」。
- A 级（行为保持型修复/死代码/顺手化/文档）+ 四道闸全过 → 可直接 push main。
- ⛔ 硬禁区（只提案）：DB/迁移、批改主流程、错题生命周期、重练组卷、掌握度、练习册质量闸、judgements、公共 API、任务状态机、判题正则。

## 1. 硬规则速查
- ⛔ 完整性唯一判据 `checkQuestionCompleteness()`；引擎输入 `parent_stem`+`content`+`options` 逐字同构（漏前者→判缺条件；漏 options→字母答案被覆盖成选项正文）。→ question-completeness
- ⛔ 配图只认 `geometry_image_url`；禁 `image_bbox`↔`block_coordinates` 互比判归属（假阳~28%）。→ bbox-contract
- ⛔ 判模型能否读图只能实测（`input_modalities` 撒谎）；AI 调用必关代理；离线脚本禁 `noBackup:true`。→ vision-vendors
- ⛔ 几何显示唯一入口 `getGeometryDisplayUrl`；画图数值全来自题干；视觉框非确定 ⇒ 先目检再 apply 复用同框；裁片好坏无确定判据。→ geometry-pipeline
- ⛔ 校验器只许加规则/测试、不得放宽；判分器两个解析函数不能单独改（补丁→全库对跑→只翻转可解释的 N 条）。→ answer-validators-and-judge
- ⛔ 参考答案位只显示 `q.answer`（禁 analysis 兜底）；「AI 自述缺条件」先查 `parent_stem` 非空。→ answer-bank-trust
- ⛔ 错题「同一题」走 `questionIdentity.js`，禁相似度合并；变式题不进重练卷/组卷。重练卷答卷唯一口径 `retryPaperState.js#isRetryPaperTask`；练习册 published 必经 `getWorksheetPublishRisk`。→ wrongbook-gate-requeue
- ⛔ 含 AI/长事务 POST 必须 `apiRequest(p,opts,1)`；错误体 `{error,message}`，前端读 `err?.payload?.message`。→ long-request-and-error-surfacing
- ⛔ 补答案优先级：同卷副本回填 > 文本链重跑 > 读图解题 > 转人工；错的答案比空答案更糟。→ blank-answer-recovery
- ⛔ 本地起服务：入口首行 `import './loadEnv.js'`；后台起 run_in_background 不加 `&`；`Edit` 报成功 ≠ 落盘，立刻 grep 复核。→ local-dev-process
- ⛔ 白板：内容必走 `MathRender`；激光笔不进 strokes，且无拖尾/抬手即消；导出走离屏层 + html2canvas（`Teleport to="body"`）；`saveStrokes()` 按 `current` 算键 ⇒ 换题先落盘旧题；板书永久占 localStorage（~55 题写满，r89 有清空入口）。→ board
- ⛔ 任务「自愈」唯一实现 `server/pendingTaskRecovery.js#describeAutoRetry`（照 SQL 判）；前端 `taskAutoRetry.js` 只翻译；缺 `auto_retry` 按「不自愈」。→ task-self-healing
- ⛔ 多根节点组件收不到 class ⇒ 定位类挂外层；工作台内容区自己滚 ⇒ 看 `getBoundingClientRect().top`。→ data-pages
- ⛔ src/ 不许有不可达模块（`test/moduleReachability.test.mjs` 全量 BFS）；删死代码走归档惯例（负责人 WIP 先 cp `D:\Minxue_Archive\` 再 git rm）。
- ⛔ 隔离产物冒烟 `vite preview` **必带 `--outDir`**（不带 = 服务陈旧 `dist/`，r94 踩实）；先 curl 新产物 asset 验对象（content-type 防 SPA 假 200）。→ frontend-verify-discipline

## 2. 前端验证纪律
- ⛔ 源码级回归锁必须反向自检（旧版上判红；新锁可删除前先跑，无需导出旧版）。
- ⛔ 「点了白屏/没反应」只打 Vue warning，0-error 断言抓不到 ⇒ 常驻入口锁 `workbenchRouteTargets`+`workbenchClickHandlers`。
- ⛔ Playwright：`addInitScript` 的 fn 被序列化 ⇒ 闭包变量拿不到，字面量走参数。
