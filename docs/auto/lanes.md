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
- 109q 候选：①`loadTasks`（App.jsx:443）/`loadGeneratedExams`（576）失败无反馈（有缓存兑底，优先级低）②首屏偶发 400 抢跑定位③ExamReview 页错误可见性审计。
