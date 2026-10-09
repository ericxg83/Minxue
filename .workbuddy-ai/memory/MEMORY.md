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
- ⛔ 错题「同一题」走 `questionIdentity.js`，禁相似度合并；变式题不进重练卷/组卷。重练卷答卷唯一口径 `retryPaperState.js#isRetryPaperTask`；练习册 published 必经 `getWorksheetPublishRisk`。→ wrongbook-gate-requeue
- ⛔ 周末班课件多小问合并（`weekendHandout.js#buildCompleteQuestion`）分组键**不含 page_number** ⇒ 组内出现 ≥2 个不同非空 `parent_stem` 必须按错题行的 parent_stem 收窄（否则同一卷跨页题号撞车，把别题小问拼进来；r213 白板第1题）。
- ⛔ 含 AI/长事务 POST 必须 `apiRequest(p,opts,1)`；错误体 `{error,message}`，前端读 `err?.payload?.message`。→ long-request-and-error-surfacing
- ⛔ 补答案：同卷副本回填 > 文本链重跑 > 读图解题 > 转人工；错的答案比空答案糟。→ blank-answer-recovery
- ⛔ 本地起服务：入口首行 `import './loadEnv.js'`；后台起 run_in_background 不加 `&`；`Edit` 报成功 ≠ 落盘。→ local-dev-process
- ⛔ 白板：内容走 `MathRender`；激光笔不进 strokes，像笔写、抬手 1s 渐隐；导出走离屏层（`Teleport to="body"`）；`saveStrokes()` 按 `current` 算键 ⇒ 换题先落盘；板书占 localStorage（r89 有清空入口）。→ board
- ⛔ 任务「自愈」唯一实现 `server/pendingTaskRecovery.js#describeAutoRetry`（照 SQL 判）；前端 `taskAutoRetry.js` 只翻译；缺 `auto_retry` 按「不自愈」。→ task-self-healing
- ⛔ 「待复核」有两个语义，不许混用：`summary.pendingReview` = **未读通知数**（铃铛，点一次铃铛即归零）；`summary.pendingReviewPapers` = **待人工复核卷数**（首页 KPI / 侧栏徽标，口径 = 批改中心 chip，唯一实现 `src/workbench/utils/pendingReviewCaliber.js`，服务端 `pendingReviewService.js` 用同一份）。历史事故：首页 1 vs 批改中心 7。
- ⛔ 多根组件收不到 class ⇒ 定位类挂外层；工作台自己滚 ⇒ 看 `getBoundingClientRect().top`。→ data-pages
- ⛔ src/ 不许有不可达模块（`test/moduleReachability.test.mjs` 全量 BFS）；删死代码走归档惯例（负责人 WIP 先 cp `D:\Minxue_Archive\` 再 git rm）。
- ⛔ 批改/识别唯一在服务端（worker processSlimGrading）；前端禁直调 AI（noClientDirectAI 锁）；QuotaBanner 的 modelscope 是标签键不是调用。
- ⛔ 冒烟双闸门：构建 `MSYS_NO_PATHCONV=1 VITE_API_URL=/api vite build --outDir …`（防烤入生产 base/MSYS 改写）；preview 必带 --outDir 并 curl 验对象。→ frontend-verify-discipline
- ⛔ 门禁/体检脚本读「固定产物文件」（如 `tmp/prune-lint.json`）必须先删旧 + 只认本轮（mtime ≥ 本轮 startedAt）——这类文件跨 tick 持久，命令没写出报告（超时/配置错/二进制缺失）时旧报告会顶替 ⇒ 假 `lint=0`；⛔ 别拿退出码判「跑成了没」（eslint 有错误本来就 exit 1），能分出来的是「有没有写出新报告」。实现见 `scripts/patrol/lintReportKit.mjs` + 锁 `test/patrolLintFreshness.test.mjs`。
- ⛔ 任务/答卷图的列表缩略图唯一入口 `src/utils/ossThumb.js`（给 OSS URL 追加 `?x-oss-process=image/resize,w_240`，实测 0.4~1.3MB → 10~16KB，**零后端改动**）；列表行⛔ 禁引 `imageUrl` 原图。判「OSS 参数生不生效」**禁用 HEAD**（HEAD 不应用处理参数、返回原图长度 ⇒ 会误判「没生效」），必须完整 GET 比字节数；换桶/换域名跑 `server/scripts/probeOssThumb.mjs`。
- ⛔ `v-memo` 行上新增任何响应式依赖，必须同步进 memo 数组（漏了 = 静默不更新，不报错）；需要「失败即改样式」时用 DOM 级 `classList.add`，别引入响应式状态。
- ⛔ 本机 `esbuild` 偶发崩（`fatal error: winmm.dll not found`，**`--version` 即崩**）⇒ `vite build`/`vite dev` 全废，与 diff 无关。`npm rebuild esbuild`/换目录/跳出沙箱/改 TEMP 均无效。此时闸 3/闸 4 走替代路径（`node _check_sfc.mjs` 真编译 / `@vue/compiler-sfc` 编译后渲染函数断言 `$setup.xxx` 绑定 / 真浏览器单点验证），且**提交说明里必须写明闸 3/闸 4 未执行**。
- ⛔ Playwright `page.setContent()` 的页面 origin 是 `null` ⇒ 跨域 `fetch()` 必被 CORS 拦（验「图能否从 OSS 拉到」会全红假结论）。图片用 `<img>`+`naturalWidth`；字节数在 Node 侧量。

## 2. 前端验证纪律
- ⛔ 源码级回归锁必须反向自检（旧版上判红；新锁可删除前先跑，无需导出旧版）。
- ⛔ 源码锁**必须 fail-closed**：禁止 `if (idx >= 0 && !src.slice(...))` / `sliceVar.length > 0 &&` 这类短路守卫
  （锚点一改名锁就静默失效，等于改坏代码时顺手把锁关掉）⇒ 一律走 `test/sourceLockKit.mjs` 的
  `anchoredSlice`/`anchoredRange`；元判据 `test/sourceLockFailClosed.test.mjs` 全量拦（规则 A/B/C）。
- ⛔ SFC 解析器不得假定 `<template>` 在 `<script>` 之前（`<script setup>` 在前会被静默跳过）；
  解析缺口必须报错，且地板值要贴着真实覆盖率（r167 实测 57 个只扫 51 个仍判绿）。
- ⛔ 「点了白屏/没反应」只打 Vue warning，0-error 断言抓不到 ⇒ 常驻入口锁 `workbenchRouteTargets`+`workbenchClickHandlers`。
- ⛔ Playwright：`addInitScript` 的 fn 被序列化 ⇒ 闭包变量拿不到，字面量走参数。
