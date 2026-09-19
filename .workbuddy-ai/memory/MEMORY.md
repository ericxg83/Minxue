# 敏学项目长期约定

> 只留仍生效的硬约定 + 判据出处。事故过程见 `YYYY-MM-DD.md`；细节见 `topics/`：
> `question-completeness.md`（完整性/引图/配图）· `geometry-pipeline.md`（几何重画 DSL/函数图象/派生点）·
> `board.md`（白板与题单：布局/全屏/手势/字号/配图口径）· `answer-bank-trust.md`（答案库信任与答案错位）·
> `vision-vendors.md`（视觉模型锁模型策略与供应商选型台账）

## 1. 完整性判定：动态口径是唯一真值源

- `checkQuestionCompleteness()`（`server/utils/questionCompleteness.js` ↔ `src/utils/questionCompleteness.js`，
  **两份必须逐字一致**）是唯一判据；`questions.is_complete` 只是反范式缓存列，漂移单向偏保守。
- 过滤优先函数现算；必须用 SQL 列过滤时**写入侧先自愈该列**。
- 练习册自包含错题入册原先不过闸，2026-09-18 已补，但**只拦 `missing_options`**：另两条在该管线不成立，
  拦了就是误伤（`missing_figure` —— 该管线从不产出 `geometry_image_url`，靠 `wrong_questions.question_image_url` 兜底；
  `missing_answer` —— `answer_source='blank'` 本身就是入册条件）。改这条闸前先读 `worker.js` 注释里的理由。
- 任何回读 questions 重算完整性的 SELECT **必须带 `parent_stem`**；引图判据只此一处，禁止另写正则。
- **⛔ 禁止用「`image_bbox` 与 `block_coordinates` 坐标互比」判断配图归属**（2026-09-18 证伪）：
  上海作业常把多题图集中排成一行、图下印「第N题图」，配图框**必然**落在本题 block 上方，属正常排版。
  该判据假阳性率约 28%，按它做存量回滚会**删掉正确配图**。唯一可靠判据是读图行印刷标注
  （`_diag_figure_label_check.mjs`）；定 block/bbox 谁可信用 `_diag_page_layout_truth.mjs`。
  控制实验必须**固定排版形态**。细节与证据见 `topics/question-completeness.md` §3。
- **⛔ 禁止用 `block_coordinates` 定位题目区域**（2026-09-18 第二轮查清）。它不是"错位"，是**"没量"**：
  模型在相当一部分页面上按题数**均分**，返回等差/等宽/等高的**占位框**。
  铁证（纯算术，无需模型）：`fd8b6bc9` 第1页 12 题 `y = 250,310,370,…,910`，**步长恒为 60、零误差**、
  `width` 全为 800；叠加目检真实题距约 120px 而框距 132px → 页尾偏出约 1.2 题，故"页首几题裁对、
  越往下越裁到下一题"。内容验证：按高换算 **40%** 命中、按宽 **35%** 命中（n=20）→ **换算是伪问题**。
  `worker.js` 的 prompt 里**早就写着**「不能返回均匀递增的占位坐标」但压不住。
  与两处独立历史记录吻合：`weekendHandout.js:268`「逐题下移 1~1.5 题」、
  `backfill-choice-options.mjs:19`「裁出邻题」。
  **合规用法**：只能当"大致在页面哪个纵向区段"的粗线索；任何"裁本题图像"的用途先过
  `server/utils/blockBoxTrust.js` 的两道闸，且**宁可不出图，也不显示邻题的图**。
  护栏必须**写入侧与读取侧共用同一份判据**（否则存量坏数据继续被展示 —— 本轮就是如此）。
- **两道护栏（2026-09-18 已落地）**：① 越界框 `x+width`/`y+height` > 1000
  （`cropAndUpload.isUnreliableBox` 此前只校验左上角 → `y=920,h=300` 被放行 → 裁片是页面底部横条；
  存量 `wrong_questions` **24/125（19%）**命中）；② 整页均分占位（`isPlaceholderBlockBoxes`，
  存量 `questions` **3 页/26 题（1.4%）**，09-15/16/18 各复发一次）。
  读侧 `weekendHandout.resolveWbImage` 两闸都挂，存量拦下 24 条 `wbImage`。
  未决：剩下 81% 不可证明但大概率错的裁片是否干脆不展示 —— **属产品级取舍**。
- **几何重画产物还要查"画残了"**（`clean_geometry_svg` 无任何 `<line|path|polyline|polygon|ellipse>`
  → 批改中心显示近空白图，白板显示裁片，两页不一致）；取图侧已加 `isDegenerateGeometrySvg`，存量 2/43。
- 测试：`test/questionCompletenessParentStem.test.mjs`、`test/wrongBookRisks.test.mjs`、
  `test/geometryDisplayDegenerateSvg.test.mjs`、`test/blockBoxTrust.test.mjs`（20 条，含 4 条源码契约）。

## 2. 选择题选项：必须采集、必须渲染

- **识别侧**：练习册两条 OCR prompt（`workbookPrompt` / `answerBankPrompt`）原先都**没有 `options` 字段**
  → 选项从未采集（2026-09-18 已补）。**新增/修改任何 OCR prompt 必须确认带 options 字段。**
- **渲染侧**：守卫统一为「有选项 且 题干未内联 ≥2 个 A–D 标号（`hasExplicitOptionMarkers`）」；
  短选项两列、长选项单列。已覆盖 `WeekendBoard.vue` 与 `WeekendHandout.vue`。
- **图形选项**写 `["选项A图","选项B图",…]` 或带区分特征，**绝不能因为选项是图就留空**。
- **存量补全** `server/scripts/backfill-choice-options.mjs`（默认 dry-run）：**默认用 `--mode=page`**
  （整页识别比按题裁剪抗 `block_coordinates` 错位；全量 89 道 crop 只补上 33、page 补上 87）；
  魔搭耗尽时 `--vendor=Huihuiyun` 点名兜底（7s，质量最好；BigModel 54s 次之）。
- **现状**：全库选择题 408 道，缺选项 **0 道**。剩 2 道 `question_type='choice'` 卷面其实是**填空题**（题型误标）。

## 3. 视觉模型：质量敏感链路必须锁模型

- `noBackup:true` = 禁止静默降级到弱备份视觉模型。**答案页 OCR、单题区域重识别已锁**；
  主 OCR（`worker.js:1174`）与练习册两处 OCR **未锁**，魔搭耗尽时静默降级 → 丢 `image_bbox`/选项。
  实测漏框率 09-01~09-09 = 0%，09-10 起 42%~100%。**是否给主 OCR 加 `noBackup` 属产品级取舍，未决策。**
- 供应商可用性**必须逐个实测**（`_visionVendorProbe.mjs` 必须传 `imageDataURL`）。
  2026-09-18 实测可用：Huihuiyun / BigModel。
- **Google Gemini 直连（`GEMINI_DIRECT`）—— 2026-09-19 实测后决定「暂不启用」，几何重绘仍由辉辉云承担。**
  代码已就位但**默认关闭**：需 `GEMINI_DIRECT_ENABLED=1` **且** `GEOMETRY_VISION_VENDOR=GoogleGeminiDirect` 两处都开。
  **⛔ 决定性依据：免费档是「按项目 × 按模型 × 按天」配额** —— `gemini-3.8-flash` 的
  `quotaId=GenerateRequestsPerDayPerProjectPerModel-FreeTier`、**limit=20 → 20 次/天**（另 5 RPM）。
  DSL 闭环每图 ~2.5 次调用 → 每天最多 ~8 张图，105 张回填要 ~13 天，**覆盖不了稳态 4–20 张/天**。
  **判据铁律**：区分「分钟窗/按天」**只能**看 `details[].QuotaFailure.violations[].quotaId` 的
  `PerMinute` / `PerDay`；**body 里的「Please retry in Ns」不可信**（按天耗尽同样给「retry in 12.3s」）。
  配置：env 名 `GEMINI_API_KEY` / `GOOGLE_API_KEY` / `MODEL_GIMINI`（三者等价）；
  模型 `GEMINI_DIRECT_MODEL`（默认 `gemini-3.8-flash`，原写死的 `2.5-flash` 已下架 404）。
  **本地必然连不上**：`requestGemini*` 显式 `proxy:false`，不认 `HTTP_PROXY`；本地自测用
  `GEMINI_DIRECT_BASE_URL` 指向 `scripts/_diag_gemini_socks_bridge.mjs`（http→socks5 10808→Google）。
  Pro 类 `free_tier` limit=0 全不可用。详见 `_几何重绘低速通道设计-20260919.md`（含落地清单）。
- **几何链路的「限流安全网」（2026-09-19 新增，与供应商无关，建议长期保留）**：
  `server/utils/aiProviderRetry.js` 包住 `geometryWorker.js` 的**三处**视觉调用点。
  背景：`handleRetry` 里任何异常都会 `retry_count+1`，3 次后写 `tikz_status='none'` =
  **永久放弃重绘、静默回退裁剪原图**；而 429/503 是常态噪声，不该消耗这道预算。
  注意 `classifyLastError`（`pendingTaskRecovery.js:94`）把 **429/quota 归在永久黑名单**（不是 transient），
  且 `scanGeometryAssets` 不调用它 —— 别指望那条链路兜底。429 退避须**跨整分钟窗（≥60s）**。
- **辉辉云一把 key = 一个模型集，换 key 必须同步改 `config/ai.js` 的 `Huihuiyun.vlModels`**，
  否则 404 `not supported by any configured account`。视觉后备选 `qwen3.8-max`
  （必须 `reasoning_effort:'none'` + `maxTokens ≥ 8192` + `timeout ≥ 120s`，缺一即空响应）。
- **后备模型只能当文字 OCR 兜底，不能当配图定位兜底**（IoU≥0.5 仅 38%）；「喂单题区块裁片」
  与「喂整页」命中率持平，该方向已否证。
- → 模型清单、基准表、`backupModelMaxTokens` / `BACKUP_VISION_TIMEOUT_MS`、网关抖动
  见 **`topics/vision-vendors.md`**；选型报告 `_辉辉云后备模型选型-20260918.md`。

## 4. 几何重画 / 函数图象 / 派生点安全网

- **几何题强制走 DSL 构造式通道**（`geometryWorker.js` 的 `forceDsl`，默认强制；`=0` 仅诊断）；
  旧 JSON 目测通道产物与原图不一致，不再作为出图通道。
- DSL 成功后**必须直接用 `correctDslByVision` 返回的 `structure`**（已 normalize + 模型看过对照图），
  禁止 `executeDsl(dsl)` 二次执行。DSL 产物**豁免派生点安全网**；DSL 失败走 `handleRetry`（可重试）。
- → 完整约定见 `topics/geometry-pipeline.md`。

## 5. 本地开发环境

- 后端 `node server/index.js` → **4000**；前端 `npm run dev` → **Vite 3000**（`/api` 代理到 4000）；
  Redis **6379** 必须先运行。**hash 路由**：`http://localhost:3000/workbench.html#/weekend-ppt`。
- 数据库串在 `server/.env` 的 `NEON_DATABASE_URL`（根 `.env` 只有 `DATABASE_URL`）；
  只读探针写 `server/_diag_*.mjs`，用 `dotenv.config({ path: 'D:/Minxue_App_V3/server/.env' })` 直跑。
- **Vite 预构建缓存清理会被安全删除保护拦截**：**不绕过保护**，把 `node_modules/.vite` 改名
  为 `.vite.stale-<时间戳>` 让 Vite 重建。
- Vue SFC 改动后用 `node server/scripts/_sfc_check.mjs <file.vue>` 离线编译校验（比整包 build 快得多）。
- 本机**无 PIL**；需要裁页图局部时用 `_crop_page_image.mjs`（借 Playwright 渲染截图）。

## 6. 前端实测脚本的纪律（2026-09-18 血泪）

- **DOM ↔ 接口对齐必须用稳定钩子，禁止按题干/题号模糊匹配**（题号题干在多套卷子里会重复 → 串题 → 假失败）。
  `.deck-item` 已加 `:data-slide-index="q.index"`；新增可验证列表页照此加钩子。
- **验证脚本的判据必须 import 产品同一份函数**（如 `_verify_handout_options.mjs` 直接 import
  `hasExplicitOptionMarkers`）。另写一份必然漂移，最后变成「脚本说 ✗、页面其实是对的」这种自欺。
- 报 ✗ 时**先逐条看明细再下结论**；截图用 `element.screenshot()` 截到具体条目，不要只截整屏（会停在顶部）。

## 7. 答案库信任策略：两条管线不一致（2026-09-18 发现，未修）

- **`processWorkbookGrading`（`worker.js:4377`）只查 `r.subject`，从不读 `r.answer_status`**
  → 未审核（`answer_status='none'`）的答案库被当权威答案直接判分 → 假红叉 → 错题入册 → 课件显示错答案。
  而 `processAnswerBankGrading`（`worker.js:5513`）**有**这个检查（`none`/`ai_draft` → 降级 general）。
  **改练习册判分逻辑前先想清楚要不要对齐这两条管线的信任策略。**
- 实例：答案库 `f8cf5d96`「九上上海作业答案」单元 `28.1(3)` 的答案与卷面完全对不上
  （卷面 Q5 正确答案 `10/3` 竟躺在别的单元 `30.1(1)`）。
- **已处置（2026-09-18）**：16 条作废转人工（`fix-answer-misalign.mjs`，语义照 refGuard：
  `answer/is_correct/correct_answer` 置空 + `ai_answer_risk_reason` + `status` 同步 + judgements **追加**审计）。
  **`confidence` 不能清空**（否则复核状态落 `processing` 而非 `exception`）。
- **判据缺口未修**：`detectReferenceMismatch`（`judgeService.js:107`）对 `fill` + 单个字母**放行**。
- **闭环已修（2026-09-18，P0）**：`PUT /api/questions/:id` 原先不清 `ai_answer_risk_reason` /
  `answer_exception` / `answer_exception_reason`（`markAiAnswerRisk` / `markAnswerException` 也只有 set、
  `answer_exception=false` 全 server 0 写入点）→ 老师补完答案，「⚠ 参考答案不可信」**永久不消失**。
  现按 `answerRewritten`（写入非空且与旧值不同的 answer）一并清除。
  **补答案后警示还在，先查这三列是否被写回**；验证脚本 `scripts/_verify_answer_risk_clear.mjs`。
  ⚠ 另：起临时实例验证时**必须把 `REDIS_URL`/`REDIS_POOL_URLS` 指向不存在的端口**，
  否则它会 `Worker: 已启动` 抢生产队列、占满连接池。

→ 证据链、影响面、根因两候选、处置记录见 **`topics/answer-bank-trust.md`**。

## 8. 其他硬约定

- 错题「同一题」判定统一走 `src/domain/questionIdentity.js`，禁止相似度阈值合并。
- 当前产品口径「只练错题」：变式题（`variant_questions`）不进重练卷与组卷，仅作讲义素材。
- 练习册答案解析质量闸（详见 AGENTS.md 第 11 条）：答案页 OCR 锁主力模型（`noBackup:true`）、分批限 3 并发 +
  单页重试、文字层质量门禁、渲染层控制字符过滤；发布 published 前必经 `getWorksheetPublishRisk` 评估
  （blocking 即 409 拦截，审核页二次确认 + `force=true` 才放行）。新增版式异常只允许加规则/加测试，
  不得放宽或绕行任一门禁。

## 9. bbox 判据：唯一实现 + 两条已验证的负结论（2026-09-18 夜）

- **`src/utils/questionBbox.js`（parseBbox/unionBbox/clampBbox/getQuestionDisplayBox）是全仓唯一实现**。
  曾有过 4 份分叉（PaperViewerPanel / QuestionDetailPanel / gradingDetailView / backfill），越界处理两两不同，
  同一道题在不同页一个有框一个没框 —— 已全部收敛。**新增/修改任何人用框的逻辑：
  import 共享实现，用 `{allowOutOfRange:true}` 表达宽松策略（绘制路径用严格默认，裁剪预选类显式宽松）。
  禁止再抄一份 parseBbox**。契约测试 `test/questionBboxShared.test.mjs`（13 条）锁死。
- **⛔ 看到 y>1000 的框，不要做「缩放修复」**。曾疑心模型把 y 按图宽归一化（3:4 页图 → 1333），
  聚合实验（`_diag_yscale_score_batch.mjs`，107 页 270 框）**否决**：SPAN=1000 命中 2.63× 基线 > 1333 的 2.50×。
  y 就是 0-1000 图高归一化；个别页坏掉（18/107 页掉到基线水平）按「越界=不可信」护栏拒绝即可，勿全局重算。
- **`text_bbox` 覆盖未修（待决策）**：`worker.js:5260/6340` 把 `text_bbox` 写成 `block_coordinates`
  → workbook 路径前端并集框比 block 还松。改回 `q.text_bbox || null` 属写入侧行为变更，需负责人确认。
  retryAlign 框（答卷 OCR）实测 10% 越界（17/170），成因未定，读取侧保持宽松（框丢了比框歪更伤老师）。
