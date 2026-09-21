# 敏学项目长期约定

> 只留硬约定；细节见 `topics/`：`question-completeness` · `geometry-pipeline` · `board` · `answer-bank-trust` ·
> `vision-vendors` · `bbox-contract` · `git-commit-discipline` · `frontend-verify-discipline`

## 1. 完整性判定

- `checkQuestionCompleteness()`（`server/utils/` ↔ `src/utils/questionCompleteness.js`，**两份必须逐字一致**）
  是唯一判据；`questions.is_complete` 只是反范式缓存列，漂移单向偏保守。过滤优先函数现算；
  必须用 SQL 列过滤时**写入侧先自愈该列**。
- 回读 questions 重算完整性的 SELECT **必须带 `parent_stem`**；引图判据只此一处，禁止另写正则。
- **多小问大题的 `parent_stem` 三处硬约束**（2026-09-20 第19题事故）：① 上面那条 SELECT 必带；
  ② **答案引擎输入必须拼它** —— `worker.js` `generateMissingAnswers` 里
  `content = [q.parent_stem, q.content].join('\n')`，只喂 `q.content` 会让条件写在公共题干里的题
  被判「缺少条件」→ `answer` 永久留空（缓存指纹同源，改后旧错误缓存自动 miss）；
  ③ 写入侧判据 `looksLikeLostParentStem`（`server/utils/parentStemTrust.js`）**只告警不拦截**
  （全库 14 命中 / 7 真 7 假，假阳性是「两个各自完整的小问」）。
- **残题（同题号多条且全无 `sub_no`）分组键必须含 `page_number`**（2026-09-20 存量 484 条事故）：
  按 `(task_id, question_number)` 会跨页撞车（p1 题2 与 p2 题2 无关）；含页后 109 组 / 299 条为真候选。
  **同页题号撞车组禁用公共题干兜底**（跨题共用 = 造假）。
- **残句小问号判定定稿**（`scripts/fix-subno-parent-stem-20260920.mjs`）：① 行首 `(N)` 最权威
  （须**整行只有一个顶层 `(N)`**，排除「第(N)题」引用；一行并两个小问的拒绝）；② OCR 匹配值；
  ③ 圈号/图号兜底。每级都过**组级 usedSubNo 去重闸**。**不认行首 ①/② 为顶层标号**
  （常是某 `(N)` 内部子部件，当顶层用会撞号）。原则：**宁可留空，不填错标号**。
- **「题目完整」是跨管线不变量，两条批改管线（general / workbook）规则必须一致**
  （2026-09-21 用户拍定：「一切都和日常管线走一样的路线，减少老师的学习成本」）。
  ~~练习册自包含错题入册闸只拦 `missing_options`，另两条在该管线不成立~~ ← **此取舍已废**：
  它成立于「练习册管线不产配图」的前提，**配图补齐后前提不成立**。
  **顺序铁律：先补数据（配图），再收门禁**（反了会把引图题全挡在错题本外）。
  日常闸的实际结构 = 候选筛选 `is_correct===false || answer_source==='blank'`
  + `checkQuestionCompleteness(q).isComplete` + 入册前 `syncQuestionCompleteness`
  （`missing_answer` 由候选筛选天然豁免，**不要为练习册另写豁免规则**）。
- **两管线的错题写入函数不同但门禁必须对齐**：日常走 `addWrongQuestions`（**有**完整性闸），
  练习册走 `addSelfContainedWrongQuestion`（**原本无闸、2026-09-21 补**）。
  练习册还缺「入册前 `syncQuestionCompleteness`」→ 不补会重演 2026-09-11
  「写入成功但列表按 `is_complete=TRUE` 过滤看不见」（实测 396 条藏 112 条）。
- **补图后自动入册已存在**：`PUT /api/questions/:id` 的复核「标错强入册」分支
  （`server/index.js`，调 `addWrongQuestions(..., {skipConfidence:true})`，返回 `wrong_book_sync`）——
  练习册题走同一 PUT，**不需要新写路径**。
- **配图 A / B 已统一（2026-09-21 落地完成）**：A = `questions.geometry_image_url`（图形元素）
  两管线**都采集**；B = `wrong_questions.question_image_url`（**整题裁片**）**已整体下线**。
  编排共享于 `server/utils/geometryCrop.js`（`cropGeometryFigures`，`cropImage` 按位置参数注入）。
  用户原话：「题目一律结构化入库，留痕只需整页原图，不需要这道题的裁片」——
  **三类图别混**：配图 A / 整题裁片 B（已废） / 留痕整页原图 `tasks.images`。
  课件白板题图现只认 A（`figure`），没有就不显示（宁可不显示，不显示错图）。
  新增练习册配图相关代码前先读 `topics/board.md` §2.1 + `topics/geometry-pipeline`。
- **⛔ 禁止用「`image_bbox` 与 `block_coordinates` 坐标互比」判断配图归属**（假阳性 ~28%，会删掉正确配图）。
- **⛔ 禁止用 `block_coordinates` 定位题目区域**：不是"错位"是**"没量"** —— 模型按题数**均分**返回占位框。
  只能当纵向区段粗线索，裁图前先过 `server/utils/blockBoxTrust.js` 两道闸；**宁可不出图，也不显示邻题的图**；
  护栏须写入侧与读取侧共用同一判据。越界框 >1000 与整页均分占位两道闸已落地；
  几何产物另查"画残了"（`isDegenerateGeometrySvg`）。

## 2. 选择题选项

- **新增/修改任何 OCR prompt 必须确认带 `options` 字段**（练习册两条 prompt 曾漏，导致选项从未采集）。
- 渲染守卫统一为「有选项 且 题干未内联 ≥2 个 A–D 标号（`hasExplicitOptionMarkers`）」；短选项两列、长选项单列。
- 图形选项写 `["选项A图",…]`，**绝不能因为选项是图就留空**。
- 存量补全 `backfill-choice-options.mjs`（默认 dry-run）**默认 `--mode=page`**；魔搭耗尽时 `--vendor=Huihuiyun`。

## 3. 视觉模型

- `noBackup:true` = 禁止静默降级弱备份模型。答案页 OCR、单题重识别**已锁**；主 OCR 与练习册两处**未锁**（产品级取舍，未决策）。
- 供应商可用性**必须逐个实测**（`_visionVendorProbe.mjs` 必须传 `imageDataURL`）。
- **Gemini 直连暂不启用**（免费档 20 次/天/模型，覆盖不了稳态 4–20 张/天）。区分分钟窗/按天**只能看
  `quotaId` 的 `PerMinute`/`PerDay`**，body 里的「retry in Ns」不可信。- **限流安全网**：`aiProviderRetry.js` 包住 `geometryWorker.js` 三处视觉调用；否则 429 会消耗
  `handleRetry` 的 3 次预算 → 写 `tikz_status='none'` = 永久放弃重绘。429 退避须 ≥60s。
- 辉辉云换 key 必须同步改 `config/ai.js` 的 `Huihuiyun.vlModels`；后备模型**只能当文字 OCR 兜底，不能当配图定位兜底**。
- **答案引擎兜底 key 可能早已被禁用**（2026-09-20 实测旧 HUIHUIYUN_API_KEY=API_KEY_DISABLED，备用链路
  一直静默断着）。换 key 后**必须实测**（`/v1/models` 列模型 + 单轮对话），别只看 .env 有没有配。
  当前 `Huihuiyun`（sk-30d6...）7 模型全为文本（deepseek-v4-flash/glm-5.2/grok-4.5/4.6/sensenova-6.8-flash-lite），
  无视觉。
- **引擎回填必须逐条验算**：兜底模型（deepseek-v4-flash）输出不稳定，同题两次调用可能不同
  （2026-09-20 题25(1) 两次分别为 (2/3,4/3)/(2,2)）；`extractAnswerFromAnalysis` 可能带截断尾巴。
  多解/分段题宁可人工定点写库（附推导进 analysis），不直接信提取值。

## 4. 几何重画

- 几何题**强制走 DSL 构造式通道**（`forceDsl`，`=0` 仅诊断）；旧 JSON 目测通道不再出图。
- DSL 成功后**必须直接用 `correctDslByVision` 返回的 `structure`**，禁止 `executeDsl(dsl)` 二次执行；
  DSL 产物豁免派生点安全网。

## 5. 本地开发环境

- 后端 `node server/index.js` → **4000**；前端 `npm run dev` → **3000**（`/api` 代理到 4000）；Redis **6379** 必须先运行。
- hash 路由：`localhost:3000/workbench.html#/weekend-ppt`。
- 数据库串在 `server/.env` 的 `NEON_DATABASE_URL`（根 `.env` 只有 `DATABASE_URL`）；只读探针写
  `server/_diag_*.mjs`，`dotenv.config({ path: 'D:/Minxue_App_V3/server/.env' })` 直跑。
- **Vite 预构建缓存清理会被安全删除保护拦截**：不绕过，把 `node_modules/.vite` 改名为 `.vite.stale-<时间戳>`。
- Vue SFC 改动后跑 `_sfc_check.mjs <file.vue>`。本机**无 PIL**，裁页图用 `_crop_page_image.mjs`。

## 6. 答案库信任

- `processWorkbookGrading`（`worker.js:4377`）**从不读 `r.answer_status`**，而 `processAnswerBankGrading`（`:5513`）**有**
  → 未审核答案库被判分 → 假红叉。**改练习册判分前先想清楚要不要对齐两条管线。**
- `PUT /api/questions/:id` 已按 `answerRewritten` 清 `ai_answer_risk_reason` / `answer_exception*`（警示不消失先查这三列）。
- ⚠ 起临时实例验证**必须把 `REDIS_URL`/`REDIS_POOL_URLS` 指向不存在的端口**，否则抢生产队列。
- **答案引擎的答案质量 = 用没用上强模型，不是判据问题**（2026-09-21 实测）：主供应商 SenseNova
  白天 rpm 打满 → 代码 3 模型 × 8s 重试后**静默降级**到 `Huihuiyun:deepseek-v4-flash`，
  该弱模型同题 10 次采样错答率 **40%**；Bailian 付费池 deepseek-v4-pro 同题 3/3 全对、9–13s。
  **判断答案可信度先看 `result.engine`，别只看答案值。**
- **已落地的三道闸**（回滚开关：`ANSWER_CONSENSUS=0`、`ANSWER_PRIMARY_BREAKER_MS=0`）：
  ① `config/ai.js` 主供应商熔断（全线失败后 60s 内只做一次不重试试探，省掉每题 24s 空转）；
  ② `worker.js` 降级时多路采样投票（`utils/answerConsensus.js`）+ 分歧写 `ai_answer_risk_reason`；
  ③ 降级留痕（`isDegradedAnswerEngine`）。
- **多路投票治不了系统性偏差**：实测 40% → ~35%，几乎无改善；且 429 会把全局 AI 信号量压到
  并发 1 → 三路串行 → 单题 140–230s。**它的价值是"标出不可靠"，不是"让答案变对"。**
- **投票口径**：`±10` 与 `10` 必须判为**不同**答案（漏写 ± 是平方根题高频分歧点）；
  采纳哪一路的答案就**必须连带用那一版的解析**，否则制造新的答案/解析不同源。
- ⛔ **别再用 `aiParseSelfCheck` 去"筛掉自相矛盾的那一路"**：判据把 `36+64=100` 与答案 `±10`
  直接比，不认识「100 的平方根」这一步变换，会把**正确的那路也筛掉**（实测自洽子集 0/3）。

## 7. 其他硬约定

- 错题「同一题」判定统一走 `src/domain/questionIdentity.js`，禁止相似度阈值合并。
- 产品口径「只练错题」：变式题不进重练卷与组卷，仅作讲义素材。
- 练习册答案解析质量闸（AGENTS.md 第 11 条）：OCR 锁主力模型 + 3 并发 + 文字层门禁 + 控制字符过滤；
  发布 published 必经 `getWorksheetPublishRisk`（blocking → 409，须 `force=true`）。
  **新增版式异常只许加规则/加测试，不得放宽或绕行任一门禁。**
- 周末班课件（`lib/weekendHandout.js` ↔ CLI 同构）：**课件范围内同一道题只出现一次**——
  全局跨天合并（`mergeKeyOf` = ocrStemKey→normalizeStem→去 `_`，长度 ≥12 闸），
  跨天共错合并到最晚错题日期节并累计「共 N 人错」，禁止改回 per-day 合并。
- **题目解析入口唯一化（2026-09-21）**：解析只在题干行的「解析」小按钮
  （`review/AnalysisSource.vue`，与「原卷」`OriginalPaperSource.vue` 同构）弹窗查看，走 MathRender。
  已下线两处旧入口：`QuestionDetailPanel` 的「查看解析」折叠区、`QuestionEditForm` 的「AI 解析」输入框。
  **编辑表单不再提供解析修改能力**（老师手改会与 `ai_self_check` 语义脱节）；
  `form.analysis` 仍由父组件原样提交，**不会清空已有解析**。无解析时不渲染按钮。
  两个入口都自隐：原卷仅 `source==='paper'` 或跨卷题；解析仅 `analysis` trim 后非空。
