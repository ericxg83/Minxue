# 敏学项目长期约定

> 只留硬约定；细节见 `topics/`：`question-completeness` · `geometry-pipeline` · `board` · `answer-bank-trust` ·
> `vision-vendors` · `bbox-contract` · `git-commit-discipline` · `frontend-verify-discipline` · `local-dev-process` ·
> `answer-engine-fallback-chain`

## 1. 完整性判定

- `checkQuestionCompleteness()`（`server/utils/` ↔ `src/utils/questionCompleteness.js`，**两份必须逐字一致**）
  是唯一判据；`questions.is_complete` 只是反范式缓存列，漂移单向偏保守。过滤优先函数现算；
  必须用 SQL 列过滤时**写入侧先自愈该列**。
- 回读 questions 重算完整性的 SELECT **必须带 `parent_stem`**；引图判据只此一处，禁止另写正则。
- **多小问大题的 `parent_stem` 三处硬约束**（2026-09-20 第19题事故）：① 重算 SELECT 必带；
  ② **答案引擎输入必须拼它**（`worker.js` `content = [q.parent_stem, q.content].join('\n')`），
  只喂 `q.content` 会让条件在公共题干里的题被判「缺少条件」→ `answer` 永久留空；
  ③ 写入侧 `looksLikeLostParentStem`（`server/utils/parentStemTrust.js`）**只告警不拦截**
  （全库 14 命中 / 7 真 7 假，假阳性是「两个各自完整的小问」）。
- **答案引擎输入必须与生产逐字同构：`parent_stem` + `content` + `options` 三样都要**
  （2026-09-21 存量重跑 25/50 伪分歧事故）。生产 `worker.js:1963-1965`：拼 parent_stem 后
  再 + `'\n选项：' + formatOptionsForPrompt(options)`。**任何绕过 worker 直接调答案引擎的脚本
  都必须复用这段口径**，最好抽 `buildEngineInput(q)`。漏 `options` → 模型看不到 A/B/C/D 却被告知
  「只返字母」→ 盲猜，把正确字母答案被当成「字母 vs 内容」伪分歧覆盖成选项正文。
- **批量改写库内答案前，必须先小批（15–30 条）dry-run 冒烟**：验 ① 新答案是不是模型退让
  （`待人工补充`，退让绝不能覆盖也不能投票）② 旧值是否带叙述尾巴 ③ 非等价率（>40% 先怀疑自己）。
- **残题分组键必须含 `page_number`**（2026-09-20 存量 484 条事故）：按 `(task_id, question_number)`
  会跨页撞车；含页后 109 组/299 条为真候选。**同页题号撞车组禁用公共题干兜底**（跨题共用=造假）。
  **读取侧同族事故（2026-09-21 白板第125题杂交题）**：`buildCompleteQuestion`（weekendHandout.js ↔
  weekend-handout.mjs）的小问索引仍按 task#number 分组，跨页撞号时题干/答案/选项三处各取自不同题。
  已加护栏：组内「整题行」（sub_no=NULL）≥2 且内容互不相同 → 放弃合并回落 rep 自身（`numberCollision`），
  并禁用 figureByQGroup 邻题配图兜底；小问行跨页的 5 个合法组不受影响。护栏有回归测试锁定。
- **残句小问号判定定稿**（`scripts/fix-subno-parent-stem-20260920.mjs`）：① 行首 `(N)` 最权威
  （整行只一个顶层 `(N)`，排除「第(N)题」引用；一行并两小问拒绝）② OCR 匹配值 ③ 圈号/图号兜底；
  每级过组级 usedSubNo 去重闸；**不认行首 ①/② 为顶层标号**。原则：**宁可留空，不填错标号**。
- **「题目完整」是跨管线不变量**，general / workbook 两管线规则必须一致
  （用户拍定「一切走日常路线，减少老师学习成本」）。日常闸 = 候选 `is_correct===false || answer_source==='blank'`
  + `checkQuestionCompleteness(q).isComplete` + 入册前 `syncQuestionCompleteness`；
  `missing_answer` 由候选筛选天然豁免，**不为练习册另写豁免规则**。
  练习册 `addSelfContainedWrongQuestion` 已补完整性闸 + 入册前 `syncQuestionCompleteness`
  （否则重演 2026-09-11 写入成功但列表按 is_complete=TRUE 看不见）。
- **配图 A/B 已统一（2026-09-21）**：A = `questions.geometry_image_url`（图形元素）两管线都采集；
  B = `wrong_questions.question_image_url`（整题裁片）**已整体下线**。三类图别混：
  配图 A / 整题裁片 B（已废）/ 留痕整页原图 `tasks.images`。课件白板题图只认 A（`figure`），没有就不显示。
- ⛔ **禁止用「`image_bbox` 与 `block_coordinates` 互比」判配图归属**（假阳性~28%）。
- ⛔ **禁止用 `block_coordinates` 定位题目区域**：不是错位是「没量」——模型按题数均分占位框。
  只当纵向区段粗线索，裁图前过 `server/utils/blockBoxTrust.js` 两道闸；**宁可不出图，不显示邻题的图**。

## 2. 选择题选项

- 新增/修改任何 OCR prompt 必须确认带 `options` 字段（练习册两条 prompt 曾漏）。
- 渲染守卫：有选项 且 题干未内联 ≥2 个 A–D 标号（`hasExplicitOptionMarkers`）；短选项两列、长选项单列。
- 图形选项写 `["选项A图",…]`，**绝不能因是图就留空**。
- 存量补全 `backfill-choice-options.mjs`（默认 dry-run）**默认 `--mode=page`**；魔搭耗尽时 `--vendor=Huihuiyun`。

## 3. 视觉模型

- `noBackup:true` = 禁止静默降级弱备份模型。答案页 OCR、单题重识别**已锁**；主 OCR 与练习册**未锁**（未决策）。
- 供应商可用性**必须逐个实测**（`_visionVendorProbe.mjs` 必须传 `imageDataURL`）。
- **Gemini 直连暂不启用**（免费档 20 次/天/模型）。区分分钟窗/按天只能看 `quotaId` 的 `PerMinute`/`PerDay`。
- 限流安全网：`aiProviderRetry.js` 包住 `geometryWorker.js` 三处视觉调用；429 退避须 ≥60s。
- 辉辉云换 key 必须同步改 `config/ai.js` 的 `Huihuiyun.vlModels`；后备模型**只能当文字 OCR 兜底**。
- 答案引擎兜底 key 可能早已被禁用 → 换 key 后**必须实测**（`/v1/models` + 单轮对话），别只看 .env。

## 4. 几何重画

- 几何题**强制走 DSL 构造式通道**（`forceDsl`，`=0` 仅诊断）；旧 JSON 目测通道不再出图。
- DSL 成功后**必须直接用 `correctDslByVision` 返回的 `structure`**，禁止 `executeDsl(dsl)` 二次执行。

## 5. 本地开发环境（硬纪律）

- ⛔ **入口文件第一行必须是 `import './loadEnv.js'`**（`server/loadEnv.js`，2026-09-21 事故）：
  ESM 静态 import 早于模块体，把 `dotenv.config()` 写在模块体 → 模块级 env 全拿 undefined 走默认。
  后果：`.env` 写 Bailian 后端实际跑 SenseNova，**切换从未生效**（线上 Render 不受影响）。
  **验证配置改动必须验入口进程**（看启动日志 `🧠 [Answer Engine] 启用 → …`），不能只验 `await import()` 脚本。
- 后端 `node server/index.js` → **4000**（**内嵌 BullMQ worker**，重启即对批改链路生效，须 Redis 6379 先跑）；
  前端 `npm run dev` → **3000**（`/api` 代理 4000）。**起后端只用 Bash 后台任务**，`curl` 验证加 `--noproxy '*'`
  （绕过代理会拿假 502）。详见 `topics/local-dev-process`。
- ⛔ **判「有/无」「是不是」的高风险结论，检索管道里不许出现 `head`**（2026-09-21 踩两次：
  `head` 截断导致误判「影响眼为零」、TIME_WAIT 占满前 4 行误判「端口没监听」）。
  必须用不带截断检索 + 至少一次全量验证支撑。
- ⛔ **`Edit` 报成功不等于落盘**：关键行改完立刻 `grep -c` / `node --check` 复核。
- 数据库串在 `server/.env` 的 `NEON_DATABASE_URL`；只读探针写 `server/_diag_*.mjs`，
  `dotenv.config({ path: 'D:/Minxue_App_V3/server/.env' })` 直跑。
- Vite 预构建缓存清理被安全删除拦截 → 把 `node_modules/.vite` 改名 `.vite.stale-<时间戳>`。
- Vue SFC 改动后跑 `_sfc_check.mjs <file.vue>`；本机**无 PIL**，裁页图用 `_crop_page_image.mjs`。

## 6. 答案库信任 / 答案引擎

- `processWorkbookGrading`（`worker.js:4377`）**从不读 `r.answer_status`**，而 `processAnswerBankGrading`（`:5513`）**有**
  → 未审核答案库被判分 → 假红叉。**改练习册判分前先想清要不要对齐两条管线。**
- `PUT /api/questions/:id` 已按 `answerRewritten` 清 `ai_answer_risk_reason` / `answer_exception*`。
- **答案引擎降级链**（详见 `topics/answer-engine-fallback-chain`）：主供应商 Key 池 × `[MODEL,...FALLBACK_MODELS]`
  → `FALLBACK_VENDORS` → 通用文本链路。当前（2026-09-21 用户拍定，提交 `de3f569`）=
  `Bailian:[qwen3.8-flash → deepseek-v4-pro → qwen3.8-max]` → `SenseNova:deepseek-v4-pro`
  → `Huihuiyun:deepseek-v4-flash`（开思考）→ 通用链路。
  顺序理由：Bailian 付费**不被免费额度打满影响** → SenseNova 免费**可用就用** →
  Huihuiyun 开思考后正确率达标但**速度不行**，故放链尾。
  ⚠️ **备用供应商必须写 `Vendor:model`** —— 供应商 `textModel` 是给**通用文本链路**挑的，
  未必适合出标准答案（SenseNova 的 textModel 只 7/12）。只写 `SenseNova` 会拿 58% 正确率的模型顶参考答案。
  ⚠️ **extraBody 必须走 `resolveModelExtraBody(vendor, model)`**，不能裸用 `vendor.extraBody` ——
  那是**供应商级**字段、常是给某个特定模型打的补丁，套到外部模型上就是孤儿配置（已发生两次）。
  ⚠️ 备用通道 `retry429:false`（辉辉云上游限流时重试合计 ≈59s 才拿到 429，实测 3/3）。
  「降级到弱模型」这条路径**没删**，只是移除了原来的触发源；**Bailian 额度触顶仍会走到它**。
  ⚠️ **`server/.env` 不入库（`.gitignore:39`）→ 线上 Render 必须手动配**这四个 `ANSWER_ENGINE_*`，
  否则线上仍走代码默认值（`SenseNova` / `Huihuiyun`）。
- ⚠ 起临时实例验证**必须把 `REDIS_URL`/`REDIS_POOL_URLS` 指向不存在端口**，否则抢生产队列。
- **`answerConsensus` 只服务答案引擎内部多路采样共识**（`worker.js:100` → `generateAnswerForQuestion`），
  **不参与学生判分**（`judgeService.js` 未引用）。改归一化前先 `npm test`（1045 条）。
  投票口径：`±10` 与 `10` 判为**不同**答案；采纳哪路答案就**连带用那一版解析**。
- **答案质量 = 用没用上强模型，不是判据问题**（2026-09-21 实测）：SenseNova rpm 打满 →
  静默降级 `Huihuiyun:deepseek-v4-flash`，同题 10 采样错答率 40%；Bailian deepseek-v4-pro 3/3 全对。
  **判可信度先看 `result.engine`，别只看答案值。**
- 多路投票治不了系统性偏差（40%→~35%），价值是「标出不可靠」不是「让答案变对」；
  429 会把全局 AI 信号量压到并发 1 → 三路串行 → 单题 140–230s。
- ⛔ **别用 `aiParseSelfCheck` 筛「自相矛盾的那路」**：判据把 `36+64=100` 与答案 `±10` 直接比，
  不认识「100 的平方根」变换，会把**正确的那路也筛掉**（实测自洽子集 0/3）。
- **答案引擎主供应商已切 Bailian（2026-09-21）**：`.env` `ANSWER_ENGINE_VENDOR=Bailian` +
  `ANSWER_ENGINE_MODEL=qwen3.8-flash`，降级链 `deepseek-v4-pro → qwen3.8-max`；`maxTokens` 2048→4096。
  ⛔ **切供应商必须处理 `ANSWER_ENGINE_KEYS`**（语义是主供应商同账号额外 Key）：
  切 Bailian 后原 SenseNova key 会被当 Bailian key 打 token-plan 域名 → 每题先 401 空转再降级，
  本次已注释停用该行（原值留注释，回滚去 `# `）。
- **确定性题型必须独立于模型做硬校验**（2026-09-21 √7>3 事故根治）：新增
  `server/utils/comparisonAnswerVerifier.js`（`verifyComparisonAnswer`，自带受限求值器 `safeEval`），
  在 `worker.js` 答案引擎落库点 **AI 生成 + 缓存命中两路径**都加闸 —— 比较大小结论与数值求解不符
  即清空 answer + 标异常 + 转人工，**绝不写错答案**。`describeReferenceAnswerRisk` 只对算式、对自然语言反差不敏感。
- **Token Plan Lite = 2,500 Credits / 7 天**（39 元/月，触顶即暂停、余额不结转）；Credits 无法从 API 读，
  只能从控制台用量详情读。`qwen3.8-flash` 7 天约 155–276 Credits（6–11%✅）；`deepseek-v4-pro` 约 1,718–3,067（超额度⚠️）。
  ⚠️ Token Plan 官方条款**禁止**自动化脚本/后端批量调用，违规可能封 Key；合规替代 = 百炼**按量付费** `qwen3.8-flash` ≈ 6 元/月。
- ⚠️ `server/.env` 是 UTF-8 但中文注释早成 U+FFFD（历史损坏）；改它用原生 Buffer utf8 + round-trip 校验 + 备份。

## 7. 其他硬约定

- 错题「同一题」判定统一走 `src/domain/questionIdentity.js`，禁止相似度阈值合并。
- 产品口径「只练错题」：变式题不进重练卷与组卷，仅作讲义素材。
- 练习册答案解析质量闸（AGENTS.md 第 11 条）：OCR 锁主力模型 + 3 并发 + 文字层门禁 + 控制字符过滤；
  发布 published 必经 `getWorksheetPublishRisk`（blocking→409，须 `force=true`）。
  **新增版式异常只许加规则/加测试，不得放宽或绕行任一门禁。**
- 周末班课件（`lib/weekendHandout.js` ↔ CLI 同构）：课件内同一道题只出现一次，全局跨天合并
  （`mergeKeyOf` = ocrStemKey→normalizeStem→去`_`，长度≥12 闸），跨天共错合并到最晚错题日并累计「共 N 人错」。
- **题目解析入口唯一化（2026-09-21）**：解析只走题干行「解析」按钮（`review/AnalysisSource.vue`，MathRender 弹窗），
  已下线 `QuestionDetailPanel`「查看解析」折叠区、`QuestionEditForm`「AI 解析」输入框。
  编辑表单不再提供解析修改能力；`form.analysis` 仍原样提交，不会清空已有解析；无解析不渲染按钮。
