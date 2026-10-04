# 敏学App V3 - 开发日志

滚动记录已落地的改动与后续待办。新条目放最上面。
---

## 2026-10-04 · r137 下线「班级备课」与「我的讲义」（负责人裁决：伪需求，不开发了）

**口径**：这两个入口基本用不上，按「小而美、能删就删」原则整链拆除，不做重构、不留半截。

**删除范围**

- 学习诊断页（`src/workbench/views/WeeklyReportWorkbench.vue`）：`viewMode` 分段器、「班级备课」年级视图（年级备课建议卡 + 年级错题卷清单 + 知识点下钻抽屉 + 底部「备课操作」输出条）与全部配套 state/方法/样式；页面只剩单生学习诊断（家长反馈）一条主线。
- 讲义页：`HandoutList.vue`（/handouts）、`HandoutPreview.vue`（/handout）整文件删除；侧栏入口、顶栏面包屑同步摘除。
- 后端：`routes/handout.js`、`routes/handoutLecture.js`、`services/handout{,Docx,Script,Diagnosis,ByKnowledge}Service.js`、`services/handoutTemplates/*`、`services/wrongPaper{,Docx}Service.js` 删除；`server/index.js` 摘掉两处 `/api/handout` 挂载。
- 端点：`/api/teaching/{diagnosis,diagnosis/:tag,grades,grade-suggestions,wrong-paper}` 下线（`/error-types`、`/student-suggestions` 保留）；`/api/teaching-question-types/auto-handout` 下线（题型库只留自动整理/确认/代表题快照）。
- 前端封装：`apiService` 的 `getTeachingDiagnosis`、`getTeachingDiagnosisDetail`、`getTeachingWrongPaper`、`exportWrongPaper` 删除（零调用方）。
- 配套死文件：`src/workbench/components/diagnosis/ParentOutputCard.vue` 同轮删除（他轮改动删掉「发给家长」卡后遗留的死文件，负责人裁决直接删，不重建）。
- 路由 `/handouts`、`/handout`、`/handout/:id` 留 redirect 到 `/weekend-ppt`，遵「页面下线 ≠ 老书签 404」既有约定。

**没动的东西（刻意的）**

- 数据库：`handout_lectures` / `handout_lecture_notes` / `handout_lecture_templates` 三表**不删不清**，迁移 `045` 与 `migrateHandoutLectures` 注册保留 —— 只断读写侧，符合「未确认不改 Schema」红线。
- 周末班课件链（`server/lib/weekendHandout.js`、`routes/weekendHandout.js`、`weekendPptxService.js`、`WeekendHandout.vue`、`WeekendBoard.vue`）与讲义子系统同名不同物，零改动 —— 它现在是老师侧唯一的「讲题」出口。
- 单生「本周备课建议（按 KP）」卡与 `/api/teaching/student-suggestions` 保留（属单生诊断输出，不是班级备课）。

**验证（四道闸）**

- Lint：本轮涉及文件 0 error（`.vue` 不在 eslint 覆盖内，另用 `@vue/compiler-sfc` 实编译，template/script 均 0 error）。
- 单测：**1668 / 1668 全绿**（本轮相关 7 把锁均绿：`dataPageMerge`、`workbenchClickHandlers`、`workbenchSilentFailure`、`workbenchApiBase`、`moduleReachability`、`teachingMarks`、`blockBoxTrust`）。
- 静态 import 图：从 `server/index.js`/`worker.js`/`geometryWorker.js`/前端入口递归解析 287 个文件，断链 0。
- 隔离构建：`BUILD_OUTDIR=dist_r137` 通过（删 ParentOutputCard 后重跑仍绿）；构建额外把 `VITE_API_URL` 烘成 `/api`，避免冒烟产物指向 Render 生产 API；产物内「我的讲义/班级备课/生成周末讲义初稿/导出全班讲义卷/本周错题卷清单/api/handout/备课操作」8 个特征串全部 0 命中，`WeekendHandout`/`WeekendBoard` chunk 完好。
- 浏览器冒烟：**全绿**。`_r137_preview_server.mjs`（静态托管 dist_r137 + `/api` 反代本地 :4000，独占端口 5260；跑完已关闭）+ `_r137_smoke.mjs` 五路由 0/5 异常：学习诊断正常渲染（正文 1358 字、零 console error、零 4xx），`/handouts`、`/handout`、`/handout/:id` 三条老书签全部 redirect 到 `#/weekend-ppt` 不白屏；`_r137_smoke2.mjs` 单生主链路（点学生 → 走势/错因/下一步→ 周期周切月 → 页头导出按钮与成长卡入口）0 问题。截图：`_r137_smoke_weekly.png`、`_r137_smoke_redirect_handouts.png`、`_r137_smoke_student.png`。
- 同步更新的锁：`dataPageMerge`（成长卡外层类名 + 输出条口径）、`workbenchClickHandlers`（SFC 地板 52→50）、`workbenchSilentFailure`（摘掉讲义页两条规则）。

**遗留风险 / 待拍板**

1. 本轮**未提交**（负责人指令）：工作区还压着他模型 in-flight 改动（`MobilePrimitives.jsx`、`QuestionDetailPanel.vue`、`performance.js`、`test/reviewExcludeNoUndo.test.mjs`，以及 `WeeklyReportWorkbench.vue` 里他们的未验证部分），同文件并发，一 commit 会连带他们的在飞内容。
2. 未对 `/question-bank` 做浏览器冒烟：该页 `onMounted` 会 POST `/auto-organize` 写库，冒烟不该顺手写生产数据；它的按钮删除已用产物特征串 0 命中静态验证。
3. 若日后要恢复讲义：服务层已清空，需重建；表结构仍在，不会丢历史讲义数据。
4. 环保险：本轮新增的临时脚本/产物（`_r137_*`、`dist_r137/`）均已被 .gitignore 排除，不入库。


## 2026-08-28 · 移动端"作业"列表批改结果展示

**改动**：作业列表行摘要由 `6/15 需要关注` 改为 `共15题 · 错6 · 空2`。
- 错用 danger 色、空用 warning 色；计数为 0 的项不显示（纯空卷显示"共22题 · 空2"而非"错0"）。
- 无错无空保留正向文案 `N 道题全部正确`；`ocrTruncated` 保留 `· 可能有漏题` 降级。

**文件**：[src/pages/ProcessingPageV2.jsx](src/pages/ProcessingPageV2.jsx)（新增 `ResultSummary` 组件，读取已下发的 `task.result.emptyCount`）。

**范围**：纯展示层。数据早已落库并随 `/api/tasks/student/:id` 的 `result` JSONB 下发（[server/worker.js:5602](server/worker.js:5602)），未动后端/schema/判题。

**验证**：本地 backend+frontend，test 学生 36 条真实任务，覆盖 有错无空 / 有错有空 / 纯空 / 全部正确 四类，配色与文案正确。

---

## 待办 · 后期需要展示"对题数"（correctCount）

当前列表页刻意**不显示对题数**：`result` 只有 `questionCount / wrongCount / emptyCount`，没有 `correctCount`；若前端用 `总数−错−空` 相减会把两类误算成"对"：
1. 非空但 `is_correct === null` 的无法判定题（答案库无此题等，[server/worker.js:4793](server/worker.js:4793)）→ 静默进"对"。
2. 复核把一道 blank 题改判为 `wrong` 时，`recalculate-stats` 里 `wrongCount` 与 `emptyCount` **同时命中同一行**（[server/index.js:655-659](server/index.js:655)）→ 双重计数，"对"被压低甚至为负。

**正确做法（进入详情页/成长中心时）**：在 `result` 与 `recalculate-stats` 新增权威 `correctCount`，与 wrong/empty 同源同点维护，前端只读不派生。
- 定义建议：`review_status === 'correct'` 或 `is_correct === true` 且 `answer_source !== 'blank'` 且 `review_status !== 'exclude'`。
- 复核回写路径已确认会重算 empty（[recalculate-stats](server/index.js:641)），新增 correct 时一并纳入，保持三者口径一致。
- 改 `result` JSONB 结构需考虑历史数据兼容（旧任务无 correctCount，前端需回退或触发重算）。
