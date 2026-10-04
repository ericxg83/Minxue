# 赛道认领表（并行模型必读）

> 用途：多个 AI 模型同时在跑这条持续优化循环。**开工前先读本表 + `_loop_state.json`，只在自己认领的赛道内动手**，
> 跨赛道的发现一律写进 `docs/auto/backlog.md` 当提案，不替别人改。
> 规则：① 锁 `running` 时后来者静默退出；② 一行赛道 = 一个会话，认领要写清范围与时间；③ 放弃时改标「空档」并留接手提示。

## 已占用赛道

| 赛道 | 范围（可写路径） | 认领方 | 状态 |
|---|---|---|---|
| **几何配图与重绘管线** | `server/geometryWorker.js`、`server/utils/geom/**`、`server/utils/{areaModel,numberAxis,functionGraph}/**`、`server/scripts/rerunNeverTriedGeometry.mjs`、配图相关 `server/scripts/*` | 第 74-83 轮会话 | ✅ 已收线（方向二批次 + 拓扑闸 + 面积模型 + tick 全部交付，裁决⑤⑫⑬⑭⑮⑯已关） |
| **周末班课件 + 白板** | `src/workbench/views/WeekendBoard.vue`、`src/workbench/components/DrawingCanvas.vue`、`WeekendHandout.vue` | 第 85-89、97-98 轮 | 🟡 高频活跃（激光笔/重做/快捷键/板书串题/默认笔宽已做） |
| **PC 工作台信息架构与数据页** | `src/workbench/views/**`（除白板）、`src/workbench/components/**`、`src/workbench/stores/**` | 第 91-92、103-104 轮 | 🟡 活跃（数据页合并、入口可达性闸、分享卡品牌化、错题中心一致性；第 104 轮修 lifecycle 回滚 + 筛选泄漏，第 105 轮深审 reviewStore 中） |
| **批改链路与任务自愈** | `server/worker.js`、`server/queue.js`、`server/services/**` 批改相关 | 第 90、103 轮 | 🟡 活跃（自愈已存在→不立项；前端直调 AI 已移除） |
| **仓库卫生与门禁基线** | 死模块/死声明清理、lint 棘轮、`scripts/pruneDeadDeclarations.mjs`、`scripts/gate/**` | 第 82-83、94-96 轮 | 🟡 活跃（lint 基线 14→9 errors） |
| **夜间只读巡检（A 层）** | 只写 `docs/auto/**`；禁止改业务码与 git 写操作 | 定时任务「敏学夜间只读巡检」每日 03:30 | 🟢 常驻 |

## 本次新认领

| 赛道 | 范围（可写路径） | 认领方 | 状态 |
|---|---|---|---|
| **移动端 App 体验 + 打印/PDF 产出物** | `src/App.jsx`、`src/pages/**`、`src/components/**`、`src/hooks/**`、`src/utils/**`（含 `pdfGenerator.js`、`imageEnhancer.js`、`nativeDownload.js`）、`src/services/apiService.js`、`src/domain/**`、`vite.config.js` 分包、`server/routes/**` 中仅导出/PDF 相关端点 | Quest 会话（2026-10-04 认领，定时任务「移动端与PDF产出物巡检优化」每 30 分钟） | 🟢 已认领 |
| **服务端基础设施（非批改）** | `server/config/**`、`server/utils/**`（除 `geom/**`、`areaModel*`、`numberAxis*`、`functionGraph*`）、`server/queue.js` 的队列/连接配置、`server/index.js` 的非批改部分、数据库查询与索引健康、进程内存/句柄、定时任务、日志与可观测性 | 常驻巡检会话（2026-10-04 认领，定时任务「敏学常驻巡检循环」每日 21:30） | 🟢 已认领 |
| **流程沉淀与 skill 维护** | `~/.workbuddy/skills/minxue-*/SKILL.md`（调用名一律中文）、`docs/auto/backlog.md` 的勘误与止损记录、`.workbuddy/memory/**` | 常驻巡检会话（2026-10-04 认领） | 🟢 已认领 |

**为什么选这条**：近 25 个提交的改动文件统计显示，`src/workbench/**` 被反复触碰，而移动端 `src/`（除 workbench）几乎没动过（`App.jsx` 仅 2 次、`apiService.js` 2 次）。
移动端是老师**现场操作**的主战场（上传→看批改→错题本→组卷），PDF/重练卷是**唯一转发给家长的出口**——高价值、低碰撞。

**边界（越界即只写提案，不动手）**：
- 白板/课件、PC 工作台视图与 store、批改链路 `server/worker.js`、几何配图管线、数据库 Schema/迁移 → 全部属他人赛道。
- 移动端与工作台**共用**的 `src/services/apiService.js`：只允许新增/调整移动端调用侧，改公共函数签名前必须先查工作台与 worker 的调用方，并在报告里点名。

**接手提示**：本轮次已知的移动端线索（尚未核实，先核实再动手）：
1. 移动端首屏偶发一次 `400 Bad Request`（疑似首次 `/api/tasks` 在学生 id 就绪前抢跑）——第 79 轮抓到、第 80/83 轮未复现，属本赛道，值得定位。
2. PullToRefresh 回归（antd-mobile 曾致 vendor 分包断裂白屏，已回滚）——回归前必须先查 `vite.config.js` 的 `manualChunks`，也属本赛道。
3. 首页上传「直达按钮」已被负责人**否决**，保持首页→上传→选类型→相机，`UploadOptionsModal` 维持两卡布局——不要重提。

**第 105q 轮（2026-10-04，本赛道）已交付：移动端错误可见化 + 学生写操作禁重试**
- StudentSwitcher 增/删/改失败只进 console（表单静默关闭、删除失败确认框卡死且本地与库分叉）→ 全部补 antd-mobile Toast，删除改「先服务端成功后动本地」；ImageCropper 原生 alert → Toast；WorksheetPicker 加载/设默认失败被吞 → Toast。
- `createStudent/updateStudent/deleteStudent` 补 `retries=1`（仓内写操作不重试既有约定；POST /students 纯 INSERT 无去重，默认 3 次会重放出重复学生）。⚠️ apiService 与工作台共用：retries=1 对 StudentsWorkbench.vue 的调用方同样是语义改善，无签名变更。
- 同类残留（本轮只提名未动，属本赛道待办）：App.jsx 初始化链（237/250）、NotificationsPanel.jsx:62、ScanQR:66、WeeklyReport:96 的 catch 只进 console；WorksheetPicker 存在 button 嵌 button（HTML 非法，点击事件已 stopPropagation，风险低）。
- 回归锁 `test/mobileErrorVisibility.test.mjs`（旧树 12 红/新树 0，反向自检已实测）；产物 `dist_nightly_20261004r105q`；四道闸全绿（1560/1560，排除他人 in-flight 的 reviewStoreFailureRollback 其当时自身红）。

**第 107q 轮（2026-10-04，本赛道）已交付：初始化/通知失败不再伪装正常空态 + 非法嵌套修正**
- App.jsx 冷启动拉不到学生名单/初始化失败只进 console，首页停在「暂无学生」误导为名单丢了 → 两处补 useToast 可见提示（App 用自家 ToastProvider，非 antd-mobile）。
- NotificationsPanel 加载失败被渲染成「暂无新通知」（铃铛里的「识别失败」提醒正是老师需要看的）→ 新增错误态 + 重试按钮；load 提为组件级 useCallback（active 改用 ref，卸载后不再 setState）。⚠️ 首轮把它直接写在 useEffect 作用域内被 lint 抓到 no-undef，已收线。
- WorksheetPicker 列表行 button 嵌 button（HTML 非法，部分 WebView 会把内层星标点击归并给外层导致误选）→ 外层改 div[role=button]，行为不变。
- 锁扩判据：新增「禁 button 嵌 button（线性深度扫描）/ App 初始化失败必须 Toast / 通知面板必须错误态+重试」；旧树（=r105q 已推树）实测 5 红、新树 0。
- 四道闸：单测 1567/1567（排除他人 in-flight）｜lint 我方 0｜`dist_nightly_20261004r107q`｜preview:5235 冒烟全绿（含 6 条新文案进包实测）。运维事件：会话间 4000 后端被他模型操作弄死，本轮按分离进程规范拉起（日志 `_r107q_backend.log`，仍在跑）；5227–5234 被旧 preview 占满，后续冒烟用 5235+ 并先探测。

**第 108q 轮（2026-10-04，本赛道）已交付：周报页错误态 + 错题分页失败反馈**
- WeeklyReport：`loadSummary` 失败与「真没数据」都渲染成「暂无学习数据」——周报是要转发家长的输出物，误导代价高 → 新增 `summaryError` 态（红字+原因+重试按钮），空态仅在非 loading 非 error 时显示。
- App.jsx 错题本：首页加载失败且无缓存时停在「暂无错题」误导 → Toast；`loadMoreWrongQuestions` 静默失败会让老师以为「就这些题」（总数口径错不得）→ Toast。
- 锁扩判据 4 条（WeeklyReport 错误态×2 + App 错题分页×2）；旧树实测 4 红/新树 0；ScanQR:66 实测**非缺陷**（已有 setScanError 可见渲染），不重复处理。
- 四道闸：单测 1572/1572（排除他人 in-flight）｜lint 我方 0｜`dist_nightly_20261004r108q`｜preview:5236 冒烟全绿（9 条可见化文案全部进包实测）。
- 109q 候选：①`loadTasks`（App.jsx:443）/`loadGeneratedExams（576）失败无反馈（有缓存兑底，优先级低）②首屏偶发 400 抢跑定位③ExamReview 页错误可见性审计。

**第 109q 轮（2026-10-04，本赛道）已交付：首屏 400 取证（未复现）+ 学生删除防连点/表单 Enter 提交**
- 先做只读取证：`_r109q_400_probe.mjs` 在隔离产物上冷启动移首页 + 错题本两轮，逐 GET/POST 记录 4xx/5xx → **0 个 4xx**，lanes 里挂的「首屏偶发 400」本轮实测不复现（r79 抓到、r80/83/109q 未复现），建议从接手提示降为“待观察”。
- 静默吞错全移端普查（`.catch(()=>{})`）：命中的都是有意为之的降级路径（缓存写入失败/卸载取消监听/健康探测），无需动。
- 顺手化（交互专业度）：StudentSwitcher 确认弹窗的「删除」无禁用态，连点会重发 DELETE → 新增 `deleting` 态 + disabled + “删除中…”反馈（finally 必清）；姓名/班级输入框补 Enter 提交（与已有表单校验一致）。ImageCropper 本身是模态一次性确认，不动。
- 锁扩判据 1 条（删除防连点 deleting+disabled）；旧树（=r108q）实测 1 红/新树 0；反向自检阈值调为≥（旧树每轮重导，红数=本轮新增数）。
- 四道闸：单测 1572/1572（排除他人 in-flight）｜lint 我方 0｜`dist_nightly_20261004r109q`｜preview:5240 冒烟全绿（含新增「删除中…」共 10 条可见化文案进包实测）。

**第 110q 轮（2026-10-04，本赛道）已交付：作业列表无缓存加载失败补 Toast**
- `loadTasks` 是缓存优先上屏，但冷启动（localStorage 空）hasCache=false 时若接口失败，页面停在「暂无任务」误导→ 与错题本同口径：仅无缓存时 Toast「作业列表加载失败」（有缓存时保留旧数据不打扰，符合秒开设计）。
- 锁扩判据 1 条（App 无缓存时 loadTasks 失败必须 Toast）；旧树（=r109q）实测 1 红/新树 0。
- 至此移动端四大列表加载（学生/任务/错题/试卷）中前三个已有失败可见化；loadGeneratedExams（试卷）失败保留旧数据不 Toast（试卷页有选中生空态文案，优先级低，下轮再定）。
- 四道闸：单测 1572/1572｜lint 我方 0｜`dist_nightly_20261004r110q`｜preview:5242 冒烟全绿（11 条可见化文案进包实测）。

**第 111q 轮（2026-10-04，本赛道）已交付：试卷首次加载无缓存失败 Toast（四大列表收尾）**
- `loadGeneratedExams` 每 15s 轮询；此前失败全静默，首次无缓存时页面停在「暂无试卷」误导。修正为：**仅首次（showCachedFirst）且无缓存可上屏时** Toast；轮询刷新失败不弹（15s 自恢，防噪）。顺手把双读 peekCache 收敛为一次读。
- 至此移动端四大列表加载（学生/任务/错题含分页/试卷）失败可见化全部收齐。
- 锁扩判据 1 条（App 无缓存首次加载试卷失败必须 Toast）；旧树（=r110q）实测 1 红/新树 0。
- Grading 完成按钮核查：发现已有 `disabled={{isSaving}}`，重练批改提交不会双发，**无缺陷未动**（该页属批改红线，只读确认）。
- 四道闸：单测 1577/1577｜lint 我方 0｜`dist_nightly_20261004r111q`｜preview:5244 冒烟全绿（12 条可见化文案进包实测）。

**第 112q 轮（2026-10-04，本赛道）已修复：错题本「切换学生竞态」（他会话移交的提案⑱-2）**
- 缺陷（PC stores 赛道第 105 轮深审发现并移交移动端赛道）：`loadWrongBookData`/`loadMoreWrongQuestions` 发起时捕获 studentId，但 await 落地前不校验当前学生——错题请求在途时换学生，晚到的 A 生响应会覆写全局 `wrongQuestions/bankCounts/offset`，展示层按 B 过滤后为空→卡「这个分类暂时没有错题」空态且 bankCounts 串成 A 的计数，**不自愈**。
- 修复（A 级行为保持）：两函数 await 后、写全局 state 前加 `if (useStudentStore.getState().currentStudent?.id !== studentId) return` 丢弃旧响应；首屏加载先 `writeCache` 到 A 自己的 key（切回 A 可秒开）再守卫。
- 锁扩判据 2 条（两函数均必须含守卫）；旧树（=r111q）实测 2 红/新树 0（反向自检已实测）。
- 验证层级说明：race 本体未做真机驱动（本机后端连生产库、无 store handle、时序易飘），依仓内「点击不可抓时上源码锁」纪律，以「守卫文本存在 + 位置在 await 后/setWrongQuestions 前」的源码锁 + 四页渲染冒烟兼顾。
- 四道闸：单测 1577/1577｜lint 我方 0｜`dist_nightly_20261004r112q`｜preview:5246 冒烟全绿（回归：12 条前序文案仍在包）。

**第 113q 轮（2026-10-04，本赛道）已交付：【新靶子】周学习诊断报告「空数据闸」（PDF 产出物质量）**
- 负责人新方向：移动端打印/PDF 产出物。定位到「学习诊断」=移动端 `src/pages/WeeklyReport` + `src/utils/weeklyReportGenerator.js`。
- 产出物缺陷：两端下载入口（移动 `WeeklyReport` / PC `WeeklyReportWorkbench.vue:1059`）都写了 `if (!result) 提示「暂无学习数据」`，但 `generateWeeklyReport` 成功时从不返 null → 那条分支是死的 → 对 0 题学生也能牛出一份全 0/全空的家长转发物。
- 修复：生成器拉到数据后、渲染前 `totalQuestions===0 → return null`（接上两端死分支，不碰 PC 赛道文件）；移动端额外加 `hasReportData` 前置拦截 + 下载按钮空数据禁用（显示「本周期无学习数据」）。
- 新锁 `test/weeklyReportEmptyGuard.test.mjs`；**同时修正了两把锁的反向自检设计**：旧树每轮从 HEAD 重导，历史修复合入 HEAD 后旧树会 0 红误报 → 改为内联合成坏样本（永久触发全部判据，不依赖 git）。
- 四道闸：单测 1579/1579｜lint 我方 0 error（仅 2 条既存 warning：buildPaperCSS/isProd 未用，非本引入）｜`dist_nightly_20261004r113q`｜preview:5248 冒烟全绿（14 条文案进包，含新增两条周报空数据文案）。

**第 114q 轮（2026-10-04，本赛道）已交付：【UI】学习诊断页品牌主色对齐全局蓝 token**
- 发现真实不一致：移动端全局 `--primary: #3157D5`（蓝，已记录的跨端统一品牌色决策），但学习诊断页 `src/pages/WeeklyReport` 硬编码 `T.primary: #6366F1`（indigo）——旧值是从 `index.css` 一行**过时注释**拄来的（注释写“主色 Indigo #6366F1”，但实际 token 早已是 #3157D5）。页面颜色与其他页不一、像另一个 App。
- 修正（零逻辑变更、纯配色）：`T.primary #6366F1→#3157D5`、`T.primarySoft #E0E7FF→#E8EDFF`（对齐 index.css）；success/danger/warning/accent/text 实测已一致未动。注释里标了过时注释陷阱。
- 验证：属视觉/颜色（按仓内边界用渲染而非源码硬锁验）——构建成功 + 产物 chunk grep 实测 `#3157D5` 已入、`#6366F1` 已消 + 4 页渲染冒烟全绿。
- ❕ 遗留提案（B 级需拍板）：PDF 本体用墨绿 #0F6B6D“成长绿”体系（weeklyReportGenerator.js 注释显示是刻意设计），与 App 蓝不一致——整份报告是否改统一品牌蓝，属跨文档品牌决策，只提不擅改。
- 四道闸：单测 1579/1579｜lint 0｜`dist_nightly_20261004r114q`｜preview:5250 冒烟全绿。

**第 115q 轮（2026-10-04，本赛道）已交付：【PDF 产出物】只读可视化质检 + 修空白趋势图 + 加掌握度分布**
- 负责人授权①只读可视化：建 `_r115q_pdf_preview.mjs`（dev server 动态 import 纯函数 `buildDiagnosisHTML` + headless 全页截图），拉真实 GET 数据渲染成 PNG 肉眼质检。**零写库**（不碰 generateWeeklyReport 的建卷路径）。实测发现（学生陆晨曦 298 题 mode=all）：
  - ❶ **正确率趋势图完全空白**（只有网格线）——mode=all 时 `dailyTrend` 为空，旧版无条件渲染空折线图，看起来像坏掉。
  - ❷ 数据密度低，页底大片留白。
- 修复（`weeklyReportGenerator.js`，纯渲染）：
  - `hasTrend=false`（无日维度数据）时，概览页用新增的 **`renderSubjectBarChart`（各学科正确率横向条形图）** 替代空折线图；有趋势数据（week）仍走折线。
  - 新增 **`renderMasteryDistribution`（知识点掌握度分布：待加强/需关注/需巩固 计数）** 填充概览页、提高数据密度。
  - 补 `.bar-chart/.mdist-row` CSS；修 buildDiagnosisHTML 未解构 `knowledgeDiagnosis` 的引用。
- 重渲染自检：空白趋势图已变学科正确率条 + 掌握度分布 4/1/0——数据密度上来、不再像坏掉。
- ❕ 数据边界（提案）：payload **无「章节/错因」字段**（knowledgeDiagnosis 只有 subject/tag/wrongCount/accuracy）——要加章节/错因需改后端 `weeklyReport.js`（对方在飞）+ DB 查询，属 C 级，只提不擅做。学科诊断页只展 TOP5（后端 buildSubjectDiagnosis 截断），同样需后端才能扩。
- 四道闸：单测 1589/1589｜lint 0 error（仅 2 条既存 warning）｜`dist_nightly_20261004r115q`｜可视化渲染自检 PNG 实测（对 PDF 产出物，真机 PNG 即最贴切冒烟）。

**第 116q 轮（2026-10-04，本赛道）已交付：【PDF 产出物】新增「知识点掌握度明细」独立页（数据密度）**
- 只读可视化质检的第二个发现（决定性）：后端 `knowledgeDiagnosis` 实测返回 **133 条**知识点（带 wrongCount/totalCount/accuracy），但旧版学科页只用了 `subjectDiagnosis.topTags` 每科 TOP5——**128 条真实数据被丢弃**。这正好是负责人要的「数据性内容多、细化、显得真实」，且零后端改动。
- 新增 `renderKnowledgeDetail`（错题≥2、按错次降序、最多 24 项，带正确率条）+ 独立「03 知识点掌握度明细」页（`.page` 固定高 1123px overflow:hidden，24 行塑学科页会裁切，故单独成页）。
- 重渲染自检：报告 3页→**4页**（封面/概览/学科诊断/知识点明细），明细页 24 行完整不裁，数据密度大幅提升。
- 数据边界（再确认）：`questions` 表**无章节/错因列**（只有 question_type/ai_tags/confidence）——章节需 questions↔unit 关联（无列），错因需新采集（AI 分类）；均属 C 级后端/数据工作，只提不擅做。
- ⚠️ 并发 hazard 实记：本轮首次编辑后，`weeklyReportGenerator.js` 被另一会话回退到 r115q 提交态（未提交的 r116q 改动被抹），已重新应用全部四处（函数/CSS/变量/新页）。教训：移动端 PDF 改动要快改快提，降低被并发 checkout 抹掉的风窗口。
- 四道闸：单测 1585/1585｜lint 0 error（仅 2 条既存 warning）｜`dist_nightly_20261004r116q`（明细页内容已入 chunk）｜真机 PNG 渲染自检（4 页完整）。

**第 117q 轮（2026-10-04，本赛道）已交付：【PDF】接入「错因分布」（复用已有 diagnosisService，不重造）**
- 负责人明确：错因是重要信息，系统里已有相关代码，只调用不重造。实测定位：`server/services/diagnosisService.js` 已回填 `wrong_questions.error_type`（启发式+LLM+词表约束+周定时），**PC 版学习诊断已在展示错因分布**（`WeeklyReportWorkbench.vue` 读 `errorDistribution`），只是移动端 PDF 没接。
- 后端 `weeklyReport.js`（我的 PDF 数据端点）：新增按学生+周期的 `GROUP BY error_type` 聚合（排除空题 is_blank），作用域改成本生，与 teaching.js 同一口径，返回 `errorDistribution`。
- 前端 `weeklyReportGenerator.js`：新增 `renderErrorDistribution`（带色条形图）接入学科诊断页。实测真实数据：计算错诶 51% / 概念不理解 21% / 审题错误 13% / 步骤遗漏 7% / 粗心 3%…
- 并发：4000 后端被对方 keep-alive 占着 kill 不掉，另起 4100 实例加载新代码验证（只读 GET）。新锁 `test/weeklyReportErrorCause.test.mjs` 守两端链路不被静默改没。
- 四道闸：单测 1591/1591｜lint 0 error｜`dist_nightly_20261004r117q`（错因分布已入 chunk）｜真机 PNG 渲染自检（学科页错因分布 8 类彩色条完整）。

**第 118q 轮（2026-10-04，本赛道）已交付：【PDF/UI】封面底部新增「本周期速览」核心数据带**
- 封面页下半部大片空白（只 3 个价值卡 + slogan）→ 底部加一行真实核心数据：整体正确率 / 记录题量 / 新增错题 / 完全掌握（彩色），既补白又提数据密度，家长封面即看到重点。
- 真机 PNG 自检：封面不再头重脚轻，4 页版式均衡。
- 四道闸：单测 1607/1607｜lint 0 error｜`dist_nightly_20261004r118q`（cover-metrics 已入包）｜真机 PNG 渲染自检。
- 本赛道「学习诊断 PDF」阶段小结（r113q→r118q）：空数据闸 + 品牌色对齐 + 修空白趋势图 + 学科正确率条 + 掌握度分布 + 133条知识点明细页 + 错因分布 + 封面速览带。诊断部分从“3页大片空白、趋势图坏掉”变“4页数据密实”。

**第 119q 轮（2026-10-04，本赛道）已交付：【重练卷】题量上限 RETRY_CAP 20→30（负责人“题目数据可扩大点”）**
- 负责人对第二部分重练卷的要求“题目数据可扩大点”：`RETRY_CAP` 20→30。后端已按学科均衡+错次排序，取的是最该重练的前 30（仍可一周内完成，覆盖面更广）。
- 属重练组卷口径（C 级敏感区），本轮改动基于负责人明确指令；数字可再调（一行）。无测试锁 20，lint 0 error，单测 1607/1607，构建 OK。

**第 105 轮深审移交（PC 工作台 stores 赛道会话产出，供移动端赛道接手）**
- ⛔ **App.jsx 错题本「切换学生竞态」**（提案⑱-2，详见 backlog）：`loadWrongBookData`
  /`loadMoreWrongQuestions` 发起时捕获 studentId、落地前不校验当前学生 → 在途响应晚到
  会覆盖新学生数据，错题本卡空态且不自愈。**它与 r108q/r109q 的「失败 Toast」是两回事**
  （成功响应串学生 vs 失败反馈），尚未被覆盖，建议下轮核实修复（落地前校验 currentStudent.id）。
- 移动端其他接手提示（历史）：首屏 400 已由 r109q 取证不复现 → 降为「待观察」；
  PullToRefresh 回归前查 `vite.config.js online manualChunks`；首页直达上传按钮被负责人否决，勿重提。

**第 129 轮（2026-10-04，PC 工作台赛道）已交付：静默失败 / 失败伪装成空态 整类修复**
- 为什么落在 PC 工作台赛道：r120–r128 连续 9 轮按文件巡检 0 发现；改按**缺陷类**扫后，
  命中的 8 处全在 `src/workbench/views/**`（ExamWorkbench / WeeklyReportWorkbench /
  HandoutPreview / WrongBookCenterRedesign）——移动端同类已由 r105q–r111q 收干净，PC 侧此前没扫过。
- 改动仅 4 个 views 文件（+26/-1、+33/-3、+18/-1、+2/-1 行级），零逻辑变更：只补
  `ElMessage.error` 与「错误态 + 重试」（复用既有 `EmptyState` 组件）。
- 回归锁 `test/workbenchSilentFailure.test.mjs`（16 条；反向自检内联合成坏样本，不依赖 git）；
  旧树对跑 8 红/8 绿、新树 16/16 绿。
- 四道闸：单测 1642/1642｜lint 9e/155w（与基线一致）｜`dist_nightly_20261004r129`｜
  render_smoke 8/8 + 定向页探针 14/14（讲义页用 route.abort 拦生成请求，零写库）。
- 本赛道待办（未动，留接手）：`WeeklyReportWorkbench.loadStudents/loadGrades` catch 只 warn（影响低）。
- ⚠️ 在制区未碰：`QuestionDetailPanel.vue` + `test/reviewExcludeNoUndo.test.mjs`（另一会话，仍为未提交态）。
