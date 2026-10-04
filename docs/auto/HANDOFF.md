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
