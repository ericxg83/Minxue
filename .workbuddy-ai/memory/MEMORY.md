# 敏学项目长期约定

> 只留硬约定与「不知道就会踩坑」的事实；细节外链 `topics/`，每日过程见 `YYYY-MM-DD.md`。
> 产品原则/循环机制见根目录 `AGENTS.md` 与 `docs/auto/HANDOFF.md`，本文件不重复（2026-10-03 三次压缩）。

## 0. 产品与自决权（最高层）
- 单用户系统：唯一用户 = 负责人（晚托班老师）；学生是数据主体，不是软件用户。产品哲学「小而美」。
- 自决权：A 级（行为保持型修复/死代码/顺手化/文档）+ 四道闸全过 → 可直接 push main。
- ⛔ 硬禁区（只能提案）：DB Schema/迁移、批改主流程设计、错题生命周期与合并、重练组卷口径、
  掌握度口径、练习册答案质量闸、judgements 语义、公共 API 行为、任务状态机、判题/抽取正则与转义。

## 1. 完整性判定（topics/question-completeness）
- `checkQuestionCompleteness()`（server/utils ↔ src/utils 逐字一致）是唯一判据；`is_complete` 仅缓存、偏保守。
- `parent_stem` 三硬约束：①重算 SELECT 必带 ②引擎输入必拼（漏 → 条件题判缺条件、answer 永久空）③写入侧只告警不拦截。
- 引擎输入须与生产逐字同构：`parent_stem`+`content`+`options`（漏 options → 字母答案被覆盖成选项正文）。
- 残题分组键必含 `page_number`；同页题号撞车禁公共题干/邻题配图兜底；残句小问以行首 `(N)` 最权威，宁可留空不填错。
- 配图只认 `geometry_image_url`；⛔ 禁 `image_bbox`↔`block_coordinates` 互比判归属（假阳~28%）。

## 2. 选择题选项
- OCR prompt 必带 `options`（图形选项写 `["选项A图",…]`，绝不因是图留空）；存量补全 `backfill-choice-options.mjs`（默认 dry-run）。

## 3. 视觉模型（topics/vision-vendors）
- ⛔「魔搭欠费」是误判（实为免费额度打满 429，会自恢复）；`MS_VISION_DISABLED` 是人工开关，线上 Render 需手动同步。
- 生产视觉链：`ANSWER_PAGE_VENDOR_CHAIN`（qwen3.8-flash@Bailian→kimi-k3@SN）、
  `WORKBOOK_OCR_VENDOR_CHAIN`（deepseek-flash@SN→qwen3.8-flash@Bailian）。
- ⛔ 判模型能否读图只能实测（input_modalities 撒谎）；400/404 ≠ 下线；AI 调用必须关代理；
  离线脚本不得用 `noBackup:true`（魔搭已禁用 ⇒ 必然失败）。
- 漏裁判据：`image_type IN ('geometry','chart')` ∧ `geometry_image_url IS NULL`；⛔ 别用 image_type 非空（'none' 是纯文字题）。

## 4. 几何重画（topics/geometry-pipeline）
- 强制 DSL 构造式（forceDsl）；DSL 成功后直接用 `correctDslByVision` 返回的 structure，禁二次 executeDsl。
- 显示唯一入口 `getGeometryDisplayUrl`（`src/utils/geometryDisplay.js`，**无 server 镜像副本**）；
  ⛔「无可重绘的几何结构」闸门只在「仅剩原始裁片」时拦。
- 四条出图通道（互补别混）：①视觉 JSON→`renderGeometrySvg` ②DSL+视觉闭环 ③裁片矢量化描摹（`figureVectorize.js`）
  ④原图高清重裁（`figureCropHiRes.js`）。
- ⛔ 视觉定位框：①会被 `figureRegionRefiner` 误伤（墨迹覆盖率 > `MAX_INK_COVERAGE=0.14` 判文字带）
  → 走 `FIGURE_REFINE=0`+已目检的框；②视觉模型非确定性 ⇒「先目检再 apply」必须复用同一个框。
  ⛔ 判「裁片好不好」无确定性判据 ⇒ 只能视觉定位 + 人工目检；**缩略图会误判，必须放大再看**。
- ⛔ 画图铁律：数值必须全部来自题干文本，图里才有的位置绝不靠猜。脏重绘图（图上印内部变量名）走
  `scripts/retract-dirty-figures.mjs`；发布侧 `geometryContentGate.js#findSuspiciousSvgLabels` 防复发。

## 5. 本地开发（topics/local-dev-process）
- ⛔ 入口第一行必 `import './loadEnv.js'`；验配置只认启动日志 `🧠 [Answer Engine] 启用 → …`。
- 后端 `node server/index.js` → 4000（内嵌 BullMQ worker，须 Redis 先起）；前端 dev 3000 / 预览 5220。
- ⛔ `Edit` 报成功 ≠ 落盘：改完立刻 `grep -c`/`node --check` 复核；同一文件禁并行发多个 Edit。
- ⛔ 后台起服务用 run_in_background，**别加 `&`**（会让后端在 Redis 连接池初始化后退出）。
- ⛔ 会写文件的命令**绝不能用 `… | Select-Object -First N` 取输出**（上游提前终止 → 文件被截空）；要 `> file 2>&1` 再读。
- ⛔ `curl` 探活 localhost 必须 `--noproxy '*'`（环境代理会劫持成 502 假死）。
- DB 串在 `server/.env` 的 `NEON_DATABASE_URL`；只读探针写 `server/_diag_*.mjs`。
  ⚠️ 该文件中文注释已成 U+FFFD → 改它用原生 Buffer utf8 + round-trip 校验 + 备份。

## 6. 答案引擎 / 校验 / 判分 / 抽取（topics/answer-engine-fallback-chain、answer-validators-and-judge）
- 链路：`SenseNova:[deepseek-flash→glm-5.2→sensenova-6.8-flash-lite]`（双 Key）→ BigModel:glm-4.7-flash
  → Bailian:qwen3.8-flash → Huihuiyun:deepseek-v4-flash → 留空转人工。全链失败返回
  `{content:'',provider:'no-channel-available'}`；⚠️ `ANSWER_ENGINE_ENABLED=0` 仍走 callTextCompletion，别误删。
- ⛔ 确定性校验器（三次误清空教训）：结论与数值求解不符 → 清 answer + 标异常。根治 `isCompleteExpression()`
  （省略号/首尾运算符/括号不配对 → applicable:false **保留答案**）。只许加规则/测试，不得放宽或绕行。
- ⛔ 判分器：`\FRAC{}{}`→`n/d` 必须排在尾标点剥离之前；两个解析函数都不能单独改
  （先复制打补丁 → 全库对跑 → 只翻转可逐条解释的 N 条）。
- 参考答案位只能显示 `q.answer`，⛔ 禁 analysis 兜底；⛔「AI 自述缺条件」一半是假的：**先查 parent_stem 非空**。
  回填 answer 必须同时复位 `answer_exception=FALSE`。

## 7. 错题 / 重练 / 练习册闸（topics/wrongbook-gate-requeue）
- 错题「同一题」判定走 `questionIdentity.js`，禁相似度阈值合并；变式题不进重练卷与组卷，仅作讲义素材。
- 入册「补全即补入」：`wrong_no_book` 是终态；判据 = `wrongGateRequeue.js`（唯一口径）。⛔ 手动「本次不加入」
  绝不自动拉回；唯一可靠判据 = skipReason ∧ `gateAuto===true`。⚠️ 未修：confidence=0 两来源且补答案不重置 ⇒ 永久卡死。
- 重练卷答卷（`generated_exam_id` 非空 或 `task_type='wrong_retry'`）不是独立作业：题目挂原 task；
  唯一口径 = `retryPaperState.js#isRetryPaperTask`。
- 练习册质量闸：OCR 锁主力 + 3 并发 + 文字层门禁 + 控制字符过滤；published 必经 `getWorksheetPublishRisk`
  （blocking→409，须 force=true）；新增版式异常只许加规则/加测试。
- `processWorkbookGrading` 从不读 `r.answer_status`；`processAnswerBankGrading` 有 → 未审核答案库被判分产生假红叉。
- 参考答案空值唯一可信判据 = 数 `questions.answer`，⛔ 别只看 `tasks.last_error`；
  `answer_exception_reason` 空=静默空，有值=主动丢弃。

## 8. 长耗时接口与错误外露（topics/long-request-and-error-surfacing）
- ⛔ 含 AI/外部服务/长事务的 POST 必须显式 `apiRequest(path, opts, 1)`（默认 3 次重放 + 等待拉到 95s）并放宽 timeout。
- ⛔ 后端错误体契约 `{ error:'<code>', message:'<中文可读>' }`；前端一律读 `err?.payload?.message || err?.message`。
- ⛔ pg query 在已建连接上无限等（connectionTimeoutMillis 只管建连）；手动触发类路由必须自带应用层超时。
- DB 故障（503 db-unavailable）与业务失败（502 engine-empty）分开报；结算类后置动作失败只告警，不吞主结果。

## 9. 缺配图闸 + 补答案路径（topics/blank-answer-recovery）
- `figureRequirementGuard.js`：判据 = `hasFigureReference(q)` ∧ 无 `geometry_image_url`；非终态，补图后可重算。
- 补答案优先级：同卷副本回填 > 文本链重跑 > 读图解题 > 转人工。
- ⛔ 多数票 ≠ 正确；⛔ 判「几源一致」必须剔除本轮自己写入的行；⛔ 跨 task 借 parent_stem 是错的；
  ⛔ 读图判幻觉：「两次独立运行一致」不构成证据，可靠手段 = 只转录不计算；⛔ 错的答案比空答案更糟。

## 10. 讲题白板 / 课件（详情 topics/board.md）
- 内容一律走 `MathRender`（KaTeX；库里大量题干是裸 LaTeX）；选择题必渲染选项；短答案传 `force-inline`。
  布局高度跟随父容器（禁 `100vh`）；全屏弹窗一律 `:append-to-body="false"`。
- 工具 = pen / eraser / **laser**；快捷键 `1-4` `[` `]` `E` `L` `Y` `Z` `A` `O` `F` `U` `R`。
  ⛔ 激光笔走独立 `.dc-laser` canvas（`pointer-events:none`），**绝不进 `startStroke/appendLivePoint`、
  绝不写 strokes** ⇒ 导出 PNG 天然不含光点。清屏有二次确认（3s 窗口）。
- ⛔ 导出板书图（`exportPng`）题干必须经 KaTeX 渲染：离屏 `.dc-export-render` 层用**同一个 `MathRender`**
  → `html2canvas` 光栅化（`onclone` 内联 `KATEX_CSS_WITH_FONTS` + `fixFractionLineInCloneDoc`）。
  **绝不用 canvas `fillText` 画含 LaTeX 的题干**；只在光栅化失败时回退。该层必须 `Teleport to="body"`
  （`.drawing-canvas` 是 `overflow:hidden`）且 **不要 `z-index:-1`**（会被 body 背景盖住 ⇒ 空白）；
  标题走纯文本（否则 `10-03` 渲染成 `10 − 03`）。
- ⛔ 笔迹点量化到 2 位小数（`utils/strokePoint.js`，在 `pointFromEvent` 出口做，**不能只在落盘时做**）；
  落盘失败**必须让老师看见**（页内 `showHint`，原生全屏下 `ElMessage` 不可见），不得静默 `catch`。
  板书按题目永久占 localStorage、全仓无清理 ⇒ 5MB 迟早写满（瘦身后 ~55 题，约 3–5 周），
  根治见 `topics/board.md` §11 与 HANDOFF 五-6（**等负责人拍板**）。
- ⛔ `saveStrokes()` 按 `current` 算键 ⇒ **任何换题单/换题的动作都必须先落盘旧题**
  （`gotoQuestion` 与 `toggleUnTaughtOnly` 同一条纪律）。踩过：「只看未讲」先换题单再存 ⇒ 当前题的板书
  被写进新题单同下标那道题的键，既串题又覆盖它原有的板书。关页路径也必须补 `saveStrokes()`
  （`onBeforeUnmount` 会先 `clearTimeout(saveTimer)` ⇒ 防抖窗口内最后一笔必丢）。
  锁 `test/weekendBoardViewSwitchOrder.test.mjs`（源码级顺序锁，已反向自检）。
