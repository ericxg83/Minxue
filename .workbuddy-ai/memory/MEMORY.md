# 敏学项目长期约定

> 只留硬约定与「不知道就会踩坑」的事实。**细节一律外链 `topics/`**：
> `question-completeness`·`geometry-pipeline`·`board`·`answer-bank-trust`·`vision-vendors`·
> `bbox-contract`·`git-commit-discipline`·`frontend-verify-discipline`·`local-dev-process`·
> `answer-engine-fallback-chain`·`judge-sign-guard`·`long-request-and-error-surfacing`·
> `wrongbook-gate-requeue`
> 每日过程见 `.workbuddy-ai/memory/YYYY-MM-DD.md`。

## 1. 完整性判定（详情 topics/question-completeness）
- `checkQuestionCompleteness()`（`server/utils/` ↔ `src/utils/questionCompleteness.js`，两份逐字一致）是**唯一判据**；`is_complete` 仅缓存列、漂移偏保守。
- 多小问大题 `parent_stem` 三硬约束：①重算 SELECT 必带 ②答案引擎输入必拼（只喂 `content` → 条件题被判缺条件、answer 永久空）③写入侧 `looksLikeLostParentStem` 只告警不拦截。
- 答案引擎输入须与生产逐字同构：`parent_stem`+`content`+`options`（漏 `options` → 模型盲猜把字母答案覆盖成选项正文）；绕 worker 的脚本用 `buildEngineInput(q)`。
- 残题分组键必含 `page_number`；同页题号撞车禁用公共题干兜底、禁邻题配图兜底。残句小问号判定以**行首 `(N)` 最权威**，宁可留空不填错。
- 配图只认 A=`questions.geometry_image_url`（B 整题裁片已下线）。⛔ 禁 `image_bbox`↔`block_coordinates` 互比判归属（假阳~28%）；⛔ 禁 `block_coordinates` 定位题目区域，裁图前过 `blockBoxTrust.js` 两道闸。

## 2. 选择题选项
- 任何 OCR prompt 必带 `options`（练习册两条曾漏）。图形选项写 `["选项A图",…]`，绝不因是图留空。存量补全用 `backfill-choice-options.mjs`（默认 dry-run）。

## 3. 视觉模型（**全部细节已迁 topics/vision-vendors.md**）
- ⛔ **2026-09-22「魔搭欠费」是误判**：实为**免费额度被打满**（`429 insufficient balance`），**会自行恢复**；2026-09-24 14:0x 实测两把 Key × VL_MODELS 全 200、真实读图 200/0.9~1.2s ⇒ 已恢复。`MS_VISION_DISABLED`（`server/.env:125`）是**人工**开关，代码对 429 额度只做「冷却到 UTC 当日 24 点」次日重试，**无自动永久禁用**。别再说成"账户欠费"。**✅ 09-24 14:25 已置回 `0` 并验收**（默认链路 `vendorName=ModelScope`）；⚠️ 线上 Render 若也配了该变量需手动同步。
- 生产视觉链 = **vendorChain 显式链**（`config/ai.js` 导出，优先级最高）：`ANSWER_PAGE_VENDOR_CHAIN`（qwen3.8-flash@Bailian→kimi-k3@SN）、`WORKBOOK_OCR_VENDOR_CHAIN`（deepseek-flash@SN→qwen3.8-flash@Bailian）。
- ⛔ 判「某模型能否读图」**只能实测**（`/v1/models` 的 `input_modalities` 会撒谎）；⛔ **400/404 ≠ 模型下线**，要拿它真正支持的那个接口去测；⛔ **所有 AI 接口调用必须关代理**（否则 400 code 11 被误判成模型不存在）。
- ⚠️ 调整视觉质量约束必须 **grep 全库 `noBackup:true`**；换 key 必须同步 `config/ai.js` 的 `vlModels`。选型结论必须标注抓取日期（模型清单会漂移）。
- ⛔ **离线脚本不得再用 `noBackup:true`**（魔搭已禁用 ⇒ 必然失败）：`recrop-missing-figures.mjs` 因此**长期无法补裁配图**，2026-09-24 已改 `vendorChain: WORKBOOK_OCR_VENDOR_CHAIN`。**新增/排查任何视觉脚本先 grep noBackup**。
- 漏裁判据：`image_type IN ('geometry','chart')` ∧ `geometry_image_url IS NULL`（全库 96 条）；⛔ 别用「image_type 非空」当条件（`'none'` 是纯文字题，会得 1920 条假候选）。

## 4. 几何重画（详情 topics/geometry-pipeline）
- 强制走 DSL 构造式通道（`forceDsl`，`=0` 仅诊断）。DSL 成功后**必须直接用** `correctDslByVision` 返回的 `structure`，禁 `executeDsl(dsl)` 二次执行。

## 5. 本地开发环境（硬纪律，详情 topics/local-dev-process）
- ⛔ 入口第一行必 `import './loadEnv.js'`：ESM 静态 import 早于模块体，dotenv 写模块体会导致模块级 env 全 `undefined` 走默认。**验配置改动脉只认入口进程启动日志** `🧠 [Answer Engine] 启用 → …`。
- 后端 `node server/index.js` → **4000**（内嵌 BullMQ worker，重启即生效，须 Redis 先起）；前端 `npm run dev` → **3000**。
- ⛔ `Edit` 报成功 ≠ 落盘：关键行改完立刻 `grep -c` / `node --check` 复核。
- DB 串在 `server/.env` 的 `NEON_DATABASE_URL`；只读探针写 `server/_diag_*.mjs`。⚠️ `server/.env` 中文注释已成 U+FFFD → 改它用原生 Buffer utf8 + round-trip 校验 + 备份。起临时实例验必须把 `REDIS_URL`/`REDIS_POOL_URLS` 指向不存在端口，否则抢生产队列。

## 6. 答案引擎（详情 topics/answer-engine-fallback-chain）
**当前链路（2026-09-22）**：`SenseNova:[deepseek-flash→glm-5.2→sensenova-6.8-flash-lite]`（**双 Key**）→ `BigModel:glm-4.7-flash` → `Bailian:qwen3.8-flash` → `Huihuiyun:deepseek-v4-flash` → **留空转人工**。
- **双 SenseNova Key 是独立配额池**；轮转结构 = **模型外层 × Key 内层**。`keyDisabledForRun`（本次调用内判废）≠ `_answerEngineKeyCooldown`（跨调用 5h 冷却）。
- ⛔ **通用文本链路兜底已下线**（用户拍定）：全链失败返回 `{content:'', provider:'no-channel-available'}` → 转人工，不产错误答案。⚠️ `ANSWER_ENGINE_ENABLED=0` 仍走 `callTextCompletion`（"整个引擎关掉"语义），别误删。
- 备用供应商必写 `Vendor:model`；extraBody 必走 `resolveModelExtraBody`；备用通道 `retry429:false`。
- ⚠️ SenseNova 额度分两段：**5h 滑动窗口**（限流）+ **周额度**；"rpm 429" 仅指前者。
- ⚠️ `server/.env` 不入库 → 线上 Render 须**手动**配四个 `ANSWER_ENGINE_*` + 主/次 Key。
- 判可信度先看 `result.engine`。`answerConsensus` 只服务引擎内部投票，不参与学生判分。

## 6b. 确定性校验器（⛔ 三次误清空事故的教训）
- 机制：worker.js 落库点（AI 生成 + 缓存命中两路径）加闸，结论与数值求解不符即清 answer + 标异常 + 转人工。`arithmeticAnswerValidator.js`、`comparisonAnswerVerifier.js`。
- ⛔ **`arithmeticAnswerValidator` 已三次误清空正确答案，根因同一族 = 「算式抽取不校验完整性」**（缺 `^`/上标；题干参照分数被当算式；省略号 `⋯` 把无穷级数当有限和）。
- **根治**：`isCompleteExpression()` 形态判据 —— 含省略号、以 `*`/`/`/`^` 开头或任何运算符结尾、括号不配对 → `applicable:false` **保留答案**。
- ⚠️ **前导 `+`/`-` 是单元运算符，合法**（`-3.6*10^(-4)`），只有 `*`/`/`/`^` 开头才是真缺操作数。**改校验器必跑 `test/arithmeticAnswerValidator.test.mjs`**。
- 纪律：只许加规则/加测试，**不得放宽或绕行**任一门禁。

## 6c. 判分器（详情 topics/judge-sign-guard）
- 归一化顺序：`\FRAC{}{}`→`n/d` **必须排在尾标点剥离之前**；`extractNumericValues` 必认中文带分数 `N又a/b` 为整体。
- 符号放水通道**已落地窄闸**（「删符号后两侧相同 + 负号数量不同 + 含非零数字 → 判错」）。⛔ 两个解析函数都不能单独改；改判分器纪律：先复制打补丁 → 全库新旧对跑量影响面 → 只翻转可逐条解释的 N 条 → 再改生产。
- ⚠️ 人工真值集有噪声，引用「假错/假对」必须说明是含噪上限。

## 6d. 参考答案抽取与显示（2026-09-24「看得到判不出」事故）
- 教师复核页「参考答案」位**只能显示 `q.answer`**；⛔ 禁再用 `q.analysis` 兜底。`q.answer` 空 + `q.analysis` 非空时显示「⚠ 未提取到参考答案（AI 仅有解析，见题干行『解析』）」（`QuestionDetailPanel.vue:125`）。
- 该提示背后的三种成因（2026-09-24 全库实测 125 条）：**88 条**解析里明写占位串「待人工补充」（AI 真解不出，多为缺配图）；**29 条**明说题目缺条件/无法唯一确定；**8 条**是抽取器 miss（真解出了但没抽到）⇒ 只有这 8 条值得回填。⛔ 别把该提示一律当成 AI 能力问题。
- 抽取器 `aiParseSelfCheck.js#extractFinalAnswerFromAnalysis` 除显式标签外**必须有填空题末句兜底**（`因此/所以/故/解得/求得 … 数值`，含 `3/2`、`-√2`、`±√2`）。
- ⛔ 抽取结果必过占位串过滤（`待人工补充`/`此为主观题`/`见解析`…），否则污染判分。
- 存量回填 `server/scripts/backfill-extract-answer-from-analysis.mjs`（只从现存 analysis 抽，零引擎调用；默认 dry-run，`--apply` 落库）。回归 `test/aiParseSelfCheck.test.mjs`。

## 6e. 错题入册「补全即补入」（详情 topics/wrongbook-gate-requeue）
- `wrong_no_book` 是**终态** ⇒ 已修：`PUT /api/questions/:id` 独立一段，判据 `server/utils/wrongGateRequeue.js`（唯一口径）。
- ⛔ **红线：手动「本次不加入」绝不自动拉回**。**唯一可靠判据 = `skipReason` 且 `gateAuto===true`**（`WRONG_GATE_AUTO_FLAG`）；只靠 `skipReason` 区分不了来源（手动下拉第 2 项也是 `recognition_error`）。
- 置信度闸不跳过；判错口径与 `wrongBookCompensation.isJudgedWrong` 同源；写库失败上抛；入册后不改 `review_status`。
- ⚠️ 未修的口径张力：`confidence=0` 有两个来源（模型没给 / `answer_exception` 答案不可用），且**补答案不会重置 confidence** ⇒ 永久卡死。

## 7. 其他硬约定
- 错题「同一题」判定走 `src/domain/questionIdentity.js`，**禁相似度阈值合并**。
- 产品口径「只练错题」：变式题不进重练卷与组卷，仅作讲义素材。
- 练习册质量闸（AGENTS.md 第 11 条）：OCR 锁主力 + 3 并发 + 文字层门禁 + 控制字符过滤；`published` 必经 `getWorksheetPublishRisk`（blocking→409，须 `force=true`）。新增版式异常只许加规则/加测试。
- 判分器与答案库信任：`processWorkbookGrading` 从不读 `r.answer_status`，`processAnswerBankGrading` 有 → 未审核答案库被判分会产生假红叉。
- 参考答案空值口径：唯一可信判据是数 `questions.answer`，⛔ 别只看 `tasks.last_error`。`answer_exception_reason` 空=静默空，有值=主动丢弃。
- ⛔ **下载 OSS 图片必须禁代理**：唯一来源 `server/utils/noProxyHttp.js`；回归 `test/noProxyDownload.test.mjs` 扫描漏带即失败。
- 题目解析入口唯一化：只走题干行「解析」按钮（`review/AnalysisSource.vue`）。
- 答案册完整性体检（`answerCoverageService.js`）：⛔ 只许报「内部空洞」+单列「孤立题号」，**禁按 `1..max(题号)` 全量报缺**。
- 重练卷答卷（`tasks.generated_exam_id` 非空 或 `task_type='wrong_retry'`）**不是独立作业**：题目挂在原作业 task 上，按 task_id 拉必为空；只进「错题重练」入口（paper 模式，以 `generated_exams` 为源）。识别判据唯一口径 = `retryPaperState.js#isRetryPaperTask`，⛔ 禁各判一套（2026-09-24 分家致 17 条混进「作业批改」下拉 / 8 名学生）。

## 8. 长耗时接口与错误外露（详情 topics/long-request-and-error-surfacing）
- ⛔ **含 AI/外部服务/长事务的 POST 必须显式传 `apiRequest(path, opts, 1)`**（默认 3 次会把写操作重放 + 等待拉到 95s）并放宽 `timeout`。
- ⛔ 后端错误体契约 `{ error:'<code>', message:'<中文可读>' }`；**前端展示一律读 `err?.payload?.message || err?.message`**。
- ⛔ `pg` 的 `query` 在**已建连接**上会无限等（`connectionTimeoutMillis` 只管建连）；手动触发类路由必须自带应用层超时。
- DB 故障（503 `db-unavailable`）与业务失败（502 `engine-empty`）**分开报**；结算类后置动作失败只告警，不得吞掉已写库的主结果。

## 9. 缺配图预判闸（2026-09-24，用户要求「缺图就别解析」）
- `server/utils/figureRequirementGuard.js`：判据 = `hasFigureReference(q)`（**复用 `questionCompleteness.js`，绝不自写正则**）∧ 无 `geometry_image_url`。开关 `ANSWER_FIGURE_PREFLIGHT_SKIP=0`；**不是终态**，补图后可重算。
- 接线：`worker.js#generateMissingAnswers`（插在**缓存查找之后、引擎调用之前**；配图 URL **必回查 DB**，因该函数在落库后运行而内存 q 来自 OCR 阶段；**查不到就 fail-open 不拦**）+ `server/index.js` 重解析端点（400 `figure-missing`）。
- 背景：全库 128 条「answer 空 + analysis 非空」中 120 条解析结论是「待人工补充/无法唯一确定」，其中 25 条是「引图但无配图」——引擎只有文字题干，实测 100% 答不出，白耗额度与 10~150s。
- 同一批的其余根因（**用户点名的三类之外还有**）：选项全空 `["","",""]` 3 条、漏 `parent_stem` 9 条、题干截断 8 条，以及**引导句被单独成题**（「设x是实数。在下列各式后的横线上…」真正的各式在别的题里）、**同题干重复 4 份**、**题干只剩引导语**（「列式计算。」）。
- ⛔ 回填脚本口径：写 `answer` 时必须**同时复位 `answer_exception = FALSE`**，只清 reason 会留下「有答案却标异常」的矛盾行（周末课件读该列）。
