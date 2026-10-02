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
| Tab 2 | 作业 ProcessingPage | tab / 首页「查看作业」/ 通知面板 | 看批改结果、进复审 |
| Tab 3 | 错题本 WrongBookPage | tab / 首页 / 组卷页 | 状态分段 + 科目 chip 筛选、多选加入重练 |
| Tab 4 | 组卷历史 ExamPage | tab | 重印、上传答案 |
| 弹层 | UploadOptionsModal | 首页「上传今天的作业」 | 两张卡：日常作业 / 普通试卷（第 46 轮由三卡减为两卡） |
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

5. **上传主流程弹层偏深**：从首页到相机要过 UploadOptionsModal → StagingModal（中途还可能插 WorksheetPicker）。最常走的那一条若能一键直达，每天几十操作各少一步（B 级方案见「与你讨论」）。→ **第 46 轮已减一层**：弹层从三卡减为两卡（只留负责人每天用的「日常作业」与「普通试卷」），删掉的「错题重练」卡经逐行核实**不删任何能力**——它走的其实就是「普通试卷」同一条通用上传分支，而重练卷靠卷面二维码定位，从任何支路进来都会被 QR 检测拦下归位；负责人真正的习惯（组卷历史里选卷上传答卷，`retry_bound`）完全未动。
6. **`server/index.js:4740` createServer 用 async Promise executor**：`getTaskQueue()` 抛错时外层 promise 永不 settle——启动期依赖故障表现为**无声挂死**（不报错、不退出、端口不监听）。属启动失败语义变更，未擅自修，见提案 7。
7. ~~**V2 命名残留**~~ —— **第 47 轮已清**（裁决 ⑦）：`ExamPageV2`/`ProcessingPageV2`/`WrongBookPageV2` 三个文件与同名函数已去后缀（V1 全部已不在，后缀无对照对象）。
8. ~~**移动端切页重复请求**~~（保留编号以免引用错乱）：浏览器实测单次切 tab，`/api/tasks/summary`、`/api/generated-exams/*`、`/api/wrong-questions/*` 会出现 2-3 次重复 fetch（均 304 缓存命中，不致错但耗流量与时间）。需先分清楚哪些是「缓存优先 + 后台刷新」的有意双加载（第 28 轮已证实错题中心属此类），剩下的才是真重复，故只记录不擅改。
9. **错题弹窗内数学渲染口径不齐**（第 41 轮实测）：同一张详情弹窗里，题干 / 选项 / 解析都走 MathText（数学体），只有**答案是纯文本**——答案 `-2 - 2√3` 的根号没有上横线、与题干割裂。接一行 MathText 即可统一，但字母答案（如 "A"）会变成斜体数学体，属肉眼可辨的版式取舍，本轮未能截图验收，已回滚不改，见提案 13。

## 三、可删/合并候选（全部待负责人确认，绝不擅删）

0. ~~移动端 `src/pages/WrongBookPage.jsx`（V1 错题本）~~ —— **第 40 轮已归档**：无任何 import 的孤儿页（V2 已接管），移到 `D:\Minxue_Archive\auto-20261002\`，并由 `test/mobilePageReachability.test.mjs` 永久看守（见第十二节）。V2 相比 V1 少了「标签筛选」（多了日期筛选），若需补回标签筛选请开口，否则视为无需处理。
1. **三个数据分析页重叠度**：学习诊断 / 成长中心 / 错题中心都做"学生×错题×掌握度"分析——第 21 轮已实证：页面无需合并，唯一重复物（成长中心导出按钮）已删。
2. **试卷答案库 / 我的题型库**：使用频率待负责人确认，低频则考虑收纳进二级入口
3. **移动端页面使用频率**：现确认底部只有 4 个 tab（首页/作业/错题本/组卷历史），其余 8 个视图均为弹层或深链。**待确认**：组卷历史 tab、周报弹层、上传三卡中的「普通」支路实际使用频率——低频则收纳或删（见提案 9）。
4. ~~**上传选册两套 flow 并存**~~ —— **第 47 轮已删旧 flow**（裁决 ⑦）：`WorksheetPicker.onSelect` 里那个 `homeworkChoiceRef.current.length > 0` 分叉已确认不可达——本弹层全仓只有一个开启入口（`useUploadFlow.js:224`，紧跟在 `setHomeworkChoiceFiles` 之后），所以该条件恒为真；旧分支与末尾 else 一起删除，它写的状态在活路径 `handleUploadAsWorkbook` 里全部也写。连带 `stagingType='workbook'` 也无入口（`pendingFlow='workbook'` 仍在用，两者不是一回事，已分开注释清楚）。
5. ~~**两个存量孤儿组件**~~ —— **第 45 轮已全部归档**（负责人批准「清」）：`ExamResourcePicker/`（133 行）与 `Skeleton/`（5 文件 136 行）已移到 `D:\Minxue_Archive\auto-20261002\components\`，孤儿锁豁免表已清空；server 三处把它当在用组件写的注释已改口为 `ExamChoiceModal`。另：`HomeDashboard.jsx`（首页 V1）已于第 44 轮归档。

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
  ➡ **已关闭（2026-10-02 负责人裁决：不统一）**——答案保持普通文字，不再提。
- **提案 14（立方根 `∛` U+221B 两边都不认）**：`convertSqrt` 只识别 `√`，所以 `∛27` 在屏幕与 PDF 里都是正文字体。修它要改共享纯函数（影响 PDF 产物），属硬禁区口径，只提案。
  ➡ **已修（第 44 轮，负责人批准屏幕+PDF 一起修）**：`RADICALS` 表同时支持 `√` / `∛` / `∜`，输出 `\sqrt[n]{}`；屏幕与打印共用同一个函数。实测详情页 38 个根号节点中 4 个带根指数，裸 `∛` 泄漏 0。
- **提案 15（试卷入库校对页未接数学渲染）**：`src/features/PaperBank/index.jsx:290` 的 `<span>{block.content}</span>` 是纯文本，校对时看到的是裸 LaTeX。低频页面，待你确认值不值得改。
  ➡ **已关闭（负责人裁决：不常用，不改）**。

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

## 十七、第 43 轮：后端活代码死变量批次（worker.js 为主）

只动「可证无引用且不可能改变模块加载」的那一类，**lint warning 241 → 220**（errors 仍 15），1451 单测全绿，`node --check server/worker.js` 通过。本轮未改前端文件，按规则不重建产物（上轮构建距本轮仅 20 分钟）。

### 安全判定先做足（因为 `worker.js` 是批改主流程）

删命名 import 唯一可能的风险是「整个模块不再被加载 → 丢顶层副作用」。逐个查过：

- `config/ai.js`（6 个死名）、`neonService.js`（4 个）、`questionFingerprint.js`（1 个）、`judgeService.js`（1 个）、`questionCompleteness.js`（1 个）——**import 语句本身都保留**（同模块其他名字在用），模块加载不变，零风险；
- `uploadRetryManager.js` 是整行死 import。先确认该模块顶层**只有常量定义与函数声明、零副作用**（逐行看过），才删整行。

### 删了什么

- 13 个死命名 import（上面那 6 个模块）；
- 3 处死解构字段（`originalName` ×2、`imageUrl` + `chapterHint`）与 3 个末尾死形参（`index`、`pageIdx`）；
- **修了一个算出来却丢掉的耗时指标**：`processSlimGrading` 的 catch 里 `duration` 算完没人用，现在补回错误日志（`已耗时 Nms`）——批改失败时终于能看到卡了多久。

### 故意没碰（重要，不是遗漏）

| 位置 | 为什么不动 |
|---|---|
| `worker.js:7017` `allCorrect` 只写不读、`:7233` `oldRef` 死读 | 都在**判题聚合路径**上。`allCorrect` 看着像一个被放弃的「全对」聚合标记，删掉技术上安全但属批改口径，只报备 |
| `worker.js:208-225` 几何相关死 import（`hasFigureReference` 已删，`checkFigureReference`/`FIGURE_GATE_MESSAGE`/`buildFunctionGraphSvg`/`renderGeometrySvg`/`publishCleanGeometryUrl` 未删） | 后五个是**整行唯一名字的 import**，删了模块就不加载；几何重绘按零回归纪律只统计不动 |
| `worker.js:2138` `questions.filter(q => true)` | 逐字看过上下文：函数头注释写明「参考答案永远对全部题重算」，`filter(q => true)` 是**故意表达 ALL**，不是漏写条件。可简化但不改行为，不抢批改主流程的改 |
| `server/utils/geom/**`、`server/scripts/**`、`server/tests/**`、迁移文件 | 保护区 / 一次性脚本 / 测试 / 硬禁区，本轮全部只统计 |

## 十八、第 44 轮：负责人裁决落地（∛ 修复 + 启动陷阱 + 循环锁 + 判题死写）

### 立方根 `∛` / `∜`（提案 14，已批准已上线）

`src/utils/mathText.js` 的 `convertSqrt` 原来只认 `√`。现在改成 `RADICALS` 表（`√`→无指数、`∛`→3、`∜`→4），四个操作数分支统一走 `wrap()` 输出 `\sqrt[n]{...}`。**屏幕与打印共用这一个函数**，所以改一处两边同时生效（这正是同构锁存在的意义）。

验收（playwright 无头，只读）：列表页 `katex-error` 0、可见文本无裸 `√`/`∛`；详情页 38 个根号节点中 **4 个带根指数**（`.root` 块）；截图 `deliverables/r44_cbrt_detail.png`。回归保护：新增断言 `√2` 依旧不得被顺手改成带指数形式、`√(x+1)` 仍走括号路径。

### 提案 7 核实：前提半错，处置变了

原以为「后端启动会因队列初始化失败而无声挂死」。逐字查完发现：**真正在跑的启动路径（`index.js:4494`）是健康的**——先 `app.listen`，再在回调里 try/catch 初始化队列并打日志。有风险的那个 `createServer` **全仓零调用**，是个没人用的导出。

所以处置从「改启动语义」降级为「删陷阱死代码」：删掉 `createServer`，原地留注释说明它为何不能再用（async Promise executor 一抛错就永不 settle）、以及真要多实例启动时该照哪段写。lint error **15 → 14**（no-async-promise-executor 归零）。

### 提案 12 落地：`scripts/loopGuard.mjs`

把「认领轮次」从手写 JSON 变成一次带校验的动作：`acquire`（忙则退出码 1；写锁后 sleep 2s 回读，round/startedAt 不是自己写的就判定被并发抢走 → 退出码 2；同时 `git fetch` 报远端是否领先）、`release`、`status`。以后每轮开工先跑它，不再手改锁文件。

### 裁决 ⑤：判题链死写已清

`allCorrect`（只写不读的「小问全对→整题全对」遗留标记）与 `oldRef`（死读）已删，原地留三行注释说明它曾经是什么、要恢复语义去 `git log -p server/worker.js` 找。行为零变更（变量本来就没人读）。

## 十九、第 45 轮：裁决 ④ 落地（死兜底与死组件批次）

- `useUploadFlow.js` 的 `uploadViaFrontend`（26 行「前端直传兜底」，全仓零调用）已删，原地留注释说明它是什么、恢复看 git 历史；连带清掉因此变死的 `uploadImage` / `createTask` 两个 import。
- `ExamResourcePicker/`（133 行）与 `Skeleton/`（5 文件 136 行）已归档，孤儿锁豁免表清空。
- 试卷库 `paperBankShowFilters`（永远为 false 的筛选面板开关）已删：状态与 hook 返回字段一并去，没人读过它。
- server 三处过时注释（`index.js:1415`、`routes/resources.js:17`、`worker.js:8024`）已改口为在用组件 `ExamChoiceModal`。
- 共 **-305 行**。验收：1453 单测全绿、lint warning 218→217、隔离构建通过（构建能过本身就证明没有漏网的引用），无头浏览器实测四个 tab 正常、首页上传弹层照常打开、控制台 0 error。

## 二十、第 46 轮：首页上传弹层三卡减两卡（裁决 ⑥）

负责人口述使用习惯：「每天用 日常作业 和 普通试卷；错题重练习惯在组卷历史那个位置上传对应试卷」。

逐行核实后动手（关键：先确认删卡不删能力）：

- 被删的「错题重练」卡只做一件事：`openStaging('wrong_retry')`；而 `handleSubmitStaging` 里根本没有 `wrong_retry` 分支——它一路落到末尾的通用上传（与「普通试卷」同一条路），**所以这张卡本身就是一个伪选项**；
- 重练卷定位靠卷面二维码，`handleFileSelect` 里的 QR 检测对**任何**支路都生效（多份卷还会提醒分开上传），删卡不影响识别；
- 负责人的真实重练入口（组卷历史→上传答卷→`retry_bound`）与 `uploadRetryPaperGroup` 的两个调用方全部保留。

改动：`UploadOptionsModal.jsx` 删卡片3 与 `onStartWrongRetry` prop（并清掉变死的 `RefreshCw` import，文件头写明为何只剩两卡）；`App.jsx` 删对应回调；`StagingModal.jsx` 删已无入口的 `wrong_retry` 标题分支；`useUploadFlow.js` 的 `stagingType` 取值注释同步为真实在用的三种。

验收：1453 单测全绿、lint 14 errors / 217 warnings（与第 45 轮持平，零新增）、隔离构建 `dist_nightly_20261002j` 通过；无头浏览器实测弹层卡片 `日常作业 ✓ / 普通试卷 ✓ / 错题重练卡 ✗`、「取消」能关掉、四个 tab 正常、控制台 0 error。截图 `deliverables/r46_upload_two_cards.png`。

回滚方式（如果负责人其实还想从首页直接发重练卷）：把卡片与 `onStartWrongRetry` 加回即可，一行回调、无数据变动（git 历史 d3febe3 之后的那一次提交）。

## 二十一、第 47 轮：裁决 ① 与 ⑦ 落地

### 裁决 ①：`answerParseService` 两个锚点变量——结论是「不是 bug」

深挖后判定：`lastAnchorUnitKey` / `lastAnchorGroup` 与续行归并的实判据完全冗余——`push()` 已把 `unit_key`/`section` 写进锚点行本身，第 877-884 行的归并条件直接读 `anchor.unit_key` / `anchor.section`，所以那两个变量从来就没参与判断（不是“该读没读”的错位 bug）。已删除（行为零变更），并把注释改成实话：**单一事实只保留锚点行一个来源，不要再引入平行副本变量**——同一类“两份真相漂移”刚在 MathText 上坑过我们。

### 裁决 ⑦-a：选册旧 flow 已确认不可达，已删

`WorksheetPicker` 全仓**只有一个开启入口**：`useUploadFlow.js:224`，紧挨在 `setHomeworkChoiceFiles(files)` 之后，且 `files.length === 0` 时第 206 行已提前 return——所以 `homeworkChoiceRef.current.length > 0` 恒为真，旧分支与末尾 else 永远走不到。删掉后 `openStaging('workbook')` 再无调用方，连带清掉 `StagingModal` 的 `wrong_retry` 之后的 `workbook` 标题分支与 App.jsx 里无人读的 `homeworkChoiceRef` 解构。注意：`pendingFlow='workbook'`（任务类型）**依旧在用**，与 `stagingType` 不是一回事，已分开注释防误删。

### 裁决 ⑦-b：V2 改名完成

`ExamPageV2.jsx` → `ExamPage.jsx`、`ProcessingPageV2.jsx` → `ProcessingPage.jsx`、`WrongBookPageV2.jsx` → `WrongBookPage.jsx`，函数名与 App.jsx 三处 import 同步；代码内 `PageV2` 残留 **0 处**（历史日志 DEVLOG.md 与各轮报告不改写，它们是当时事实的记录）。

### 验收

1453 单测全绿；lint **error 14 / warning 215**（217→215，即删掉的两个死变量）；隔离构建 `dist_nightly_20261002k` 通过（**改名后构建能过就是路径无漏网的证据**）；无头浏览器逐页实测：四个 tab 均按预期关键词正常渲染、无崩溃兜底页、`katex-error` 0、上传弹层仍是两卡（第 46 轮成果未回退）、控制台 0 error。

### 下一轮候选（仍是死变量）

`server/services/*` 剩 ~10 条死 import 与死局部声明（`answerParseService` 锚点变量已在第 47 轮解决）；`server/worker.js` 剩几何相关死 import（需负责人对零回归纪律松口才动）。

## 二十二、第 48 轮：server 活代码死变量批次（warning 215→197）

15 个文件 +10/-64，1453 单测全绿，error 仍 14，本轮未动前端→按规则不重建产物。

### 一个差点把功能改没的坑（重要）

`weekendPptxService.js` 里 `const tb = s.addText(...)` 和 `const ansCard = s.addText(...)` 被 lint 报「变量未使用」。按死代码处理直接删行 = **课件上的题干文本框和「参考答案」标题会凭空消失**——因为 `addText()` 本身在往幻灯片上画东西，没人用的只是它的返回值。所以只删绑定、保留调用（`s.addText(...)`）。

同类：`figureVectorize.js` 的 `weakCount++` 在 `for (...) { weak[i] = INK; weakCount++ }` 里——`weak[i] = INK` 是真干活，只删计数器。判据：**删之前先看右边有没有副作用**，不看变量名。

### 省下来的真东西：一条在循环里白跑的数据库查询

`teachingSuggestionsService.js` 每个知识点都 `await query(一条带 JOIN + jsonb 展开的 SELECT)`，结果 `errorDistRows` **从未被读**——因为改用 `fetchErrorDistribution()` 后忘了删旧的那段。在 `MAX_KP_PER_SUGGESTION` 循环里，等于每次生成教学建议多打 N 道无用 Neon 查询（本项目 Neon 配额是硬约束）。已删，并把那句已无所指的注释改成实话。

### 其余清理（均为可证无副作用）

- 6 处死 import（docx 的 `HeadingLevel`/`ShadingType`、`OSS_CONFIG`、`ENGLISH_QUESTION_TYPE_LABELS`、`assignQuestionKnowledge`）；`handoutService` 的整行 `getQuestionKnowledge` 删除前已逐行确认 `knowledgeService.js` 顶层零可执行语句；
- 死常量/死函数：`MAGIC_BYTES`、`SUP_SIGNS`、`PAD_RATIO`、`EPS`、`parseFrac`、`cell`、`timeForBlock`、`weakCount`；
- 工具坑记录：`uploadValidator.js` 与 `figureVectorize.js` 是 **CRLF** 行尾，带 `\n` 的匹配串找不到——批量改脚本必须行级处理，不能靠字符串尾换行。本轮两处未命中就是此因，已改用 CRLF 安全版重跑，每处都校验命中数，不猜。

### 发现但未本身修（需口径决定，不本身动）

1. **`MAGIC_BYTES` 从来没用过 → 上传文件的「魔数校验」实际上从来没生效过**（现在只校 MIME / 扩展名 / 大小）。启用它是安全加固，会拒掉伪装的图片，属行为变更 → 待定。
2. `runErrorDiagnosis({ chain })` 参数全仓无人传 true 且函数内不读 → 一个没接线的开关（诊断链功可能只做了一半）。
3. `renderExamPDF({ filename })` 渲染器不读它——已核实不是 bug，文件名在 `routes/examPdf.js:46` 的 Content-Disposition 生效，属多余透传参数，未动。
