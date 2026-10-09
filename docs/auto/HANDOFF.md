# 交接文档 — 敏学持续优化循环

> **写给接手的模型**：读完本文档 + 仓库根目录 AGENTS.md + docs/auto/flow-audit.md + docs/auto/backlog.md，即可继续运行这条持续优化循环。
> 上一版交接写于 2026-10-03（额度耗尽）；本版重写于 2026-10-03 晚，交接人已完成第 74–83 轮（10 轮，10 个提交，全部已推送 main）。

## 一、这个系统是什么

敏学：晚托班老师（负责人本人，**唯一用户**）的个人系统——作业拍照上传 → OCR/AI 批改 → 错题入库 → 重练。产品哲学：**小而美**（优先优化现有流程与 UI 美感；新增功能必须审慎；鼓励主动提删除/合并建议，警惕系统膨胀）。

- 移动端 `src/`（React，负责人现场操作）
- 教师工作台 `src/workbench/`（Vue）
- 后端 `server/`（Express + BullMQ/Redis + Neon PostgreSQL）
- 详细规范：仓库根目录 **AGENTS.md**（必读，含用户模型与小而美原则）

## 二、循环机制（如何继续运行）

1. **接力锁**：仓库根目录 `_loop_state.json`（已被 gitignore 覆盖）——`{state:"running"|"finished", round, startedAt/finishedAt, note}`。当前值：`finished / round 83`。
2. **一轮的完成定义**：修复→测试成功→推送，或提案发出并记录。
3. **接手后第一件事**：读锁——finished → 开工（round+1，写 running）→ 执行一轮 → 收尾推送 → 写 finished → 交报告。
   ⚠️ **负责人明确要求的节奏（长期记忆已固化）**：每轮必须「做完 → 四道闸 → 提交推送 → 在对话里交付本轮报告」之后才允许开下一轮；不允许同一次会话连吞多轮不上报。
4. **防止重复**：state=running 时任何新触发的会话立即静默退出。
5. **触发器**：**ZCode automation `automation-864c8134`**（2026-10-04 重建；负责人要求把脉冲从 30 分钟提到 **5 分钟**，见 `docs/auto/backlog.md` 第 114 轮记录）。规则：读到锁=running 静默退出，finished 才开新轮。不在 ZCode 内则自循环即可。
   - ⚠️ 注意：**WorkBuddy 那边的定时任务粒度最小是「每小时」**，做不出 5 分钟；本循环的 5 分钟脉冲只有 ZCode 这条线能跑。若发现脉冲停了，先确认 ZCode 在不在运行。
6. **写生产库/花钱的批量动作，必须等负责人逐条点头**（他的授权是"按事项"给的，不是永久的）。

## 三、必须遵守的纪律（违反 = 事故）

1. **上线安全铁律（最高优先级）**：每次 git push 触发线上自动部署。**推送前必须过四道关**：① `npm test` 全绿；② lint 无新增 error；③ 构建成功（**`MSYS_NO_PATHCONV=1 VITE_API_URL=/api CODEBUDDY_SAFE_DELETE_ENABLED=0 npx vite build --outDir dist_nightly_日期rN`**，绝不写 dist/。`VITE_API_URL=/api` 强制产物全走本地代理——不带会把 `.env.production` 的生产 API base 烤进包，冒烟变相直连生产（r95 实证）；`MSYS_NO_PATHCONV=1` 防 Git Bash 把 `/api` 改写成 `C:/Program Files/Git/api`（r95 实证））；④ **真机级冒烟**——`npx vite preview --port <端口> --outDir <隔离目录>` 跑起来（**必带 `--outDir`**，不带服务的是陈旧 `dist/`，r94 实证），并用浏览器自动化实测移动端首页与工作台真的渲染（挂载点有子节点、innerText 有真实文字、0 控制台错误、0 个 4xx/5xx）。冒烟不过不推送。
   - **本机浏览器窗口常处于隐藏态，`take_screenshot` 必然超时** → 冒烟改用「JS 求值读 DOM」，并在指令里明确"禁止截图"。要肉眼看图，用 `@napi-rs/canvas` 本地栅格化（见 `tmp/geo_montage.mjs` 范式）。
   - **冒烟标准工具已入库（r96）**：`scripts/gate/cert_probe.mjs`（零外联验证）+ `scripts/gate/render_smoke.mjs`（双端真渲染 8 项）+ `scripts/gate/README.md`（前置命令三件套）。直接跑，不再每轮重写临时件。
2. **自决权三级**：A 直接干（行为保持型缺陷修复/死代码/顺手化/文档）；B 提案等确认（产品向决策）；C 永不（删用户数据/改 eslint 规则或 ignores/放宽任何门禁/写生产数据库或 Redis/批量调付费 AI·OCR 超 5 次）。
3. **硬禁区（只能提案，不得动手）**：数据库 Schema/迁移；批改主流程（`server/worker.js`）设计变更；错题生命周期语义与合并规则；重练与组卷口径；掌握度口径；练习册答案解析质量闸；judgements 审计语义；共享服务与公共 API 行为变更；任务状态机；判题/答案解析服务里的正则与转义。
4. **长期授权**：A 级 + 四道关全过 → 直接 git add/commit/push 到 main，无需请示（紧急 revert 也可）。
5. **修复纪律**：红灯回归测试优先（无法组件级测试的给出可复现路径）→ 修 → 全绿 → 冒烟；修不动就回滚并报告，不留半成品。
6. **卫生**：根目录 `_*`、`tmp/`、dist 快照不是真实代码；改文件前 `git ls-files` 确认被跟踪且从正式入口可达。
7. **本轮次新沉淀的三条硬纪律（都出过事，务必遵守）**：
   - **批量写库/批量改文件前，必须先抽样肉眼验证"检测器"精度**。第 79/80 轮两次实测自动判据精确率仅 ~12%，盲做会把九成正常数据改坏。
   - **任何会写文件的命令，绝不能用 `… | Select-Object -First N` 取输出**——PowerShell 会提前终止上游进程，node 在 `writeFileSync` 中途被杀会把文件截成空文件（第 83 轮真实发生，`server/backfillTags.js` 251 行被清空，靠 `git checkout` 救回）。要 `> file 2>&1` 再读文件。
   - **改裁片/改产物必须把"同一事实的全部表达字段"一次对齐**。第 78 轮只改了裁片 URL 没回写 `image_bbox`，导致第 80 轮自动流程差点把人工修复退回（详见长期记忆）。
   - 附：PowerShell 重定向 node 中文输出会按 GBK 解码变乱码 → 先 `[Console]::OutputEncoding = UTF8`，或让脚本自己 `fs.writeFileSync` 落盘再读。

## 四、当前系统状态（2026-10-04 实测，非记忆值）

- **测试基线**：`npm test` **1582 全绿**（2026-10-04 实测；第 74 轮接手时为 1453）。
  ⚠️ 该数字随每轮增长，**不要照抄本文档**——以当轮 `npm test` 实测为准（本文历史上多次写成过期值）。
- **lint**：**9 errors（历史遗留，未动）+ 152 warnings**（接手时 190；第 82-83 轮死声明清理降一波，第 103 轮再降到 9 errors）。
  ⚠️ 同样是实测值，别照抄。
- **几何配图（实测）**：geometry_image 资产 501 个 = completed **457**、闸门拒绝 44、从未尝试 **0**、failed **0**、在途 0。
  展示层真相：completed 的 457 个里 **内联 SVG 384 / 只有已发布位图 URL 72 / 真在显示模糊裁片 0**。
- **五条确定性通道**：函数图象 / 数轴 / **分数面积模型（新）** / DSL 构造 / 视觉目测。
- **讲题白板（r86 后）**：工具 = pen / eraser / **laser**；快捷键 `1-4` `[` `]` `E` `L` `Y` `Z` `A` `O` `F` `U` `R` + 方向键/Home/End；
  有重做（`redoStack`）；清屏需二次确认（3s 窗口）。**激光笔走独立 `.dc-laser` canvas，绝不写 strokes**；
  **样式 = 笔迹式激光 + 抬手 1 秒渐隐（r97 改；⚠️ 已覆盖 r93 的「无拖尾 + 抬手即消」）**：
  激光像笔一样留下连续笔迹（`laserStrokes` 数组，各笔独立倒计时），抬手后 `LASER_FADE_MS = 1000` 内按 alpha 渐隐、到时整笔移除；
  一秒内的连续多笔互不影响（画框时前面的笔迹不提前消失），正在书写的笔不参与倒计时。回归锁 `test/laserInkFade.test.mjs`。
  选中激光笔时手指归指针、横滑切题暂停。验证脚本 `_r85_board_verify.mjs`（gitignore 的根目录 `_*` 临时件）。
- **白板导出板书图（r86 新修）**：题干不再以 LaTeX 源码印在图上。离屏 `.dc-export-render` 层用**屏幕同一个
  `MathRender`** 渲染 → `html2canvas` 光栅化（`onclone` 内联 `KATEX_CSS_WITH_FONTS` + `fixFractionLineInCloneDoc`）
  → 贴进导出图；失败回退旧 `fillText`。⛔ 该层必须 `Teleport to="body"` 且**不能加 `z-index:-1`**（都会被裁成空白）；
  ⛔ 标题是纯文本不走 MathRender（否则 `10-03` 变 `10 − 03`）。验证脚本 `_r86_board_export_verify.mjs`（12/12）。
- **板书本地存储（r87 新修）**：笔迹点量化到 2 位小数（`src/workbench/utils/strokePoint.js`，在
  `DrawingCanvas#pointFromEvent` 出口做），单点 48.7→~31 字符、体积约减半；`saveStrokes` 写不进时
  先回收当前题的旧键再重试，仍失败用**页内 hint** 明确告知（原为静默 `catch`）。验证脚本
  `_r87_board_storage_verify.mjs`（13/13，含把 localStorage 真填满 4.99MB 的告警路径）。
  **配额回收入口（r89 已交付）**：顶栏「本机板书」→ 看占用（进度条 + 5MB 基准，≥80% 变红）、
  按题列出（锚点翻成人话：`练习册 第 X 页 第 Y 题 · 题干`）、逐条删 / 一次清空，两次点击确认。
  ⛔ 只列「真写过字」的题（切题时 `saveStrokes()` 会给没写字的题留 `'[]'` 空壳，不滤掉列表会被灌满）；
  脏数据（非 JSON）保留可删。⛔ **删到「正在讲」那一题时必须连板面一起清** —— 只删存储是假的，
  屏幕上那份在内存里，离开这题时 `saveStrokes()` 会原样写回同一个键（打开弹窗前也会先补落盘，
  否则列表数字漏掉刚写的一笔）。回归锁 `test/boardStorage.test.mjs`（12 例，含反向自检）。
  验证脚本 `_r89_storage_verify.mjs`（27/27，dev + 隔离产物各跑一遍）。
- **白板板书归属正确性（r88 新修）**：`saveStrokes()` 按 `current` 算键，所以**任何换可见题单的动作
  都必须先落盘旧题**。「只看未讲」切换原实现先换 `unTaughtOnly`/`viewSnapshot` 再 `saveStrokes()`，
  会把当前题的板书写进**新题单同下标**那道题的键里 —— 既串题又覆盖掉那道题原有的板书（已实测复现并修）。
  `onPageHide` 也补了一刀 `saveStrokes()`（`onBeforeUnmount` 会先 `clearTimeout(saveTimer)`，
  否则「写完字 300ms 内离开」的最后一笔必丢）。回归锁 `test/weekendBoardViewSwitchOrder.test.mjs`（4 例，
  源码级顺序锁，已反向自检过「套在修复前版本上会判红」）。验证脚本 `_r88_board_view_switch_verify.mjs`（17/17）。
- **任务自愈的对外呈现（r90 新修）**：自动重试**一直在跑**（`index.js:4513` 无条件 `start()`，默认 5 分钟一轮），
  但失败行在两次扫描之间（最长 5 分钟；配额类等到自然日重置）一直显示成「识别异常 / 重新上传」⇒ 老师点了白等，
  还和服务端自动重捞撞车（同一份作业两个 job 各处理一遍，重复烧配额）。**修法不是加提示文案**（负责人已否决），
  而是**这类失败不显示成失败**：服务端 `pendingTaskRecovery.js#describeAutoRetry` 是唯一判定实现（随
  `/api/tasks/student/:id` 的 `auto_retry` 与摘要的 `autoRetry` 下发），前端 `src/domain/taskAutoRetry.js`
  只翻译不重算（**缺字段一律按"不自愈"**，防老缓存把真失败藏起来）。三处入口：移动端任务页新增
  `'self-healing'` 档（**排在 failed 之前、不算 `bad` ⇒ 那一行没有按钮**、转圈 + 「正在处理」）、
  移动端首页（自愈不算失败也不算卡死 ⇒ 落进「作业批改中」）、PC 批改中心（自愈 → `workflowStatus: processing`）。
  手动重试也不撞车：`retryTaskById` 在途去重（`alreadyQueued`，不动 status/retry_count/last_error）。
  ⛔ **SQL 的 ILIKE 名单 ≠ JS 正则**（SQL 拒绝话术只有 9 项、配额只有 7 项，`isAIRefusalLikely` 多认
  无法识别/看不清/页识别失败/AI_EMPTY）⇒ 对外判定必须**照 SQL 走**，否则界面替系统许下不兑现的承诺；
  漂移锁从源码抠 ILIKE 字面量做集合相等断言。⛔ 配额分支**不能**按常规 3 次判（SQL 配额分支不看 retry_count，
  跨日必捞；判成 gave-up 等于说"系统放弃了"而实际明天会自愈）。回归锁 `test/taskAutoRetry.test.mjs`（21 例，已反向自检）。
  验证脚本 `_r90_autoretry_verify.mjs`（19/19）、`_r90_pc_verify.mjs`（6/6）、`_r90_smoke.mjs`（27/27），
  三者 dev 与隔离产物各跑一遍。**生产库当前 0 条 failed、队列 0 在途 job ⇒ 验这类改动必须造数据**：
  只打桩任务列表接口，每行的 `auto_retry` 用真实 `describeAutoRetry()` 现算。
- **工作台数据页合并（r91 新交付）**：三个数据分析页 → 一个。成长中心（`/growth`）与错题中心（`/wrongbook`）
  下线，均留 redirect 兜底（`/wrongbook?studentId=X` 落该生档案页，无参数落学生列表）。
  ① **家长成长卡**（`GrowthCardButton`）搬进学习诊断底部输出条**最右**；
  ② **错题清单**以 `WrongCardCenterRedesign` 自带的 `embedded` 形态嵌进学生档案页
  （`<section id="student-wrong">`，源码注释本来就写着"嵌在学生档案页的错题 tab 里"，只是从没接上）；
  「下一步建议」的两条 CTA 由跳路由改为**页内滚动**（`scrollToWrong()`）；
  ③ 侧栏「教学工作」只剩 **批改中心 / 学习诊断 / 学生管理**，10 处入站链接改指，删死勾选框。
  ⛔ **两条必须记住的坑**：① `GrowthCardButton` 是**多根节点组件**（`el-button` + `el-dialog` + Teleport），
  Vue **不透传 class** ⇒ 定位类挂它身上会被静默丢弃，只在控制台留一条
  `Extraneous non-props attributes` **warning**（不报错，扫日志极易漏）——定位类必须挂外层元素；
  **验对齐要看几何位置，不能只看"按钮存在"**。② 工作台内容区**自己滚**（不是 `window`）⇒
  验页内滚动必须看 `getBoundingClientRect().top` 变化，`window.scrollY` 恒为 0。
  回归锁 `test/dataPageMerge.test.mjs`（12 例，已反向自检 33/33）。验证脚本
  `_r91_pc_verify.mjs`（25/25）+ `_r91_smoke.mjs`（33/33），dev 与隔离产物各一遍。
  ⛔ **构建坑**：`vite build --outDir <已存在目录>` 需清空目录，本机 `rmSync` 会被安全删除守卫拦下
  ⇒ 用 `CODEBUDDY_SAFE_DELETE_ENABLED=0 npx vite build --outDir ...`。
- **工作台入口可达性闸门（r92 新交付）**：把「所有导航目标」与「所有按钮绑的处理函数」变成可重复跑的检查，
  抓到两个真家伙 ——
  ① **新学生档案页的主按钮点了整页白屏**：「下一步建议」在学生**还没有作业记录**时给了
  `to: '/upload'` 的按钮，而工作台**没有上传页**（上传只在手机 App 做）；vue-router 匹配不到路由，
  **只打一条 warning**（不是 error，所以「0 控制台错误」抓不到），内容区整片空白
  （Playwright 取证：点击前内容长度 545 → 后 77）。现在不给按钮，文案改为「作业在手机 App 里拍照上传」，
  CTA 容器按 `nextAction.cta` 有无渲染。
  ② **复核页「查看错题池」绑了不存在的函数名**（`goWrongBook` vs `goToWrongBook`）⇒ 点了没反应。
  常驻闸门：`test/workbenchRouteTargets.test.mjs`（导航目标必须能被路由表接住，含**具名路由**）
  + `test/workbenchClickHandlers.test.mjs`（`@click` 绑的名字必须存在，函数型 prop 与 `$emit` 算已定义）。
  ⛔ **通用教训**：`0 控制台错误` 这个断言抓不到两类最常见的「点了没用」——
  「点了白屏」只打 vue-router warning、「点了没反应」只打 Vue warning，必须另加源码级入口锁。
  审计脚本 `_r92_route_audit.mjs` / `_r92_click_audit.mjs` 可随时重跑；反向自检 `_r92_lock_selfcheck.mjs` 7 条判红。
- ⚠️ **【已被 r97 取代，仅作存档】白板激光笔改「无拖尾」（r93 交付）**：负责人当时要求「无拖尾激光笔，抬起笔消失的那种样子」。
  2026-10-04 深夜负责人**推翻了该裁决**，改为「笔迹式激光 + 抬手 1 秒渐隐」——现行行为见上面「讲题白板」那条。
  下面保留的是 r93 当时的实现与验证记录；其回归锁 `test/laserNoTrail.test.mjs` **已随 r97 删除**，现由 `test/laserInkFade.test.mjs` 接管。
  旧实现是「红点 + 220ms 按点龄衰减的拖尾线段」（`laserTrail` 点缓冲 + `LASER_TRAIL_MS` + `LASER_MAX_POINTS`
  + 逐段 `lineTo` 折线 + 抬手后让最后一段自然过期）。现在 `laserPoint` 只存**当前那一个点**，
  `drawLaser()` 不画折线、不遍历历史点，`endLaser()` 丢点 + `cancelAnimationFrame` + **立即重绘清空光点层**。
  ⛔ **绝不改「激光笔不进 strokes」这条纪律** —— 导出板书 PNG 只读 `localStrokes`，「导出图不含光点」
  因此是天然成立的，不需要在导出侧加过滤；前提是激光笔代码一行都不碰 `localStrokes`。
  回归锁 `test/laserNoTrail.test.mjs`（6 例，反向自检 25 条判据 / 旧版判红 12 条）；
  验证脚本 `_r93_laser_verify.mjs`（15/15，dev + 隔离产物各一遍，**像素级**取证：
  拖动中光点外接框恒 26×26 宽高比 1.00（旧版拖尾 >8）、抬手后立即 0 像素、250ms 后仍 0、
  手写 canvas 像素数不变、strokes 无 `laser`、红点跟随指针偏差 0.5px）。
  目检截图 `server/scripts/logs/r93-look/`（during / after 两张）。
- **常驻测试闸（6 条）**：哨兵行为 quotaSentinel｜工作台 store 导入锁｜Vue 模板锁｜移动端导入锁 mobileApiImports｜`test/geometryTopologyGate.test.mjs`（第 75 轮）｜`test/areaModelChannel.test.mjs` + `test/geometryTickMark.test.mjs`（第 76 轮）。
- **全局错误护栏**：`src/workbench/main.js` 的 `app.config.errorHandler` + 移动端 `ErrorBoundary`（均已上线）。
- **配额哨兵**：`/api/quota/status` 接口 + 顶栏降级横幅 `QuotaBanner.vue`（三家供应商降级事件显性化）。
- **流程地图**：`docs/auto/flow-audit.md`（11 页面体检 + 粗糙点 + 可删清单 + 敏感区地图）；缺陷与候选池：`docs/auto/backlog.md`（只追加、只由人工关闭）。
- **可复用工具**：
  · `server/scripts/rerunNeverTriedGeometry.mjs` 单资产重跑管线（`--dry`/`--limit`/`--ids=<前缀>`，不经 Redis）
  · `server/scripts/backfillStaleQuestionSvg.mjs` “completed 但展示层无 SVG”的三档安全回填器（默认演练）
  · `scripts/pruneDeadDeclarations.mjs` 死声明清理器（真 AST 判副作用，默认演练，内置裁决③硬名单）
  · `tmp/geo_montage.mjs` / `tmp/fig_crops_view.mjs` / `tmp/fig_fix_one.mjs` 肉眼比对与单题重裁范式
- **预览实例**：后端 4000（`node server/index.js`）、前端 dev 3000（`npm run dev`）——**可能已死，接手后先 curl 探测**（r93 实测两者都活着；隔离产物预览在 5221-5225 段）。
- **数据备份**：`D:/Minxue_Backup/2026-10-02/`（5 表 8.5MB）+ `scripts/dailyBackup.mjs`（每晚 21:30 自动）。

## 五、未完成事项（按优先级）

### 1. 【✅ 已交付 · 第 85 轮】周末班课件 + 白板优化（P1/P2/N1/P3/P4/P5）

负责人已勾选：**P1 P2 N1 P3 P4 P5 全做**｜荧光笔**不做**｜全屏右侧工具栏**不挡、位置不动**。
执行方自决三项：N4 板书上云**暂缓**（单用户固定设备）、N3 图形吸附**先观察**、Q1 激光笔触发**照 `allowTouch` 同款规则**。

已落地：`1-4` 换色 / `[` `]` 调粗细 / `E` 橡皮 / `L` 激光笔 / `Y` 重做（`redoStack` 后进先出，新笔迹·切题·清空即失效）；
**激光笔**走 `.dc-laser` 独立 canvas（`pointer-events:none`），`tool==='laser'` 时 pointer 事件只走光点层并 return，
**绝不进 `startStroke/appendLivePoint`**，拖尾按点龄 220ms 过期 ⇒ 抬手即消、导出 PNG 天然不含；
清屏二次确认（首点变红 + 页内提示，3s 超时/切题自动复原）；删 `DrawingCanvas.resetView` 与 disabled 的 PPTX 前端入口
（含 `runGenerate`/`generating`/孤儿 `Download` 导入；**后端 `weekendPptxService.js` 与路由保留**）；
清 `fs=1` 过时 JSDoc 与死参数 `params.maxPerDay`。

顺手修：默认笔宽 `penSize=3` 不在三档预设（2/3.5/6）里导致第一次按 `[`/`]` 跳档 ⇒ `stepSize()` 改为方向吸附。

验证脚本：`_r85_board_verify.mjs`（30/30，含 preview 冒烟 + 白板交互；写接口全程拦截、零写生产库）。
细节见 `docs/auto/backlog.md` 第 85 轮交付节。**遗留观感问题**：默认 3 时工具栏粗细档无高亮（预设里没有 3），
根治需改默认笔宽为 3.5（行为变更，未做）。

### 2. 【✅ 已核实：不必立项 · 第 88 轮后复核】方向一：上传链路自愈

原提案写「`processing` 超时自动重入队 + `failed` 按错误分类自动重试（配额类等配额恢复自动重跑）」。
**第 88 轮后只读复核发现这套早已建好并已在线上跑**，立项 = 重复建设：

- `server/index.js:4513` → `pendingTaskRecovery.start()`，**无条件启动**、默认 5 分钟一轮；
- `server/pendingTaskRecovery.js`：`processing` 卡死 >6min 重排（`:415-492`）、`pending` >10min 重排（`:520-572`）、
  `failed` 按 `classifyLastError()` 分类重试（常规 3 / AI 偶发拒绝 10 / 瞬时下载 5+5min 冷却，`:250-380`）、
  **配额跨自然日自动放行并清零重试次数**（`:293-305`、`:340-355`）、配额耗尽全局熔断、练习册解析卡死 >15min 重置；
- 分类器有回归锁 `test/failedTaskRetryClassify.test.mjs`（含 2026-09-13「下载图片失败被整体拉黑」事故用例）；
- 移动端 `src/pages/ProcessingPage.jsx:31-52,136`（卡死判定 + 人话失败原因 + 重新处理/重新上传）；
  PC 端 `DashboardWorkbench.vue:371`（识别异常卡）+ `GradeCenterWorkbench.vue:377,199`（失败筛选 + 重试）。

⇒ **本项关闭，不得再作为「待批准的新工作」提出。** 只余两个小缺口（详见
`docs/auto/reports/2026-10-03-提案-上传自愈与数据页.md` 一、）：① 失败行未告知「系统还会自动重试」，
老师容易重复上传；② 「还会自动重试」与「已放弃」在 UI 上分不清。

**第 90 轮：两个缺口一起解决，但不是靠文案。** 负责人 2026-10-04 明确否决补文案 ——
「不想补『系统还会重试』这句话，你系统可以更聪明的办法，不让我自己手动点就可以了，
你自动进行尝试让我无感不是更好？」⇒ 落点改为「**自愈中的失败根本不显示成失败**」
（见四、任务自愈的对外呈现）：缺口 ① 消失（那一行没有按钮，老师不会去点）；
缺口 ② 由 `state` 分档回答（`quota-wait` 说"等 AI 服务恢复"、`gave-up`/`blocked` 才显示成失败）。

### 3. 【等开口】配图「裁多了」的 24 题越界 `image_bbox`

24/498 题的框超出页面（`y+height>1000` 或 `x+width>1000`）→ 裁图被夹到页底 → 裁片把评分文字/下一题/桌面框进来。**负责人裁决⑯ = 不动**（不夹框、不批量重裁，看到哪题图不对再点名修）。已关，勿再提，除非他重新开口。

### 4. 【暂缓】PullToRefresh 回归

antd-mobile PullToRefresh 曾致 vendor 分包断裂白屏（已回滚，见 git 6784a 前后）。回归前必须先查 `vite.config.js` 的 `manualChunks`——这是待办的打包配置排查。

### 5. 【✅ 已交付 · 第 91 轮】数据页合并（第 1 档 + 第 2 档）

**负责人 2026-10-03 答复**：三个数据分析页里**每天实际只打开「学习诊断」**（`/weekly-report`）。
据此已出合并/下线提案：`docs/auto/reports/2026-10-03-提案-上传自愈与数据页.md` 二。

**第 89 轮答复：第 1 档和第 2 档「可以做」**；**第 91 轮已全部执行完毕**（细节见四、工作台数据页合并
与 `docs/auto/backlog.md` 第 91 轮交付节）。两档都做了「页面下线 + 内容搬到真在用的页 + 老书签 redirect
兜底 + 清死 UI/死入口」四件事，家长成长卡与错题清单**都保住了**。

- **第 3 档**（试卷答案库 / 我的题型库等二级入口）**未问，等他说到再说**。
- **等拍板的一件事**：错题中心那对死函数 `createRetry` / `createRetryFor` —— 本轮只删了死勾选框，
  函数**保留但未引用**。二选一：(a) 把「生成重练卷」按钮接回来（PC 就能自己组卷）；
  (b) 连函数一起删（组卷只走移动端错题本 / 学习诊断「生成再测卷」）。

### 6. 【① 已交付 · ③ 等开口】板书本地存储配额迟早写满

**实测**：笔迹量化后一题仍约 **97 KB**（50 笔 × 61 点，`_r87_stroke_size.mjs` + `_r87_board_storage_verify.mjs`），
5MB 配额 ≈ **55 题**；按每周 10–20 题算约 **3–5 周写满**。写满后 r87 已做到「不静默」（页内提示去导出）。

**负责人 2026-10-03 答复**：采纳路线③，**先加「清空本机板书」入口**；
「三四周后要是发现老要点它，再上②换仓库」。⇒ ③ 已在 **第 89 轮交付**（顶栏「本机板书」，
零自动删除、只由老师动手，详见四、白板条目）。**② IndexedDB 暂缓，等他开口**；
路线①（按最旧淘汰）**已明确不做**（会删掉老师写的字）。

### 7. 【✅ 已交付 · 第 94 轮】全仓死模块清零：30 个不可达模块删除 + 全 src 可达性闸门

r92 在 Vue 工作台做了「入口可达性」，第 94 轮把口径推到**全 src**：从双入口
（`index.html→src/main.jsx`、`workbench.html→src/workbench/main.js`）做静态 import BFS，
185 个 src 模块里 **30 个无任何路径可达** → 逐个排除噪声（`.claude/` 快照、`_lint_*.json`、
memory 日志、同名子串假阳性、CSS 注释提及）后全部判死删除。典型三类：
死文件（`HomeDashboard.jsx` 被 `HomeDashboardV2` 同名顶替）、孤儿页（`RetryTasksWorkbench.vue`
从未进过路由）、死岛（`paperStore`+`ImageBlock`+`QuestionBlock` 互相引用但整链无人用）。

- ⚠️ **`HomeDashboard.jsx` 是负责人 2026-10-02 的 WIP 草稿**（fe4f941 特意保留并登记孤儿豁免），
  处理遵循仓库归档惯例：**先归档到 `D:\Minxue_Archive\auto-20261004\components\` 再删**
  （git 历史 fe4f941 亦有全文，零丢失）。`ALLOWED_ORPHANS` 豁免表随之清空。
- **新闸门 `test/moduleReachability.test.mjs`**：src/ 下不许再有不可达模块（含空豁免表
  `ALLOWED_UNREACHABLE`，纪律同 r42 的 ALLOWED_ORPHANS）。**反向自检**：删除前在旧树上跑
  判红、恰好列出 30 个文件（非空锁，且全程未 spawnSync git）。
- **同步改 r91 锁**：`test/dataPageMerge.test.mjs` 摘除对已删孤儿页 `RetryTasksWorkbench.vue`
  的读取与「重练空态文案」测试（其意图——全仓禁硬跳 /wrongbook——由该文件第 ④ 组全仓扫描锁覆盖）。
- **⛔ 冒烟闸重大陷阱（本轮实测踩中）**：`npx vite preview --port N` **不带 `--outDir` 时服务的是
  `build.outDir`（即陈旧的 `dist/`）**，不是隔离产物！本轮陈旧 `dist/`（9-28 构建）里还有 r91 已删的
  GrowthWorkbench 页，其 computed 抛 `undefined.filter`，差点误判为回归。**今后冒烟命令必须带
  `--outDir <隔离目录>`**，并先 curl 一个「只存在于新产物的 asset」验明服务对象再跑断言
  （判据：真 chunk `Content-Type: text/javascript`，SPA fallback 回的是 `text/html`）。
- 运维注：后端 `node server/index.js`（:4000）与 dev（:3000）在会话间会被系统回收；Redis 以
  **Memurai 服务**常驻 6379（`redis-cli` 不在 PATH，用 `Test-NetConnection -Port 6379` 探）。
  preview 代理连不上后端表现为全页 500 `/api/quota/status`。

**四道闸**：`npm test` **1582/1582**（2026-10-04 实测）｜ lint **9 errors / 152 warnings**
（errors 持平，warnings −3 随死文件消失）｜ 构建 `dist_nightly_20261004r94` ｜ 真机冒烟
`_r91_smoke 33/33`（×3，1 遍遇外部证书噪声 32/33，旧产物同款）+ `_r91_pc_verify 25/25` +
`_r92_verify 12/12` + `_r93_laser_verify 15/15`（dev 与产物双跑）+ `_r94_render_smoke 8/8`。零写生产库。

### 8. 【✅ 已交付 · 第 95 轮】冒烟直连生产根因修复：闸门构建强制本地化

r94 报告的「外部证书噪声」查到根了，且比噪声严重：隔离产物构建时 `.env.production` 的
`VITE_API_URL=https://minxue-api.onrender.com/api` 被烤进 bundle，而 workbench 另有一批
**裸 `fetch('/api/...')` 相对路径**（QuotaBanner / QuestionDetailPanel / HandoutPreview /
WorksheetManagement）走 preview 代理到本机 ⇒ **同一个产物一半请求打生产 Render API、
一半打本机**。后果：① 冒烟断言读到的是生产数据（非确定性，学生真名都进了冒烟日志）；
② 生产 API 的 TLS 抖动直接打进冒烟（`ERR_CERT_COMMON_NAME_INVALID` / `ERR_CONNECTION_CLOSED`
就是 r93/r94 反复遇到的「偶发噪声」）；③ dev 从不复现（`.env` 无 VITE_API_URL，走相对路径）。

**修复（闸门命令级，零产品代码改动）**：构建加 `VITE_API_URL=/api` 覆盖 + `MSYS_NO_PATHCONV=1`
（Git Bash 会把 `/api` 环境变量值改写成 `C:/Program Files/Git/api`，r95 第一次重建就踩了，
bundle 里 fetch 全变 `file:///...`）。已更新第二-1 条四道关规范原文。
**验证**：新产物 `dist_nightly_20261004r95` bundle 中 `minxue-api.onrender.com/api` 命中 0；
探针全路由**零外部 origin、零 requestfailed**；`_r91_smoke` **33/33**、`_r94_render_smoke` 8/8。

**两条顺藤摸出的提案（记入 backlog，未动手）**：⑦ workbench 双 base 并存待统一；
⑧ `VITE_AI_API_KEY` 客户端直读是 foot-gun（本仓 .env.production 是占位符 `your-ai-api-key`，
**未泄露**，但真 key 放进去就会进公开 bundle）。

### 9. 【✅ 已交付 · 第 97–102 轮】负责人深夜裁决批量执行（六项全落地）

负责人醒来逐条拍板：①错题中心接回「生成重练卷」直连移动端模块、②第 3 档收纳、
⑤默认笔宽 3.5、⑥删陈旧 dist/、⑦workbench 统一 apiService、新增·激光笔改
「像笔一样写 + 抬手 1 秒渐隐」（推翻 r93 无拖尾）；③④维持原判、⑧仅解释。
全部执行并推送（`2b9cc85`→`9dc9889`），明细与 ⑧ 的解释见
**`docs/auto/HANDOFF-裁决执行完成-20261004.md`**（新会话从那份文档接手）。
基线：`npm test` **1545/1545**｜lint 14e/150w｜激光笔新锁 `laserInkFade`（反向自检 12 红）｜
错题勾选恢复但**必须带真消费者**（dataPageMerge 锁已改写口径）。
⚠️ 工作区有并行会话开发「家长分享卡」未提交——接手先 `git status`，外科手术式 add。

## 六、已关闭、不得重提的红线清单（负责人已裁决）

| 编号 | 事项 | 裁决 |
|---|---|---|
| ③ | 几何重绘目录 5 个整行死 import（`checkFigureReference`/`FIGURE_GATE_MESSAGE`/`buildFunctionGraphSvg`/`renderGeometrySvg`/`publishCleanGeometryUrl`） | **先不动**，任何轮次不得自行清理（工具已写死硬名单） |
| ④ | 3 个 `failed`（DSL max_rounds）是否重新入队 | **不用**，交生产兜底（实测现已归零，别再管） |
| ⑤ | 死声明清理 | **已收线**（182→153 warnings），剩 72 条带分类原因入库，不再主动推进 |
| ⑪ | 面积模型通道扩展版式 | **不做**：全库「看作1」仅 5 题（3 题已支持；2 题是空白长方形**作图题**，画满等于替学生写答案）；设想的 1/3 系 0 样本 |
| ⑫ | 72 个 TikZ 时代资产升级成内联 SVG | **不升级**（已在显示已发布干净图，属锦上添花） |
| ⑬ | 加"配图框比真图窄"通用重裁闸 | **不加**：结构判据命中 90% 无判别力；投影判据抽样精确率 ~12% |
| ⑭ | 批量收紧"裁多了"的 63 题 | **不批量做**：8 条抽验 6 条会被收紧毁掉（并排多面板合法图），铁证是 `2b4aaeec` 被判"应收紧到 209×114" |
| ⑮ | 单题收紧 `ff46daa3` | **已推翻**：dry-run 预览发现会切掉抛物线顶点与 -4 刻度，比原裁片更差 |
| ⑯ | 24 题越界 `image_bbox` | **不动** |
| ⑰ | 白板荧光笔（N2） | **不做**（先看激光笔够不够，避免工具膨胀） |
| ⑱ | 白板全屏右侧工具栏重排 | **不动**（负责人实测不遮挡书写区，2026-10-03） |
| ⑲ | 板书上云（N4） | **暂缓**（单用户固定设备，localStorage 够用） |
| ⑳ | 白板图形/直线吸附（N3） | **先观察**（批注板不是画图板，吸附易误伤手写） |
| — | 首页上传"直达按钮" | **否决**（保持首页→上传→选类型→相机；UploadOptionsModal 维持两卡布局） |
| — | 变式题进重练卷 / 相似度阈值自动合并错题 / 学生端功能设想 | **永久禁止**（见 AGENTS.md 核心业务原则 9、10 与禁止事项） |

## 七、本会话（第 74–83 轮）已交付索引（勿重复建设）

| 轮 | 提交 | 交付 |
|---|---|---|
| 74 | `e073e7e` | 方向二批次执行：79 个从未尝试资产全量跑完，出图 71，completed 384→455，从未尝试池清零 |
| 75 | `1bee3e5` | **拓扑保真闸**：修「P5 回灌修正把顶点搬反导致严重画错」，含 4 例回归锁；实盘修好被负责人点名的 2 张 |
| 76 | `b9a6c1b` | **分数面积模型确定性通道** + **等比刻度短线 tick 图元**（DSL 命令/结构闸/渲染器），零放宽 isSymbolLabel |
| 77 | `ebdfc9b` | 裁决 A 执行：按前端七级取图链重测，只需 3 回填 + 1 重跑（省 71 次付费调用）；**推翻第 74 轮"74 个虚高"的错误结论** |
| 78 | `225ee67` | 四选项并排图条被裁一格半的版式缺陷：人工定框重裁 + 重绘四格全对 |
| 79 | `0d92957` | ⑬ 扫描：自动判据不可行，结论不加通用闸 |
| 80 | `b073b93` | ⑭ 扫描：63 题"裁多了"但不能批量处理（精确率 ~12%） |
| 81 | `cb2b42b` | ⑮ 推翻、⑪ 按证据不做；挖出真根因 24 题越界 bbox；修了"改裁片没回写 image_bbox"的数据一致性缺口 |
| 82 | `d8f9aab` | ⑤ 第一批：`pruneDeadDeclarations.mjs`（真 AST 判副作用），删 26 条声明/152 行，警告 182→158 |
| 83 | `3bc5623` | ⑤ 第二批：只删 5 条整行形态；拦下裁决③红线；修工具两个坑（逗号重叠写碎源码、`Select-Object -First` 截空文件）；清理线收线 |
| 84 | `2ae8fb6` | 只读调研「周末班课件 + 白板现状与待拍板清单」；重写 HANDOFF 交接文档（循环暂停等接手） |
| 85 | `6a5a9f5` | 白板 P1/P2/N1/P3/P4/P5：快捷键 `1-4`/`[` `]`/`E`/`L`/`Y`、重做、**激光笔**（不写 strokes）、清屏二次确认、删死入口（resetView + PPTX 前端）、清过时注释；顺手修粗细吸附。四道闸全过，`_r85_board_verify.mjs` 30/30 |
| 86 | `88ffe05` | 白板导出板书图：题干由 canvas `fillText` 改为**复用屏幕同一个 `MathRender`** 渲染 + `html2canvas` 光栅化（修「LaTeX 源码印在图上」），失败回退 fillText；导出失败不再静默。四道闸全过，`_r86_board_export_verify.mjs` 12/12 + r85 回归 30/30 |
| 87 | `065bcd7` | 白板板书存储：笔迹点量化到 2 位小数（体积约减半，`utils/strokePoint.js`）、落盘失败不再静默（页内提示去导出）、旧键迁移顺手瘦身并回收；删死分支 `q-figure__hint`。另实测关闭「白板取图口径」议题（PC 有图/白板无图 = 0，不需抽共享函数）。四道闸全过，`_r87_board_storage_verify.mjs` 13/13 + r85/r86 回归 30/30 + 12/12 |
| 88 | `075af3c` | 白板「只看未讲」切换**不再把板书串到别的题上**（原实现先换题单再 `saveStrokes()`，会把当前题的板书写进新题单同下标那道题的键、并覆盖其原有板书；探针实测复现）；`onPageHide` 补落盘（防抖窗口内最后一笔不再丢）；顶栏题号总数改用 `viewQuestions.length`。新增源码级顺序锁 `test/weekendBoardViewSwitchOrder.test.mjs`（4 例，已反向自检）。四道闸全过，`_r88_board_view_switch_verify.mjs` 17/17 + 隔离产物冒烟 20/20 + r85/r86/r87 回归 30/30 + 12/12 + 13/13 |
| 89 | `1e6d38e` | 白板**本机板书回收入口**：顶栏「本机板书」→ 看占用（进度条）/ 按题列（锚点翻成人话）/ 逐条删 / 一次清空，两次点击确认、零自动删除（`utils/strokeStorage.js` + `components/BoardStorageDialog.vue`）。⛔ 只列真写过字的题；**删到「正在讲」那一题时连板面一起清**（只删存储会被 `saveStrokes()` 写回，等于没删）。回归锁 `test/boardStorage.test.mjs`（12 例，已反向自检）。四道闸全过，`_r89_storage_verify.mjs` 27/27（dev + 隔离产物）+ r85/r86/r87/r88 回归 30/30、12/12、13/13、17/17 + 隔离产物冒烟 20/20 |
| 90 | `4fb0b85` | **任务自愈对老师完全无感**：自愈中的失败不再显示成失败（移动端任务页新增 `'self-healing'` 档、无按钮、转圈「正在处理」；首页落进「作业批改中」；PC 批改中心归为「AI 处理中」），手动重试与自动重捞不再撞车（`retryTaskById` 在途去重）。判定唯一实现 `pendingTaskRecovery.js#describeAutoRetry`（**照 SQL 判，不照设计意图**），前端 `src/domain/taskAutoRetry.js` 只翻译。回归锁 `test/taskAutoRetry.test.mjs`（21 例，含 SQL ILIKE 漂移锁，已反向自检 19/19）。四道闸全过，`_r90_autoretry_verify.mjs` 19/19 + `_r90_pc_verify.mjs` 6/6（dev 与隔离产物各一遍）+ `_r90_smoke.mjs` 27/27 |
| 91 | `2cc8b1f` | **数据页合并 第 1 档 + 第 2 档**：成长中心（`/growth`）与错题中心（`/wrongbook`）两个页面下线，**家长成长卡搬进学习诊断输出条最右**（它是转发给家长的产出物，不能随页消失），**错题清单以组件自带的 `embedded` 形态嵌进学生档案页**（`#student-wrong` + 页内滚动 CTA），侧栏「教学工作」只剩 3 项，10 处入站链接改指，两条路由留 redirect 兜底，删掉错题中心那排**死勾选框**（勾了没有任何事发生）。⛔ 顺手抓到并修掉一个**静默失效**：`GrowthCardButton` 是多根节点组件，Vue 不透传 class ⇒ 定位类被丢弃、右对齐永远不生效（只有一条 `Extraneous non-props attributes` **warning**，不报错）——现把该 warning 当红、并用几何位置验对齐。回归锁 `test/dataPageMerge.test.mjs`（12 例，已反向自检 33/33）。四道闸全过，`_r91_pc_verify.mjs` 25/25 + `_r91_smoke.mjs` 33/33 |
| 92 | `4d23cba` | **工作台入口可达性闸门**：审计 88 个文件 / 48 个导航目标 + 71 个 SFC 的 `@click` 绑定，抓到两个真缺陷 —— ① **新学生档案页的主按钮点了整页白屏**（`to: '/upload'`，工作台没有上传页；vue-router 只打 warning，内容区整片空白，实测内容长度 545→77）；② **复核页「查看错题池」绑了不存在的 `goWrongBook`**（函数叫 `goToWrongBook`）⇒ 点了没反应。新增两道常驻闸门 `test/workbenchRouteTargets.test.mjs`（3 例）+ `test/workbenchClickHandlers.test.mjs`（2 例），均已反向自检（11 条判据 7 条判红）。四道闸全过，`_r92_verify.mjs` 12/12 + 回归 `_r91_pc_verify.mjs` 25/25 + `_r91_smoke.mjs` 33/33 |
| 93 | 本轮（⚠️ 行为已被第 97 轮取代）| **白板激光笔改「无拖尾 + 抬手即消」**：删掉旧的「红点 + 220ms 按点龄衰减拖尾线段」（`laserTrail` / `LASER_TRAIL_MS` / `LASER_MAX_POINTS` / 逐段 `lineTo`），`laserPoint` 只存当前那一个点，`drawLaser()` 不画折线，`endLaser()` 丢点 + 取消 rAF + **立即重绘清空**。⛔「激光笔不进 strokes」纪律未动（导出 PNG 只读 `localStrokes` ⇒ 天然不含光点）。回归锁 `test/laserNoTrail.test.mjs`（6 例，反向自检 25 条判据 / 旧版判红 12 条）。四道闸全过，`_r93_laser_verify.mjs` 15/15（dev + 隔离产物，像素级：拖动中光点外接框恒 26×26、抬手后立即 0 像素、strokes 无 laser、跟随偏差 0.5px）|

## 八、历史已交付索引（第 74 轮之前，勿重复建设）

- **配额哨兵**：`server/services/quotaSentinel.js` + `routes/quota.js` + 顶栏 `QuotaBanner.vue`（降级横幅）
- **家长成长卡**：`GrowthCardButton.vue`（复用 weeklyReport 聚合；家长只看老师转发出去的图，不用系统）
- **KPI 诚实化 + 真趋势**：`GrowthWorkbench.vue`（错题已掌握率正名 + 真实周环比）
- **全局错误护栏**：工作台 `app.config.errorHandler` + 移动端 `ErrorBoundary`
- **数据保险库**：`scripts/dailyBackup.mjs`（每晚 21:30 自动 + 可手动跑）
- **审计工具**：`scripts/auditStoreContract.mjs`（store 契约审计，随时可跑）
- **仓库治理**：1.1GB 历史垃圾已归档至 `D:/Minxue_Archive/`；lint 从 644 噪声 → 204 可信信号（本会话再降到 167）
- **交互重构已落地**：批改中工作台 header 三合一 + 撤销 snackbar + ⌘K 命令面板

## 九、已知遗留风险

- **方向一自愈机制：早已交付，不是遗留风险**（第 88 轮后复核，见五-2）。勿再作为待办提出。
  ⚠️ 第 90 轮新增一条必须记住的口径漂移：**`scanFailedTasks` 的 SQL ILIKE 名单与
  `isAIRefusalLikely` / `QUOTA_ERROR_PATTERNS` 不是一套**（SQL 拒绝话术 9 项、配额 7 项）。
  任何"系统还会不会再试"的对外判断都必须照 SQL 走；改任一边都要同步
  `AUTO_RETRY_ILIKE`，否则 `test/taskAutoRetry.test.mjs` 的漂移锁会红。
- eslint 配置仍缺 `eslint-plugin-vue` / `typescript-eslint`（.vue 模板层靠自建锁补位）。
- **Minxue Deploy 自动提交守护进程仍在运行**（作者为 Minxue Deploy 的提交是它做的）——不要与它抢写。
- 预览后端/前端后台进程会被系统回收——每轮开工先 curl 探测 4000/3000。
- 移动端首屏偶发一次 `400 Bad Request`（疑似首次 `/api/tasks` 抢跑）：第 79 轮抓到，第 80、83 轮同口径冒烟**均未复现**，暂定偶发不立案。
- `no-unused-vars` 还剩 72 条（14 条同行 import 形态收益不抵风险；其余是函数参数/含副作用初始化/复杂形态），已分类入库。
- 等比刻度线（tick）已建图元，但**采用率靠模型自愿**（实测 1 中 1 不中）；负责人裁决⑩ = 不加硬要求。
- **⛔ 第 130 轮（2026-10-04 16:40 起）本机 `vite build` / `vite preview` 全部不可用**：
  `node_modules/@esbuild/win32-x64/esbuild.exe` 在 Go `osinit()` 阶段崩溃
  （`fatal error: winmm.dll not found`，`--version` 即崩，与仓库代码无关）。
  r129 产物 16:19 还正常 ⇒ 会话中途系统侧 DLL 加载被拦（重启本机或 `npm rebuild esbuild` 可解）。
  ⇒ **闸 3（隔离构建）与闸 4（preview 真机冒烟）在恢复前无法执行**，接手轮须知：
  可改用 `vue/compiler-sfc` 真编译 + `vue/server-renderer` 内存 SSR 渲染作为替代验证
  （r130 已用此法覆盖 19 项，见 `_r130_build_ssr.mjs` / `_r130_sfc_verify.mjs`），
  但**替代验证不能替代真机冒烟**，恢复后仍需补跑。
  ✅ **2026-10-05 r132 实测已恢复**：`npx esbuild --version` 正常返回 0.21.5，
  隔离构建 `dist_nightly_20261005r132` `✓ built in 36.67s`，preview + render_smoke 8/8 全过。
  ⚠️ 但**跑构建前仍建议先 `npx esbuild --version` 探一次**——这个故障会自己冒出来又自己消失，
  直接写「本机构建不可用」会误导接手轮放弃闸 3/闸 4，写成「必崩」同样会误导。

- **⛔ 本机 safe-delete 对「目录」fail-closed（2026-10-05 r132 实测）**：
  `rmSync(p,{recursive:true,force:true})` / `rm -rf` / `Remove-Item -Recurse` /
  **Python `shutil.rmtree`** —— 四种方式全被同一道 shim 拦住
  （`[safe-delete] 操作失败 ... trash operation ... operations were aborted`），连 `mv` 都 `Permission denied`。
  影响：**测试残留目录现在删不掉也移不走**（如 `_r131q_badlock/`），只能在别的机器或重启后清理。
  更要命的是它会制造**假红**：`test/mobilePullToRefresh.test.mjs` 的反向自检，
  一开场那句 `rmSync(base,{recursive:true})` 清不掉上轮残留 ⇒ 当场抛错、
  **反向自检根本没跑到**，一把防空锁长期不验证，却只在人手动点它时才显红
  （比不报警更坏：它会让人以为验过了）。已在 r132 把清理降为 warn（判据一行未改）。
  ⇒ 接手轮遇到「某把锁的红在 safe-delete 上」时，**先判断是真缺陷还是清不掉残留**；
  ⛔ 不要为了让测试变绿而删别人的断言，那两者是两回事。

## 九点五、第 131 轮新增（2026-10-04 19:53）

- **首页报 500 先跑一条命令**：`node scripts/frontendHealth.mjs`（commit 3bc04a9）。
  它专治「单条 500 分不清『刷新就好』还是『必须改代码』」：递归列出所有非200 模块 +
  mtime 判据分瞬时/持续 + 可选 playwright 读 DOM 判白屏。
  退出码 `0`健康 / `1`持续缺陷 / `2`编辑中间态 / `3`探针自身失败，供巡检循环直接消费。
  ⛔ 绝不截图（本机窗口隐藏会必超时）。
- **r131 实例：负责人截图「移动端首页坏了」其实是虚惊** —— 实测 53 模块全200、
  DOM 有 139 字可见文字。报错 URL 里的时间戳换算得18:02:59，而 `src/App.jsx`
  最后写入是 18:19:39 ⇒ 那一刻 Vite 正转换到写了一半的中间态。**处置是刷新。**
  ⇒ 教训入册：**看到 500 先算时间戳，别急着翻源码。**
- **⛔ Git Bash 会偷改命令行里的类 Unix 路径**：`--entry /src/main.jsx` 会被 MSYS
  展开成 `C:/Users/.../PortableGit/1.2.0/src/main.jsx`。脚本里凡收 `/xxx`
  形式的参数都要反解，否则会去请求不存在的地址并报出**假警报**（比不报警更坏）。
- **⛔ 反向自检要注入「把判据关掉」的极端值**（本例：`--edit-window-ms 0`）。
  正向测例全绿时可能判据根本没生效；注入 0 后仍报绿才是真失效。
  本轮正是靠这一条抓出 `age <= window` 在 0<=0 时恒真的边界 bug。

## 十、给接手模型的三句话

1. **先读 AGENTS.md**——单用户系统、小而美、任何"学生端/家长端"设想都不成立。
2. **四道闸全过才推送**；批量动作前先抽样肉眼验自己的判据（这个会话靠这条挡住了三次会毁数据的事故）。
3. **负责人的时间最贵**——每轮必须交付实物并交报告；需拍板的事**编号成表主动呈报**，别只写进仓库文档就算汇报过了。

## 十一点、第 133 轮新增（2026-10-05 01:15–01:40）

- **家长分享卡的空周期寄语必须区分老学生/新学生**（commit `e8637ac` + `49502f2`）。
  实测：周一早 21/21 名学生本周期全 0，卡片一律写「学习记录刚起步」；而陆晨曦累计已批 298 题、
  正确率 77.5%。模板 `buildShareComment` 加一层判据，**缺省按「有历史」**。
- **⛔ 别往热接口随手加查询**：本轮先加在 `fetchStudentWeeklyReport`，实测周报接口稳定
  +0.24s（COUNT）/ +0.1s（EXISTS 早退，6 轮交错采样 6/6 一致）⇒ 撤出，挪到 `POST /api/share-card`
  渲染前。原位留了反面教材注释。⇒ 通用判据：**先算这条查询会出现在多少次调用里**，再动手。
- **⛔ 冒烟判据要实测校准，不能凭代码想象**：本轮 render_smoke 首轮 6/8 两条红，
  查下来是**我的判据写错**——学生切换器屏幕上显示的是名字（「汤一诺」）不是「学生」二字，
  移动端 tab 实际是 首页/作业/错题本/组卷历史，根本没有「试卷/诊断」两个词。
  按真实 DOM 校准后 8/8。**应用一直是对的。**
- **旧锁判红的正确处理**：`test/shareCard.test.mjs:113` 锁的是旧文案。不改变判据，
  而是给样本显式补 `hasEverGraded:false`（把"免费诊断首份报告 = 从没被批改过"这个本意写清楚）。
  ⛔ 绝不允许为了让测试变绿而删/放宽别人的断言。
- 四道闸：单测 1711/1711 fail 0｜lint 5 文件 0 error｜`dist_nightly_20261005r133` 34.86s（前端零改动）
｜preview:5261 读 DOM 冒烟 8/8。健康采样 uptime 36min / 响应 868ms，与 16:12→本轮单调上升，期间无重启。

## 第 151 轮（2026-10-05 18:47–19:04）：清 r148 时区类最后一处残留

- 交付 `ffa130d`（A 级，已推送）：`server/routes/teaching.js` 的 `period.start/end` 原来是
  `periodStart.toISOString().split('T')[0]`（按 UTC 印日期），而周期边界是本地时区算的。
  全仓同款扫描确认**这是 r148 那类缺陷的最后一处漏网**（`weeklyReport.js` 三处都在
  `mode==='all'` 哨兵分支、刻意用 UTC 构造哨兵值，正确）。改成 `toLocalYmd`，end 减 1ms 说「最后一天」。
- ⛔ **A 级的前提是「行为保持」，本轮实测坐实**：`TZ=UTC`（生产容器）下新旧输出逐字相同；
  `TZ=Asia/Shanghai` 下旧写法周起点印成 10-04（周日）、月起点 09-30，新写法才对。
  ⇒ **改任何「只在 UTC 容器里才正确」的时区代码，必须先跑一遍 TZ=UTC 的同值比对**，
  否则你无法证明自己在生产上没改行为。
- 新锁 `test/teachingPeriodLocalDate.test.mjs` 5 条；反向自检改成**精确比对四条判据逐条命中**
  （不只数条数 —— 只数条数时判据写错位置也会「碰巧」凑数 = 假通过）。
- 闸 4 套路升级：本机 `agent-browser` 本轮 `open` 反复挂死（`close --all` 却正常）。
  ⇒ **改用项目自带 `puppeteer-core` + 本机 `C:\Program Files\Google\Chrome\Application\chrome.exe`**，
  10s 出读 DOM 结果，真浏览器。别在这台机器上死等 agent-browser。
- 提案进 backlog：③ 删 `GET /api/teaching/error-types` 死入口（B）｜④ 开工先探 esbuild（环境）
  ｜⑤ 接力锁要不要认 `halted` 这种第三种状态（B，需负责人定）｜⑥ 家长分享卡 ~36s 是否异步化（B）。
- 健康采样：uptime 45min(17:39)→53min(18:47) 单调上升，期间无崩溃循环。


## 第 155 轮（2026-10-05 20:06–20:40）：重练卷抬头日期改成本地日历日（已交付已推送）

- 交付 `d36ca33`（A 级，行为保持型）：`server/services/wrongRetryPdfService.js` 原来用
  `toISOString()` 印 UTC 日 ⇒ 生产 UTC+8 下本地 00:00~08:00 导出重练卷，抬头 / 文件名 / 库里
  `generated_exams.name` 全都印成昨天（老师列表、孩子手里的卷子、磁盘文件名，一处三用）。
  改走 `toLocalYmd`，纯函数 `buildRetryExamName(studentName, at)` 便于真跑断言。
- 新锁 `test/wrongRetryExamName.test.mjs` 5 条；反向自检套 HEAD 旧版逐条判红、套新版逐条判绿（已实测）。
- 四道闸：单测 1807/1807 fail 0｜lint 改动文件零输出｜`dist_nightly_20261005r155` 35.59s｜
  preview:5291 + Chrome 读 DOM 冒烟 5/5。健康采样 uptime 53min→61min（单调上升）。
- ⭐ 套路补充：
  1. **闸 4 的入口路径不能抄上一轮的模板** —— `#/dashboard` 早就不存在了（首页 path 是 `/`）。
     判据过期会造出「假红」，也会掩盖「真红」；每次改判据都要回去核一次真实路由表。
  2. **本机 https 直连报 `CRYPT_E_REVOCATION_OFFLINE` 不等于站点挂了** —— 用 `-k` 复测即可区分，
     别据此下「服务不可用」的结论（单次观测不得用于因果结论）。
  3. **扫同类 UTC 日期残留时必须先判列类型/输入形态**：`week_start` 是 `::date` 字符串那条看着像 bug 其实对。
- 下次触发接 **r156**：四道闸正常跑；首选清 backlog 提案⑪（`server/index.js:4462`，两行，可选），
  或提案⑬（周报全班版单人失败的静默成功，B 级需先和负责人确认口径）。

## 第 157 轮（2026-10-05 21:18–21:50）：时区类最后一处收尾 + 上传孤儿文件不再静默吞错

- 交付 `dd5395e`（A 级，清 backlog ⑪）+ `a6e1830`（A 级），均已推送。
- **缺陷 1（时区类第 4 处、也是最后一处漏网）**：`server/index.js:4462` 的误判类型归因统计
  默认 `since` 写 `new Date(Date.now()-30*86400000).toISOString().slice(0,10)` —— UTC 日。
  生产容器 UTC+8 ⇒ 本地 00:00~16:00 之间请求，「近 30 天」窗口起点退到前一天，
  且与显式 `?since=` 传值的结果对不上，每天早上都差一天，极难定位。
  改：新增纯函数 `localDaysAgoYmd(days, now)`（`server/utils/period.js`，复用已有的 `toLocalYmd`），
  index.js 改引它 —— 同类错误不用每轮重新认一遍。
- **缺陷 2（静默吞错）**：`server/index.js:570` 上传去重分支（撞 UNIQUE 23505 复用已有任务）
  清理本次刚上传的孤儿文件时是 `catch(e){ /* ignore */ }`：文件删不掉就一直挂在存储上，
  白占免费实例约 1GB 额度（满了上传直接失败），而日志零线索。同文件 DB 写失败分支早就
  `console.error`，两处口径不一致 ⇒ 改为 `console.error('  [Upload Dedup] 孤儿文件清理失败:', e.message)`
  并写明「为什么不能静默」。
- 回归锁 2 个新文件 10 条，均含反向自检（实测，不是假设）：
  · `test/adminStatsSince.test.mjs` 5 条（真跑纯函数 + 防误伤对照组 + 新旧输出确实不同）。
  ⛔ **手算日期会算错**：第一次写的判别时刻手算成「10-06 减 30 天 = 10-07」，实测是 09-06，
  3 条判红。**判别时刻的期望值一律由运行时先打表再写进锁里**。
  · `test/uploadDedupOrphanCleanup.test.mjs` 5 条；**反向自检用真回退实测**：
  把 index.js 那一行临时改回旧写法 → 跑锁 **3 红**，恢复后 **5 绿**。
- 四道闸：单测 **1817/1817 fail 0**（两次全量：1812 与 1817，中间无他人 red）｜
  lint 改动文件 **0 error**（1 条 warning 是既存错误中间件的 `next`，HEAD 同代码）｜
  `dist_nightly_20261005r157` **35.88s**｜preview:5293 + Chrome 读 DOM 冒烟 **4/4**、0 pageerror。
- 健康：本轮开始时 uptime 61min（boot 20:17:34 +08），响应 1296ms。**单次观测不能下结论**，
  故改为直连 `/api/health` 读 `bootAt` 反算；两次采样（20:06 读数 upMin=61、21:18 boot=20:17:34）
  ⇒ 期间**确实重启过一次**，时间点与本会话自己的推送（20:13 `d36ca33`、20:17 `c6f549b`）高度重合，
  属 Render 免费实例「推代码就重启」的常规行为，不是崩溃循环。本轮推送后另采一次样本复核。
- 复核（防下轮重复翻）：全班版周报实测 1.93~2.29s（21 名学生逐人查库，N+1 但不构成缺陷，
  只提案）；真实学生（汤一诺）周报 period `2026-10-05 ~ 2026-10-12` 本地口径正确、本周 0 题符合
  周一开局；`toISOString` 全仓扫描后，**生产代码里非批改路径已清零**（仅剩 worker.js 与一次性脚本）。

## 第 159 轮（2026-10-05 23:28–23:45）：备份脚本失败不再伪装成成功（已交付已推送 `e3638cb` + `9bd97f7`）

- **赛道**：服务端基础设施（非批改）· 定时任务 —— 提案 ⑱ 的落地（r158 把它当成跨赛道只提不改，
  实际属本赛道；r158 认领的是「仓库卫生与门禁基线」，判断失误，本轮补上）。
- **缺陷（四处，全部实测坐实）**：`scripts/dailyBackup.mjs` 全文 0 处 `process.exit`（调用方拿不到显式失败信号）；
  核心表 0 行照样写空 JSON 并打印「完成」（连错库 = 谎报平安）；快照目录名用 `toISOString()`（UTC）
  而同一文件轮换判断用 `+08:00`（两种时区口径）；`manifest.json` 只在全表成功后写（半途失败的残快照看不出残缺）。
- **修法**：新增 `scripts/backupKit.mjs` 纯函数模块（本地日命名 / 过期轮换 / fail-closed 成败判定，
  复用 `server/utils/period.js` 的 `toLocalYmd` 不另起一套）；`dailyBackup.mjs` 显式 `process.exit(0/1)`、
  失败写 `manifest.error`、manifest 在 `finally` 必写。判空以 TABLES 清单为准 ⇒ 只导了 2 张表也算失败。
- **回归锁** `test/dailyBackupResult.test.mjs` 14 条；**反向自检**：同一判据套 HEAD 修复前真实脚本 = **8 条判红**，
  新版 0 条 + 4 组「逐点改回旧写法」真回退全红。
- **端到端实跑**：`node scripts/dailyBackup.mjs` ⇒ exit 0，`D:/Minxue_Backup/2026-10-05/` 9.2MB
  （students 21 / tasks 192 / wrong_questions 1120 / questions 3011 / knowledge_mastery 152），`manifest.ok=true`。
- ⚠️ **新发现（提案 ⑲，B 级待拍板）**：这份脚本**压根没人调它**——`D:/Minxue_Backup/` 只有 `2026-10-02` 一份，
  全仓 grep / 系统计划任务 / 全部定时任务都找不到调用方，10-03~10-05 三天零备份，而脚本注释与本文档
  都写着「每晚 21:30 自动」。正是没有退出码、没人告警，这三天无声无息。已修口径，但**得先有人排上或明说手动**。
- ⚠️ **单测基线**：现 1839 条，**1 红且不是本轮引入** —— `test/wrongBookLifecycleRollback.test.mjs:73`
  锁旧字面量 `errorCount '2-3'`，而他人 23:30 的 `431d4df` 已改成 `2+ 档` ⇒ 锁过期（PC 工作台赛道），
  本轮未删未放宽，记为提案 ⑳。下轮接手若看到这 1 红，直接归属 431d4df，别查本轮。
- 四道闸：单测 1838 通过 / 1 红（归属如上）｜lint 我方 3 文件零输出｜`dist_nightly_20261005r159` 36.53s｜
  preview:5295 + `cert_probe` 零外联 exit 0 + `render_smoke` **8/8**（0 控制台错误 / 0 个 4xx5xx）。


## 第 198 轮（2026-10-06 11:45–11:52，本赛道「服务端基础设施（非批改）」）：磁盘体检从「永远亮着的黄灯」改成真数字

- **缺陷（可观测性，A 级）**：`scripts/healthcheck.mjs` 里「服务器磁盘」这一项写的是一句**常量警告**——
  不管剩多少、有没有数据，每次采样都打「体检读不到磁盘用量」，于是每次结论都是
  「没有致命问题，但有 1 项想提醒你」。而 `GET /api/health` 从设计上**就没有任何磁盘字段**，
  所以那句「读不到」不是偶发失败，是这个接口答不出这个问题。
  ⚠️ **恒定亮着的黄灯等于没有黄灯**：它会把「批改失败 / 队列积压」这些真告警一起淹掉，看久了直接跳过。
- **修法（三处，一个判据一个测量，不重造）**：
  1. 新增 `server/utils/diskUsage.js`（唯一测量实现，用 Node 自带的 `fs.statfs`，不装包；
     量不到时**打日志**并返回 null，不静默吞）；
  2. `server/index.js` 的 `/api/health` 回显 `disk: { freeMb, totalMb, path }`（纯新增字段，零消费方破坏）；
  3. 新增 `scripts/healthDiskState.mjs` 承载**唯一判定实现** `resolveDiskState()`
     （剩余 < 200MB ⇒ warn 并给后果与动作，否则 ok；拿不到 ⇒ warn 但必须指路），
     `healthcheck.mjs` 只 import 它，不再自抄阈值。
- ⭐ **文案说人话（且不夸大）**：初版写了「磁盘满会让拍照上传失败」——**这是错的**：作业图片存在 OSS，
  这个盘只是临时空间（分享卡 / 重练卷 PDF 渲染会往这儿写临时文件）。已改成准确说法，
  并加了一条判据**禁止**再出现「上传失败」式夸大白话 —— 说错了会让人照着做错动作，回归锁就是守这句的。
- **回归锁** `test/healthDiskGuard.test.mjs` **11 条**（阈值边界 + 单一实现 + 源码契约）。
  **反向自检实测**：同一把判据套 HEAD 修复前两个文件 ⇒ 旧树 **4 红 / 新树 0 红**；
  探针还自带「判据字面量与测试文件逐字一致」的自证钩子（第一次就靠它抓出正则末尾少一个 `\)` 的假通过）。
- ⭐ **顺带用数据撤销了 backlog 提案 ⑮（周报全班版改 `GROUP BY` 批量查询）**：实测 EXPLAIN——
  21 学生一条 `student_id = ANY(...)` 走 **Seq Scan on questions**（27.04ms，过滤掉全部 3011 行），
  而按学生单条走 `idx_questions_student_id` 索引扫描只要 **1.74ms**。批量反而慢一个数量级
  ⇒ ⑮ 这条"优化"不该做，已改判为「实测证伪」。
- ⚠️ **并发实记**：开工时锁 = `finished/197`，随后在 11:48 被**另一会话改写成 `running/198`**（与本轮同轮号）。
  两侧文件集不相交（对方 = `server/routes/worksheets.js` / `neonService.js` / `pdfService.js` / lint 类），
  本轮只动 `server/index.js` + `scripts/**` + 新测试。**按纪律未争抢锁，故收尾未写 `finished`**，
  由在跑方自行收尾；下一轮 opening 时若锁不是 finished，先确认不是同一批在制品。
- 四道闸：单测 **1854/1854 fail 0**（基线 1843 + 本轮 11）｜lint 我方 5 文件 **0 error**、
  6 条 warning 全部既存（healthcheck 的 existsSync/ROOT、index.js:4654 `next`）｜
  `dist_nightly_20261006r198` **41.20s**｜preview:5312 + `cert_probe` 零外联 exit 0 + `render_smoke` **8/8**。
- 提交 `cda3aa6`（5 files changed, +226/−4），**只推了这一个 commit**（`git push origin cda3aa6:main`）。

## 第 207 轮（2026-10-06 13:08–13:30，只读审计轮）：家长「批改题量」静默少 141 题（取证完成，未改未推）

**锁 = `running / r206`（12:42 起，另一会话在跑）⇒ 本轮只读：不改业务码、不提交、不推送；
收尾也**未写 `finished`**（按纪律让在跑方收线）。只往 backlog 追加了取证结果。**

- **主发现（编号 ㉘，B 级待拍板）**：`questions.is_complete` 是陈旧缓存列。近 30 天 264 行
  `is_complete != TRUE` 里，**141 行用系统自己的动态口径 `checkQuestionCompleteness()` 重算判「其实完整」**，
  所属 90 个任务状态全是 `reviewed`（老师已复核完）。它们被 `weeklyReport.js:133/:701` 的
  `AND is_complete = TRUE` 滤掉 ⇒ **家长「批改题量」少 141 题（6.0%），正确率被抬高**
  （整体 61.2% vs 实际 59.7%；陈施君 51.2%→40.4%、王艺博 50.0%→43.6%）。
  错题本路径有「写侧 + 读前」两道自愈（index.js:3531 / 3584-3606），**周报/分享卡这条链路一条都没有**。
- **㉓ 实测坐实**：正确率分母含未判定题，与同页 `retryAccuracy` 口径平均差 6.4pp、最大 11.6pp；
  与 ㉘ 方向相反，**别只修一个**（净效应以 `server/_diag_r207_impact.mjs` 实测为准）。
- **㉒ 闭环**：生产 `36df281` 落后 origin/main 的 7 个提交**全是 docs** ⇒ 代码一致；
  12:10:34 重启 = 推送触发的自动部署，**不是故障**。
- **⑲ 更新**：`D:/Minxue_Backup/` 现有 2026-10-02 / 2026-10-05 两份（10-05 23:36 手动跑过），
  仍无自动调用方，B 级待拍板。
- 探针全部只读，留在 `server/_diag_r207_*.mjs`（gitignored）当证据。
- **下轮首选 ㉘**（先跟负责人确认是否补回这 141 题口径）。

## 第 208 轮（2026-10-06 14:17–14:45，只读审计轮，锁 running/r206 未收）

- 锁仍是 `running / r206`（12:42 起），收尾权留在在跑方；本轮只读，**未提交、未推送、未改锁状态**。
- 健康两点：14:19 uptime 128min/906ms → 14:36 uptime 148min/360ms，单调上升、无重启。
- **㉒ 重开**：生产 `commit 36df281`、`bootAt 12:10:34`，**2.5 小时 0 重启**；
  期间 origin/main 新增 **9 个提交（7 docs + 2 workbench 代码）一个都没进生产**。
  r207 的「闭环」前提（落后全是 docs）已不成立 ⇒ 需负责人去 Render 面板确认自动部署。
- **㉙ 新发现（当前无影响）**：`shareCard.js:33` 的「老学生」判据也吃 ㉘ 那列 `is_complete`；
  实测 21 名学生 `is_complete=TRUE` 行全部 > 0（陆晨曦 298/313 等）⇒ 措辞当前全对，
  但结构上与 ㉘ 同源，建议两处合并做一次「读前自愈」。
- 已排除（下轮别再查）：`server/` 全仓空 catch 均为「已记日志」的最佳努力写状态；
  `weeklyReport.js:116/:506/:693` 三处 `done/reviewed` 口径**已全部**收口，无残留。
- **下轮首选 ㉘ / ㉙（建议合并）**；另需负责人处理：Render 自动部署（㉒）、running/206 的 stale 锁。


## 第 209 轮（2026-10-06 15:39–，只读审计轮，锁仍 running/r206 未收）

- 锁仍是 `running / r206`（12:42 起，已挂 3h）。本轮只读：**未改业务码、未提交、未推送、未写 finished**
  （收尾权留给在跑方）。改动仅向 `docs/auto/backlog.md` 追加第 209 轮节。
- 健康（15:40）：`uptime 210min`、接口 347ms、DB 766ms、队列 0、磁盘剩 66920MB。
  r208（14:36）148min → 本轮 210min **单调上升，本窗口无重启**。
- **㉒ 再次证伪「闭环」（比 r208 更进一步）**：生产 `commit=36df281`、`bootAt=12:10:34`，
  **3h30m 零重启**；落后 `36df281..HEAD` 共 **10 个提交 = 7 docs + 3 个 workbench 前端代码**
  （`5825531` / `81b6911` / `f1abe5d`）。⇒ r199「自动部署跟上 HEAD」与 r207「落后全是 docs」
  **两条结论同时不成立**。
  ✅ 补一句公平话：落后清单里**没有任何 `server/` 后端提交** ⇒ 当前对线上仍零运行时影响。
  ⚠️ 但前端那 3 个提交是否上线要看 **pages.dev** 那条链路（PR 二维码域名），Render 单侧说明不了
  ⇒ 负责人要查的是两条部署链路。
- **㉚ 新发现（B 级）**：家长分享卡渲染链路**全程零超时**，实测 grep `server/` 首仓代码
  `Promise.race` **零命中**。实测出图 **37.04s / 174,085 bytes**（与 r155 36.08s 一致，稳定）。
  断点位置：`examPdfRenderer.js:136 setContent` / `:138 evaluate` / `:147 screenshot`、
  `shareCard.js:78`、以及前端 `GrowthCardButton.vue:67 fetch` 无 AbortSignal。
  后果：Chromium 一旦在免费实例上卡死，HTTP 永不返回、后端不发 500、前端一直转圈 ⇒
  **老师看到的是无提示的永久加载**。建议阈值 60s（比实测高 60% 留余量）。
  ⛔ 前端 abort 那半截属 PC 工作台赛道，本轮只提案未动。
- **⑬ 确认闭环**：`weeklyReport.js:582-588` 已有 `failed` + `console.error` + `partialFailure` 字段，
  r159 的「全班周报单人静默成功」确已修复，从待办划掉。
- 取证全只读：一次 `/api/health`、一次 `/api/students`、一次生产 `POST /api/share-card`
  （该路由按设计图片不落库不落 OSS）。
- **下轮首选 ㉘（拍板后）**；其次 **㉚（先定 60s 阈值）**；另需负责人处理 Render 自动部署（㉒）
  与 running/206 的 stale 锁。

## 第 211 轮（2026-10-06 16:44–17:10，可开工轮）：家长「成长总览」卡片连说三处「本周」（一个 commit，已推送）

- **做了什么（后果先讲）**：老师在学习诊断页切到「全部时间」再生成分享卡，转发给家长那张图上，
  徽章写「成长总览」、学习周期印着 01/01~10/06，可老师寄语却写着「**本周**作业完成情况尚可」——
  家长读起来自相矛盾。一处根因，三处文案全修好了（commit `66aba2a`）。
- **根因**：`server/services/shareCardTemplate.js:220` 的周期用词只判了月/周两种，
  「全部时间」被当成「本周」。已改成三分支（这段时间的/本月/本周），未知模式仍兜底「本周」。
- **回归锁**：`test/shareCardPeriodWord.test.mjs` 8 条（真跑渲染断言，不是源码 grep）。
  **反向自检实测：旧模板 4 红 / 新模板 0 红**；探针自带「自证钩子」防止判据写错字导致假通过。
- **同类排查**：`server/**` 里 `'本周'` 只剩周期词本身和 offset 徽章（后者正确、有单独锁）⇒ 无漏网。
- **排除的假缺陷**：`weeklyReport.js:435/:438` 的 `'all'` 分支用 `toISOString()` 看着像时区漏网，
  但 all 模式的边界是 2000-01-01 / 2099-12-31 哨兵值，不受时区影响 ⇒ 不是缺陷，已记录在 backlog。
- **四道闸**：单测 **1864/1864 fail 0**｜lint 改动 2 文件零输出｜`dist_nightly_20261006r211` **37.06s**｜
  preview:`5336` + cert_probe 零外联 + render_smoke **8/8** + 0 控制台错误 / 0 个 4xx-5xx。
- **健康**：采样 uptime 274min → 生产 uptimeSec 16757（≈279min），单调上升，本窗口无重启。
- **部署待办**：本轮已推送 `66aba2a`，但生产 health 仍是 `commit 36df281` / `bootAt 12:10:34`
  （提案 ㉜）。**家长目前看到的还是旧文案，等部署生效。**
- **下轮首选**：㉘ / ㉚ / ⑲；另需负责人处理 Render 自动部署（㉜）与 running/206 的 stale 锁。


## 第 213 轮（2026-10-06 17:51–18:10，可开工轮）：成长总览卡「低正确率」那句仍写死「本周」（一个 commit，已推送）

- **做了什么（后果先讲）**：上一轮（r211）修了周期词变量本身，但**漏了一处硬编码**。
  家长分享卡在「全部时间」档、且孩子正确率低于 60% 时，末句会写成
  「整体正确率 47.2%，建议重点复习**本周**错题」——可这张卡的徽章写「成长总览」、
  学习周期印着 01/01 ~ 12/31。实测 **21 名学生里 10 名**落在这个分支
  （李哲瀚 47.2% / 丁嘉炜 21.9% / 汤一诺 37.5% / 王艺博 45.3% / 蔡怡希 53.4% …）。
  已改（commit `8acf22c`），周档拼出的句子与改动前逐字相同，老师平时的周卡一个字都没变。
- **根因**：`server/services/shareCardTemplate.js:99` 低正确率分支（正确率 <60）把「本周」写死在模板串里，
  没走 r211 建好的 `periodWord`。同类残留：r211 那次 `server/**` 扫 `'本周'` 时统计成「只剩两处」，
  实际是三处（225 周期词 + 258 的 offset 徽章 + 99 这一处）⇒ 计数口径漏了，本轮补齐。
- **实测取证**：一条 `GROUP BY student_id` 聚合（Neon 免费实例禁止多表 JOIN/子查询循环，r208 教训），
  只读取 21 行，578ms，直接列出全部 <60% 的学生，不用猜。
- **回归锁**：`test/shareCardPeriodWord.test.mjs` 由 8 条加到 **12 条**（真跑 `buildShareCardHTML` 断言 HTML）。
  **反向自检实测：套修复前旧模板 4 红 / 套新模板 0 红**（5 个判据），探针带自证钩子。
- **亲眼复核**：用新代码直接跑渲染链路出真图（`tmp/_r213_card_all_after.png`），
  李哲瀚「成长总览」卡两处从「本周」变成「这段时间」；对比图见本轮报告。
- **四道闸**：单测 **1876 条 / 本轮 12 条全绿**｜lint 改动 2 文件零输出｜`dist_nightly_20261006r213` **37.01s**｜
  preview `5337` + cert_probe 零外联 / 0 失败请求 + render_smoke **8/8**。
- ⚠️ **本轮 3 条红测不是我造成的**：`test/dataPageMerge.test.mjs:138`、
  `test/resourceFold.test.mjs:100`、`test/weekendHandoutProduct.test.mjs:75` 三条侧栏源码锁
  被并行会话 `2a5ab25`（工作台侧边栏改版）打红。**未删未放宽未改**，正是纪律要求的「别人的红要能分得清归属」。
- **健康**：采样 uptime **62min** / 响应 823ms；生产 `/api/health`：`bootAt 16:50:24`、
  `commit 66aba2a` ⇒ 这次重启落在 r211 推送（`66aba2a` 16:47）后 3 分钟，
  **是推代码触发的自动部署，不是故障**。
- **部署待办（提案 ㉜ 更新）**：本轮已推 `8acf22c`，生产 `commit` 仍是 `66aba2a`（不含本修复）。
  **家长现在拿到的还是旧文案。**
- **顺带新观察（提案 ㉝，B 级）**：本机 :4000 后端 bootAt 00:25，同一张卡它渲染出「完成作业 0 次」，
  而用当前代码直接渲染是「8 次」——差在 `status IN ('done','reviewed')` 那次改动（3ce328b 之后）没被这个
  老进程加载。**单次观测只报事实**：说明线上/本机存在「跑着旧代码」的情况，与 ㉜ 同源。
- **下轮首选**：㉘（拍板 141 题口径）/ ㉚（定 60s 超时阈值）/ ⑲（备份脚本挂不挂每日定时任务）；
  另需负责人处理 Render 自动部署（㉜）与 running/206 的 stale 锁。

---

## 第 215 轮（2026-10-06 19:02–19:20）：`npm test` 漏跑 65 条断言——server 侧 9 个测试文件从不进套件

**交付**：`efcf6a7`（`package.json` 显式列出 8 个 server 侧测试文件 + 新锁 2 个文件）。

**为什么这一条值钱**：门禁**假绿**。此前 `npm test` 报「1878 全绿」，但其中 8 个文件、65 条断言
从来没被执行过——`node --test "test/*.test.mjs"` 这个 glob 罩不到 `server/tests/` 与
`server/utils/` 下的测试。单独跑实测：8 个全绿（65 条断言**成立**）、1 红。
**门禁永远是绿的，因为它压根没在查** —— 这比假红更危险。

**⛔ 技术坑（下次别再试）**：`node --test <目录A> <目录B>` 在 Node 22 不递归发现测试，
实测把每个目录当 1 个 entry 跑。⇒ 只能显式列文件，代价是清单要维护，所以锁了它。

**反向自检**：判据抽到 `test/testSuiteCoverageKit.mjs`（唯一实现），
喂**修复前旧 package.json** = 8 条全红、每条点名具体文件；新配置 0 红。不调 git，
用 `git show HEAD:package.json` 先导出到 `_r215_old/`。

**新提案 ㊱（B，跨赛道只提名）**：埋在那些从未执行的测试里的一条**真红**——
`server/tests/figureRegionRefiner.test.mjs` 18 通过 / 1 失败。取证：模型框
`{x:130,y:190,w:180,h:110}` ⇒ 返回 `130,200 180x79`，水平覆盖 ✓，**纵向只给 200..279（要求 190..300）✗**。
根因在 `server/utils/figureRegionRefiner.js:447-454`：算出了与模型框的并集，输出却用削过边的
`uniTrim` 边界 ⇒ 2026-09-21「并集后再让一次边」把 2026-09-18「防砍半截」的纵向保护削回去了。
**几何配图与重绘管线赛道，本轮只取证未擅改。**

**四道闸**：单测 **1953/1953 fail 0**（1878 基线 + 65 新增断言 + 10 新锁，数字对得上账）｜
lint 改动 2 文件零输出｜`dist_nightly_20261006r215` **37.39s**（main chunk `main-Dg_0tVgF.js`
与 r213/r214 同名 = 零前端产品代码改动）｜preview `5340` + cert_probe 零外联 exit 0 +
render_smoke **8/8** + route_sweep **0/16** + text_audit **0/14**。

**健康**：19:02 uptime **61min**、接口 353ms、DB 1872ms、队列 0、磁盘剩 76189MB。
19:10 生产 `/api/health`：`commit 223b691`、`bootAt 10:02:06Z`。
⚠️ 生产 ≥7 小时停在同一次重启，**本轮 `efcf6a7` 与 r214 的 `c8642b7` 都还没上线**（㉒/㉜ 仍未闭环）。

**下轮首选**：㉘（141 题口径拍板）/ ㊱（几何赛道修完纳入套件）/ ㉚ / ⑲；
另需负责人查 Render 两条部署链路（㉜）。

---

## 第 216 轮（2026-10-06 19:41–19:55，每小时兜底脉冲 → 测试套件门禁基线）：假绿门禁的第二层

**交付**：`test/testSuiteCoverageKit.mjs`（新增 `auditTestFileDiscovery`）+ `test/testSuiteCoverage.test.mjs`
（fs 扫描 + 6 条反向自检）。**只改测试文件，零产品代码**（main chunk `main-Dg_0tVgF.js` 与 r213–r215 同名可证）。

**为什么这一条值钱**：r215 刚修掉「9 个测试文件从来没被执行过」，但它的修法是**显式清单**
（`MUST_COVER` + 反向自检）—— 而那份判据**只能证明「清单里写的文件在清单里」，
看不见磁盘上多出来的文件**。也就是说 r215 修掉的那类缺陷可以原样复发：
谁往 `server/tests/` 加一个 `foo.test.mjs`、忘了同步 `package.json`，那个文件永远不跑，门禁依旧全绿。
还有一半同族：`test/*.test.mjs` 只罩「test/ 直下一层 + `.test.mjs`」，
在 `test/` 下写 `foo.test.js` 或塞进 `test/sub/` 同样永不执行。

**修法**：判据改成「对着磁盘的真实清单判」——
`test/` 下的测试文件必须被主 glob 罩到；其余位置必须出现在 `MUST_COVER` 或 `EXCLUDED` 里。
`TEST_FILE_RE` / `MAIN_GLOB_RE` 只有一份，扫描侧与审计侧共用（防两边漂移成假绿）。
扫描结果为空时**判红**（否则扫描一坏就退化成永真门禁）。

**反向自检（三层，不是只喂合成样本）**：
① 合成坏样本三种（未登记新文件 / `test/x.test.js` / `test/sub/x.test.mjs`）各判红并点名；
② **真实文件级**：真造 `server/tests/zzz_r216_probe_unlisted.test.mjs` 跑锁 ⇒ 判红并逐字点名，探针已删；
③ **旧判据盲区实证**：同一份坏样本喂 `auditCoverage()` 判绿、喂新判据判红 —— 洞是实测的，不是推测。

**四道闸**：单测 **1961/1961 fail 0**（r215 基线 1953 + 本轮 8）｜eslint **0e / 126w**（同基线，
改动 2 文件零输出）｜`dist_nightly_20261006r216` **40.69s**｜preview `5352` + curl 验对象
`text/javascript` + cert_probe 零外联 exit 0 + render_smoke **8/8** + route_sweep **0/16**。

**未做（仍待负责人拍板）**：㉘（141 题口径）/ ㉚（分享卡渲染超时阈值）/ ⑲（备份脚本挂不挂定时任务）/
㊱（几何配图 `figureRegionRefiner` 纵向保护失效 —— 本轮这把锁的 `EXCLUDED` 就是它，几何赛道修好后
本锁会自动要求把它挪进 `MUST_COVER`）；另需负责人处理 Render 两条部署链路（㉜/㉝）。

## 第 217 轮（2026-10-06）

**接力锁**：进入时 `finished / 216`（`2026-10-06T11:49:57Z`），工作区只有他人在改的
`src/workbench/views/QuestionBankWorkbench.vue`，全程未碰。

**第 0 步健康采样**（`node scripts/healthcheck.mjs`，只读）：
`upMin 139`、`rtMs 1275`、`DB 846ms`、`queue 0 waiting`、`disk 69143MB free`。
配套核对 `tmp/health.jsonl` 的 30 条历史样本：两天内 5 次重启，最后一次 `upMin 62→61`（11:03），
本轮窗口内 uptime 单调，**没有新增重启** ⇒ 本轮不做部署相关推断。
⚠️ 按红线，单次观测只报数、不下因果结论。

**缺陷 1（A 级，已修，commit `8f7815a`）**：家长分享卡上**同一个数字被起了两个名字**。
顶部 KPI 写「批改题量」、下面「较上一周期」写「完成题量」——读的都是同一个字段
`s.totalQuestions`（`server/services/shareCardTemplate.js`）。家长在一张卡上看到两个词、分不清
是同一个数还是两个数。只改文案不改取值：对比块 `compareItem('完成题量'…)` → `compareItem('批改题量'…)`，
`server/services/shareCardTemplate.js:298`；涨跌方向（`goodWhenUp`）、单位、比较逻辑一行没动。
配套 `test/shareCardCopyConsistency.test.mjs`（6 条：行为锁 + 同源锁 + 自证钩子 + 行为保持）。

**缺陷 2（B 级，只留证据未改）**：`lanes.md` 里认领的「敏学夜间只读巡检（每日 03:30）」**这条自动化根本不存在**。
实测：实际自动化只有 5 条，没有「夜间只读巡检」，也没有「移动端与PDF」；「常驻巡检循环」实际是
HOURLY 不是 21:30；`scripts/nightlyAudit.mjs`（夜间巡检引擎）**零调用方**；
`docs/auto/baseline.json` 的 mtime 停在 `2026-09-29 23:46`。
已在 `docs/auto/lanes.md` 第 16 行改标为 🟠 空转并新增「第 217 轮勘误」表。
这条同时改写了 ⑲ 的前提：**没有夜间自动化可挂备份脚本**，㊲ 得先拍板再决定挂哪条。

**实测排除的两个误判**（按红线「看图发现问题也可能不是问题」反向自查）：
1. 本地跑分享卡渲染探针**卡死约 10 分钟** ⇒ 是本机 → Neon 冷连接路径，不是线上慢。
   线上实测：全班周报 `1.86s / 1.97s`、单生 `0.83s`。已 kill 进程（`netstat -ano` + `taskkill /F /T`）。
2. 缺陷 1 的对比块**当前对 0/21 个学生真的渲染出来**（系统空转期）⇒ 它是「将来家长一定会看到」
   的文案错，不是当下报错。**仍按 A 级修了**（改词零成本、零风险），但不夸大成「线上正在出错」。

**本轮踩的自我制造坑（已修）**：测试判据 4 的正则 `/class="kpi-l">([^<]*)题量</` 贪心回溯把
「批改题量」截成「批改」⇒ 假红；判据 6 把「新增错题」的涨跌方向写反了（`goodWhenUp=false`
时 `+3` 才是坏方向）。修正为「先收集全部 `kpi-l` 标签再筛唯一含题量者 + 与 `compareItem` 标签比对」。

**提案**：㊲ 夜间巡检自动化到底建还是删（B，需拍板）；㊳ `scripts/` 下 7 个零调用方脚本（A，清还是留）。
**未做**：㉘ / ㉚ / ㊱ / ⑲ / ㉒ 全部保持原状，留待负责人拍板。

## 第 218 轮（2026-10-06 21:53–22:15，本赛道「服务端基础设施 + 家长可见产出物」）

- **交付 `7828fe2`（已推送）**：体检脚本 `scripts/healthcheck.mjs` 的「接口速度」判据漏掉冷启动那一次。
  同一份输出里「后端在线」报第一次的耗时（最慢），「接口速度」却用第二次复查去判 —— 当天生产实测
  **在线 2211ms / 复查 335ms ⇒ 结论「一切正常」**。发布后头几分钟打不开正是最该提醒老师的时刻。
  修：判据取两次里最慢值 + 把「首次 / 复查」两个数字都印出来；顺手清掉体检脚本 6 处死声明
  （`pruneDeadDeclarations` 门禁自己报出来的）与磁盘文案里两个 Markdown 星号。
- **回归锁 `test/healthcheckSpeed.test.mjs` 5 条**：真跑体检脚本 + 可控延迟假后端。
  反向自检（导出修复前旧脚本跑同一场景）实测：**旧版冷启动 873ms 仍判 ✅「正常」，新版把首次纳入判据**。
- **踩坑两条（写进通用经验）**：假后端在同进程 ⇒ 必须异步 `spawn`（`spawnSync` 锁死事件循环，请求到不了）；
  `Atomics.wait` 轮询 `server.listening` 永远等不到（阻塞期间事件不转）⇒ 要等事件就别阻塞事件循环。
- **已验证无问题（别再翻）**：`--json` 真能被 `JSON.parse`；分享卡周期词在 r211/r213 后无残留硬编码。
- **提案**：㊴（`examPdfRenderer` 两条渲染路径零超时，与 ㉚ 同源，建议一次定阈值一起改，B）；
  ㊵（观察）。**状态更新 ㉒**：本轮实测生产 `commit 1c94d13` / `bootAt 20:52`，比 r217 的 `223b691` **前进一档**
  ⇒ Render 自动部署是生效的，此前三轮「没部署」的结论需要改写（见 backlog 第 218 轮节）。
- 四道闸：单测 1990/1990 fail 0｜lint 3 文件零输出｜`dist_nightly_20261006r218` 38.38s｜
  preview 5391 + cert_probe + render_smoke 8/8 + route_sweep 0/16 + text_audit 0/14。
- 未做：㉘ / ㉚ / ㊱ / ⑲ / ㊲ / ㊴，全部留待拍板。

## 第 219 轮（2026-10-06 23:11–23:45）：后端死端点门禁（commit `2dbed43`，已推送）

- **做了什么**：给「后端新挂的 API 有没有人在调」装了一道门禁。后端共暴露 155 条 API，
  实测 20 条零调用方（业务 7 / 运维 13）。这 7 条业务死端点全部写进
  `test/apiDeadEndpoints.json` 并逐条写明「为什么还留着」+ 归属赛道。
- **最重要的实证**：`POST /api/wrong-questions/export-retry-pdf`（服务端重练卷 PDF + 二维码）
  零调用方 —— 学生扫的二维码是手机端现算的。同类第三枚（前两枚：提案 19 的备份脚本、
  r217 的 nightlyAudit.mjs）。**这一类缺口读代码看不出来，只有「扫端点 + 扫调用方」才看得见。**
- **待办（交负责人）**：
  - **㊸**：服务端那条重练卷导出链路 —— 留着？删掉？还是接到工作台上去？
    建议先删（手机端已有等价能力），要接再说。
  - **㉘**（141 题 is_complete 口径）／**㊴**（两条渲染路径加 60s 超时）／**⑲**（备份脚本挂不挂定时任务）仍待拍板。
  - **㊹**（观察）：另 6 条业务死端点（teaching / weakness / batch-update-tags / figure-relocate）零调用方，
    其中几何、考法两条是别人在跑的赛道，本轮只登记未动手。
- ⛔ **写这类门禁时最容易踩的坑（本轮当场踩到一次）**：门禁自己的测试文件若在「调用方语料」里，
  它列的死端点清单会**用自己那串字符串**把这些端点判成「有人调」⇒ **锁自己变假绿**。
  `test/apiCallerAuditKit.mjs` 里的 `GATE_SELF_FILES` 就是为这个存在的，别删。
- 四道闸全绿：单测 2015/2015｜lint 零输出｜`dist_nightly_20261006r219` 37.32s｜
  preview 5405 + cert_probe + render_smoke 8/8 + route_sweep 0/16 + text_audit 0/14。

## 第 220 轮（2026-10-07）· 体检「任务队列」读错 /api/queue/stats 嵌套字段

- 缺陷：`scripts/healthcheck.mjs:117` 读根级 `q.waiting/q.active/q.failed`，真接口是
  `{ success, stats:{...} }`（`server/index.js:1711-1719`）⇒ 三数恒 0。生产 `stats.failed=50`
  体检印「历史上失败 0 个」；真积压（>20）照样印 0 判合格。体检的 warn 记进 `tmp/health.jsonl`
  ⇒ 这类告警一次都不会出（r198 磁盘 / r218 接口速度 同一枚雷的第三处）。
- 修 `25b4386` + 文档；新锁 `test/healthcheckQueueStats.test.mjs`（5 条，含反向自检）。
- ⭐ 顺带发现：r218 那份**假后端把错误契约固化下来了**（返回根级），所以那把锁从第一天起
  验的就是一个不存在的接口。已改回 `{ stats }` 并加元判据锁住契约不漂移。
  ⛔ 以后写假后端，**先 curl 一次真接口再抄结构**。
- ⭐ 六项判据现已逐项实测（下轮别再翻 ①②③④⑤⑥）。
- 四道闸：单测 2022/2022｜lint 0 error 0 warning｜`dist_nightly_20261007r220` 86s｜
  preview 5410 + render_smoke 8/8 + route_sweep 0/16 + text_audit 0/14。
- 提案 ㊺（B）：体检六项统一加「字段没真读到就明说」自检。

- **r221（2026-10-07 10:19–10:52，可开工轮）：体检「字段没真读到就明说」—— 同一枚雷第四、五、六处（两个 commit，已推送）**
- 提案 ㊺ 落地（A 级，本赛道，零产品代码改动）。体检六项里有**四项的判据在字段取不到时会悄悄判合格**：
  - ①「后端在线」`uptimeSec` 没回 ⇒ 旧版印「已运行 ? 分钟」**照样判合格**（看着在盯，其实没盯）；
  - ③「数据库可读」`students` 没回 ⇒ 旧版 `.students || []` 说成「读到 0 名学生」，
    真出问题的信号被一句听不出毛病的话盖住；
  - ④「批改失败任务」`summary` 没回 ⇒ 旧版 `.summary || {}` 吞掉，判「没有失败也没有卡住的任务」；
  - ⑤「任务队列」整层 `stats` 掉了 ⇒ 旧版照印「排队 0 个」并判合格（r220 只修了**读错路径**，
    没补「字段压根不在」这一层）。
  - ⑥ 磁盘 r198 起已由 `healthDiskState` 单独处理，本轮不动。
- 交付 `c754558`：新增纯文案/存在性口径 `missingFieldDetail(label)`，「这一项等于没盯（体检会一直
  显示正常，其实是空转）」—— 说后果和下一步，不写 `available`/`undefined` 这类词。
  ⛔ **口径纪律：字段真的返回 0 不算没读到，照旧判合格**，不许假报警（r198 恒定黄灯教训）。
- 新锁 `test/healthcheckMissingField.test.mjs` 7 条（真跑脚本 + 假后端故意漏字段 + 逐项点名）。
- ⭐ **本轮最大收获（反向自检基线锁错对象）**：r220 那把锁的反向自检基线是 `git show HEAD:`，
  本轮一提交 HEAD 就变成**新代码** ⇒ 反向自检会永远空转、永远判绿（r214 教训重演，只是换了个场景）。
  ⇒ 本轮把基线**钉死到 r220 那次提交 `25b4386`**，逐场景断言「旧版必须判合格」，
  而不是数红了几条。换机器探针不在 ⇒ 显式 `t.skip` 而不是 `return`（r215 教训）。
- ⭐ 测试自身踩坑：`assert.match(str, '字符串')` 会抛 `ERR_INVALID_ARG_TYPE`
  （第二参数必须是 RegExp）⇒ 元判据第一条直接红；改成 `includes()`。
- ⭐ 改完用**改后的脚本复测生产**确认没多出假告警：六项全绿（「接口速度」从首采 2138ms 变 1111ms，
  单次观测不下因果结论）。
- 四道闸：单测 **2029/2029 fail 0**（基线 2022 + 本轮 7）｜lint 2 文件 0 error 0 warning｜
  `dist_nightly_20261007r221` **47.76s**（main chunk `main-Dg_0tVgF.js` 与 r213–r220 同名 = 零前端产品码改动）｜
  preview `5431` + cert_probe 零外联 exit 0 + 本机 Chrome 读 DOM **5/5** + route_sweep **0/16** + text_audit **0/14**，
  预览已按端口杀清。
- 健康：10:19 采样 uptime **650 分钟**、首响 2138ms / 复查 459ms；10:47 复测 uptime **658 分钟**、
  首响 1111ms / 复查 380ms ⇒ 单调上升，本窗口无重启。
- 生产观察：`commit` 仍停在 `5a6eb5a`（= r219 的文档提交），r220 的 `25b4386` 与 r221 的
  `c754558` **都没上线** ⇒ ㉒/㉜（Render 部署链路）本周第三次仍待负责人去面板确认。
- **下次触发接 r222**：首选 ㉘（141 题 is_complete 口径拍板）、㊸（export-retry-pdf 留/删/接线）、
  ㊴（两条渲染路径 60s 超时阈值）、⑲（备份脚本挂不挂定时任务）；
  另需负责人处理 running/206 的 stale 锁与 Render 部署链路（㉒）。

## 第 222 轮（2026-10-07）· 反向自检探针缺失显式 t.skip（提案㊻ 落地，`4f60b3c` 已推送）

- 三处修（全测试文件，零产品码）：① speed 锁静默 `return` ⇒ `t.skip`（实测本机探针从不存在，
  该锁一直空转假通过）；② queue 锁 skip 提示 `HEAD` ⇒ 钉死 `25b4386~1`（基线漂移假红）；
  ③ 三把锁 skip 后补 `return`（实测 `t.skip`+抛错 = fail 假红，`t.skip`+return = skipped）。
- 真基线验证：三探针按钉死提交导出 ⇒ 18/18 全绿；删探针复跑 ⇒ 15 pass + 3 skipped + 0 fail。
- 四道闸：2029 = 2026 pass + 3 skipped / 0 fail｜lint 全仓 0 error｜`dist_nightly_20261007r222` 33.33s｜
  preview 5441 + render_smoke 8/8 + cert_probe 零外联。
- 线上 commit 仍停 `5a6eb5a`（㊼ 第三次，本轮零运行时影响，待负责人面板确认）。
- 下轮 r223：待拍板 ㉘/㊸/㊴+㉚/⑲；观察 ㊼ 继续。

## 第 223 轮（2026-10-07）· 只读巡检：patrol daemon lint 判据陈旧报告假绿（提案㊽，无代码改动）

- `scripts/patrol/patrol.mjs` lint 判据跑 eslint 前不删 `tmp/prune-lint.json`、不查退出码：eslint 没写出报告时
  会读上一轮旧报告冒充本轮 `lint=0`（假绿家族第八枚候选）。实测文件跨 tick 持久、无人删除。
- 修法一行：跑前 `rmSync` 旧报告，或校验报告 mtime ≥ 本 tick 起点。daemon 正被并行会话活跃使用 ⇒ 只读不代修。
- 快闸：2029 = 2026 pass + 3 skipped / 0 fail｜lint 0 error。六项体检全 ✅（本地 :4000）。生产 commit 仍停 `5a6eb5a`（㊼）。
- 下轮 r224：㉘/㊸/㊴+㉚/⑲ 待拍板；观察 ㊼。

## 第 224 轮（2026-10-07）· cert_probe 外联判据进退出码（`ef2137f` 已推送）

- 假绿：cert_probe 退出码只看 requestfailed，外部 origin 只打印不判——烤入生产 base 的产物
  外联请求会成功 ⇒ exit 0 假绿（r152「有脏即非零退出」漏了这一闸）。
- 反向自检同场景双跑：旧版 exit 0 假绿 / 新版 exit 1 判红点名。⭐ gate 脚本探针须导到同目录
  （相对导入 `./base.mjs`），放 scripts/ 下会 ERR_MODULE_NOT_FOUND。
- 修：origin 严格相等判外联（避开 :54410 startsWith :5441 端口边界），与 failures 一并定退出码。
- 四道闸：2029/0 fail｜0e/110w｜dist_nightly_20261007r224 33.40s｜render_smoke 8/8 + 修复版
  cert_probe 绿路 exit 0（无假红）。六闸脚本全部扫毕，假绿唯一即本次所修。
- 下轮 r225：㉘/㊸/㊴+㉚/⑲ 待拍板；观察 ㊼。

## 第 225 轮（2026-10-07）· P0：每日备份断档三晚，白班补跑 + 提案㊾（无代码改动）

- 发现：备份库只有 10-02 / 10-05 两份，10-03/04/06 三晚缺失（昨晚窗口内有会话跑轮但未执行每日收工）。
- 补救：手动 dailyBackup ⇒ 2026-10-07 快照 ok:true（五表 21/192/1120/3011/152）。
- 提案㊾（B）：daemon 兜底——发现当日快照缺失/不完整即补跑 dailyBackup。备份不该依赖可能不来的脉冲。
- 假绿家族全域扫毕：backupKit/patrol-smoke 均诚实。快闸 2029/0 fail、0e/110w。㊽ 尚未采纳；㊼ 继续。
- 今晚 21:30 收工窗口务必确认备份真的落盘。

## 第 226 轮（2026-10-07）· 只读巡检，无代码改动

六项体检全 ✅；daemon R28–R31 全绿；生产 commit 仍停 5a6eb5a（㊼）。
下轮 r227：待拍板 ㉘/㊸/㊴+㉚/⑲/㊽/㊾；今晚收工窗口确认备份落盘。

## 第 227 轮（2026-10-07）· 脚本层死码盘点清白 + 提案㊿（无代码改动）

- 197 脚本盘点：server/scripts ~150 个一次性件 = 刻意存档不动；build-app（npm build:app）与
  loopGuard（锁工具）排除嫌疑；gate/patrol/backup 全在岗。⭐ caller 扫描必须含 package.json。
- 提案㊿（B）：开工/收工协议换用 loopGuard acquire/release——工具已落地（10-02 双开工事故产物），
  协议文本却仍手写 JSON；换用即防并发从纪律变机制（status 只读已验证）。
- 快闸 2029/0 fail、0e/110w。下轮 r228：待拍板八件套；今晚收工确认备份。

## 第 228 轮（2026-10-07）· loopGuard 三场景实机验证全过 + 备份快照核验（无代码改动）

- 本圈首次用 loopGuard acquire/release 走完整轮锁（提案㊿ 实机验证）：认领/忙拒/release 三场景全过，
  锁格式与协议一致 ⇒ ㊿ 采纳零风险。
- 备份快照 2026-10-07 JSON 级核验 ALL_MATCH=true（五表行数与 manifest 全符），恢复点可靠。
- 快闸 2029/0 fail、0e/110w；生产 commit 仍停 5a6eb5a（㊼）。
- 下轮 r229：待拍板八件套（㊿ 已验证）；今晚收工确认备份落盘。

## 第 229 轮（2026-10-07 11:29–11:42）· 只读转可开工：体检新增「代码版本」项（f269fbc 已推送）

- 开工经过：11:29 读锁 = `running / r227` ⇒ 转**只读审计**，只做只读取证（不改码、不提交、不写锁）；
  11:34 对侧释放 `finished / 228`、树干净 ⇒ `loopGuard.mjs acquire` 接手 r229。
  只读段只取了一次健康样 + 一次 `/api/health` + 若干只读 grep，**没动任何文件**。
- **主缺陷（A 级，可观测性）**：`/api/health` 一直回 `commit` / `bootAt`（curl 实测生产
  `commit=5a6eb5a`、`bootAt 2026-10-06T23:29` 本地），体检**从不印** ⇒ 「刚推的新代码上没上线」
  只能人肉 curl。r220~r228 **八轮**都是这样靠人工发现才会写进报告。
- 交付 `f269fbc`：`scripts/healthcheck.mjs` 加第 7 项「代码版本」（+59 行）+ 新锁
  `test/healthcheckCommit.test.mjs`（+195 行）。判黄并同时点名两边版本号 + 说清去哪手动部署；
  `commit` 没回沿用 r221 的「这一项等于没盯」措辞；non-sha 占位（本机 `commit="local"`）只照实印不判黄。
- ⭐ 自踩坑：第一版照抄判黄 ⇒ 本机天天黄灯（r198 同病）⇒ 收紧为「非 hex 不比」。
  **写告警先自问「会不会天天亮」。**
- ⭐ 反向自检：基线钉死 `9809c30` 旧脚本，同场景**压根没有这一项**、也无「没上线」字样；
  新锁 6 条全绿；探针按 r215/r222 纪律 `t.skip` + 文案内附导出命令，跑完已删。
- ⭐ 只读段清白盘点（⛔ 下轮别再翻）：五个 `scripts/gate/*.mjs` 全有调用方（gateBase + gateExitCode 罩住、
  退出码齐全）；7 处进程内 `setInterval` sweep 全有 try/catch 兜底。
- ⭐ 既有提案修正：㊴/㉚ 建议的「渲染超时 60s」与仓库既有口径不符 ——
  `server/config/ai.js:1788/1813` 的 `BACKUP_VISION_TIMEOUT_MS` / `VISION_TIMEOUT_MS`
  默认都是 **180000**，实测出图 36~37s ⇒ **建议阈值改 180s**，别两处各定一套。
- 四道闸：单测 **2035/2035 fail 0**（2032 pass + 3 skipped）｜lint 2 文件 0e/0w｜
  `dist_nightly_20261007r229` **38.85s**（`main-Dg_0tVgF.js` 与 r213–r221 同名 = 零前端产品码改动）｜
  preview `5445` + cert_probe 零外联 + render_smoke **8/8** + route_sweep **0/16** + text_audit **0/14**，预览已杀清。
- 健康：11:30 采样 uptime **721 分钟**、首响 1370ms / 复查 398ms；r221 的 658min → 单调上升，无重启。
- 生产：commit 仍 `5a6eb5a`（落后 31 个提交、12h 零重启）⇒ ㊼ 未闭环，但**现在体检会直接判黄点名**。
- 提案 ㊶ / ㊷ 见 backlog 第 229 轮节。
- **下次触发接 r230**：首选 ㊶（先去 Render 面板确认自动部署，再看这条黄灯是不是真信号）、
  ㊴+㉚（阈值改 180s，一次改两条渲染路径）、㉘（141 题口径拍板）、㊸（export-retry-pdf）、⑲（备份定时任务）。

## 第 230 轮（2026-10-07）· 只读巡检：r229 新「代码版本」体检项验证通过（无代码改动）

- 七项体检全 ✅（新项对本地如实报 commit 来源，㊼ 盲区关闭）；loopGuard 第四次实机验证通过。
- 快闸新基线：2035 = 2031 pass + 4 skipped / 0 fail｜0e/110w/733f。
- 生产 commit 仍停 5a6eb5a（新体检项会持续盯着）。下轮 r231：待拍板八件套；今晚收工确认备份。

## 第 231 轮（2026-10-07）· flow-audit 新增「判定面地图」（无代码改动）

- 把 r198–r230 散落的判定面知识集中成表：17 个判定面 ×（位置/盯什么/守它的锁/踩过的雷），
  附假绿家族八枚档案（共同根因：数据缺席时默认分支是「合格」）与断档家族（「有没有人跑」没有判定面）。
- 后续轮次加/修判定面先登记该表。快闸 2035/0 fail、0e/110w。
- 下轮 r232：待拍板八件套；今晚收工确认备份。

## 第 232 轮（2026-10-07）· 新建 docs/auto/DECISIONS.md 决策菜单（无代码改动）

- 十项待拍板集中一页（A 安全数据 / B 门禁流程 / C 口径数据 / D 方向大件），负责人勾选即生效。
- 快闸 2035/0 fail、0e/110w；daemon R34/R35 全绿；生产 commit 仍停 5a6eb5a。
- 下轮 r233：等菜单勾选；今晚收工确认备份。

## 第 233 轮（2026-10-07 12:45–13:05，可开工轮）：体检「批改失败任务」子字段假绿（一个 commit `91cfabe`，已推送）

- 缺陷：r221 只堵了整层 `summary` 在不在，`pendingTasks` / `failedTasks` 两个子字段仍走 `|| []` / `|| 0`
  ⇒ 接口改结构时体检照旧印「没有失败也没有卡住的任务」判合格（假绿家族第四枚，往下挪了一层）。
  真接口字段都在 ⇒ **线上行为零变化**。
- 交付 `91cfabe` + 反向自检（基线钉 `0557805`，旧版同场景判合格，洞是真的）+ 新增 2 条锁。
- ⭐ 采样数据当裁判：磁盘 18 次告警全在 r198 之前、改后 0 次；接口速度只亮 1 次（真实冷启动 2138ms）。
  ⛔ 判断「告警是不是瞎亮」先翻 `tmp/health.jsonl` 数分布，别凭印象。
- ⭐ 已验证无问题（下轮别再翻）：`scripts/` 11 个脚本零死脚本；`SUMMARY_TTL` 仅 10s；`healthDiskState` 判据干净；
  生产 `/api/health` 的 `branch` / `visionTimeoutMs` 两个字段体检没读（只记录）。
- 四道闸：2037/2037 fail 0｜lint 0e/0w｜`dist_nightly_20261007r233` 38.16s（main chunk 同名 = 零前端改动）｜
  preview `5451` + cert_probe + render_smoke **8/8** + route_sweep **0/16** + text_audit **0/14**。
  健康 796min → 807min 单调上升无重启。
- 提案 **㊫**（接口速度阈值 2000ms 是否偏紧，B）/ **㊬**（体检无定时调用方，B）。
- 下轮 r234：待拍板 ㉘/㊸/㊴+㉚/⑲/㊾/㊿；另需负责人处理 running/206 的 stale 锁与 Render 部署（㊼/㉒）。

---

## 第 234 轮（2026-10-07 13:58–14:20，只读审计轮）

- 开工锁 = `running / r234`（对侧 13:55 起）⇒ 按纪律**只读**：未改业务码、未提交、未推送、**未写 finished**
  （留给在跑方收线）。改动仅向 `docs/auto/backlog.md` + `docs/auto/HANDOFF.md` 各追加本轮节。
- 健康采样 13:58：uptime **869 分钟**、首响 1254ms / 复查 364ms、磁盘剩 77270MB；14:03 复测 871 分钟。
  与 r233（12:45，796min）单调上升 ⇒ 本窗口无重启。
- ⭐ **本轮最大发现（提案 ㊭，B）：体检「代码版本」这一项，把「两条不同的部署」合成了一个信号，
  负责人照着它行动会做错事。**
  - 实测：生产 `commit 5a6eb5a`（10-06 23:29 启动），本地 HEAD `d9b844c` ⇒ 落后 **53 个提交**。
  - 但**这 53 个提交里只有 1 个动了老师真正用的东西**：`093f971 fix(board): 修 iPad 触控笔「要写两次」+
    书写区漂移 + 主屏 PWA 三处缺陷`（12 个文件）。
  - ⛔ **此前几轮（r209/r233）的判据「落后提交零 `server/` 改动 ⇒ 线上零运行时影响」是错的**：
    它衡量的是**后端**，而老师实际受影响的是**前端白板**。这条判据以后不能再用。
  - ⭐ 更关键的一条（实测坐实）：**前端那条链路其实已经部署了，后端没有。**
    - `093f971` 首次加入的 5 个 PWA 文件：`public/manifest.webmanifest`、`icon-192x192.png`、
      `icon-512x512.png`、`icon-maskable-512x512.png`、`apple-touch-icon.png`。
    - 线上 `https://minxue.pages.dev/manifest.webmanifest` ⇒ **HTTP 200 / 745 字节 / 真 JSON**
      （`display":"standalone"`，正是那个修复要的「添加到主屏幕全屏」）。
    - 但 `manifest` 声明的三个图标 + `workbench.html` 引用的两个，`/icon-192x192.png`、
      `/apple-touch-icon.png`、`/icon-512x512.png` 全部返回 **text/html 2465 字节 = SPA 兜底页**（不是图）。
    - 对照组排掉「public 整体没部署」以外的可能：`/assets/main-D7ezFucl.js`（dist 构建产物）**312KB 真 JS 正常**，
      而既有的 `/vite.svg`、`/icon.png`（仓库里 967KB）同样拿不到 ⇒ **缺的是 `public/` 这一整块**。
  - ⇒ 这盏黄灯现在报的是「后端落后」，但**负责人真正想要的 iPad 手写修复，前端侧已经上线了**；
    他照着这盏灯去手动部署**后端，解决不了任何他遇到的问题**。两条链路必须分开看、分开报。
  - ⚠️ 成因有 ≥2 种可能（部署只拷了文本文件 / 部署目录不含 `public/` / CDN 缓存），**本轮不下因果结论**，
    也不碰（属「白板/课件」赛道 + C 级部署管线）。已列排查方向进提案 ㊯。
- 提案 **㊮（A，2 行，本赛道未做）**：`scripts/healthcheck.mjs:238` 的「代码版本」项，
  在**读不到本机版本号**时（`readLocalHeadShort()` 返回 null）`behind` 恒假 ⇒
  印 `✅ 代码版本：线上 commit 5a6eb5a` 判合格 —— **压根没比过**。这正是 r221 立的
  「字段没真读到必须明说」在这条分支上的漏网（r221 只堵了 `commit` 本身在不在）。
  - 实测坐实：把脚本复制到没有 `.git` 的临时目录跑生产 ⇒ 输出 `✅ 代码版本：线上 commit 5a6eb5a`（判合格）；
    同场景有 `.git` 时则正确报 `⚠️ ... 你本地已经是 d9b844c`。探针跑完已删，零写操作。
  - 修法：`comparable && local === null` ⇒ 走 `missingFieldDetail('本机代码版本号')`。
- 提案 **㊯（B，白板/课件赛道，未动）**：PWA 图标线上拿不到（见 ㊭ 的取证）——
  「添加到主屏幕」拿不到自定义图标、会退回网页截图，**正是 093f971 想修掉的那个现象，现在只上线了一半**。
- ⭐ **已验证无问题（下轮别再翻）**：
  ① 采样数据当裁判——`tmp/health.jsonl` 35 条有效样本：磁盘 18 次告警**全落在 10-04~10-06 03:45**，
  r198 改后 **0 次**；接口速度只亮 1 次 = r221 那条真实冷启动 2138ms；**代码版本**自 12:45 起连亮 3 次
  且三次成因相同（有未部署提交）⇒ **不是恒定黄灯，是真报**（与 r233 同法，别凭印象判）。
  ② 今天备份 `D:/Minxue_Backup/2026-10-07/` 已落盘、manifest `ok:true`、五表齐全 ⇒ ⑲ 今天不缺。
  ③ 落后 53 个提交里 `server/` 改动 **0 个** ⇒ 后端当前零运行时影响（这条仍成立，但别外推到前端）。
- 提案 ㊭/㊮/㊯ 入本节；㊼（Render 面板部署）状态更新为「**负责人要决定的是：后端要不要重新部署**，
  前端白板已经在线上」；running/206 的 stale 锁仍待处理。

### r236（2026-10-07 18:26–，只读审计轮：**前端白屏探针加了「跳过浏览器」就盯着白屏说健康**）

- 锁 = `running / 236`（18:30 被对侧会话拿走）⇒ 按纪律只做只读审计：**未改任何业务码、未提交、未推送、未写 finished**；只向本池追加（与 r207–r209 只读轮同做法）。
- 健康采样：uptime **1137 分钟**（bootAt 10-06 23:29，与 r233 同实例，单调上升无重启）、首响 2310ms / 复查 338ms、21 名学生、磁盘剩 72910MB。42 条历史采样分布：磁盘 18 次（全在 r198 之前 ⇒ 不是恒定黄灯）、**代码版本 6 次（r229 引入后每跑必亮）**、接口速度 2 次。

**㊰（A 级，本轮最大，未动手）**：`scripts/frontendHealth.mjs:193` 判健康的条件是 `result.bad.length === 0 && !dom.blank`。`dom` 只有真启动了浏览器才带 `blank`；跑 `--no-dom` 时它是 `{ skipped: true }` ⇒ `dom.blank` 为 `undefined` ⇒ `!undefined === true` ⇒ **真白屏也判「首页正常」并 exit 0**，而且文案还替没查的那半边打包票，写「DOM 有内容」。
- 实测（起一个仓库外的假服务：`#root` 空、可见文字 0 字、模块链全 200）：
  - 默认路径（playwright 在）：`真机冒烟：✗ 白屏（根节点 0 个子元素 / 0 字符 HTML / 0 字可见文字）` ⇒ **exit 1 persistent** ✅ 这层本身就是好的；
  - `--no-dom`：`结论：首页正常：模块链全 200，DOM 有内容。` ⇒ **exit 0** ❌
- 与 r221 是同一枚雷：体检判据把「这一项没查」当成「这一项正常」，外壳文案还替它背书。外壳型体检（健康检查 / 白屏探针）都该按 r221 的口径说「这一项等于没盯」。
- 修法很小（两处，零调用方 ⇒ 风险低）：DOM 那层没跑时，不许把「有内容」写进结论，也不许算 healthy。
- ⚠️ 纠正一个容易记反的点：本机 **playwright 是装了的**（Node 能 resolve）；用 python 查 `sys.path` 会把 node_modules 排除掉、误判成「没装 ⇒ 白屏层空转」——本轮我先踩了一次，差点把结论写反。

**㊱（B 级，观察）**：`tmp/health.jsonl` 目前**只写不读**——42 条采样在全仓零消费方（grep 命中只有 `healthcheck.mjs` / `frontendHealth.mjs` 两个写入方、几个单测、几处文档）。体检「持续采样」的设计意图（r218 起）到现在没有任何分析方。建议二选一：加一条「看最近 N 条」的只读小命令（A，很小），或明说这文件只留档。

**生产未换码（㉒ / ㊼ 继续未闭环）**：线上 `commit 5a6eb5a`（10-06 23:28 提交、23:29 启动），本轮 18:26 实测已 **19 小时零部署**；本地 HEAD `357a360`，落后 origin/main **8 个**提交。体检「代码版本」那项因此每跑必亮（6/6）——按 r198 的规矩天天亮的灯会被忽略，但根因不在灯，在部署，得去 Render 面板确认。

**已验证无问题（下轮别再翻）**：r229 那版 `scripts/healthcheck.mjs` 七项判据逐项复核，无假绿（含 `noLocalVersionDetail` 这条「本机版本号读不出」的分支）；`frontendHealth.mjs` 的默认（playwright）路径白屏检测实测生效，不是空转。

**四道闸**：未跑（只读轮、零代码改动）。


## 第 237 轮（2026-10-07 19:35–，可开工轮）：前端白屏探针「跳过浏览器」时不再盯着白屏说健康

- 交付 `768df37`（+2 commit 含 lint 收尾）：`scripts/frontendHealth.mjs` 判健康条件里的 `!dom.blank` 在 `--no-dom` 时恒真（`dom.blank` 是 `undefined`）⇒ **真白屏也印「首页正常」exit 0**。改：判定抽纯函数 `decideFrontendVerdict(bad, dom)`，白屏那层没跑就返回 `status='dom-not-checked'`、`exitCode=4`、说清「这一项等于没盯」，不许印「DOM 有内容」。**退出码新增 4**（0/1/2/3 语义不变，零调用方，只在手动跑探针时生效）。
- 手动跑法不变：`node scripts/frontendHealth.mjs`。首页报 500 时看结论即可 —— 现在「没启动浏览器」会明确提示，不再冒充健康。
- 端到端实测（假白屏站）：修复前 `--no-dom` exit 0「首页正常」⇒ 修复后 exit 4「白屏这一项等于没盯」；默认路径（真起浏览器）仍是 `✗ 白屏` ⇒ persistent exit 1，行为未变。
- 锁 `test/frontendHealthVerdict.test.mjs` 9 条；反向自检用 `bafbfad` 的修复前基线逐字抄出的旧判据，证明那两个输入在旧判据下确实判健康。
- 四道闸全绿：单测 2054/0 fail｜lint 0e/0w｜`dist_nightly_20261007r237` 43.29s｜preview 5461 + 读 DOM 冒烟 8/8 + route_sweep 0/16 + text_audit 0/14。
- 健康采样：uptime 1206 分钟、首响 1112ms / 复查 350ms、21 名学生、磁盘 69106MB（与 r233 同实例，无重启）。**生产仍是 `5a6eb5a`**，本轮改动要等 Render 面板部署。

## 第 238 轮（2026-10-07 20:45–21:10，可开工轮）交接

- 可开工（锁 `finished / 237`），与知识图谱会话零碰撞；只 commit 了自己的 3 个路径，其余 in-flight 全没碰。
- 交付：提案 **㊱** 从 B 升 A 落地 —— 新增 `scripts/healthTrend.mjs`（只读 `tmp/health.jsonl`，把「最近这段是变好还是变差」讲成人话）+ `healthcheck.mjs` 结尾推一句命令 + 锁 `test/healthTrend.test.mjs` 7 条。两个 commit `082d0e8`（代码）、`ae7309f`（lint 清理）。
- 为什么值得做：体检采样从 r218 起每轮往 `tmp/health.jsonl` 追加一行，**全仓零消费方**攒了 45 条没人看；现在负责人一条 `node scripts/healthTrend.mjs` 就能看出哪盏灯一直亮、哪盏灯是修完才不亮的。
- 判据纪律（本轮两条自己踩的坑，写文案/判据时先看）：
  - 「条条都亮」不许写成「多半是灯坏了」—— 实测线上代码版本一直亮是**推了没部署**，不是灯坏；写死推论就是误判（r198）。改成只说两种可能、不替他下结论。
  - 反向自检的**窗口**开错（8 条里含那 3 条还亮着的），「修好了」永远出不来而测试全绿 ⇒ **判自己写错了，不是产品错了**。合成样本要先把窗口对齐再断言。
- 四道闸实测：单测 2067/2058 过 / **0 fail**（基线 2060 + 本轮 7）｜lint 0e/0w｜`dist_nightly_20261007r238` 37.59s｜preview 5462 + cert_probe 零外联 + render_smoke 8/8 + route_sweep 0/16 + text_audit 0/14（预览已按端口杀清）。
- 健康：uptime 1276 分钟（r237 是 1206 ⇒ 单调上升，无重启），首响 1299ms / 复查 388ms。
- 待负责人拍板（没动）：㉘（141 题 `is_complete` 口径）、㊸（export-retry-pdf 留/删/接线）、㊴+㉚（两条渲染路径超时，**r229 实测阈值应为 180s**）、⑲/㊲（备份脚本挂不挂每日定时任务）、Render 部署（㉒/㊼，线上仍是 `5a6eb5a`）、running/206 的 stale 锁。
- 新提案 **㊵**（B）：采样有入口了但**没有定时调用方**，新行只在本巡检会话跑时才有；建议跟备份任务一起定个每天固定体检。
- **下一轮接 r239**：首选 ㊵、㉘、㊸、㊴+㉚（180s）、⑲/㊲。

- **r239（2026-10-07 21:56–22:40）：采样文件有两拨写入方，趋势脚本会印 [object Object]（两个代码 commit + 一个 docs commit）**
  - 开工锁 `finished / 238`；树干净（知识图谱会话 `312a318` 已入树）。交付 `0816b15` + `db785b4`，零产品代码。
  - 缺陷：`scripts/healthcheck.mjs` 与 `scripts/frontendHealth.mjs` 的 `--log` **默认值都是 `tmp/health.jsonl`**，
    但两行结构不同 —— 后端 `bad` 是灯名字符串、前端 `bad` 是坏模块对象。r238 新加的 `healthTrend.mjs`
    第一次读这个文件时就踩中：摊平后 Map 的键成了对象 ⇒ 实测输出 6 行 `[object Object]`，
    还被算进「6 次需要处理（红色）」⇒ **真红被垃圾行冲淡**。文件里实测已有 4 条前端行混入 42 条后端行。
  - 修法：两路写入打 `kind`（旧行没 kind 归 backend，旧采样照样能用）；`healthTrend` 按 kind 分两节，
    前端那一路单独讲人话（模块链坏几个 / 哪个文件连不上 / 首页有没有真查 / 结论）；
    `collect` 只收字符串、`badCount` 只数后端；一条后端都没有时明说「没盯过」，不许说「没有红色」。
  - ⭐ 两条自己踩的坑：① **反向自检探针把「新版该出现」写成「新版必须不含」** ⇒ 3 条假红、测试全过
    （r213 同款），改成「每条显式写旧/新期待（前缀 `!` = 必须不出现）」才逐条真判红；
    ② 改标题漏印 `${spanText}`，**是 lint 的 no-unused-vars 抓出来的**。
  - ⭐ 自己新写的锁当场抓出一个真崩溃（只有前端采样时 `first/last` 为 null 读 `.t` 崩），已修。
  - 锁 `test/healthTrend.test.mjs` 13 条；反向自检基线钉 `312a318`，5 条全过。
  - 四道闸：单测 **2073 / 2064 过 / 0 fail**｜lint 4 文件 0e/0w｜`dist_nightly_20261007r239` **36.94s**
    （main chunk 与 r213–r238 同名 = 零前端产品码）｜preview `5470` + cert_probe 零外联 +
    render_smoke **8/8** + route_sweep **0/16** + text_audit **0/14**，按端口杀清。
  - 健康：uptime **1348 分钟**、首响 1041ms / 复查 795ms（r238 是 1276 ⇒ 无重启）；唯一黄灯「代码版本」。
  - 提案 **r239-①**（B）：`scripts/nightlyAudit.mjs` 夜间巡检引擎仍零调用方（沿用 ㊲ 未拍板），
    拍板后它能顶掉体检＋备份＋趋势的重复实现；**r239-②**（B）：两工具默认写同一个文件，
    可在写侧把 frontendHealth 默认改成独立文件（一行，会改默认行为，没擅自动）。
  - 生产：线上仍 `5a6eb5a` ⇒ 本轮两个 commit 未上线，㊼/㉒ 继续未闭环。
  - **下一轮接 r240**：首选 ㉘、㊸、㊴+㉚（180s）、r239-②、㊵/⑲/㊲；
    另需负责人处理 Render 部署（㊼/㉒）与 running/206 的 stale 锁。

- **r240（2026-10-07 23:08–23:35，可开工轮）：夜间巡检「单测整晚挂掉也会报当晚成功」（一个代码 commit，已推送）**
  - 开工锁 `finished / 239`；树干净。提交 `a0b27b4`（3 文件 +253/−6，零产品代码）。
  - 靶子 `scripts/nightlyAudit.mjs`：全仓零调用方 + 那个「夜间只读巡检」自动化实际不存在
    ⇒ **从写下第一行起没跑过一次**，判据缺陷一律不会被发现。
  - 三个缺陷：① 结尾只按 lint 棘轮算退出码 ⇒ **单测整晚挂掉退出码仍是 0**（挂上定时任务就永远报成功）；
    ② `collectTests` 只看 runner 退出码，而 `node --test` glob 匹配不到时是「一条都没跑 + exit 0」⇒ 也判绿；
    ③ `today` 用 `toISOString()` 印 UTC 日 ⇒ **凌晨跑（本脚本的主时段）报告日期归到前一天**。
  - 修：判定抽纯函数 `scripts/nightlyAuditVerdict.mjs`；退出码 0/1/2/**3**（3 = 单测失败或没跑，不与 2 撞）；
    报告那一行改三态（全绿 / 有失败 / 没验过）；日期改走 `toLocalYmd`（r157 的本地日历日唯一实现）。
  - 锁 `test/nightlyAuditVerdict.test.mjs` 12 条，反向自检用**修复前那行旧退出码**当基线（不调 git）。
  - ⭐ 端到端（仓库外只读探针）：真跑 `node --test test/healthTrend.test.mjs` 拿 `counters={tests:13,pass:13,fail:0}`
    ⇒ 判 PASS（不假红）；改 tests=0 且 runner 仍 exit 0 ⇒ 判 NO_TESTS_RUN/3（真红）。
  - ⭐ 自己踩坑：断言写「没从输出里读到」、源码实际写「或没读到执行条数」⇒ 当场判红。
    **写判据前先把源码那句复制出来**（r237 同款）。改判据没改产品。
  - ⭐ ㊮ 复核为**已闭环**（r235 的 `comparable && local === null` 分支早就在），本轮没重复做。
  - 四道闸：单测 **2102 / 2093 过 / 0 fail**（基线 2073 + 本轮 12 + 他人 17）｜lint 3 文件 0e/0w｜
    `dist_nightly_20261007r240` **37.05s**（main chunk 与 r213–r239 同名）｜preview `5480` +
    cert_probe 零外联 + render_smoke **8/8** + route_sweep **0/16** + text_audit **0/14**，按端口杀清。
  - 健康 23:08 uptime **61 分钟**（870/350ms）→ 23:17 **69 分钟**（1635/358ms），单调上升无重启，
    六项全绿、没多出假告警。采样 48 条：代码版本连亮 12 条（推了没部署，真报）、接口速度 2 条、磁盘 0 条。
  - 生产：线上 `4a0c376`（首次看到 r239 的文档提交上线），本地 `a0b27b4`，落后 4 个提交。
  - 提案 r240-①（B）：`nightlyAudit` 现在 fail-closed，等于给 ㊲ 兜了底，拍板定时任务时可先挂它。
  - **下一轮接 r241**：首选 ㉘（141 题 is_complete 口径拍板）、㊸（export-retry-pdf）、
    ㊴+㉚（180s 超时，一次改两条渲染路径）、r239-②、⑲/㊲/㊵（定每天自动体检 or 备份定时任务）；
    另需负责人处理 Render 面板部署（㉒/㊼）与 running/206 的 stale 锁。

## 第 241 轮（2026-10-08 00:21–00:52，可开工轮）：体检补第 8 项「家长卡片中文字」—— 转发给家长的图出事，此前一次都没盯过

- 开工锁 `finished / 240`；工作区只有他人 in-flight 的 `src/workbench/views/QuestionBankWorkbench.vue`，全程没碰、没带进 commit。
- 交付 `9a7e34e`（6 文件 +228/−11）+ `50afeb1`（文案，1 文件）。零产品行为改动（只给 `/api/health` 加一个字段）。

- 缺陷（A 级，与 r221「字段没真读到就明说」同款，在**家长可见产物**这一侧的第一枚）：
  r134 修掉服务端容器没中文字形（家长拿到的分享卡整张中文全是方框）之后，**没有任何一处会再问一次「字体还在不在」**。
  文件被误删 / 部署资产没带上 / 有人换成别的格式 ⇒ `renderFontFace.js` 只在渲染那一瞬间 `console.error` 一句，
  之后永远输出方框，而体检七项（在线/速度/数据库/任务/队列/磁盘/代码版本）**没一项管「家长实际看到的东西」**。
  实测取证：造「字体文件丢了」的假后端，旧版体检照旧只报 2 项黄灯、家长那张图是看不懂的，体检完全没说话。

- 修法（一处根因三处消费）：
  - 新增 `server/utils/cjkFontState.js` 作为**唯一实现**：`probeCjkFontAsset()` 读资产、验 woff2 头、缓存（`renderFontFace.js` 早就这么缓存 968KB）；`resolveCjkFontState(value)` 是纯判定，吃 `/api/health` 的值。
  - `renderFontFace.js` 改用它的单一路径常量 ⇒ 同一个资产路径不再两边各算一遍（红线：同一事实的多个表达字段要一次对齐）。
  - `/api/health` 回 `cjkFont`；`healthcheck.mjs` 第 8 项「家长卡片中文字」只有 `ok` 合格，字段没回明说「这一项等于没盯」。
  - 锁 `test/cjkFontHealth.test.mjs` 9 条（含自证钩子：源码里确实是新写法、renderFontFace 不再自己拼目录）。

- 反向自检（基线钉 `0c76689` 的旧脚本，不调 git）：假后端回 `cjkFont:'missing'`，**旧版 0 次出现这一项**（洞坐实）
  ⇒ 新版点名「发给家长的卡片/重练卷上的中文会全变成方框…补回字体文件重启后端就行」，`结论` 从 2 项变 3 项。跑完删探针。

- ⭐ 自己踩的三个坑（高复用）：
  ① **自己新锁当场判红**：`ok` 那段文案里还写着「不会是方框」，而断言写的是「ok 不许提方框」—— 判据和文案互相打架。改文案，没改判据。
  ② **既有锁被我的新项挤红**：`test/healthcheckLocalVersion.test.mjs` 的老问题（r235）—— 它把整个 `scripts/` 拷到临时目录造「没 .git 的脚本目录」，
     而 `fs.cpSync(srcDir, 还不存在的 dest, {recursive:true})` **是把 src 的内容倒进 dest，不是 `dest/<src名>/`** ⇒
     脚本实际落在临时目录根，`healthcheck` 新 import 的 `../server/utils/cjkFontState.js` 被解析到 `Temp/server/utils` ⇒ MODULE_NOT_FOUND ⇒ 那条锁假红。
     修法是先 mkdir 出 `dir/scripts` 再拷，并按同样层级拷 `server/utils`。⛔ **以后「只拷 scripts/ 造探针」的锁，只要脚本开始 import `server/`，就必须一起拷。**
  ③ **告警文案只写一个成因**：字段没回那句原本写「多半是接口结构变了」，而实测最常见的成因是「后端还没重启到新代码 ⇒ 本机/线上跑的旧代码」。
     写死一个成因会把人往错的方向带（r198 教训）⇒ 改成两个成因都点到。写完复测生产，确认新灯如实亮、没多出别的假告警。

- 四道闸：单测 **2115 / 2106 过 / 0 fail**（9 skipped；基线 2102 + 本轮 9 + 他人 4）｜lint 5 文件 0e/0w｜
  `dist_nightly_20261008r241` **43.23s**（main chunk `main-CO0NAGlB.js`：与 r213–r240 的 `main-Dg_0tVgF.js` 同名期结束了，
  中间进了他人前端提交，本轮仍零前端产品码改动）｜preview `5490` + cert_probe 零外联 + render_smoke **8/8**（0 控制台错误 / 0 个 4xx-5xx）
  + route_sweep **0/16** + text_audit **0/14**，预览按端口杀清。

- 健康两次采样：00:21 uptime **61 分钟**（886/340ms）→ 00:47 **7 分钟**（1991/885ms）—— **uptime 回退 = 期间重启过**
  （`bootAt 10-08 00:27`，与本次推送前后重合：Render 推代码即重启，不是故障；单次观测不下因果结论）。
  生产改后复测：唯一新增黄灯就是第 8 项本身（线上还是 `5f7d3ec`、没回这个字段）⇒ **灯亮是它应该在亮，部署到新代码后自动转绿**。

- 提案 **r241-①**（A，很小）：`test/healthcheckLocalVersion.test.mjs` 的反向自检基线探针 `_r235_old_healthcheck.mjs` 早就不在，
  那条 `t.skip` 已经空转好几轮 —— 要么重新导出一次基线，要么删掉这条空转的自检，别让它一直显示「跳过=已验过」。
- 提案 **r241-②**（B，观察）：体检第 8 项只说明「这次盯上了」，但**字体资产到底会不会随部署带上**没人验过（Render 的构建/发布是否 include `server/assets/fonts/`）。

- **下一轮接 r242**：首选 ㉘（141 题 is_complete 口径拍板，家长「批改题量」少 141 题）、㊸（export-retry-pdf 留/删/接线）、
  ㊴+㉚（两条渲染路径超时，r229 实测阈值 **180s**）、r239-②、r241-①、⑲/㊲/㊵（定每天自动体检 or 备份定时任务）；
  另需负责人处理 Render 面板部署（㉒/㊼）与 running/206 的 stale 锁。

### 第 242 轮（2026-10-08 09:58–10:14，可开工轮）：体检反向自检「跑完即删」反噬，六条锁空转 → 全仓 skip 归零

**做了什么**：体检类回归锁（healthcheckCommit / MissingField / QueueStats / Speed / frontendHealthVerdict）
的反向自检原本靠「`git show <提交>:scripts/healthcheck.mjs > scripts/_rNNN_old_healthcheck.mjs`、跑完即删」
当基线。六份探针文件**全部早已不在磁盘上** ⇒ 对应用例永远 `t.skip`，而 skip 会被当成"验过"
（r215 教训）⇒ 六条自检连续多轮空转 ⇒ 修过的洞有没有真修好，全靠这些锁的时候，它们什么也没验。

**交付**（两个 commit，已推送，零产品代码）：
- `9a47015` —— r241-① 收尾：`healthcheckLocalVersion` 的反向自检不再依赖 git 导出探针，
  改成**每次对当前脚本做字符串手术**（把 r235 加的那道本机守卫换回旧写法
  `behind = comparable && local && local !== short`，local 为 null 时恒假 ⇒ 印 ✅）。
- `f85e8c6` —— 主体：基线快照作为**正式测试资产**进 `test/fixtures/`（`healthcheck-baseline-*.mjs` 五份 +
  `frontendhealth-baseline-r237.mjs` 一份），新增 `test/baselineScriptKit.mjs` 负责 stage 成可跑目录，
  五个测试文件的 `t.skip` 分支删掉改真跑。

**六条洞现在都被真跑复现出来了**（不是推理）：9809c30 压根没有「代码版本」这一项；0557805 在子字段
消失时判「没有失败也没有卡住的任务」合格；25b4386 系列在漏字段三场景全判合格；7828fe2-parent 在
冷启动 800ms 时仍印 ✅；r237 基线在 `--no-dom + 真白屏` 下判「首页正常」exit 0。

**四道闸**：单测 **2118 / 2118 过 / fail 0 / skipped 0**（此前 2110 过 + 8 skipped）｜
lint 12 文件零输出｜`dist_nightly_20261008r242` **40.08s**（main chunk 与 r241 同名 = 零前端产品码）｜
preview `5495` + cert_probe 零外联 + render_smoke **8/8** + route_sweep **0/16** + text_audit **0/14**。

**下一轮接手请先看这里**：

1. ⛔ **以后给这类锁加基线，一律往 `test/fixtures/` 放、随仓库提交**，别再用「`git show` 导出 + 跑完即删」。
   也**不要**用 `_` 前缀存：eslint 的 `**/_*` 会整段忽略它，而且会被下轮巡检当成"一次性排障产物"再删一次
   ⇒ 又会回到 skip。
2. ⛔ **基线要 stage 成临时目录，连兄弟文件一起带**：基线 `import './healthDiskState.mjs'`，
   只放快照会 MODULE_NOT_FOUND（红在"旧脚本没输出这一项"，实际是脚本压根没起来）。`stageBaselineScript()` 已经处理。
3. ⛔ **断言失败时把完整 stdout 打出来**：第一版脚本被手术写坏时 stdout 全空，"没输出这一项"五个字
   完全看不出病因，靠这行才定位到。
4. 生产健康 09:58：uptime 564 分钟、首响 1396ms / 复查 1039ms，唯一黄灯仍是「代码版本」（线上 `50afeb1`
   vs 本地 `57ac8f0`）⇒ ㊼/㉒ 继续未闭环，需负责人去 Render 面板确认两条部署链路。
5. 下次首选：㉘（141 题 is_complete 口径拍板）、㊸（export-retry-pdf 留/删/接线）、㊴+㉚（渲染超时
   **r229 实测阈值 180s**，一次改两条渲染路径）、r239-②、⑲/㊲/㊵（定每天自动体检 or 备份定时任务）。

---

## 第 243 轮（2026-10-08 03:16–03:42，可开工轮）：体检「任务队列」那句「失败数会定期清理」是假话

- 缺陷（A 级，只读文案 + 回归锁，线上行为零变化）：`scripts/healthcheck.mjs:236-243` 在 `f>0` 时接一句
  「（失败数会定期清理，看趋势不看绝对值）」。**这句是假的，而且两条都不成立**：
  - 全仓没有任何一处定时清理「判不出来」的作业 —— 唯一会删 tasks 表的语句在删学生数据的运维脚本
    `server/scripts/cleanup-student-data.mjs:225`，那是删人不是清理作业；
  - 更关键的是**这个数只统计 `describeAutoRetry(...)===false` 的那一批**（`server/index.js:793`），
    即「不会再重试」的 ⇒ **既不会自己重判、也不会自己消掉**，会永远留在这个数里。
  - ⛔ 夸大的提示比没提示更糟（r198 同款口径）：老师看到「会定期清理」就会以为不用管，
    而这 50 个作业是**静默烂掉**的。旧句还会兑现不了「看趋势不看绝对值」（这一行只印一个数，
    趋势得跑 `scripts/healthTrend.mjs`）。
- 改：抽 `FAILED_HONEST_TAIL` 常量，原话写「不会自己重判、也不会自己消掉，会一直留在这个数里」。
  生产直出：`排队 0 个、进行中 0 个、判不出来且不会再重试的 50 个（这几个不会自己重判、也不会自己消掉，会一直留在这个数里）`。
- 交付 `bd53616`（`scripts/healthcheck.mjs` + `test/healthcheckQueueStats.test.mjs`，+136 / −7）。
- ⭐ **本轮反向自检走「字符串手术」**（r242 定的规矩：不调 git、不依赖基线文件），新加 2 条锁：
  ① 反向自检（把整行 ternary 手术回旧措辞 ⇒ 上面 4 条断言必须立刻判红）；② 元判据自证（手术两端都在、
  锚点在源码里唯一，防「判据写错字造成的假通过」）。单文件 7/7。
- ⭐ **三条自己踩的坑（都写进注释了，下轮直接抄）**：
  1. **手术锚点必须选整行 ternary**，光把尾巴换成旧措辞不够 —— 新措辞是
     `` `、判不出来且不会再重试的 ${f} 个` + 尾巴 ``，只换尾巴会留下前缀 ⇒ 换完的输出**同时**含新措辞和
     「会定期清理」，反向自检打红的是前缀那句，看着像「手术无效」，其实是**锚点选短了**（白绕一轮）。
  2. **新注释不能原样写那条 SQL**：`test/healthcheckSafety.test.mjs:25` 那条安全锁是
     `SRC.includes('DELETE FROM')` **全文扫（不分注释代码）**，写进去立刻把「体检脚本不得写库」打红。
     已把注释措辞改成「删除 tasks 表记录」，并在注释里写明为什么这么绕。
  3. staging 临时目录的**布局必须和仓库一致**（`healthcheck.mjs` 放 `<dir>/scripts/`、`server/utils` 一起拷），
     否则 `../server/utils/cjkFontState.js` 的 `..` 跳到 Temp 上一级 ⇒ MODULE_NOT_FOUND（r241 同款坑）。
- **已验证无问题（下轮别再翻）**：`server/routes/weeklyReport.js:435/438/598/599/730/731` 的
  `.toISOString().split('T')[0]` **是假缺陷** —— `server/utils/period.js:34-37` 的 `all` 模式用的是
  固定哨兵 `2000-01-01` / `2099-12-31`，UTC 写法在那里**正确**（与 r155 `missingFigureMonitorService.js:88`
  同款「先判输入形态」）。`test/fixtures/` 里 r242 的 7 份基线资产齐全、全仓 `t.skip` 已归零。
- 四道闸：单测 **2120 / 2120 过 / fail 0 / skipped 0**（r242 基线 2118，本轮 +2）｜
  lint 本轮 2 文件零输出｜`dist_nightly_20261008r243` **47.79s**（`main-CO0NAGlB.js` 与 r242 同名 = 零前端产品码）｜
  preview `5439` + render_smoke **5/5**（根/工作台/周报真渲染 + 0 pageerror + 0 失败请求），按端口杀清。
- 健康采样 03:41：uptime **666 分钟**、首响 1525ms / 复查 869ms、DB 21 名学生 1308ms、磁盘剩 72076MB；
  唯一黄灯仍是「代码版本」（线上 `50afeb1` vs 本地 `bd53616`）⇒ ㊼/㉒ 继续未闭环。
- 提案 **r243-①**（B，需拍板）：那 50 个「判不出来且不会再重试」的作业现在体检会明说不会自动消失，
  但**系统没有任何自动处置，也没有人工入口**。要不要给一个「批量重判 / 标为无需批改」的运维入口？
  涉及写库与任务重判（C 级），本轮只提案不擅动。
- 下轮 r244：待拍板 ㉘/㊸/㊴+㉚/㊻/㊾/㊿/㊽ + r243-①；另需负责人处理 Running 面板两条部署链路（㉒/㊼）。

## 交接 · 第 246 轮（2026-10-08 15:03–15:2x，只读审计轮）

**锁状态**：开工读到 `running / 244`（12:45:17 起，2h18m）⇒ 只读审计；**未提交、未推送、未写 finished**
（留给在跑方）。本轮唯一写入 = `docs/auto/backlog.md` 第 246 轮节 + 本文件 + 当日日志的纯追加。

**健康（15:03）**：uptime **39 分钟**（r245 是 802 ⇒ 中途重启过），首响 1002ms / 复查 393ms，
21 名学生、磁盘剩 66475MB、`cjkFont=ok`；黄灯只有「代码版本」（线上 `51beacd` vs 本地 `a361566`）。
`bootAt 14:24:49` 与本地提交 `6b89359`（14:25:19）同时 ⇒ 推代码触发的部署重启，不是故障。

**本轮唯一实质产出（A 级，补丁已原型跑通，未落库）**：体检采样只记「哪盏灯亮」，不记
「这次盯了几项」、也不记「亮的时候说了什么」。仓库外原型实测三档对照（详见 backlog 第 246 轮节）：
- 第 8 项被条件门住：旧采样与全绿**逐字相同**，新采样 `checked:7` ⇒ 立判；
- 后端连不上：旧只记 1 盏灯名，新 `checked:1`；
- 亮灯触发值：现有 58 条采样 44 次亮灯**无一带数字**，新采样 `lit:{灯名:人话}`（只记非 ok，不撑大文件）。

**⚠️ 本轮修正 r245-② 口径**：`/api/health` 返 500 时 8 项**全都执行**（各挂「等于没盯」黄灯，
采样仍 `checked:8`）；只有 `fetch failed` 才 `checked=1`。⛔ 下轮别照抄「接口 500 ⇒ 只盯 1 项」。

**已验证无问题（下轮别再翻）**：`rtMs` 有消费方（healthTrend 印平均/最快/最慢）；队列 50 个 =
`server/queue.js:120/161/207` 的 `removeOnFail:{count:50}` 上限，稳定不增长，不是泄漏（Redis 重启会归零）；
体检那句「不会自己重判也不会自己消掉」与 BullMQ 语义一致，不是错报。

**下轮 r246（acquire 会得到 round=245，编号以 loopGuard 返回值为准）**：首选
r246-①（采样补 `checked`/`checkedNames`/`lit`，两处锚点已定位）→ r246-②（`healthTrend` 必须消费
`checked`，否则又成只写不读）→ ㊴+㉚（渲染超时 **180s**，r229 实测）、㉘（141 题口径拍板）、㊸（export-retry-pdf）；
另需负责人处理 Render 面板部署（㉒/㊼）与 stale 锁（建议 BUSY_WINDOW 3h→90min，提案 r246-③）。
注意 backlog 里 r244/r245 两节目前是**未提交的工作区内容**，本轮一并保留、不要覆盖。

## 第 247 轮（2026-10-08 15:15–15:xx，只读审计轮）：趋势脚本把「本机」和「线上」算成同一条趋势

- 开工锁 = `running / 244`（12:45:17 起，开工时 151 分钟）⇒ 只读审计；未改业务码、未提交、未推送、**未写 finished**。
  他方 in-flight 只有 `scripts/patrol/daemon.mjs`，没碰。本轮唯一写入 = `docs/auto/backlog.md` 纯追加（219 行 / 0 删除）。
- 健康 15:15：uptime **52 分钟**（r245 是 802 ⇒ 中途重启过一次）、首响 1817ms / 复查 792ms、磁盘 82321MB；
  线上 `51beacd` vs 本地 `bf493c3`。`bootAt 14:24:49` ≈ `51beacd`(14:23:23) ⇒ 推代码触发的部署，不是故障。

### 主发现 r247-①（A，未动手，下轮首选之一）

`scripts/healthTrend.mjs` **从不读采样行的 `api` 字段** ⇒ 把「查本机」和「查线上」混成一条趋势结论。
实测：现网 60 条里已有 **1 条本机行**（`127.0.0.1:4000`，10-04 06:59，就是趋势里那个「最早 81ms」）；
仓库外造「15 条线上 + 5 条本机」混合样本，本机那 5 条磁盘黄灯被算成
「服务器磁盘：最近 5/20 条 ⇒ 连续 5 条 ⇒ 大概率同一件事在连着发生」（线上一条都没亮），
「1300 分钟 → 23 分钟 ⇒ 中途重启过一次」实际是**两台机器**被当成一台。
`healthcheck.mjs:68` 的 `--api` 默认值就是本机 ⇒ 谁不带 `--api` 跑一次并写同一个文件，趋势立刻变脏且无提示。
修法（A）：趋势头部点名「M 条查线上 / K 条查本机」，或按 `api` 分组；⛔ 别直接过滤本机行（排本机后端时有用）。

### 复核（下轮别再翻）

- **r246-①② 仍成立**：60 条采样 **0 条带 `checked`**、43 条亮灯无一带数字；锚点 `healthcheck.mjs:76 / :77-80 / :307-319`。
- **第 8 项已转绿**：本轮线上采样 ✅ 且 detail 是字体正常那句 ⇒ `/api/health` 真的回了 `cjkFont:"ok"`
  ⇒ 字体资产随 `51beacd` 部署带上了；r244 那条唯一黄灯是真亮过一次、已自己转绿，别当新增噪声。
- **锁持有者无存活证据**：`scripts/patrol/**` 对 `_loop_state`/`loopGuard`/`healthcheck`/`health.jsonl` 全 0 命中，
  但 loopGuard 自己规定「≥3 小时才接管」⇒ 151 分钟我不越线，仍只读。

### 提案

- **r247-①**（A，下轮首选之一，与 r246-①② 一起做）：`healthTrend.mjs` 按 `api` 分组或头部点名台数。
- **r247-②**（B，更新 r246-③）： BUSY_WINDOW 180 分钟 ⇒ 「崩溃接管」要等 3 小时，实测唯一活跃并发方不碰锁，
  建议直接降到 60 分钟或加心跳。
- **r247-③**（B，观察）：只读轮，四道闸未跑。

### 下次接 r248

先读锁——仍 running 就继续只读且只追加 docs；可开工时首选 **r246-① + r246-② + r247-①**（一次补齐
`checked`/`checkedNames`/触发值 + 趋势按目标分组，配锁区分「只盯 1 项」与「盯满 8 项」），
其次 ㊴+㉚（渲染超时 180s，r229 实测）、㉘、㊸、⑲/㊲/㊵；
另需负责人处理 Render 面板部署（㉒/㊼）与 stale 锁。
backlog 里 r244/r245/r246 三节是**未提交的工作区内容**，别覆盖。

## 第 245 轮（2026-10-08 18:28–19:4x，可开工轮；章节号以 loopGuard 返回值为准）

> ✅ **闭环声明**：r246-①、r246-②、r247-① **已在本轮修掉并验证**（commit `07cb5e1`）。
> 下面旧节的「下轮首选 / 未动手」字样是当时快照，**下轮别再翻这三条**；翻了只会对着已修的东西空转。
> 顺延编号：r247-② → **r248-②**（锁窗口 180 分钟太长，实测一条 stale 锁连卡 5 轮）；
> r246-③ → **r248-③**（`test/fixtures/` 基线治理）；`healthcheck --api` 默认值改成线上 → **r248-①**（B，本轮没动）。

- 开工判据：锁 `running / 244`（10:45:17 UTC / 12:45:17 本地起，开工时 **346 分钟**）⇒ 越过 `loopGuard.mjs`
  自定的 180 分钟「崩溃接管」线 ⇒ `loopGuard acquire` 接手 **r245**。⚠️ 这是**连续第 5 轮卡在同一把锁**
  （r244/r245/r246/r247 全是只读空转），本轮才第一次越线。
- 他方 in-flight 全程没碰也没带进 commit：`scripts/patrol/daemon.mjs`（patrol 心跳锚点那批）、
  `.workbuddy-ai/memory/MEMORY.md`、以及历史轮累积的 `docs/auto/backlog.md` +219 / `HANDOFF.md` +68 纯追加节。
- 交付 `07cb5e1`（4 文件 +847/−85，零产品行为改动，只动体检/趋势脚本 + 2 个测试文件）：
  1. `scripts/healthcheck.mjs` — 采样行补 `checked`（这次真跑了哪几项）/ `checkedNames`（跑的是哪几样）/
     `lit`（亮的那一下原话）。零行为改动，加的只是日志字段。
  2. `scripts/healthTrend.mjs` — 按目标机器分组（线上/本机分开讲），多机器时明说「混着 N 台机器」；
     报出「这次盯了几项 / 比这段时间最多那次少了哪几项（少了就是哪几样）」；灯名后附「亮的时候那句是……」；
     老格式采样（没记这几个字段）**明说读不出但不判红**，防 r198 那种恒定黄灯。
  3. `test/fixtures/healthTrend-baseline-49a7339.mjs` — 改动前的真脚本随仓库入库当反自检基线（r242-① 落地：
     基线不再用「跑完即删」的探针，免得哪天探针不在盘上、用例永远 `t.skip` 却被当成验过）。
  4. `test/healthTrendChecked.test.mjs` — 11 条锁（含反向自检）。

### 主发现（实测数字，非推理）

1. **r246-① 坐实（A，已修）**：采样以前只记 `bad`/`warn` 两个灯名数组 ⇒ 「某项压根没跑」和「某项全绿」
   在日志里**逐字相同**。实测后端连不上/接口 500 时整趟体检只跑 1 项，采样照样是 `{"bad":["后端在线"]}`，
   跟「盯满 8 项、7 绿 1 红」长得一模一样，事后分不出。现网 62 条采样 49 次亮灯，
   **改之前 0 条带数字**（只知道亮过，不知道当时磁盘剩 199MB 还是 1GB），改后最新 1 行已带齐三字段。
2. **r247-① 坐实（A，已修）**：旧 `healthTrend.mjs` 从不读采样行的 `api` ⇒ 本机 + 线上混成一条。
   仓库外造「15 条线上 + 5 条本机 disk 黄灯」⇒ 旧版印「服务器磁盘：最近 5/20 条 ⇒ 连续 5 条」
   （线上一条没亮），「连续运行时间 600 → 44 分钟」实为**两台机器**。
   现网 62 条里已有 3 台（线上 57 / 旧格式 4 / 本机 1）；新版本 `healthTrend --n 4` 已能正确分组并
   点名「混着 3 台机器」。
3. **自己踩的判据坑（下轮别踩）**：「少了哪几项」第一版写成 `最新那次名单.filter(不在参照名单)` ⇒ 恒空
   ⇒ 会印「少了 0 项」的假话；正确方向是拿**参照那次的名单**去减。是 11 条新锁当场判红抓出来的
   （r238「趋势脚本每个字段都要问谁在消费」延伸：拿到结果先自问「这个筛选方向反过来会怎样」）。

### 四道闸（全过）

| 闸 | 实测 |
|---|---|
| `npm test` | **2143 pass / 0 fail / 0 skipped**（基线 2118 + 本轮 11 + 他人若干；既有 `healthTrend.test.mjs` 13/13 无回归） |
| eslint | 4 个改动文件 **0 error / 0 warning** |
| 隔离构建 | `MSYS_NO_PATHCONV=1 VITE_API_URL=/api CODEBUDDY_SAFE_DELETE_ENABLED=0 npx vite build --outDir dist_nightly_20261008r248` — **1m47s**，main chunk `main-CO0NAGlB.js`（与 r241/r242 同名 ⇒ 零前端产品码），**没碰 `dist/`** |
| 真机级冒烟 | `vite preview --port 5496 --outDir dist_nightly_20261008r248` + 本机 Chrome `puppeteer-core` **读 DOM**：**6/6 全过**，0 console error、0 bad response、路由 sweep 5xx/ERR 0（⛔ 全程没截图） |

- 提交纪律：`npm test` 单独跑完确认 `# fail 0` 之后**单独**提交（`git add -- <4 路径>` + `git commit -F … -- <4 路径>`），
  没用 `;` 串联「跑测试→不看结果→接着 commit」那套。commit 只含自己 4 个文件。
- 回归锁：新锁里含**反向自检**（同一份混合样本喂基线脚本必须一条不报、喂新脚本必须报）——
  喂旧基线用的是随仓库入库的 `test/fixtures/` 文件，不是临时探针。

### 复测生产（新代码跑真体检）

- uptime **245 → 256 分钟**（单调上升，无重启；这轮专门盯过「自己推送导致重启」这个假象）。
- 采样最新行已带 `checked:8`、`checkedNames` 8 项、`lit:{"代码版本":"线上还是 51beacd，你本地已经是 07cb5e1…"}`。
- 八项里只剩 **1 项黄** = 代码版本（线上 `51beacd`，本地 `07cb5e1` ⇒ 本轮代码**还没部署**）。
  首响 1986ms / 复查 888ms、DB 1094ms、21 学生、queue failed 50（队列里原有失败数，尾注如实记）、
  disk 78370MB、家长卡片中文字 ok。

### 清理

删掉了临时探针 `server/_r248_smoke.mjs`、`server/_r248_dump.mjs`、`tmp/_r248_probe.jsonl`；
仓库外的探针留在系统 Temp（只读轮不往 `server/_*` 写文件，沿用 r208/r236 纪律）。

### 下次接 r249（编号已对齐）

首选：**r248-①**（`healthcheck --api` 默认本机易把趋势写脏，建议默认改线上或加「你这次查的是本机」提示；
本轮没动默认值，属行为变更按 B）；**r248-②**（loopGuard BUSY_WINDOW 180 分钟 → 60 分钟或加心跳）；
**r248-③**（基线文件名带提交号 + 文件头写清取自哪个提交）。
其余未做项留给下轮：㉘（141 题 `is_complete` 口径拍板）、㊸（export-retry-pdf 留/删/接线）、
㊴+㉚（渲染超时 **180s**，r229 实测，不是 60s）、⑲/㊲/㊵（每日自动体检或备份定时任务）。

## 第 249 轮（2026-10-08 19:49–20:0x，只读审计轮）：体检把「老师还没看的新作业」报成「作业卡住了」

> 性质：开工读到 `_loop_state.json = running/246`（`startedAt 11:42:09Z` = 19:42，就在 7 分钟前）
> ⇒ 按纪律转**只读审计**：不改业务码、不提交、不推送、**不写 finished**（留给在跑方）。
> 他方 in-flight：`.workbuddy-ai/memory/MEMORY.md`、`scripts/patrol/daemon.mjs`、根目录 4 个未跟踪文档，全程没碰。
> 本轮唯一写入 = `docs/auto/backlog.md` + `docs/auto/HANDOFF.md` 纯追加（0 删除，与 r244~r248 同法）。

### 健康采样（19:49，一次）
`已运行 325 分钟 / 首次 1064ms / 复查 766ms / 21 名学生 / 磁盘剩 76776MB（共约 396139MB）/
判不出来且不会再重试 50 个 / 家长卡片中文字 OK`。
- uptime 曲线：r242≈590 → r244 739 → r245 802 →（14:24 部署重启）→ r246 39 → r247 52 → 本轮 325，
  重启那次与 `51beacd`（14:23:23）重合 ⇒ 推代码触发的部署，不是故障（⛔ 单次观测不下因果结论）。
- 线上 `commit 51beacd` vs 本地 `48de07e` ⇒ ㊼/㉒（Render 部署）本轮仍未闭环。

### 复核：在跑方 r246 的落地已生效（只读实跑，不是读代码）
`07cb5e1` 已把 r246-①（采样记 `checked`/`checkedNames`/`lit`）+ r247-①（趋势按机器分组）合在一起：
- 本轮采样行实测 `checked:8`、`checkedNames:[后端在线,接口速度,数据库可读,批改失败任务,任务队列,服务器磁盘,代码版本,家长卡片中文字]`、
  `lit:{"批改失败任务":"1 份作业卡在处理中，…","代码版本":"线上还是 51beacd…"}` ⇒ **生效了**。
- `node scripts/healthTrend.mjs` 只读实跑输出：`64 条采样里混着 3 台机器：线上 59 / 目标没记 4 / 本机 1`，
  并按三台分开讲、老格式明说「没记盯了几项」；`✅ 这次盯了几项：8 项全跑了`。

### ⭐ 主发现 r249-①（A 级，未动手）：「批改失败任务」这一项把两种完全相反的事报成一句
- 19:49 那趟体检打的是：`⚠️ 批改失败任务：1 份作业卡在处理中，等一会儿再看；持续卡住就重启后端`。
- `scripts/healthcheck.mjs:183`：`const stuck = (s.pendingTasks || []).length`；`:189-190` 拿它当「卡住的份数」并给上面那句提示。
- **但 `pendingTasks` 的真身不是「在处理中」**：`server/index.js:749` 那条子查询是
  `WHERE t.status = $1（= DONE）AND deleted_at IS NULL AND notification_read_at IS NULL`，
  注释（`:723`）原文写的是「教师未读（notification_read_at IS NULL）的 **done 任务**」，还 `LIMIT 5`。
  ⇒ 它其实是「**作业已经批完了、老师还没点开看**」，跟卡住没有任何关系。
- **实测证据**（curl 生产 `/api/tasks/summary`，即 healthcheck 真正请求的那个接口，`:170`）：
  那一刻 `pendingTasks` 唯一的 1 条是 `status="done"`、`createdAt=2026-10-08T10:58:45.051515+00:00`
  （到 20:0x 已 52+ 分钟），体检一个「已经这么久」的字都没提；
  而**真正在批改中的数量 `inProgressCount = 5`**（`status='processing'` 的 COUNT，`server/index.js:759`）
  **体检一次都没读** —— 两个语义正好拿反了。
- **真实代价**：老师照那句提示去「重启后端」，会打断当时正在跑的 5 份批改；正确动作是去 App 点开看新批完的作业。
  反过来，真卡死（processing 长时间不动）反而没有任何一处提示。
- 修法（A，本赛道可观测性，零接口改动、零写库）：`healthcheck.mjs:182-193` 三分支文案改准——
  `failed>0` → bad「N 份作业批改失败了，去 App 里点重试」（与现有一致）；
  `stuck>0` → warn「有 N 份作业已经批好了、你还没打开看（最早那份 X 分钟前交上来的）；去 App 里看一眼就行」；
  两者都 0 → ok「没有批改失败，也没有没看的新作业」（现文案「没有失败也没有卡住的任务」同样说错）。
  X 用 `pendingTasks[].createdAt` 算——`mapTask`（`server/index.js:770-786`）**已输出这个字段**（实测 key 列表里在）。
  ⛔ **别用 `updatedAt`**：`mapTask` 只输出 `id, studentId, originalName, status, createdAt, notificationReadAt,
  studentName, questionCount, wrongCount, emptyCount, pendingCount, autoRetry`，没有 `updatedAt`。

### 提案
- **r249-①**（A，下轮首选）：上面那条——把「批改失败任务」这一项的文案/语义改准，零接口改动、零写库。
- **r249-②**（B，需拍板）：这一项的**灯名**「批改失败任务」实际挂了「批改失败 + 没看的新作业」两件事，
  建议拆成两盏灯（真在处理中的 `inProgressCount` 也可以补一句话）。拆灯属行为变更，没拍板前不动。
- **r249-③**（A，很小）：`healthTrend.mjs` 把没有 `api` 的行叫「目标没记（旧格式采样，
  **多半是别人不带 --api 跑的那次**）」——那 4 条实测是 **10-04 19:57~20:03 写的**、既无 `api` 也无 `kind`，
  也就是 r239 之前**本脚本自己写的老格式行**（r245-③ 就是这么分类的）。「多半是别人跑的」没有证据，
  按 r198（夸大的推论比不写更糟）建议改成「旧格式采样（r239 之前写的，没记目标）」。⛔ 别删行，老数据照样能用。
- **r249-④**（流程，观察）：本轮差点把结论写反——中途 curl `GET /api/health` 看到 `summary` 是空的，
  差点下「现在 0 份 ⇒ 刚才那句只是正常在途」；但 `healthcheck.mjs:170` 请求的是 `/api/tasks/summary`，
  两个接口的 `summary` 是两个东西。⛔ **取证前先看脚本请求的是哪个 URL**（与 r245-③「先按字段分类、别猜有人在写」同族）。
  按正确接口重测后结论翻转，见上面实测证据。

### 采样当裁判（64 条）
代码版本 28 次（连续 ⇒ 推了没部署，真报）、服务器磁盘 18 次**全在 r198 之前**（那次修是真修好，不是瞎亮的灯）、
接口速度 4 次、家长卡片中文字 1 次（10-08 00:34，部署到 `51beacd` 后自己转绿，别当新增噪声）、
批改失败任务 1 次（就是本轮这条语义错报）。

### 四道闸
**未跑**（只读轮，零代码改动）。

**第 249 轮（2026-10-08 19:49–，只读审计轮）**
- 开工锁 `running / 246`（19:42 起）⇒ 只读；未改业务码、未提交、未推送、未写 finished（留给在跑方）。
  他方 in-flight（`.workbuddy-ai/memory/MEMORY.md`、`scripts/patrol/daemon.mjs`、根目录 4 个未跟踪文档）没碰。
  唯一写入 = `docs/auto/backlog.md` + 本文件纯追加（已校验 0 删除）。
- 复核了在跑方 19:42 拿锁后落地的 `07cb5e1`：采样 `checked`/`checkedNames`/`lit` 与趋势按机器分组**已生效**
  （只读实跑 healthTrend：线上 59 / 目标没记 4 / 本机 1，逐台分开讲）。
- ⭐ 新发现 **r249-①（A，未动手）**：`scripts/healthcheck.mjs:183,189-190` 把
  `/api/tasks/summary` 的 `pendingTasks`（真身 = **老师未读的 done 作业**，`server/index.js:723,749` 注释明写）
  当「卡在处理中」报，并劝「持续卡住就重启后端」；实测那一刻那份 `status="done"` 已躺 52 分钟、
  而真在批改中的 `inProgressCount=5` 体检一次都没读。**老师照提示去重启会打断正在跑的批改，正确动作是去 App 点开看。**
  修法只有文案三分支改准，零接口改动零写库（X 用 `pendingTasks[].createdAt`，⛔ 别用没有的 `updatedAt`）。
- 提案 **r249-②**（B：灯名「批改失败任务」挂了两件事，建议拆灯或改名）/ **r249-③**（A，很小：
  趋势把老格式行说成「多半是别人不带 --api 跑的那次」，无证据，按 r198 改中立说法）/ **r249-④**（流程观察）。
- 下一轮接 r250：首选 **r249-①**（文案改准 + 一条回归锁，反向自检基线钉本轮 07cb5e1 之前那版），
  其次 r249-③、r248-①（默认 `--api` 改线上）、㉘（141 题 is_complete 口径拍板）、㊸（export-retry-pdf）、
  ㊴+㉚（渲染超时 **180s**，r229 实测）。另需负责人处理 Render 面板部署（㊼/㉒）与 stale 锁。

### 第 247 轮（2026-10-08 20:53–21:0x，可开工轮）：体检不再劝人「重启后端」去救一批根本没卡住的作业

- 缺陷（实测）：体检那句「N 份作业卡在处理中，等一会儿再看；**持续卡住就重启后端**」——
  `pendingTasks` 其实是**已经批完、老师还没点开看**的作业（`server/index.js:723` 的 SQL 写死了
  `status=DONE AND notification_read_at IS NULL`）。实测生产 `inProgressCount=0`（没有任何作业在跑）
  却照样报「卡住」⇒ 老师真去重启生产后端，会打断那几条正在跑的批改。
- 交付（已推送 `8492df9` + `2f9ec2a`，零接口改动、零写库）：`scripts/healthcheck.mjs` 三分支文案改准，
  并补上体检从未读过的「现在有几份正在批改」；`scripts/healthTrend.mjs` 对老格式行改中立说法。
  锁 `test/healthcheckUnreadTasks.test.mjs` 5 条（含反向自检，基线钉 `23ef3df`）。
- ⭐ 复用坑：反向自检的断言方向别写反（旧版**必须含**那句错话才叫验到了）；
  stage 基线的上一级相对依赖要按 `<tmp>/probe/` + `<tmp>/server/utils/` 布局才跑得起来（`test/baselineScriptKit.mjs`）。
- 四道闸：单测 2159/2159 fail 0｜lint 0e/0w｜`dist_nightly_20261008r248` 36.27s｜preview 5501 + render_smoke 8/8 + route_sweep 0/16 + text_audit 0/14。
- 线上改后复测：黄灯从 3 项降到 2 项，那句变成「5 份作业已经批完了，你还没点开看（最早那一份是 2 小时 4 分钟前批的）；这不是卡住，去 App 里点开看就行，不用重启后端」。
- 提案 **r248-①**（B，待拍板：「批改失败任务」灯名挂着两件事，拆/改名）、**r248-②**（A，观察）、**r248-③**（A，观察）。
  下轮接第 249 轮（编号以 loopGuard 返回值为准）。

## 第 248 轮（2026-10-09 09:07–09:5x，可开工轮）：体检的告警不再替你下结论，也不再给你做不到的建议

- 开工锁 `finished / 247`，`loopGuard.mjs acquire` 得 round=248；他方 in-flight（`.workbuddy-ai/memory/MEMORY.md`、
  `docs/auto/{backlog,HANDOFF}.md`、`scripts/patrol/daemon.mjs`、根目录 4 个未跟踪 docs）**全程没碰、没带进 commit**。
  本轮零产品行为改动（`/api/health` 与所有接口一个字段没动），只动体检的**告警文案与判据措辞**。

- 健康两次：09:07 uptime **191 分钟**、首响 1996ms / 复查 867ms → 改后复测 09:5x **203 分钟**（890/822ms），
  单调上升无重启；21 名学生、磁盘 66177MB。

- ⭐ **主发现（A 级，一处最贵 + 四处同族；实测不是推理）**：体检脚本里有五处文案，要么**拿单次观测替你下因果结论**，
  要么**推荐一个负责人根本做不到的动作**。① 队列那盏灯「队列服务连不上（多半是 Redis 掉了）：……**建议重启后端**」——
  `server/redisManager.js:129-131` 的 ioredis 是 `maxRetriesPerRequest: null`（重试不限次数）+ `reconnectOnError: () => true`，
  `:207` 那行注释明写「Auto-reconnect is handled by ioredis retryStrategy」，而 `server/queue.js:102` 的
  `redisManager.getAvailableClient()` 正是拿这个客户端 ⇒ **Redis 掉了后端会自己连回来，重启根本不解决**，白等一趟还打断正在跑的批改
  （r248 刚修掉的那条「照提示重启打断了 5 份批改」是同一个坑的第二处）。② `missingFieldDetail` 那句「多半是接口结构变了」
  —— 本周 66 条采样里「代码版本」连续 20 条亮（线上一直没换代码），而本周每一次「字段没回」的真实成因恰恰是**线上还没重启到新版**，
  常见成因被指反了。③ 接口速度「多为网络往返，……**换到离国内更近的机房**」—— 前者是单次观测下的因果（红线性），
  后者在 Render 上根本不是她的操作项（⛔ 给一个做不到的建议比不给更糟，r198）。④⑤ 队列积压「可能是 AI 额度紧张」、
  本地版本读不出「多半是被复制到别处跑了」—— 同一个「一个成因定终身」的毛病。

- 交付 `dfca4f7`（+685/−6，两文件）：五处文案改成「点到两种可能 + 给一个做得到的下一步」；队列那条改成
  「后端会自己连回去，**不用重启**；要是好一阵都连不上，去查 Redis 那边的内存/连接数是不是到顶了」；
  接口速度改成「偶尔碰上一次先不用管，过一会儿再跑一次体检；次次都这样才是服务器那边慢」。
  新锁 `test/healthcheckAlertCopy.test.mjs` 5 条（**真跑脚本**：假后端按真契约出数，队列 `available:false` /
  `summary` 整层不回 / 局域网 IP 造假后端 3s 延迟真跑线上那套慢文案 / 积压 30 个）；
  反向自检基线钉 `test/fixtures/healthcheck-baseline-8492df9.mjs`，同场景**旧版必须印出**「建议重启后端」与
  「多半是接口结构变了」⇒ 5/5 全过，不是空转。

- ⭐ **本轮自己踩的坑（高复用）**：① 造「线上偏慢」场景必须让**假后端的 `/api/health` 慢**（`health.rt` 才是判据输入），
  但 `isProd` 要非 127.0.0.1/localhost ⇒ 假后端得绑 `0.0.0.0` 并用 `os.networkInterfaces()` 拿局域网 IPv4 当 `--api`；
  ② 第一版把 `readFileSync` 引进来却没用（删掉源码断言后）⇒ lint 的 no-unused-vars 当场抓到（r241 同款）。
  ⛔ **下次再写「给建议」的告警，先问三句**：这建议她做得到吗？我有两次以上观测才下的结论吗？除了这个成因还有没有更常见的？

- 四道闸：单测 **2164 / 2164 过 / fail 0 / skipped 0**（基线 2159 + 本轮 5，账对得上）｜lint 3 文件 0e/0w｜
  `dist_nightly_20261009r250` **1m20s**（main chunk `main-CO0NAGlB.js` 与 r213–r249 同名 ⇒ 零前端产品码改动）｜
  preview `5510` + cert_probe 零外联（只有 OSS 图片，正常业务）+ render_smoke **8/8**（0 控制台错误 / 0 个 4xx-5xx）
  + route_sweep **0/16** + text_audit **0/14**，预览已按端口杀清。
  改后复测生产：仍是 2 项黄灯（代码版本 + 那 1 份没点开的新作业），**没有多出任何瞎亮的灯**。

- 提案 **r250-①**（A，很小未做）：`healthTrend.mjs` 报「代码版本」连亮时说「要么没解决、要么这盏灯本身坏了」——
  两种可能点到是对的，但可以直接点名现在最常见的那种（刚推了代码没部署），省得她每次都去猜。
  **r250-②**（B，沿用 r248-①：「批改失败任务」这个灯名挂着两件相反的事，拆/改名还没拍板，本轮只改文案没改名）；
  **r250-③**（B，观察）：本轮推的 `dfca4f7` 要等 Render 面板部署，线上要看效果得先解决 ㉒/㊼。

- 下轮接第 249 轮（编号以 loopGuard 返回值为准）：首选 **r250-①**、**r248-①**（灯名/拆灯，需拍板）、
  ㉘（141 题 `is_complete` 口径）、㊸（export-retry-pdf）、㊴+㉚（渲染超时 **180s**，r229 实测）；
  另需负责人处理 Render 面板部署（㉒/㊼）与 stale 锁。

## 第 249 轮（2026-10-09 10:27–，交接编号待对齐）：体检那句「没有批改失败」是把「没盯到」说成「没有」

> **编号对齐（重要）**：上一轮 HANDOFF 里写的是「下轮接第 249 轮（编号以 loopGuard 返回值为准）」，
> 而本轮 `loopGuard.mjs acquire` 实际返回的就是 **round=249** —— 上一轮那批编号（r250-① healthTrend
> 点名成因 / r250-② 灯名拆灯 / r250-③ 部署）在本文档里统一改记为下方 **r249-①~④**，以 loopGuard 返回值为准。
> 历史 r244~r248 的 backlog 节是**未提交的工作区内容**，本轮用 python 只读追加，**0 删除**。

- 开工锁 `finished / 248`，`loopGuard.mjs acquire` 得 round=249。他方 in-flight
  （`.workbuddy-ai/memory/MEMORY.md`、`scripts/patrol/daemon.mjs`、以及中途被 workbench 提交掉的
  `src/workbench/*` 与 `test/pendingReviewCaliber.test.mjs`）全程没碰、没带进 commit。
- 交付 `1e24de3`（代码 2 文件 +203/−1，零产品代码、零接口改动、零写库），docs 为纯追加。

### ⭐ 主发现（A 级，假绿家族新一枚，而且这盏灯盯的正是「失败」本身）

`scripts/healthcheck.mjs` 合格那一支写死一句「**没有批改失败**，也没有没看的新作业」；
而 `/api/tasks/summary` 的 `failedTasks` 只数 `status='failed' AND notification_read_at IS NULL`
（`server/index.js:733` 的 `failed_detail` 子查询硬带未读条件）。

实测生产 `tasks` 表（`SELECT status, COUNT(*) ... GROUP BY status`）：只有 `reviewed 189` + `done 8` +
**`failed 1`**。那条失败作业 `35b35c33…`「新闵学校"成长·桥"练习 数学堂堂清01」：
created 2026-09-02T09:53:31Z、`retry_count=3`、`last_error = invalid input syntax for type json`、
`notification_read_at = 2026-09-02T10:47:41Z`（**当天就被点开过**）、
`describeAutoRetry`（`server/pendingTaskRecovery.js`）→ `{willRetry:false, state:'gave-up', reason:'超出 7 天自动恢复窗口'}`。

⇒ 因为被点开过，`failedTasks` 恒 0 ⇒ **体检和铃铛一次都没提醒过这份作业**；而它会一直卡在那儿：
不会自己重判，`server/` 里也没有任何一处定时清掉它。10-09 10:27 那次体检照旧印「没有批改失败」。

**这类假绿比假红危险**：灯名承诺「盯失败」，实际漏的就是失败本身（与 r221 同族 ——
r221 管「字段在不在」，本轮管「口径窄到看不见**已经点开过**的失败」）。

- 修（A，零接口改动零写库）：合格那一支改成「**没看到新的批改失败**」+ 一句交代本项只看什么 +
  一直没批成的上哪儿翻：`没看到新的批改失败，也没有没看的新作业｜（这一项只看「新冒出来、你还没点开过的失败」；` +
  `点开过的不再提醒 —— 真有几份一直没批成的，得去作业列表里翻出来手动重试，它们不会自己重判、也不会自己消掉）`。
  判红那一支（真·3 份作业批改失败，需在 App 里点重试）**一字未动**，行为保持。
- 新锁 `test/healthcheckFailedCaliber.test.mjs` **5 条**：① 元判据自证（探针认得这行、认得两种状态）；
  ② 什么都没有 ⇒ 仍判 `ok`，但 **不许再出现「没有批改失败」**，且必须说清「没看到新的 / 只看 / 作业列表 / 不会自己重判」；
  ③ 行为保持：`failedTasks:3` ⇒ 仍判 `bad` 且印「3 份作业批改失败」；④ **反向自检**：套基线快照
  `test/fixtures/healthcheck-baseline-8492df9.mjs`（修复前那一版）同场景**必须印出「没有批改失败」**；
  ⑤ 基线快照自证（fixtures 里若被换掉，第 ④ 条会空转成假绿）。

### ⭐ 本轮自己踩的坑（高复用）

① **禁词断言差点把自己判红**（r237/r241 同款）：新文案里含「没看到新的**批改失败**」，而禁的是
「**没有批改失败**」—— 五字一差，本来会当场判红。⛔ 写「禁止出现某词」前，先拿自己的新文案去核一遍。
② **新锁第一版漏了 `import { spawn } from 'node:child_process'`** ⇒ 3 条直接 `ReferenceError: spawn is not defined`
（不是断言失败）；用 `node --test <单文件>` 一眼能看见，别等全量套件才暴露。
③ **反向自检的基线必须挑对版本**：本轮的洞在 `8492df9`（r248 那一版）里**还在**；若沿用 r249 这把锁钉的
`23ef3df` 基线，基线里已是修过的 copy ⇒ 自检会永远空转（r214 教训）。故本轮新挑 `8492df9`，并加第 ⑤ 条自证。

### 已验证无问题（下轮别再翻）

- `/api/queue/stats` 的 `failed=50` 与 tasks 表 `failed=1` 差 50 倍：前者是 BullMQ `removeOnFail:{count:50}`
  上限（永远停在 50，r246 已验），**不是作业失败数**；体检「任务队列」那盏灯只作事实打印、不参与判定（r220 决定），现状不改。
- `/api/tasks/summary` 的 `pendingReview`（1）= 未读 done 数（铃铛），`pendingReviewPapers`（5）= 待复核卷数（待办工作量），
  两个口径不同源，非缺陷。
- 家长分享卡真图复核（成长总览·陆晨曦，258,478 bytes / 36.3s）：中文字形、学习周期 01/01~12/31、
  三态掌握度（已记住 16 / 还在攻克 54）、周期词（「这段时间」）、老师寄语全部正确，无新问题。
- `node scripts/pruneDeadDeclarations.mjs --check` 报 2 条可删死声明
  （`server/scripts/applyKnowledgeMerge.mjs:215`、`server/services/knowledgeService.js:78`）——
  属「仓库卫生」赛道且未擅自 apply，留作提案/下轮。

### 提案

- **r249-①**（B，本轮最大待拍板）：`/api/tasks/summary` 的 `failedTasks` 只数未读失败 ⇒ 老师点开一次铃铛，
  那条永远批不成的作业就从**所有**告警里永久消失（本轮实测就是这么消失的）。建议改成
  「不会自动重捞的失败总数（不管有没有点开）」，铃铛另算；属口径变更且影响铃铛数字，需负责人拍板。
- **r249-②**（B，沿用 r248-① / 上一轮 r250-②）：灯名「批改失败任务」挂着两件不相干的事（真失败 / 没点开的新作业），
  本轮只改合格支的措辞，**灯名没动**（改名会动到 `bad`/`warn` 灯名与采样分组）。
- **r249-③**（B，观察）：队列那 50 个永远停在 50，绿灯会一直这么印；别把它当成「作业失败数」读。
- **r249-④**（B，沿用上一轮 r250-③）：线上 commit `22852cf`（09:53 由 workbench 推送触发的部署重启，非故障），
  本地 `1e24de3` ⇒ 本轮改动要等 Render 部署。

- 下轮接第 250 轮（编号以 loopGuard 返回值为准）：首选 **r249-①**（口径变更要发起人点头）、
  **r249-②**（灯名拆/改名，需拍板）、上一轮留下的 `healthTrend.mjs`「代码版本」连亮时直接点名
  「刚推了代码没部署」、㉘（141 题 `is_complete` 口径）、㊸（export-retry-pdf）、㊴+㉚（渲染超时 180s，r229 实测）；
  外加本轮的 `pruneDeadDeclarations` 两条死声明（仓库卫生赛道）。另需负责人处理 Render 面板部署（㉒/㊼）与 stale 锁。


**交接状态**：第 249 轮已收尾（本轮已结束，下次触发自动接下一轮）。交接人本轮改动：体检「批改失败任务」合格支不再把「没盯到」说成「没有」；代码已过四道闸并推送。下轮接第 250 轮（编号以 loopGuard 返回值为准），首选 r249-①（口径变更需负责人拍板）与 r249-②（灯名拆分/改名）。

### 第 250 轮（2026-10-09 11:44–12:0x，可开工轮）交付：`f543437`

**做了什么**：体检「批改失败任务」这一项会把**数据库读不通时接口回吐的旧数字**当成现在的值报。

- 事实：`/api/tasks/summary` 的 DB 失败分支（`server/index.js:836`）会降级返回上一次缓存、并在响应里打 `_stale`，那行注释原话「前端可据 _stale 提示用户数据可能延迟」—— 但 `src/ server/ scripts/ test/` 实测**零消费方**，这个信号从加上的那天起就没人读过。后果不是报错，是**老师照着旧数字做决定**（铃铛数、PC 待复核数、体检报的「N 份作业已经批完了」可能是几小时前的）。
- 为什么这条比「字段没读到」严重：字段没回一眼看得出没盯；**旧值的样子和真值一模一样**。
- 改了什么（零产品行为改动）：① 服务端降级响应**新增** `_staleAt`（这份数字存于何时），`_stale` 原样保留；② 体检读到 `_stale` 就明说「这是 X 前存下来的旧数字，不是现在的值，先别照它做决定」，并降级成要看一眼，但**数字照样报**（只说旧不给数等于没盯）；旧数字里真有批改失败仍判红；数据新鲜时不许平白多一句（避免天天瞎亮）；③ 7 条新锁 + 反向自检基线 `test/fixtures/healthcheck-baseline-beforer250.mjs`。

**四道闸**：单测 2215/2215 fail 0（单独跑、单独提交）｜lint 3 文件 0e/0w｜`dist_nightly_20261009r250` 57.51s｜preview 5512 + cert_probe 零外联 + render_smoke 8/8 + route_sweep 0/16 + text_audit 0/14（预览已按端口杀清）。

**健康采样**：11:44 uptime 24 分钟（1511/349ms）→ 改后 2 分钟（1388/772ms）；`bootAt 11:53` 与 patrol 会话 `5614297` 部署重合，是推代码触发的部署重启，不是故障。

**改后复测生产**：黄灯 2 项 → 1 项（「代码版本」转绿），**没多出瞎亮的灯**，非陈旧路径输出与改前逐字一致。

**下一轮（第 251 轮）首选**：r250-②（先拍板要不要让 PC 铃铛/移动端首页也认 `_stale`）、㉘（141 题 `is_complete` 口径，家长「批改题量」少 141 题）、㊸（export-retry-pdf）、㊴+㉚（渲染超时 **180s**，r229 实测）、r249-②（灯名挂着两件事）、r250-①、⑲/㊲/㊵。
另需负责人处理 Render 面板部署（㉒/㊼）与 stale 锁。

**未碰他人文件**：`.workbuddy-ai/memory/MEMORY.md`、`scripts/patrol/daemon.mjs` 全程没动，也没带进 commit。

**本轮复用到的坑（下轮直接避开）**：
1. 元判据「全文件搜两个字面量再比位置」会搜到自己刚写的注释上 ⇒ 先定位到那一个 `if` 块再判（本轮第一版就是假绿）。
2. 闸 4 的三个门禁脚本 `render_smoke / route_sweep / text_audit / cert_probe` **都必须带 `BASE=http://127.0.0.1:5512`**，否则默认往 5227 打、全是 CONNECTION_REFUSED（r152/r158 的 `base.mjs` 有这个钩子）。
