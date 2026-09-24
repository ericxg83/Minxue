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
- ⛔ **「AI 自述缺条件」里有一大半是假的（2026-09-24 下午，重要）**：实测 `parent_stem` **就在库里**、只是当初解析时**没拼进引擎输入** —— 正是 §1 那条「`parent_stem` 答案引擎输入必拼」被违反的存量后果。带题干重跑 **43 条里救回 23 条**，抽验答案全部人工验算正确。⇒ **先查 `parent_stem` 是否非空，再决定要不要归因到「AI 能力」**。
- 存量重跑口径见 §6f。
- 抽取器 `aiParseSelfCheck.js#extractFinalAnswerFromAnalysis` 除显式标签外**必须有填空题末句兜底**（`因此/所以/故/解得/求得 … 数值`，含 `3/2`、`-√2`、`±√2`）。
- ⛔ 抽取结果必过占位串过滤（`待人工补充`/`此为主观题`/`见解析`…），否则污染判分。
- 存量回填 `server/scripts/backfill-extract-answer-from-analysis.mjs`（只从现存 analysis 抽，零引擎调用；默认 dry-run，`--apply` 落库）。回归 `test/aiParseSelfCheck.test.mjs`。

## 6e. 错题入册「补全即补入」（详情 topics/wrongbook-gate-requeue）
- `wrong_no_book` 是**终态** ⇒ 已修：`PUT /api/questions/:id` 独立一段，判据 `server/utils/wrongGateRequeue.js`（唯一口径）。
- ⛔ **红线：手动「本次不加入」绝不自动拉回**。**唯一可靠判据 = `skipReason` 且 `gateAuto===true`**（`WRONG_GATE_AUTO_FLAG`）；只靠 `skipReason` 区分不了来源（手动下拉第 2 项也是 `recognition_error`）。
- 置信度闸不跳过；判错口径与 `wrongBookCompensation.isJudgedWrong` 同源；写库失败上抛；入册后不改 `review_status`。
- ⚠️ 未修的口径张力：`confidence=0` 有两个来源（模型没给 / `answer_exception` 答案不可用），且**补答案不会重置 confidence** ⇒ 永久卡死。

## 6f. 存量缺答案重跑口径（2026-09-24）
- 工具：`server/scripts/rerun-blank-answer-with-figure.mjs`。两阶段用法：dry-run `--out` 出清单 → 人工过一遍 → `--commit <json>` 落库（**零 AI 调用**）。
- ⛔ **`Bailian:qwen3.8-flash` 的并发承受力 = 1**：`--conc 2` 大面积 90s 超时，`--conc 1` 同题 9~19s 完成。批量必须 `--conc 1`。
- ⛔ **防幻觉比对必须用 `isSameAnswerSemantic`（四层判据），不能用 `isSameMathAnswer`** —— 后者会把「run1 给完整证明 / run2 只给结论」「不正确 vs 错误」「带单位 vs 不带单位」「k=-1 vs -1」全判成矛盾。实测 8 条「两次不一致」**8/8 都是误杀**。
- ⛔ **判据刻意保守处走人工清单 `server/scripts/_commit-manual-verified.mjs`**（每条必须写可复核的 `basis`：人工验算算式 或 同题副本交叉验证）。**不得为了多救几条而放宽判据。**
- 中断补救：`_commit-ok-from-log.mjs` 从**运行日志**回收 OK 行落库（`--apply` 是全跑完才统一落库，批跑中断时已验证答案会全丢）。
- 诊断三件套（零 AI 只读）：`diagnose-blank-answers.mjs`（题面缺陷体检）/ `_diag_parent_stat.mjs`（parent_stem 覆盖）/ `_diag_blank_triage.mjs`（按「真实缺什么」精确分类）。
- ⚠️ **同一文件不能并行发多个 `Edit`**：后写的基于旧内容会覆盖前一个，`Edit` 报成功但改动丢失（本轮实测 `const PARENT_FIXABLE` 定义被吞，跑出 ReferenceError）。改完必须 `grep -c` 复核。

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

## 10. 同卷副本交叉验证（2026-09-24，**零 token 补答案的最强路径**）
- **事实**：同一份练习册被不同学生扫描 ⇒ 库里存在多份**同题副本**，有的副本早已有答案。全库 26 条缺答案题存在带答案副本。
  ⇒ 补答案优先级应为：**同卷副本回填 > 文本链重跑 > 读图解题 > 转人工**（前者零 token、零读图幻觉）。
- 工具 `server/scripts/backfill-answers-from-copies.mjs`，四道闸（缺一不可）：
  ① 归一化 content **完全相等**（⛔ `norm()` 必须去掉填空下划线 `_`，否则「…这个数是」与「…这个数是______。」判成不同题）；
  ② 副本答案非空且**不是占位串**（`需依据具体图形确定，故此处标记为待人工补充` / `无法确定，需人工补充题目内容后再作答` —— 抄进 `answer` 会把「缺答案」伪装成「有答案」，**比留空更糟**）；
  ③ **选择题/判断题必须核对选项**（题干同但选项顺序可能不同，抄字母会抄错；⛔ 选项为图/为空时该闸失效，须人工判断）；
  ④ 多副本语义一致（用 `isSameAnswerSemantic`）。
- ⛔ **两个反例必须记住**：
  · **多数票 ≠ 正确**：全库「√9的算术平方根是」6 份副本，**4 份答 `3`（错）**、2 份答 `√3`（对）—— 该题型族引擎系统性把「√X 的算术平方根」算成 √X。
  · **循环引用**：判断「几源一致」必须**剔除本轮自己写入的行**（`95be3595` 的 3 份「一致」里有 2 份是本轮自己落的库）。
- ⛔ **跨 task 借 parent_stem 是错的**：同题号在不同 task 里内容**不同**（实测 32 组同题号，逐字全同 0 组）。只有**同 task 同题号**才能配对。
- 探针 `_diag_cross_copy.mjs --all-blank` 全库扫；`_diag_orphan_stem.mjs` 扫「引导语行被误当独立题目」。

## 11. 读图解题的判幻觉纪律（2026-09-24）
- ⛔ **「两次独立运行一致」不构成证据**：`becce0b7` q#12(2) 批次内两次都给 `40`（过闸落库），第三次给 `32`，且 `analysis` 为空 ⇒ 无从审计。**多子图题上一致可能只是巧合。**
- **可靠手段 = 只转录、不计算**：`server/scripts/_probe-figure-labels.mjs` 让模型逐字转录图上标注（「看」比「算」稳得多），两次内容一致才说明图读得准；`--mode shape` 只描述阴影构成。
  实测靠它定案：图① 底部 1、3；图② 1、3、5、7；图③ 1、3、…、99 ⇒ 三题互洽 `S=2n²` ⇒ **8 / 32 / 5000**，证伪 `40`（2n²=40 ⟹ n²=20 非完全平方）。
- ⛔ **错的答案比空答案更糟**（会拿去判分）⇒ `_commit-manual-verified.mjs` 新增 `OVERWRITE` 纠错覆盖清单，
  每条必带 `wasWrong` 做**条件更新**（当前值与预期不符即停手），并写明「为什么原来的错」。
- `solve-with-figure.mjs` 新增 `--force`（审计已落库答案、与 `--apply` 互斥）与默认落盘明细（**必须含 `analysis`**，否则事后无法复核模型是怎么读图的）。
- ⛔ **「只剩引导语」的行不是题目**（`列式计算。` / `运用适当方法计算。` / `设x是实数…：`）—— 它们是公共题干被单独存成了 questions 行，`answer` 本就该为空，**不该计入「AI 解不出」**，需要的是产品侧标注而非补答案。

