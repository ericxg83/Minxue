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
9. **错题弹窗内数学渲染口径不齐**（第 41 轮实测）：同一张详情弹窗里，题干 / 选项 / 解析都走 MathText（数学体），只有**答案是纯文本**——答案 `-2 - 2√3` 的根号没有上横线、与题干割裂。接一行 MathText 即可统一，但字母答案（如 "A"）会变成斜体数学体，属肉眼可辨的版式取舍，本轮未能截图验收，已回滚不改，见提案 13。

## 三、可删/合并候选（全部待负责人确认，绝不擅删）

0. ~~移动端 `src/pages/WrongBookPage.jsx`（V1 错题本）~~ —— **第 40 轮已归档**：无任何 import 的孤儿页（V2 已接管），移到 `D:\Minxue_Archive\auto-20261002\`，并由 `test/mobilePageReachability.test.mjs` 永久看守（见第十二节）。V2 相比 V1 少了「标签筛选」（多了日期筛选），若需补回标签筛选请开口，否则视为无需处理。
1. **三个数据分析页重叠度**：学习诊断 / 成长中心 / 错题中心都做"学生×错题×掌握度"分析——第 21 轮已实证：页面无需合并，唯一重复物（成长中心导出按钮）已删。
2. **试卷答案库 / 我的题型库**：使用频率待负责人确认，低频则考虑收纳进二级入口
3. **移动端页面使用频率**：现确认底部只有 4 个 tab（首页/作业/错题本/组卷历史），其余 8 个视图均为弹层或深链。**待确认**：组卷历史 tab、周报弹层、上传三卡中的「普通」支路实际使用频率——低频则收纳或删（见提案 9）。
4. **上传选册两套 flow 并存**：`App.jsx:1140-1160` 同一个 `onSelect` 里按 `homeworkChoiceRef` 长度分叉成新旧两条链，读与改都容易错。待确认哪条已死，死则删（提案 10）。
5. **两个存量孤儿组件（第 42 轮实测，已进闸门豁免表）**：
   - `src/components/ExamResourcePicker/`（133 行）——已被 `ExamChoiceModal.jsx` 取代，全仓零引用；但 `server/index.js:1415`、`server/routes/resources.js:17`、`server/worker.js:8023` **三处注释仍把它当成在用组件**写。删组件得同步改这三处注释，故只提名。
   - `src/components/Skeleton/`（5 个文件共 136 行）——PLAN.md 里规划过的骨架屏库，**从未接线**；docs/SYSTEM_ARCHITECTURE.md 目录树仍列着它。
   - 同轮已归档真正的孤儿：`src/components/HomeDashboard.jsx`（首页 V1，零引用）→ `D:\Minxue_Archive\auto-20261002\components\`。

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
| `test/mobilePageReachability.test.mjs` | **新增（第 40 轮）+ 扩充（第 42 轮）**：src/pages 与 src/components 里从入口 import 链到不了、且全仓（含工作台 .vue）无人引用的文件即红（存量孤儿进豁免表） |
| `test/mathTextSourceLeakLock.test.mjs` | **新增（第 40 轮）+ 扩充（第 41 轮）**：屏幕与打印两份数学渲染实现必须同构（定界符/填空线/根号/上下标/乘点，共 14 例，字符集逐字比对） |

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

## 十五、第 41 轮：同构漂移第二批（根号 / 上下标 / 乘点）

第 40 轮修了两个症状后，用**只读探测拿真实数据定量**（8 个学生 307 条错题题干），确认同一类漂移还剩三批：

| 打印链路会规范化、屏幕链路不会 | 命中 | 屏幕现状 |
|---|---|---|
| 裸根号 `√x` / `√(x)` / `√17(a²+b²)` → `\sqrt{...}` | **50 / 307（16%）** | 根号用正文字体、没有上横线，根号下的式子被撕成独立数学段 |
| Unicode 上标 `a²` → `a^{2}`、下标 `y₀` → `y_{0}` | **110 / 307（36%）** | 数学体字母 + 正文字体上标混排，与同一题的 PDF 不一致 |
| 乘点 `·` → `\cdot ` | 21 / 307（7%） | 数学段被 `·` 切断 |
| U+2212 数学减号 | 0 / 307 | 无存量，**不动** |
| `\left` `\right` 剥离 | 2 / 307 | 逐字推演：KaTeX 本身能解析合法 `\left(...\right)`，**不是缺陷，不改** |

修法（关键决策：**不再重复定义一份**）：屏幕组件直接 `import { convertSqrt, SUP_BASE, SUB_BASE } from '../../utils/mathText.js'`，`utils/mathText.js` 只多导出两个已存在的常量表（纯加法，打印行为零变更）——把「两份实现同步」从人肉记忆变成结构上共用。

同构锁 `test/mathTextSourceLeakLock.test.mjs` 从 10 例扩到 **14 例**，新增的「字符集逐字比对」当场拓出一个真漏：手写上标字符集时少了一个 `⁽`（U+207D）。

**锁本身的锁**：第一次 red-check 时发现新加的 `includes('result = convertSqrt(result)')` 在把那行**注释掉后仍然绿**——假锁。已改成与第 40 轮同款的 `assertLiveCodeLine`（注释行不算），三个变异（注释掉调用 / 删一个上标字符 / 删乘点映射）实测均为红。

验收（负责人预览实例 5199，未抢占未重启）：列表页 `.katex` 65 个、`.katex-error` **0**、`.katex` 容器外裸 `√` **0**、裸 Unicode 上标 **0**；`∛27 − √64 + |√3 − 2|`、`729cm³`、`A₀A₁A₂` 均为数学体带横线；控制台无 error。

### 第 41 轮新增提案

- **提案 13（错题弹窗答案行接数学渲染）**：`WrongQuestionDetailModal.jsx:156` 把 `{q.answer}` 换成 `<MathText content={q.answer} />` 即与题干/选项/解析口径一致。本轮已改过、又主动回滚：字母答案（"A"）会变斜体数学体，属肉眼取舍，且验证用的浏览器标签页被自动化脚本的死循环卡死、拿不到截图。一句话说清你要哪边，下轮直接上。
- **提案 14（立方根 `∛` U+221B 两边都不认）**：`convertSqrt` 只识别 `√`，所以 `∛27` 在屏幕与 PDF 里都是正文字体。修它要改共享纯函数（影响 PDF 产物），属硬禁区口径，只提案。
- **提案 15（试卷入库校对页未接数学渲染）**：`src/features/PaperBank/index.jsx:290` 的 `<span>{block.content}</span>` 是纯文本，校对时看到的是裸 LaTeX。低频页面，待你确认值不值得改。

## 十六、第 42 轮：死变量批次 + 一次错判被验证拦下

### 错判与自纠（过程纪实，不遮）

读 `src/components/HomeDashboard.jsx` 时发现它用了 `onOpenWrongBook` / `onOpenReview`，而 `App.jsx` 没传 → 判定「首页三个入口是死按钮」并接线。**无头浏览器验证直接拆穿**：首页实际渲染的是 `HomeDashboardV2`（`App.jsx:33` 把 `HomeDashboard` 这个局部名指向了 V2 文件），V1 全仓零引用——我接的是空 props，对着的是一个根本不上屏的文件。已回滚那两行，并把 V1 归档。

教训：**孤儿文件最大的危害不是占地方，是误导判断**——它看起来像「在用的代码」，于是基于它得出的每个结论都是错的。因此本轮把可达性锁从 src/pages 扩到 src/components（带存量豁免表，只卡新增），并把「验证」放在提交前而不是后。

### 本轮实际落地（全部验证通过）

- **PrintPreview 死代码清除**：652 → 553 行（-99）。删的是旧版整页 HTML 打印模板 `generatePrintContent`（82 行）、`handlePrint` 空壳、`isMobile`、`printRef`、四个双侧全死的 useState、`filename`（算了文件名却没人用）、以及随之变死的 4 个 import。按钮实际走的是 `handleExportPDF` / `handleDirectPrint`，**没删任何在用功能**。
- **永远为 false 的死守卫**：`pdfDownloading` 的 setter 全仓无调用 → `if (generatingPdf || pdfDownloading)` 后半段永远不成立。已删该状态并简化条件（行为完全一致）。
- **试卷库死 UI 证据**：`paperBankShowFilters` 同样 setter 无调用方——**试卷库的「筛选面板」是一条接不上的死分支**（已在代码里注释说明，列入待确认）。
- **删了一个浪费的全页 JPEG 编码**：`const imgData = canvas.toDataURL('image/jpeg', 0.92)` 算完没人用（下面分页直接从 canvas 切），每次导出白编一次大图。
- 其他：`Grading` 死 dayjs import 与死 `student` 查找、`useExamReview` 死 import、`ImagePreview` 与 `handleDoubleTap` 完全同体的死 `toggleZoom`、`WrongBookPageV2` 死 `labels`、`WeeklyReport` 死 `dailyTrend`、两处未用 `idx` 形参。
- lint warning **271 → 241**（-30），errors 仍 15（未动禁区），单测 1451 全绿，隔离构建通过。

### 没删但已报备

- `src/hooks/useUploadFlow.js:754` `uploadViaFrontend`（「前端上传兜底」）无任何调用方。删代码很容易，但**删掉一条兜底路径属于口径变更**，等你确认是有意弃用还是漏接线。
- `src/features/PaperBank/index.jsx:290` 校对页裸文本（提案 15）。
