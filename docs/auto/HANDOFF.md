# 交接文档 — 敏学持续优化循环

> **写给接手的模型**：读完本文档 + 仓库根目录 AGENTS.md + docs/auto/flow-audit.md + docs/auto/backlog.md，即可继续运行这条持续优化循环。写于 2026-10-03，因负责人额度暂时耗尽而交接。

## 一、这个系统是什么

敏学：晚托班老师（负责人本人，**唯一用户**）的个人系统——作业拍照上传 → OCR/AI 批改 → 错题入库 → 重练。产品哲学：**小而美**（个人使用，优先优化现有流程与 UI 美化，警惕功能膨胀，鼓励提删除建议）。

- 移动端 `src/`（React，负责人现场操作）
- 教师工作台 `src/workbench/`（Vue）
- 后端 `server/`（Express + BullMQ/Redis + Neon PostgreSQL）
- 详细规范：仓库根目录 **AGENTS.md**（必读，含用户模型与小而美原则）

## 二、循环机制（如何继续运行）

1. **接力锁**：仓库根目录 `_loop_state.json`（已被 gitignore 覆盖）——`{state: "running"|"finished", round: 总轮次计数, startedAt/finishedAt}`。
2. **一轮的完成定义**：修复→测试成功→推送，或提案发出并记录。
3. **接手后第一件事**：读锁——finished → 开工（round+1，写 running）→ 执行一轮 → 收尾推送 → 写 finished → **立即开下一轮**（自循环，不等定时）。
4. **防止重复**：state=running 时任何新触发的会话立即静默退出（接力锁防重叠）。
5. **原触发器**：ZCode automation `automation-e2f72a29`（2 分钟脉冲，现已因额度暂停——接手模型若在 ZCode 内运行可重新启用；不在 ZCode 内则自循环即可，无需定时器）。

## 三、必须遵守的纪律（违反 = 事故）

1. **上线安全铁律（最高优先级）**：每次 git push 触发线上自动部署。**推送前必须过四道关**：① npm test 全绿；② lint 无新增 error；③ 构建成功（BUILD_OUTDIR=dist_nightly_日期 隔离，绝不写 dist/）；④ **真机级冒烟——构建产物用 `BUILD_OUTDIR=<目录> npx vite preview --port 5210` 跑起来，浏览器自动化实测移动端首页与工作台真的渲染（root 有子节点、非白屏）**。冒烟不过不推送。
   - 事故复盘（2026-10-03 白屏）：单测全绿 + 构建成功，但页面渲染不出来——单元级检查抓不到，只有真机冒烟能抓。**负责人不应成为线上事故的发现者**。
2. **自决权三级**：A 直接干（行为保持型缺陷修复/死代码/顺手化/文档）；B 提案等确认（产品向决策）；C 永不（删用户数据/改 eslint 规则或 ignores（例外：负责人已批准的准确性修正）/放宽任何门禁/写生产数据库或 Redis/批量调付费 AI·OCR 超 5 次）。
3. **硬禁区（只能提案，不得动手）**：数据库 Schema/迁移；批改主流程（server/worker.js）设计变更；错题生命周期语义与合并规则；重练与组卷口径；掌握度口径；练习册答案解析质量闸；judgements 审计语义；共享服务与公共 API 行为变更；任务状态机；**判题/答案解析服务里的正则与转义（flow-audit 第七节敏感区地图——批量清除会改变判题语义）**。
4. **长期授权**：A 级 + 四道关全过 → 直接 git add/commit/push 到 main，无需请示（紧急 revert 也可）。
5. **修复纪律**：红灯回归测试优先（无法组件级测试的给出可复现路径）→ 修 → 全绿 → 冒烟；修不动就回滚并报告，不留半成品。
6. **卫生**：根目录 `_*` 与 dist 快照不是真实代码；改文件前 git ls-files 确认被跟踪且从正式入口可达。

## 四、当前系统状态（交接时刻）

- **测试基线**：1453 全绿；lint：204 项（14 errors 历史遗留 + 190 warnings 条条可信）
- **第 74 轮（2026-10-03）已交付**：方向二批次执行完成（+71 张矢量配图，从未尝试池清零）；新执行器 `server/scripts/rerunNeverTriedGeometry.mjs`。
- **第 75-77 轮已交付**：拓扑保真闸（修「回灌修正把图搬反」）+ 分数面积模型确定性通道 + 等比刻度短线（tick）图元 + 裁决 A 执行（3 回填 + 1 重跑，真模糊裁片归零）。几何重绘现有**五条**确定性通道：函数图象 / 数轴 / 面积模型 / DSL / 视觉目测。测试基线 1453 → **1469 全绿**，lint 仍 14 errors / 182 warnings。
- **第 77 轮重要纠正**：第 74 轮登记的「74 个 completed 虚高、老师看模糊裁片」**结论不成立**——只查了取图链第 1 级字段。按 `getGeometryDisplayUrl` 七级链重测：75 个里 73 个已走优先级 5 显示已发布干净图，真模糊裁片只有 2 个（已处理）。**教训：任何“产物不可见”的判定必须逐条跑完前端取图链，不得只看单字段。**
- **待办队列（按负责人已给的裁决顺序，接手后从 79 开始）**：
  1. 第 78 轮 = 裁决 ⑨「补裁」—— ✅ **已完成**：`83434db3`/question `2b4aaeec` 的图是四选项并排整条，而 `image_bbox` 只有 1031×143 像素（裁到一格半）；人工定框后走生产同一个 `cropAndUploadGeometryImage(skipRefine)` 重裁，重跑重绘四格全对（过程与可泛化提案见 backlog 第 78 轮）。
  2. 第 79 轮 = 裁决 ⑪「要」：把面积模型确定性通道从「1/2 起分母翻倍」扩展到其它等分版式（如 1/3 系）。
  3. 再往后 = 裁决 ⑤「开」：~90 条多行死声明清理（分批）。
  4. 裁决 ⑫ = **不升级**那 72 个 TikZ 时代资产（它们已在显示已发布干净图，属锦上添花）——**已关，勿再提**。
- **四条常驻测试闸**：哨兵行为（quotaSentinel.test）｜工作台 store 导入锁｜Vue 模板锁｜移动端导入锁（mobileApiImports）
- **全局错误护栏**：workbench main.js 的 app.config.errorHandler + 移动端 ErrorBoundary（均已上线）
- **数据备份**：`D:/Minxue_Backup/2026-10-02/`（5 表 8.5MB 快照）+ scripts/dailyBackup.mjs（每晚 21:30 自动 + 可手动跑）
- **配额哨兵**：/api/quota/status 接口 + 顶栏降级横幅（QuotaBanner.vue）
- **预览实例**：后端 4000（node server/index.js）、前端 5199（vite）——**可能已死，接手后先 curl 探测，死了就重启并验证**
- **流程地图**：docs/auto/flow-audit.md（11 页面体检 + 粗糙点 + 可删清单 + 敏感区地图）

## 五、未完成任务（按优先级，含执行细节）

### 1. 方向二批次执行（负责人已批准预算）—— ✅ **已于第 74 轮执行完毕（2026-10-03）**
- 结果：目标池实测 79 个（非 94），全部跑完 → **出图 71 / 未出图 8**（其中 5 个闸门正确拒绝 + 3 个 failed 可重试），全库 completed 384 → 455，从未尝试池已清零。**不要重跑本项。**
- 执行器：`server/scripts/rerunNeverTriedGeometry.mjs`（`--dry` / `--limit=N` / 进度写 `tmp/rerunNeverTriedGeometry.progress.json`）。
- 详细数据、肉眼复核结论、两个新拍板项（零/少标注产物是否回退、completed 与展示层脱节 74 个）见 `docs/auto/backlog.md` 第 74 轮执行结果节。

### 2. ~90 条多行死声明清理（分批消化）—— 负责人已给「开」（排在几何两项之后）
- refs=1 验证器模式已备好（见 test/mobileApiImports.test.mjs 同款逻辑 + 本轮 _verify2.mjs 模式——单行完整声明已清完，剩余为多行声明块）。
- 需要"声明块级删除"工具：从 decl 起始行起，花括号/圆括号配平后整块删除；.js 文件用 node --check 兜底，.jsx 靠测试+构建。

### 3. PullToRefresh 回归（暂缓）
- antd-mobile PullToRefresh 引入曾致 vendor 分包断裂白屏（已回滚，见 git 67af8bd 与回滚提交）。回归前必须先查 vite 分包配置（manualChunks）——这是**待办的打包配置排查**。

### 4. 可删候选（等负责人方向）
- 三个数据分析页（学习诊断/成长中心/错题中心）重叠度、试卷答案库/我的题型库使用频率、移动端页面使用频率——需要负责人说"每天实际用哪几个"。

## 六、已交付成果索引（勿重复建设）

- **配额哨兵**：server/services/quotaSentinel.js + routes/quota.js + 顶栏 QuotaBanner.vue（降级横幅）
- **家长成长卡**：GrowthCardButton.vue（复用 weeklyReport 聚合）
- **KPI 诚实化 + 真趋势**：GrowthWorkbench.vue（错题已掌握率正名 + 真实周环比）
- **四条测试闸** + 全局错误处理（workbench errorHandler + 移动端 ErrorBoundary）
- **数据保险库**：scripts/dailyBackup.mjs
- **审计工具**：scripts/auditStoreContract.mjs（store 契约审计）
- **仓库治理**：1.1GB 历史垃圾归档至 D:/Minxue_Archive/；lint 从 644 噪声 → 204 可信信号

## 七、已知遗留风险

- **方向一自愈机制未实施**（提案等确认）：processing 超时任务自动重入队 + failed 按类自动重试——涉任务状态机，等批准。
- eslint 配置仍缺 eslint-plugin-vue / typescript-eslint（.vue 模板层靠自建锁补位）。
- Minxue Deploy 自动提交守护进程仍在运行（作者为 Minxue Deploy 的提交是它做的）——不要与它抢写。
- 预览后端/前端后台进程会被系统回收——每轮开工先 curl 探测 4000/5199。

## 八、给接手模型的三句话

1. **先读 AGENTS.md**——单用户系统、小而美、每张卡片都要能回答"数据从哪来"。
2. **四道关全过才推送**——白屏事故的教训用血写的。
3. **负责人的时间最贵**——每轮必须交付实物（修复/顺手化/美化/提案），空转巡逻就是失职。
