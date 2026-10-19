# 敏学项目长期约定

> 只留索引 + 硬规则。细节外链 `topics/`；过程见日期日志；产品原则见 `AGENTS.md`。

## 0. 产品与自决权
- 单用户系统：唯一用户 = 负责人（晚托班老师）。哲学「小而美」。
- A 级（行为保持型修复 / 死代码 / 顺手化 / 文档）+ 四道闸全过 → 可直接 push main。
- ⛔ 硬禁区（只提案）：DB/迁移、批改主流程、错题生命周期、重练组卷、掌握度、练习册质量闸、
  judgements、公共 API、任务状态机、判题正则。

## 1. 硬规则速查

### 数据与判据
- ⛔ 完整性唯一判据 `checkQuestionCompleteness()`；引擎输入 `parent_stem`+`content`+`options`
  逐字同构（漏前者→判缺条件；漏 options→字母答案被覆盖）。→ question-completeness
- ⛔ 配图只认 `geometry_image_url`；禁 `image_bbox`↔`block_coordinates` 互比判归属（假阳~28%）。→ bbox-contract
- ⛔ 几何显示唯一入口 `getGeometryDisplayUrl`；画图数值全来自题干；视觉框先目检再 apply。→ geometry-pipeline
- ⛔ 校验器只许加规则/测试、不得放宽；判分器两个解析函数不能单独改。→ answer-validators-and-judge
- ⛔ 参考答案位只显示 `q.answer`（禁 analysis 兜底）。→ answer-bank-trust
- ⛔ 错题「同一题」走 `questionIdentity.js`，禁相似度合并；变式题不进重练卷/组卷。
  重练卷答卷唯一口径 `retryPaperState.js#isRetryPaperTask`。→ wrongbook-gate-requeue
- ⛔ 任务「自愈」唯一实现 `pendingTaskRecovery.js#describeAutoRetry`；前端 `taskAutoRetry.js` 只翻译。→ task-self-healing
- ⛔ 补答案：同卷副本回填 > 文本链重跑 > 读图解题 > 转人工；错的答案比空答案糟。→ blank-answer-recovery
- ⛔ 判模型能否读图只能实测；AI 调用必关代理；离线脚本禁 `noBackup:true`。→ vision-vendors

### 复核口径（详见 topics/review-caliber.md）
- ⛔ 「待复核」唯一判据 `reviewDecision.js#getReviewState`；`reviewStore.mergeJudgements` 合并
  `/judgements/latest` **只许「有值才覆盖」**（`if (j && j.confidence != null)`），NULL 不得反向覆盖
  （否则「AI 判对」整片掉进待复核）。锁 `test/judgementConfidenceMerge.test.mjs`
- ⛔ 左栏「待处理」唯一判据 `reviewDecision.js#needsHumanAttention` = 6 态三态
  + `ai_answer_risk_reason` 非空且未人工复核；必须靠 `review_status` 收口。
  锁 `test/reviewAttentionCaliber.test.mjs`
- ⛔ 「待复核」两义不许混用：`summary.pendingReview` = 未读通知数；
  `summary.pendingReviewPapers` = 待人工复核卷数（唯一实现 `pendingReviewCaliber.js` / `pendingReviewService.js`）
- ⛔ 批改中心「待处理」= `isPendingReviewItem`，**不许**拿 `PENDING_REVIEW_WORKFLOW_STATUSES.has()`
  过列表（含 `'retry'`，会把待学生作答的重练卷列进来）。锁 `test/pendingReviewCaliber.test.mjs`
- ⛔ `review_status`(wrong/wrong_no_book) 与 `is_correct` 不得矛盾：判对必须解除错题标记并把
  `status='wrong'` 翻回 `'pending'`；`PUT` 只传 `review_status` 时按人工结论同步 `is_correct`。
  锁 `test/reviewConflictSync.test.mjs`
- ⛔ 「同档通道」不算降级：`isDegradedAnswerEngine` 与 `needsConsensusSampling` **故意不合并**。
  锁 `test/answerEngineTrustedChannel.test.mjs`
- ⛔ 错题入册两条互不设防的写操作（2026-10-15 排查确诊 + 已修，全库 47 条「我没做错过」）：
  「判对删除」（`gradingFinalizer.finalizeRejudgeResult`，`PUT /api/questions/:id` 调用时**不传
  `settlementKey`**）与「卷结算建行」既不原子、幂等键也不同源 ⇒ 老师刚判对的题 11 秒后被结算
  重新 INSERT 回错题本。**修法**：结算单题判定抽成纯函数
  `server/services/retrySettlementDecision.js#decideRetrySettlementItem`，
  加守卫「**答对 + 不在册 ⇒ skip**」；⛔ 不要改回无条件 INSERT。
  **不变量：任何入册路径的 `error_count` 必须 ≥ 1**（`error_count=0` 全库只有旧结算的 INSERT
  分支能写出，是识别该症状的唯一签名；其余 5 条入册路径都写死 1）。
  锁 `test/retrySettlementEnrollGuard.test.mjs`（穷举行为不变量 + 源码锁，已反向自检）；
  存量清理 `server/scripts/cleanup-zero-error-wrong-questions.mjs`（dry-run 默认，备份到
  `wrong_questions_backup_zeroerr_20261015`，已删 47 条）。→ `_错题归属排查-我没有错过-20261015.md`

### 错题闸门（详见 topics/wrong-gate-tier.md）
- ⛔ 闸1 分层 `wrongGateTier.js#classifyWrongGateItem` 只认机器 code，不得传中文 `issues`；
  欠账 LATERAL 只认带 `skipReason` 的 judgement。锁 `test/wrongGateCodesNotLabels.test.mjs` + `wrongGateTier`
- ⛔ 「待补入」清单每项必须当场可操作（`QuestionDetailPanel.vue#currentQIsGateDebt`）。
  锁 `test/gateDebtDecisionAffordance.test.mjs`
- ⛔ 周末班课件合并 `weekendHandout.js#buildCompleteQuestion` 分组键不含 `page_number`
  ⇒ 组内 ≥2 个不同非空 `parent_stem` 必须收窄

### 前端
- ⛔ 含 AI/长事务 POST 必须 `apiRequest(p,opts,1)`；错误体 `{error,message}`，前端读 `err?.payload?.message`。
  → long-request-and-error-surfacing
- ⛔ 白板：内容走 `MathRender`；激光笔不进 strokes，抬手 1s 渐隐；导出走离屏层；换题先落盘。→ board
- ⛔ 多根组件收不到 class ⇒ 定位类挂外层；工作台自己滚 ⇒ 看 `getBoundingClientRect().top`。→ data-pages
- ⛔ `v-memo` 行新增任何响应式依赖必须同步进 memo 数组（漏了=静默不更新）；
  需「失败即改样式」用 DOM 级 `classList.add`，别引入响应式状态
- ⛔ 列表缩略图唯一入口 `src/utils/ossThumb.js`（`?x-oss-process=image/resize,w_240`）；
  判「参数生不生效」**禁用 HEAD**，必须完整 GET 比字节数
- ⛔ 工作台独立入口 `workbench.html` + hash 路由（错题管理 = `:3000/workbench.html#/wrongbook`）
- ⛔ 重练卷复核定位框 = 答卷图按题切段实测；喂量框模型的题号必须用**卷面编号** `questionLabels`。
  锁 `test/retryPaperRefineBoxes.test.mjs`
- ⛔ 错题「班级卷」（PC `/wrongbook`）：只讲评不进批改链路；教师版唯一出口
  `exportWrongBookPDF({showAnswers:true,showAnalysis:true})`；组卷只走 `kp-questions`(`onlyWrong=1`)、
  排序差异在前端解决。锁 `test/wrongBookPaperBuilder.test.mjs`。→ `_错题管理扩展-产品评审-20261013.md` §十

### 代码与构建（详见 topics/build-and-dev.md）
- ⛔ `src/` 不许有不可达模块（`test/moduleReachability.test.mjs` 全量 BFS）；
  删死代码走归档惯例（先 `cp D:\Minxue_Archive\` 再 `git rm`）
- ⛔ 删「死代码」前分清「死声明」和「有副作用的调用」：`await saveFileToDevice(...)` 整行删掉
  ⇒ 文件从不保存。此类调用**必须消费返回值**。锁 `test/printPreviewDownload.test.mjs`
- ⛔ 门禁/体检脚本读固定产物文件必须先删旧 + 只认本轮（mtime ≥ startedAt）；
  ⛔ 别拿退出码判「跑成了没」。`scripts/patrol/lintReportKit.mjs` + `test/patrolLintFreshness.test.mjs`
- ⛔ 本机 Go 二进制（esbuild）放仓库目录内执行必崩 ⇒ 放仓库外 +
  `export ESBUILD_BINARY_PATH=C:/Users/Administrator/.workbuddy-ai/binaries/esbuild/esbuild.exe`
- ⛔ APK 打包链与「假成功坑」见 topics/build-and-dev.md §5；
  判「APK 是不是新的」必须比 `dist-app/assets/main-*.js` 与 APK 内同名文件 hash
- ⛔ 删仓库内 `dist_*` 目录：`find <dir> -type f -delete` 再 `find <dir> -depth -type d -exec rmdir {} \;`
- ⛔ Playwright `page.setContent()` origin 是 `null` ⇒ 跨域 `fetch()` 必被 CORS 拦；
  图片用 `<img>`+`naturalWidth`，字节数在 Node 侧量

### 本地服务与开机自启（详见 topics/local-services.md）
- ⛔ 入口首行 `import './loadEnv.js'`；后台起 `run_in_background` **不加 `&`**；`Edit` 报成功 ≠ 落盘
- ⛔ 后端 `:4000` + 前端 vite `:3000`（代理 `/api`→`:4000`）；Redis/Memurai 系统服务自启
- ⛔ 开机自启链 = 计划任务 `MinxueLocalServices`(AtLogOn) + Startup 文件夹兜底
  → `scripts\start-local-hidden.vbs` → `scripts\dev\keep_local_services.mjs`（15s 保活 + 首次健康后开浏览器）
- ⛔ 沙箱会回收子进程：前台命令里 `detached:true` 起的进程命令一结束就被杀；
  `wscript`/`cscript`/`schtasks` 均被安全策略拦 ⇒ 会话内长跑只走 `run_in_background`

## 2. 前端验证纪律
- ⛔ 源码级回归锁必须反向自检（旧版上判红；新锁可删除前先跑，无需导出旧版）
- ⛔ 源码锁**必须 fail-closed**：禁止 `if (idx >= 0 && !src.slice(...))` 这类短路守卫
  ⇒ 一律走 `test/sourceLockKit.mjs` 的 `anchoredSlice`/`anchoredRange`；
  元判据 `test/sourceLockFailClosed.test.mjs` 全量拦（规则 A/B/C）
- ⛔ SFC 解析器不得假定 `<template>` 在 `<script>` 之前；解析缺口必须报错，地板值要贴真实覆盖率
- ⛔ 「点了白屏/没反应」只打 Vue warning，0-error 断言抓不到 ⇒ 常驻入口锁
  `workbenchRouteTargets` + `workbenchClickHandlers`
- ⛔ 冒烟双闸门：构建 `MSYS_NO_PATHCONV=1 VITE_API_URL=/api vite build --outDir …`；
  preview 必带 `--outDir` 并 curl 验对象。→ frontend-verify-discipline
- ⛔ Playwright `addInitScript` 的 fn 被序列化 ⇒ 闭包变量拿不到，字面量走参数
