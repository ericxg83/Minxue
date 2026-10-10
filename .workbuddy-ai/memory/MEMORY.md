# 敏学项目长期约定

> 只留索引+硬规则。细节外链 `topics/`；过程见日期日志；产品原则见 `AGENTS.md`。

## 0. 产品与自决权
- 单用户系统：唯一用户 = 负责人（晚托班老师）。哲学「小而美」。
- A 级（行为保持型修复/死代码/顺手化/文档）+ 四道闸全过 → 可直接 push main。
- ⛔ 硬禁区（只提案）：DB/迁移、批改主流程、错题生命周期、重练组卷、掌握度、练习册质量闸、judgements、公共 API、任务状态机、判题正则。

## 1. 硬规则速查
- ⛔ 完整性唯一判据 `checkQuestionCompleteness()`；引擎输入 `parent_stem`+`content`+`options` 逐字同构（漏前者→判缺条件；漏 options→字母答案被覆盖）。→ question-completeness
- ⛔ 配图只认 `geometry_image_url`；禁 `image_bbox`↔`block_coordinates` 互比判归属（假阳~28%）。→ bbox-contract
- ⛔ 判模型能否读图只能实测；AI 调用必关代理；离线脚本禁 `noBackup:true`。→ vision-vendors
- ⛔ 几何显示唯一入口 `getGeometryDisplayUrl`；画图数值全来自题干；视觉框先目检再 apply；裁片无确定判据。→ geometry-pipeline
- ⛔ 校验器只许加规则/测试、不得放宽；判分器两个解析函数不能单独改（补丁→全库对跑→只翻转可解释的 N 条）。→ answer-validators-and-judge
- ⛔ 参考答案位只显示 `q.answer`（禁 analysis 兜底）；「AI 自述缺条件」先查 `parent_stem` 非空。→ answer-bank-trust
- ⛔ 复核页「待复核」唯一判据 `src/utils/reviewDecision.js#getReviewState`（`is_correct===true && (review_status || confidence>=0.5)`）。
  `judgements` 是审计流水、**只许提供 confidence**；人工类流水（`manual_review`/`pc_edit`/`pc_rejudge`/`regrade_script`/`workbook_to_ai_regrade`）confidence 恒为 NULL
  ⇒ 合并**只许「有值才覆盖」**（`if (j && j.confidence != null)`），NULL 不得反向覆盖题目自带置信度，否则「AI判对」整片掉进「待复核」（r2026-10-09 全库 41 条）。
  锁 `test/judgementConfidenceMerge.test.mjs`。→ answer-validators-and-judge §5
- ⛔ 复核页左栏「待处理」页签 / 顶部「需处理 N」/ 移动端 `useExamReview` 的 `needsAttentionCount` 唯一判据
  `reviewDecision.js#needsHumanAttention` = 6 态三态（pending/exception/processing）**+ `ai_answer_risk_reason` 非空且未人工复核**
  （AI 判错/判对但参考答案存疑，负责人 2026-10-10 要求也进待处理；列表行配 `.item-answer-risk`「⚠ 参考答案」小签）。
  ⛔ 必须靠 `review_status` 收口：后端只在「人工改写参考答案」时清该列（`PUT /api/questions/:id` 的 `answerRewritten`），
  老师点判错/判对确认结论时该列**仍留着** ⇒ 不看 review_status 会永远卡在待处理里清不掉。锁 `test/reviewAttentionCaliber.test.mjs`。
- ⛔ 「同档通道」不算降级（2026-10-10 负责人要求）：实测与主模型**并列满分**的答案通道
  （默认 `ANSWER_ENGINE_TRUSTED` = `Bailian:qwen3.8-flash` / `SenseNova:glm-5.2` / `SenseNova:deepseek-v4-pro`，
  横评依据 `_答案引擎模型选型-全量汇总-20261010.md`）产出的答案**不得**写
  「参考答案由降级通道 X 生成（主模型不可用），建议核对」—— 那是环境噪音，不是答案错。
  ⛔ 两个闸**故意不合并**：`isDegradedAnswerEngine`（要不要提醒老师核对，同档豁免）与
  `needsConsensusSampling`（要不要多路投票，同档**照旧投票** —— Bailian 自己的三路采样也会分歧，
  全库 39 条留痕，那是唯一能自动发现「参考答案算错」的信号）。锁 `test/answerEngineTrustedChannel.test.mjs`。
  弱通道（fallback-text-chain / Huihuiyun / BigModel glm-4.7-flash / sensenova-6.8-lite）判据不变。
- ⛔ 「错题标记」`review_status`（wrong/wrong_no_book）与判定 `is_correct` **不得并存矛盾**（2026-10-10 负责人裁定「严重 BUG」）：
  重练结算判对（`gradingFinalizer.finalizeGeneratedExamResults`）、人工改判为对（`finalizeRejudgeResult` 的 `$5=manualOverride`，
  **AI 自动重解析 manualOverride=false 不得推翻人工结论**）、`PUT /api/questions/:id` 改判为对
  → 必须解除错题标记（`→NULL::text`）**并**把 `status='wrong'` 翻回 `'pending'`；
  `PUT` **只传 `review_status`** 时必须按人工结论同步 `is_correct`（PC 端 `apiService.updateQuestionReviewStatus` 只传一个，
  移动端 `handleSetReviewAction` 传两个 —— 这是全库 31 条矛盾的根因）。`exclude` 是软删除，不动 `is_correct`。
  锁 `test/reviewConflictSync.test.mjs`；存量收口口径 =「以最近一条 judgement 的结论为准」。
- ⛔ 批改页「待复核」= `confidence` 空或 <0.5，**与答案对不对无关**；`reviewStore.mergeJudgements` 会拿 `/judgements/latest`（每道题最新一条、不过滤 source）**无条件覆盖** `q.confidence`，而结算/重判/人工编辑写的流水（`manual_review`/`regrade_script`/`pc_rejudge`…）`confidence` 恒为 null 且永远更新 ⇒ AI 判对的题被显示成待复核（2026-10-09 数学-1008-01 卷 9 题；全库 41 条）。复现：`server/_diag_repro_pending.mjs`。→ caliber-drift
- ⛔ 错题「同一题」走 `questionIdentity.js`，禁相似度合并；变式题不进重练卷/组卷。重练卷答卷唯一口径 `retryPaperState.js#isRetryPaperTask`；练习册 published 必经 `getWorksheetPublishRisk`。→ wrongbook-gate-requeue
- ⛔ 周末班课件多小问合并（`weekendHandout.js#buildCompleteQuestion`）分组键**不含 page_number** ⇒ 组内出现 ≥2 个不同非空 `parent_stem` 必须按错题行的 parent_stem 收窄（否则同一卷跨页题号撞车，把别题小问拼进来；r213 白板第1题）。
- ⛔ 含 AI/长事务 POST 必须 `apiRequest(p,opts,1)`；错误体 `{error,message}`，前端读 `err?.payload?.message`。→ long-request-and-error-surfacing
- ⛔ 补答案：同卷副本回填 > 文本链重跑 > 读图解题 > 转人工；错的答案比空答案糟。→ blank-answer-recovery
- ⛔ 本地起服务：入口首行 `import './loadEnv.js'`；后台起 run_in_background 不加 `&`；`Edit` 报成功 ≠ 落盘。→ local-dev-process
- ⛔ 白板：内容走 `MathRender`；激光笔不进 strokes，像笔写、抬手 1s 渐隐；导出走离屏层（`Teleport to="body"`）；`saveStrokes()` 按 `current` 算键 ⇒ 换题先落盘；板书占 localStorage（r89 有清空入口）。→ board
- ⛔ 任务「自愈」唯一实现 `server/pendingTaskRecovery.js#describeAutoRetry`（照 SQL 判）；前端 `taskAutoRetry.js` 只翻译；缺 `auto_retry` 按「不自愈」。→ task-self-healing
- ⛔ 「待复核」有两个语义，不许混用：`summary.pendingReview` = **未读通知数**（铃铛，点一次铃铛即归零）；`summary.pendingReviewPapers` = **待人工复核卷数**（首页 KPI / 侧栏徽标，口径 = 批改中心 chip，唯一实现 `src/workbench/utils/pendingReviewCaliber.js`，服务端 `pendingReviewService.js` 用同一份）。历史事故：首页 1 vs 批改中心 7。
- ⛔ 批改中心「待处理」= `isPendingReviewItem`（与「待人工复核」chip 同一判据），**不许**再拿 `PENDING_REVIEW_WORKFLOW_STATUSES.has()` 直接过列表 —— 该集合含 `'retry'`，会把「已布置·待学生作答」的重练卷列进待处理（chip 写 0、列表 10 条，2026-10-09 负责人截图）。未交卷重练卷只在「待学生作答」tab /「重练已布置」chip 可见；其右侧摘要「错题」必须显示「—」（原数字来自原作业题目行旧判定）。锁 `test/pendingReviewCaliber.test.mjs`。
- ⛔ 多根组件收不到 class ⇒ 定位类挂外层；工作台自己滚 ⇒ 看 `getBoundingClientRect().top`。→ data-pages
- ⛔ src/ 不许有不可达模块（`test/moduleReachability.test.mjs` 全量 BFS）；删死代码走归档惯例（负责人 WIP 先 cp `D:\Minxue_Archive\` 再 git rm）。
- ⛔ 批改/识别唯一在服务端（worker processSlimGrading）；前端禁直调 AI（noClientDirectAI 锁）；QuotaBanner 的 modelscope 是标签键不是调用。
- ⛔ 冒烟双闸门：构建 `MSYS_NO_PATHCONV=1 VITE_API_URL=/api vite build --outDir …`（防烤入生产 base/MSYS 改写）；preview 必带 --outDir 并 curl 验对象。→ frontend-verify-discipline
- ⛔ 门禁/体检脚本读「固定产物文件」（如 `tmp/prune-lint.json`）必须先删旧 + 只认本轮（mtime ≥ 本轮 startedAt）——这类文件跨 tick 持久，命令没写出报告（超时/配置错/二进制缺失）时旧报告会顶替 ⇒ 假 `lint=0`；⛔ 别拿退出码判「跑成了没」（eslint 有错误本来就 exit 1），能分出来的是「有没有写出新报告」。实现见 `scripts/patrol/lintReportKit.mjs` + 锁 `test/patrolLintFreshness.test.mjs`。
- ⛔ 任务/答卷图的列表缩略图唯一入口 `src/utils/ossThumb.js`（给 OSS URL 追加 `?x-oss-process=image/resize,w_240`，实测 0.4~1.3MB → 10~16KB，**零后端改动**）；列表行⛔ 禁引 `imageUrl` 原图。判「OSS 参数生不生效」**禁用 HEAD**（HEAD 不应用处理参数、返回原图长度 ⇒ 会误判「没生效」），必须完整 GET 比字节数；换桶/换域名跑 `server/scripts/probeOssThumb.mjs`。
- ⛔ `v-memo` 行上新增任何响应式依赖，必须同步进 memo 数组（漏了 = 静默不更新，不报错）；需要「失败即改样式」时用 DOM 级 `classList.add`，别引入响应式状态。
- ⛔ 本机 Go 二进制（`esbuild` 等）**放在仓库目录 `D:/Minxue_App_V3/` 内执行必崩**（`fatal error: winmm.dll not found` + `runtime: panic before malloc heap initialized`）；**同一份二进制（哈希相同）放到仓库外就能跑**（实测 `D:/_esbprobe/`、`C:/Users/Administrator/`、`/tmp` 均正常）。与 cwd、沙箱开关、TEMP、esbuild 版本（0.19.12/0.20.2/0.21.0/0.21.5 全试）**都无关**，根因疑似 EDR/令牌按目录拦截，未查清。
  **正解（2026-10-08 实测，此前"无解只能等重启"的结论作废）**：二进制放仓库外，用环境变量指过去——
  `export ESBUILD_BINARY_PATH=C:/Users/Administrator/.workbuddy-ai/binaries/esbuild/esbuild.exe`，
  再跑 `vite build` / `vite dev` / `node scripts/build-app.mjs` 即正常（JS 侧仍是 `node_modules/esbuild@0.21.5`，版本握手一致，无需改 package.json）。⛔ 别再 `npm rebuild esbuild`／换版本／换 TEMP。
  极端兜底：闸 3/闸 4 走替代路径（`node _check_sfc.mjs` 真编译 / `@vue/compiler-sfc` 编译后渲染函数断言 / 真浏览器单点验证），且提交说明里写明闸 3/闸 4 未执行。
- ⛔ APK 打包链：`export ESBUILD_BINARY_PATH=<仓库外 esbuild>` → `node scripts/build-app.mjs`（`BUILD_TARGET=app`→`dist-app`）→ `CODEBUDDY_SAFE_DELETE_ENABLED=0 npx cap sync android` → `cd android && ./gradlew assembleDebug`。`android/` 在 `.gitignore` 里但**关键文件仍被跟踪** ⇒ 改 `android/app/build.gradle`、`android/gradle.properties` 要 `git add -f`。⛔ `android/gradle.properties` 里**不得**写死 `-javaagent`（曾指向已归档的 `agent/pipefix-agent.jar`，会让 gradle 启动直接失败；该 Windows 绝对路径在 CI(ubuntu) 上必崩）。CI `.github/workflows/build-apk.yml` 跑的是 `npm run build`（输出 `dist/`）而 `webDir=dist-app` ⇒ **CI 打 APK 一直是坏的**，别指望它。
- ⛔ Playwright `page.setContent()` 的页面 origin 是 `null` ⇒ 跨域 `fetch()` 必被 CORS 拦（验「图能否从 OSS 拉到」会全红假结论）。图片用 `<img>`+`naturalWidth`；字节数在 Node 侧量。
- ⛔ 重练卷（paper）复核页定位框 = 答卷图**按题切段实测**（`refine-boxes` 带 `questionIds`；重练卷题目挂在原作业 task 上，按 `task_id` 查必然为空）。`task.result.retryAlign` 只是**兜底**（它存的是答卷 OCR 答案行坐标，选择题答案在题干括号里 ⇒ 整体偏移）。
  ⛔ **喂给量框模型的题号必须用「重练卷卷面编号」**（`questionLabels`，与 `questionIds` 同序），不能用题目自带的原作业题号 —— 实测该卷原题号 4,1,3,7,5,5,7,9,4,11,10 vs 卷面 1,2,3,4(2),5(5)…，喂原题号会让模型按原题号找行、**切段整体错位**（同页两次调用 y 差 30~180，一次准一次不准）；换卷面编号后连测两次差值 ≤8。锁：`test/retryPaperRefineBoxes.test.mjs`。

## 2. 前端验证纪律
- ⛔ 源码级回归锁必须反向自检（旧版上判红；新锁可删除前先跑，无需导出旧版）。
- ⛔ 源码锁**必须 fail-closed**：禁止 `if (idx >= 0 && !src.slice(...))` / `sliceVar.length > 0 &&` 这类短路守卫
  （锚点一改名锁就静默失效，等于改坏代码时顺手把锁关掉）⇒ 一律走 `test/sourceLockKit.mjs` 的
  `anchoredSlice`/`anchoredRange`；元判据 `test/sourceLockFailClosed.test.mjs` 全量拦（规则 A/B/C）。
- ⛔ SFC 解析器不得假定 `<template>` 在 `<script>` 之前（`<script setup>` 在前会被静默跳过）；
  解析缺口必须报错，且地板值要贴着真实覆盖率（r167 实测 57 个只扫 51 个仍判绿）。
- ⛔ 「点了白屏/没反应」只打 Vue warning，0-error 断言抓不到 ⇒ 常驻入口锁 `workbenchRouteTargets`+`workbenchClickHandlers`。
- ⛔ Playwright：`addInitScript` 的 fn 被序列化 ⇒ 闭包变量拿不到，字面量走参数。
