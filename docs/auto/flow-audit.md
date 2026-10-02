# 全系统流程地图（小而美审计）· 持续维护

> 目的（负责人 2026-10-02 指令）：理解整个系统 → 优化每个流程的顺手度 → UI/UX 特别好看 → 找出可删除/合并的功能。系统定位：**个人使用，小而美**。

## 一、页面与流程地图（教师工作台）

| 入口 | 页面 | 状态 | 初步观察 |
|---|---|---|---|
| 工作台 | DashboardWorkbench | 在用 | 今日概览：待复核/新增错题/待消化/趋势/待关注学生 |
| 批改中心 | GradeCenterWorkbench | 高频核心 | 复核减负已做过三轮优化（自动放行/撤销/命令面板） |
| 学习诊断 | WeeklyReportWorkbench | 在用 | 周报 PDF（服务端 Playwright 出图） |
| 成长中心 | GrowthWorkbench | 在用 | 渲染炸弹已根治（第 17 轮）；假数据/假趋势已清（第 18、35 轮）；重复导出按钮已删（提案 5） |
| 错题中心 | WrongBookCenterRedesign | 高频核心 | 两处学生加载经核实为互斥分支（健康，第 28 轮） |
| 学生管理 | StudentsWorkbench | 在用 | — |
| 练习册管理 | worksheets | 在用 | 答案质量闸重点区 |
| 试卷答案库 | paper | ? | 使用频率待负责人确认 |
| 我的讲义 | handouts | 在用 | 讲义生成链 |
| 周末班课件 | weekend-ppt | 在用 | 白板/课件链 |
| 我的题型库 | question-bank | ? | 使用频率待负责人确认 |

## 一之二、移动端流程地图（src/，React，负责人晚托班现场操作）

> 入口全在 `src/App.jsx`（1335 行单文件容器）：底部 4 个 tab + 一组 `show*` 状态驱动的弹层/全屏覆盖。第 40 轮实证清点。

| 层级 | 视图 | 进入方式 | 观察 |
|---|---|---|---|
| Tab 1 | 首页 HomeDashboard | 默认页 / tab | 上传、优先重练、任务处置的总入口 |
| Tab 2 | 作业 ProcessingPageV2 | tab / 首页「查看作业」/ 通知面板 | 看批改结果、进复审 |
| Tab 3 | 错题本 WrongBookPageV2 | tab / 首页 / 组卷页 | 状态分段 + 科目 chip 筛选、多选加入重练 |
| Tab 4 | 组卷历史 ExamPageV2 | tab | 重印、上传答案 |
| 弹层 | UploadOptionsModal | 首页「开始上传」 | 三张卡：作业 / 普通 / 错题重练 |
| 弹层 | StagingModal | 选完上传类型 | 拍照 + 相册多选暂存 |
| 弹层 | WorksheetPicker | 上传流程内 | 选练习册，含「不使用练习册」 |
| 全屏 | ScanQR → Grading | 顶栏扫码 → 扫码成功 | 扫码批改链 |
| 全屏 | ExamReview | 作业页「查看批改」 | 复审 + 保存后重算统计 |
| 全屏 | PrintPreview | 错题本生成重练 / 组卷历史重印 | 两处复用同一组件 |
| 路由 | RetryTask | 深链 `/retry-task/:id` | 错题重练答题，无 tab 栏 |
| 弹层 | LearningReportPanel(WeeklyReport) | 顶栏报告入口 | 周报查看 |
| 弹层 | StudentSwitcher | 顶栏学生名 | 切学生，数据按学生隔离缓存 |

核心链条（拍作业 → 出结果）：**首页 → 开始上传 → 三卡选择 → 暂存区拍照 → （选练习册）→ 提交 → 作业 tab → 查看批改**，共 5-6 步。

## 二、粗糙点清单（持续补充）

已关闭（保留索引，防止回退）：

1. ~~成长中心渲染炸弹（下拉空态）~~ —— 第 17 轮根治（store 未导出 wrongQuestions）
2. ~~成长中心时间范围硬编码旧日期~~ —— 第 18 轮清除
3. ~~空 catch 吞错~~ —— 第 25、34 轮：移动端与状态接口全部补齐意图注释
4. ~~el-select 全站行为不一致~~ —— 随 store 修复关闭；第 27 轮 store 契约审计 0 处同类哑弹

在案（新增于第 40 轮）：

5. **上传主流程弹层偏深**：从首页到相机要过 UploadOptionsModal → StagingModal（中途还可能插 WorksheetPicker）。最常走的那一条若能一键直达，每天几十次操作各少一步（B 级方案见「与你讨论」）。
6. **`server/index.js:4740` createServer 用 async Promise executor**：`getTaskQueue()` 抛错时外层 promise 永不 settle——启动期依赖故障表现为**无声挂死**（不报错、不退出、端口不监听）。属启动失败语义变更，未擅自修，见提案 7。
7. **V2 命名残留**：`ExamPageV2` / `ProcessingPageV2` / `WrongBookPageV2` 的 V1 均已不在（第 40 轮归档最后一个），后缀已无对照对象，读代码时要多绕一层。纯改名整理，见提案 8。
8. **移动端切页重复请求**：浏览器实测单次切 tab，`/api/tasks/summary`、`/api/generated-exams/*`、`/api/wrong-questions/*` 会出现 2-3 次重复 fetch（均 304 缓存命中，不致错但耗流量与时间）。需先分清楚哪些是「缓存优先 + 后台刷新」的有意双加载（第 28 轮已证实错题中心属此类），剩下的才是真重复，故只记录不擅改。

## 三、可删/合并候选（全部待负责人确认，绝不擅删）

0. ~~移动端 `src/pages/WrongBookPage.jsx`（V1 错题本）~~ —— **第 40 轮已归档**：无任何 import 的孤儿页（V2 已接管），移到 `D:\Minxue_Archive\auto-20261002\`，并由 `test/mobilePageReachability.test.mjs` 永久看守（见第十二节）。V2 相比 V1 少了「标签筛选」（多了日期筛选），若需补回标签筛选请开口，否则视为无需处理。
1. **三个数据分析页重叠度**：学习诊断 / 成长中心 / 错题中心都做"学生×错题×掌握度"分析——第 21 轮已实证：页面无需合并，唯一重复物（成长中心导出按钮）已删。
2. **试卷答案库 / 我的题型库**：使用频率待负责人确认，低频则考虑收纳进二级入口
3. **移动端页面使用频率**：现确认底部只有 4 个 tab（首页/作业/错题本/组卷历史），其余 8 个视图均为弹层或深链。**待确认**：组卷历史 tab、周报弹层、上传三卡中的「普通」支路实际使用频率——低频则收纳或删（见提案 9）。
4. **上传选册两套 flow 并存**：`App.jsx:1140-1160` 同一个 `onSelect` 里按 `homeworkChoiceRef` 长度分叉成新旧两条链，读与改都容易错。待确认哪条已死，死则删（提案 10）。

## 四、已完成的顺手化/美化

- 2026-10-01：色值归一（6灰→3档、双主色归一）、死按钮接线、成长中心补导航入口、z-index 层级约定

## 五、可删候选实证（2026-10-02 13:4x 轮）

**提案 5：移除成长中心的「导出报告」按钮（删重复，等确认）**
- 三个分析页功能面清点：学习诊断 = 周报聚合+教学诊断+错题重卷+PDF 导出（最全）；成长中心 = 概览 KPI+图表+薄弱点推荐+家长成长卡+**周报 PDF 导出（昨日接入，与学习诊断同源重复）**；错题中心 = 操作台（独立，不重叠）。
- 结论：页面无需合并（各自聚焦：诊断深报告 / 成长概览 / 错题操作），**唯一重复物 = 成长中心的导出按钮**。
- 建议：移除该按钮（约 20 行），入口归一——深度报告去「学习诊断」，家长卡留「成长中心」。

## 六、lint 信号质量发现（2026-10-02 14:30 轮）

**提案 6：eslint 配置补 react/jsx-uses-vars（消除 JSX 导入误报，等确认）**
- 移动端 265 处"未使用变量"警告中，抽验发现大量**假阳性**：`Suspense` 判未使用但 JSX 中使用 14 次、`Loader2`/`X` 等同理——eslint.config.js 缺少 react 插件的 jsx-uses-vars 规则，所有「JSX 中使用的导入」被系统性误报。
- 影响：移动端 lint 信号被噪声污染（595 警告中相当比例是假的），真死代码反而被淹没。
- 方案：eslint.config.js 补一条规则 `'react/jsx-uses-vars': 'error'`（这是**让 linter 更准确**，不是放宽门禁；误报消除后真死代码才浮得出水面）。属修改 eslint 配置 = C 级禁区，故必须负责人批准。
- 批准后执行：改配置 + 重跑全量 lint + 重新生成真实死变量清单（提案 5 同轮可做真实清理）。

## 七、store 契约审计（2026-10-02 16:30 轮）

- 工具化：`scripts/auditStoreContract.mjs`（npx node scripts/auditStoreContract.mjs 随时可跑）——扫描全部 views/components 对 store 未暴露字段的读取。
- 首轮结果：**0 处同类哑弹**（成长炸弹系孤例）。残留风险由全局 errorHandler 兜底（任何渲染抛错现在都会弹窗可见）。
- 粗糙点 #4 正式关闭。

## 八、错题中心双加载待审项关闭（2026-10-02 17:00 轮）

- WrongBookCenterRedesign.vue 两处 getStudents 为**互斥分支**（嵌入模式 return / 独立模式），非重复请求；watch 兜底嵌入态切换；失败有可见报错。**判定：健康，无需改动。**

## 九、提案 5/6 落地（2026-10-02）

- 提案 5 ✅：成长中心导出按钮移除（入口归一）。
- 提案 6 ✅：eslint jsx-uses-vars 补齐，移动端假阳性 -211 条，lint 信号从「响而噪」变为「少而可信」。
- 真实死代码清理战役（基于干净信号）列为后续轮次的小而美批次。

## 十、第 40 轮：lint error 诚实化批次（行为零变更）

error 22 → 15，全部逐处读过，无一放宽规则：

- **5 处空 catch 补意图注释**（消除 no-empty ×5）：`e2e/capture-real-questions.cjs`（单个 checkbox 点不动不中断整批）、`server/fixExistingAnswers.js`（分析文本顺带保存，失败仍推批次）、`server/index.js`（文件名解码尽力而为，不阻断上传）、`server/redisManager.js`（关机阶段 quit 失败无可救）、`server/services/handoutScriptService.js`（二次抢救失败转本地兜底脚本）。顺带把三个无用的 `catch (e)`/`catch (_)` 绑定去掉，减 3 条 no-unused-vars。
- **2 处 `fn && fn(x)` → `fn?.(x)`**（消除 no-unused-expressions ×2）：`src/pages/Grading/index.jsx`、`src/components/StudentSwitcher/index.jsx`。与仓内既有写法（`onLoadMore?.()`）对齐，行为等价。
- **2 条失效的 eslint-disable 注释清理**：`server/utils/comparisonAnswerVerifier.js`（no-new-func 本未启用，换成「白名单已收紧字符集」的真实缘由注释）、`server/worker.js`（废弃函数参数已带 `_` 前缀，disable 多余）。
- **未动的 error**（有意保留，不是遗漏）：`no-control-regex` ×4 与 `no-regex-spaces` ×3 属第 37 轮定的正则敏感区永久禁清理；`no-var` ×5 在 9/27 一次性脚本里；`server/scripts`、`server/tests` 各 1 条 no-unused-expressions 同属一次性工具；`server/index.js:4740` 的 no-async-promise-executor **不是风格问题而是真隐患**，见粗糙点 #6 / 提案 7。

### 第 40 轮附带：App.jsx 死功能残骸清除（1335 → 1197 行，-138）

移动端主容器 `src/App.jsx` 现在有 **0 条 lint 问题**（原 60 条）。删的全是「看起来像功能、实际碰不到」的死残骸（均为组件内局部符号，lint 已证明无引用，不可能跳文件被用）：

- **15 个双侧全死的 useState**（值与 setter 都没人碰）：预览图、showQRCode、printMode/printSize/printTarget/showPrintModal/printPreviewData、showImagePreview/previewImageUrl、showAddTag/newTagInput、showBatchActions、showGenerateExam/generatedExamPreview、qrDetectionResults。
- **7 个死 handler**：handleAddStudent、handleDuplicateExam、handleEditQuestion、handleManageTags、handleSaveTags、handleShowStudentQR、handleRefresh（共 110 行）。
- **随之一并变死的 6 个状态 + 8 个导入/store 字段**：createStudent / updateQuestionTags / updateTaskStatus / taskService / Tag / Download / motion / addStudent / exams 等（两轮级联：删 handler → 重跑 lint → 新死的再删）。

读出来的**产品事实**（已归入第三节可删候选）：移动端**不存在**新增学生、标签管理、学生二维码展示、手动刷新、复制试卷这几个功能（UI 早已拆掉，只剩状态与函数在自娱自乐）。若其中有你想找回的（最可疑的是**手动刷新**：现场改完作业想立刻看到新结果，现在只能靠 30s 轮询），说一声，git 历史里一行不少地拿得回来。

## 十一、待确认提案（第 40 轮新增，均未落地）

- **提案 7（后端启动挂死隐患）**：`createServer` 改成 `async` 函数后 `await`，使 `getTaskQueue()` 失败能正常报错而非静默挂死。一行改动级别，但改变了启动失败语义，故只提案不自行落地。
- **提案 8（V2 改名）**：去掉 `ExamPageV2` / `ProcessingPageV2` / `WrongBookPageV2` 的 V2 后缀（V1 已全部不存在），同步改 import 与目录名。纯可读性整理，零行为变更。
- **提案 9（上传弹层提平）**：把 UploadOptionsModal 的三张卡直接摆到首页上（现状：首页→「开始上传」大按钮 → 三卡弹层 → 暂存区），目标：最常走的那条少一步、并删掉一个 Modal。需负责人先说「哪条支路每天真在用」。
- **提案 10（选册双 flow 归一）**：`App.jsx:1140-1160` 新旧两条上传选册链共存，确认哪条已死则删（删代码不删功能）。
- **提案 11（移动端手动刷新 / 下拉刷新）**：现在页面数据靠「进页缓存优先 + 30s 轮询 + 切页重加载」，现场没有“立刻刷新”这个动作。本轮清理时删掉的 `handleRefresh`（含 5 个缓存失效 + 重算已批改任务统计，共 37 行）正好是现成实现，接回一个下拉手势或顶栏按钮即可。属新增交互（虽然代码已存），故只提案。
- **提案 12（循环锁防并发）**：第 40 轮实际发生了两个循环实例同时开工（双方都认领了 round 39，锁文件互相覆盖）。建议：① 写 running 后 sleep 2s 回读，round 不是自己写的值就退出；② 开工前 `git fetch`，远端领先本地 HEAD 则本轮转只读。属循环机制变更，等负责人点头再改任务书与脚本。

## 十二、常驻闸门清单（只加闸不放宽）

| 闸门 | 管什么 |
|---|---|
| `test/workbenchStoreImports` | 工作台 store 导入缺符号 |
| `test/workbenchTemplate*` | 工作台模板层引用 |
| `test/mobileApiImports` | 移动端调用 apiService 未导入 |
| `test/wrongBookRollbackScope` | 错题批量回滚作用域 |
| `test/answerOcrGuard` | 答案 OCR 三层防线 |
| `scripts/auditStoreContract.mjs` | store 契约读取审计（随时可跑） |
| `test/mobilePageReachability.test.mjs` | **新增（第 40 轮）**：src/pages 里从入口 import 链到不了的文件即红（根除 V1 孤儿页回流） |
| `test/mathTextSourceLeakLock.test.mjs` | **新增（第 40 轮）**：屏幕与打印两份数学渲染实现必须同构（定界符剥离 + 填空线转换），防裸源码上屏 |

## 十三、第 40 轮重大修复：屏幕露裸 LaTeX 源码（同构漂移）

浏览器实测错题本列表发现两类「一半数学体、一半源码」的题面，根因同一个：移动端 `src/components/MathText` 是 `src/utils/mathText.js` 的 fork，打印链路有的规范化步骤屏幕链路缺：

| 缺陷表现 | 缺失步骤 | 打印链路 | 移动组件（修复前） |
|---|---|---|---|
| 「已知 `$\sqrt{x+2y-7}+\|x-1\|=0$`」露裸 `$` | 剥定界符 `$`/`$$`/`\(` `\)` | 步骤 0 已剥 | **缺** |
| 整段红色 `\sqrt{1-\frac{19}{100}}=____` | 填空线 `____` → `\underline{\quad}` | 步骤 0.6 已转 | **缺** |

第二条尤其坑：`____` 落进数学段后 KaTeX 报 `Expected group after '_'`，`throwOnError:false` 下它把**整段源码原样红字上屏**。

修复：给组件补上两步（与打印链路逐字同码）+ 新增同构锁 `test/mathTextSourceLeakLock.test.mjs`（10 例：源码层「两份实现都有那行活代码」+ 行为层「产物不残留裸符号」）。

验收（负责人预览实例 5199，未抢占未重启）：`.katex-error` 节点 **9 → 0**；11 条错题标题无 `$`、无 `\sqrt`/`\frac` 源码、无裸 `____`；控制台无 error。截图：`tmp/wrongbook_item8_closeup.png`。

教训归档：**两份实现必须同构**——此前只锁了循环小数（mathTextRender.test.mjs），没锁定界符与填空线，所以漂移了整整一年。新锁把「同构」从“记得住”变成“闸门守”。

## 十四、提案质量教训（第 40 轮自纠）

第 19 轮提出的「移动端无 ErrorBoundary，建议加」是**基于错误事实的提案**：`src/components/ErrorBoundary.jsx` 自 2026-08-09 就已存在并在 `main.jsx` 包裹全树（带重新加载 / 清缓存两个恢复按钮）。该提案已撤回——不应再占用负责人注意力。教训：提案前必须 grep 确认代码现状，不能只看旧报告与目录名就下结论。
