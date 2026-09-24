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

## 3. 视觉模型（详情 topics/vision-vendors）
- **2026-09-22 魔搭双 Key 欠费 → `MS_VISION_DISABLED=1` 禁用**（.env，恢复改 0；只影响视觉链路）。生产视觉新链 = **vendorChain 显式链**（config/ai.js 导出，最高优先级）：`ANSWER_PAGE_VENDOR_CHAIN`（qwen3.8-flash@Bailian→kimi-k3@SN，答案页/答案册）、`WORKBOOK_OCR_VENDOR_CHAIN`（deepseek-flash@SN→qwen3.8-flash@Bailian，练习册/定位框/单题重识别）。vlModels=`['deepseek-flash','6.8-lite','kimi-k3']`。⚠️ 调整质量约束必须 **grep 全库 `noBackup:true`**（显式约束的调用点不会自然落到默认链赢家）；魔搭死后 `model:` 锁魔搭模型名会让备份层全部 404。
- `noBackup:true` = 禁静默降级弱备份（**魔搭禁用后此语义已空转**——noBackup 且魔搭不可用 ⇒ 必然失败，存量调用点已迁移 vendorChain，离线脚本除外）。供应商可用性逐个实测（`_visionVendorProbe.mjs` 必传 `imageDataURL`）。换 key 必须同步 `config/ai.js` 的 `vlModels`。
- ⛔ **判「某模型能否读图」只能实测，不信元数据/文档**：SenseNova `/v1/models` 的 `input_modalities` 把 `kimi-k3`、`deepseek-flash` 都标 `in=text`，实测两者喂图都能正确读图（2026-09-22）。该接口实际返回 9 个模型（文档只写 7 个）。能读图的只有 `sensenova-6.8-flash-lite`/`kimi-k3`/`deepseek-flash`。
- ⛔ **400/404 不等于模型下线，必须用「它真正支持的那个接口」去测**：`sensenova-u1-fast`/`u1.5-fast`/`u1.5-lite` 走 `POST /v1/images/generations`（文生图，不能读图），在 `chat/completions` 返 404「model is not found」是正常表现，三者在 image 通道全部 200 可用。（2026-09-22 官方公告：`u1-fast` 将于 9/30 下线，需换 `u1.5-fast`；但敏学全库无任何实际调用，只 `config/ai.js:390` 一行注释。）
- ⚠️ **SenseNova 模型清单会漂移**：9/21 列表含 `u1.5-fast`，9/22 已无。选型结论必须标注抓取日期。
- ⛔ **所有 AI/模型接口调用必须关代理**（`proxy:false, httpsAgent:false, httpAgent:false`）：否则被网关拦成 `400 code 11 OUT_OF_RANGE`，**看起来像「模型不存在」，实际是代理拦截**，极易误判成模型下线。
- ⚠️ **`kimi-k3` 只接受 `temperature:1`**（传 0 → `400 field Temperature invalid`）；它**不接受 `reasoning_effort`**，慢（真实页 ~21s vs 6.8-lite 6.6s）是固有特性。它的价值是**输出干净**（夹带解题过程仅 1/12）+ **读得到单元标题**（4/12）⇒ 答案库首选候选。
- ⚠️ 不关思考（`reasoning_effort:'none'`）会让思考链吃满 `max_tokens` → `content` 空。生产 SenseNova 供应商带该参数是对的。
- ⛔ **视觉横评必用真实页、必带 429 退避 + 间隔≥8s**：连发数十次请求会打爆 tpm/rpm 产生大量「假失败」，**不能归因到模型能力**；合成图快筛结论会被真实页推翻（deepseek-flash 合成图 6/6 全对，真实页夹带过程 12/12）。

## 4. 几何重画（详情 topics/geometry-pipeline）
- 强制走 DSL 构造式通道（`forceDsl`，`=0` 仅诊断）。DSL 成功后**必须直接用** `correctDslByVision` 返回的 `structure`，禁 `executeDsl(dsl)` 二次执行。

## 5. 本地开发环境（硬纪律，详情 topics/local-dev-process）
- ⛔ 入口第一行必 `import './loadEnv.js'`：ESM 静态 import 早于模块体，dotenv 写模块体会导致模块级 env 全 `undefined` 走默认（曾致 .env 写 Bailian 实际跑 SenseNova）。**验配置改动脉只认入口进程启动日志** `🧠 [Answer Engine] 启用 → …`。
- 后端 `node server/index.js` → **4000**（内嵌 BullMQ worker，重启即生效，须 Redis 6379 先起）；前端 `npm run dev` → **3000**。
- ⛔ `Edit` 报成功 ≠ 落盘：关键行改完立刻 `grep -c` / `node --check` 复核。
- DB 串在 `server/.env` 的 `NEON_DATABASE_URL`；只读探针写 `server/_diag_*.mjs`。⚠️ `server/.env` 中文注释已成 U+FFFD → 改它用原生 Buffer utf8 + round-trip 校验 + 备份。起临时实例验必须把 `REDIS_URL`/`REDIS_POOL_URLS` 指向不存在端口，否则抢生产队列。

## 6. 答案引擎（详情 topics/answer-engine-fallback-chain）
**当前链路（2026-09-22）**：`SenseNova:[deepseek-flash→glm-5.2→sensenova-6.8-flash-lite]`（**双 Key**）→ `BigModel:glm-4.7-flash` → `Bailian:qwen3.8-flash` → `Huihuiyun:deepseek-v4-flash` → **留空转人工**。
- **双 SenseNova Key 是独立配额池**（实测：主 key 的 glm-5.2/6.8-lite 报 `tpm exhausted` 时次 key 三模型全通）。`getAnswerEngineKeys()` 只在 key 值相同时去重。
- **轮转结构 = 模型外层 × Key 内层**：`模型 × [主key,次key]` 再降下一个模型。`keyDisabledForRun`（本次调用内判废）≠ `_answerEngineKeyCooldown`（跨调用 5h 冷却）；熔断仅在所有 Key 都判废时触发。
- ⛔ **通用文本链路兜底已下线**（用户拍定）：全链失败返回 `{content:'', provider:'no-channel-available'}` → 判「答案为空」转人工，不再产错误答案。⚠️ `ANSWER_ENGINE_ENABLED=0` 仍走 `callTextCompletion`（"整个引擎关掉"语义），别误删。启动日志须与真实行为一致。
- 备用供应商必写 `Vendor:model`（只写 `Vendor` 会用 58% 正确率 textModel 顶参考答案）；extraBody 必走 `resolveModelExtraBody`；备用通道 `retry429:false`。
- ⚠️ SenseNova 额度分两段：**5h 滑动窗口**（限流）+ **周额度**；"rpm 429" 仅指前者，别误读成额度耗尽。
- ⚠️ `server/.env` 不入库 → 线上 Render 须**手动**配四个 `ANSWER_ENGINE_*` + 主/次 Key，否则走代码默认。
- 判可信度先看 `result.engine`。`answerConsensus` 只服务引擎内部多路投票，不参与学生判分。Token Plan Lite=2,500 Credits/7天，官方禁止后端批量调用。

## 6b. 确定性校验器（⛔ 三次误清空事故的教训）
- 机制：worker.js 落库点（AI 生成 + 缓存命中两路径）加闸，结论与数值求解不符即清 answer + 标异常 + 转人工。两个器：`arithmeticAnswerValidator.js`、`comparisonAnswerVerifier.js`。
- ⛔ **`arithmeticAnswerValidator` 已三次误清空正确答案，根因同一族 = 「算式抽取不校验完整性」**：09-15 缺 `^`/上标被切；09-20 题干参照分数被当算式；09-22 **省略号 `⋯`** → 无穷级数被当有限和（「2⁰+2⁻¹+…+2⁻⁴+⋯」算成 31/16 去比正确解 2/1）。
- **根治**：`isCompleteExpression()` 形态判据（非特例）—— 含省略号、以 `*`/`/`/`^` 开头或任何运算符结尾（缺操作数）、括号不配对 → 一律 `applicable:false` **保留答案**。
- ⚠️ 写此闸踩过的坑：**前导 `+`/`-` 是单元运算符，合法**（`-3.6*10^(-4)` 科学记数法），只有 `*`/`/`/`^` 开头才是真缺操作数。**改校验器必跑 `test/arithmeticAnswerValidator.test.mjs`**（已加 7 条回归），否则修一个误判又引入一个。
- 纪律：只许加规则/加测试，**不得放宽或绕行**任一门禁。

## 6c. 判分器（详情 topics/judge-sign-guard）
- 归一化顺序：`\FRAC{}{}`→`n/d` **必须排在尾标点剥离之前**；`extractNumericValues` 必认中文带分数 `N又a/b` 为整体。
- 符号放水通道**已落地窄闸**（「删符号后两侧相同 + 负号数量不同 + 含非零数字 → 判错」）。⛔ 两个解析函数都不能单独改；改判分器纪律：先复制打补丁 → 全库新旧对跑量影响面 → 只翻转可逐条解释的 N 条 → 再改生产。
- ⚠️ 人工真值集有噪声（`answer` 会被后续批处理改写、学生答案可能为空），引用「假错/假对」必须说明是含噪上限。

## 6d. 参考答案抽取与显示（2026-09-24「看得到判不出」事故）
- 教师复核页「参考答案」位**只能显示 `q.answer`**；⛔ 禁再用 `q.analysis` 兜底（旧 `QuestionDetailPanel.vue` 用 `correct-val` 绿字渲染 analysis → 老师以为有答案，判分侧却因 `q.answer` 空报「缺少参考答案」）。
- 答案抽取器 `aiParseSelfCheck.js#extractFinalAnswerFromAnalysis` 除「答案为/答案是」显式标签外，**必须有填空题末句兜底** `因此/所以/故/解得/求得 … 数值`（含 `3/2`、`-√2`、`±√2`）。⛔ 模型常写「因此减去的数是 55」这种无标签收尾 → 旧正则全 miss → `answer` 落空。
- ⛔ 抽取结果必过占位串过滤（`待人工补充`/`此为主观题`/`见解析`…）：实测 dry-run 多道「答案为 待人工补充」被误抽，入库会污染判分。
- 存量回填 `scripts/backfill-extract-answer-from-analysis.mjs`（只从现存 analysis 抽，零引擎调用；默认 dry-run，`--apply` 落库）。回归 `test/aiParseSelfCheck.test.mjs`。prompt（`config/ai.js`）已强制解析结尾带显式标签。

## 6e. 错题入册「补全即补入」（详情 topics/wrongbook-gate-requeue）
- `wrong_no_book` 是**终态**（`reviewDecision.js` 排除）⇒ P2 门禁自动放行的题补全元素后曾永久卡死。
  现已修：`PUT /api/questions/:id` 独立一段，判据 `server/utils/wrongGateRequeue.js`（唯一口径）。
- ⛔ **红线：手动「本次不加入」绝不自动拉回，但只靠 `skipReason` 区分不了来源** —— 手动弹窗
  「不加入原因」下拉里第 2 项就是 `recognition_error`。**唯一可靠判据 = `skipReason` 且 `gateAuto===true`**
  （`WRONG_GATE_AUTO_FLAG`，自动放行路径才写；存量记录只能由回填脚本 `allowLegacySkip` 处理）。
- 置信度闸不跳过（低置信返回 `skipped`）；判错口径与 `wrongBookCompensation.isJudgedWrong` 同源；
  写库失败上抛；入册后不改 `review_status`。
- ⚠️ 未修的口径张力：`confidence=0` 有两个来源（模型没给 / `answer_exception` 系统侧答案不可用），
  后者被误归入「低置信需老师拍板」，且**补答案不会重置 confidence** ⇒ 永久卡死。

## 7. 其他硬约定
- 错题「同一题」判定走 `src/domain/questionIdentity.js`，**禁相似度阈值合并**。
- 产品口径「只练错题」：变式题不进重练卷与组卷，仅作讲义素材。
- 练习册质量闸（AGENTS.md 第 11 条）：OCR 锁主力 + 3 并发 + 文字层门禁 + 控制字符过滤；`published` 必经 `getWorksheetPublishRisk`（blocking→409，须 `force=true`）。新增版式异常只许加规则/加测试。
- 判分器与答案库信任：`processWorkbookGrading` 从不读 `r.answer_status`，`processAnswerBankGrading` 有 → 未审核答案库被判分会产生假红叉。
- 参考答案空值口径：唯一可信判据是数 `questions.answer`，⛔ 别只看 `tasks.last_error`（会残留上次失败记录）。`answer_exception_reason` 空=静默空（链路没跑完），有值=主动丢弃。
- ⛔ **下载 OSS 图片必须禁代理**：唯一来源 `server/utils/noProxyHttp.js`；新增下载调用点必带，回归测试 `test/noProxyDownload.test.mjs` 扫描漏带即失败。
- 题目解析入口唯一化：只走题干行「解析」按钮（`review/AnalysisSource.vue`），已下线其余入口。
- 答案册完整性体检（`answerCoverageService.js`）：⛔ 只许报「内部空洞」+单列「孤立题号」，**禁按 `1..max(题号)` 全量报缺**（碎片会把 max 抬高 → 幻觉出大批缺口）。

## 8. 长耗时接口与错误外露（详情 topics/long-request-and-error-surfacing）
- ⛔ **含 AI/外部服务/长事务的 POST 必须显式传 `apiRequest(path, opts, 1)`**（默认 3 次会把写操作重放 + 等待拉到 95s）并放宽 `timeout`。
- ⛔ 后端错误体契约定死 `{ error:'<code>', message:'<中文可读>' }`；**前端展示一律读 `err?.payload?.message || err?.message`**——`httpCore` 的 `serverMessage` 优先取 `error` 字段，直接 `err.message` 会显示成错误码或 `Internal Server Error`。
- ⛔ `pg` 的 `query` 在**已建连接**上会无限等（`connectionTimeoutMillis` 只管建连，管不到查询）；手动触发类路由必须自带应用层超时（`DEADLINE_MS` + `done()` 包裹返回点）。
- DB 故障（503 `db-unavailable`）与业务失败（502 `engine-empty`）**分开报**；结算类后置动作失败只告警，不得吞掉已写库的主结果。
