# 敏学项目长期约定

> 只留硬约定与「不知道就会踩坑」的事实。细节外链 `topics/`。每日过程见 `.workbuddy-ai/memory/YYYY-MM-DD.md`。

## 1. 完整性判定（详情 topics/question-completeness）
- `checkQuestionCompleteness()`（server/utils ↔ src/utils 逐字一致）是唯一判据；`is_complete` 仅缓存、偏保守。
- `parent_stem` 三硬约束：①重算 SELECT 必带 ②答案引擎输入必拼（只喂 content → 条件题判缺条件、answer 永久空）③写入侧只告警不拦截。
- 引擎输入须与生产逐字同构：`parent_stem`+`content`+`options`（漏 options → 字母答案被覆盖成选项正文）。
- 残题分组键必含 `page_number`；同页题号撞车禁公共题干/邻题配图兜底；残句小问以行首 `(N)` 最权威，宁可留空不填错。
- 配图只认 `geometry_image_url`；⛔ 禁 `image_bbox`↔`block_coordinates` 互比判归属（假阳~28%）。

## 2. 选择题选项
- OCR prompt 必带 `options`（图形选项写 `["选项A图",…]`，绝不因是图留空）；存量补全 `backfill-choice-options.mjs`（默认 dry-run）。

## 3. 视觉模型（细节 topics/vision-vendors.md）
- ⛔ 2026-09-22「魔搭欠费」是误判：实为免费额度打满（429 insufficient balance），会自行恢复；09-24 实测两 Key×VL_MODELS 全 200 已恢复。`MS_VISION_DISABLED` 是人工开关（已置回 0）；线上 Render 若配了需手动同步。
- 生产视觉链 = vendorChain 显式链：`ANSWER_PAGE_VENDOR_CHAIN`（qwen3.8-flash@Bailian→kimi-k3@SN）、`WORKBOOK_OCR_VENDOR_CHAIN`（deepseek-flash@SN→qwen3.8-flash@Bailian）。
- ⛔ 判模型能否读图只能实测（input_modalities 撒谎）；400/404 ≠ 下线，用其真支持的接口测；AI 调用必须关代理。
- ⛔ 离线脚本不得用 `noBackup:true`（魔搭已禁用 ⇒ 必然失败）；新增/排查视觉脚本先 grep noBackup。
- 漏裁判据：`image_type IN ('geometry','chart')` ∧ `geometry_image_url IS NULL`（96 条）；⛔ 别用 image_type 非空（'none' 是纯文字题，得 1920 假候选）。

## 4. 几何重画（详情 topics/geometry-pipeline）
- 强制 DSL 构造式通道（forceDsl）；DSL 成功后直接用 `correctDslByVision` 返回的 structure，禁二次 executeDsl。

## 5. 本地开发环境（详情 topics/local-dev-process）
- ⛔ 入口第一行必 `import './loadEnv.js'`（ESM 静态 import 早于模块体）；验配置改动脉只认启动日志 `🧠 [Answer Engine] 启用 → …`。
- 后端 `node server/index.js` → 4000（内嵌 BullMQ worker，重启即生效，须 Redis 先起）；前端 `npm run dev` → 3000。
- ⛔ `Edit` 报成功 ≠ 落盘：关键行改完立刻 `grep -c` / `node --check` 复核；同一文件不能并行发多个 Edit（后写覆盖前一个）。
- ⛔ 后台起服务用 run_in_background 即可，**别加 `&`**（`&` 叠加 run_in_background 会让后端在「Redis 连接池初始化」后退出，2026-09-24 实测）。
- DB 串在 `server/.env` 的 `NEON_DATABASE_URL`；只读探针写 `server/_diag_*.mjs`。⚠️ server/.env 中文注释已成 U+FFFD → 改它用原生 Buffer utf8 + round-trip 校验 + 备份。

## 6. 答案引擎（详情 topics/answer-engine-fallback-chain）
- 当前链路（2026-09-22）：`SenseNova:[deepseek-flash→glm-5.2→sensenova-6.8-flash-lite]`（双 Key）→ BigModel:glm-4.7-flash → Bailian:qwen3.8-flash → Huihuiyun:deepseek-v4-flash → 留空转人工。
- 双 SN Key 独立配额池；轮转 = 模型外层 × Key 内层；`keyDisabledForRun`（本次内判废）≠ `_answerEngineKeyCooldown`（跨调用 5h 冷却）。
- ⛔ 通用文本链路兜底已下线：全链失败返回 `{content:'', provider:'no-channel-available'}` → 转人工。⚠️ `ANSWER_ENGINE_ENABLED=0` 仍走 callTextCompletion（"整个引擎关掉"语义），别误删。
- 备用供应商必写 `Vendor:model`；extraBody 走 `resolveModelExtraBody`；备用通道 retry429:false。
- SenseNova 额度：5h 滑动窗口（限流）+ 周额度。server/.env 不入库 → 线上 Render 须手动配四个 ANSWER_ENGINE_* + 主/次 Key。

## 6b. 确定性校验器（⛔ 三次误清空教训）
- worker.js 落库点（AI 生成 + 缓存命中两路径）加闸：结论与数值求解不符 → 清 answer + 标异常 + 转人工（arithmeticAnswerValidator.js / comparisonAnswerVerifier.js）。
- ⛔ 三次误清空根因同一族 = 「算式抽取不校验完整性」（缺 ^/上标；题干参照分数被当算式；省略号把无穷级数当有限和）。
- 根治 `isCompleteExpression()`：含省略号、以 */^ 开头或任何运算符结尾、括号不配对 → applicable:false 保留答案。
- ⚠️ 前导 +/- 是单元运算符合法（-3.6*10^(-4)），只有 */^ 开头才是真缺操作数；改校验器必跑 `test/arithmeticAnswerValidator.test.mjs`。只许加规则/测试，不得放宽或绕行。

## 6c. 判分器（详情 topics/judge-sign-guard）
- 归一化顺序：`\FRAC{}{}`→`n/d` 必须排在尾标点剥离之前；`extractNumericValues` 必认中文带分数 `N又a/b` 为整体。
- 符号放水窄闸已落地（删符号后两侧相同 + 负号数量不同 + 含非零数字 → 判错）。⛔ 两个解析函数都不能单独改；改判分器：先复制打补丁 → 全库新旧对跑量影响面 → 只翻转可逐条解释的 N 条 → 再改生产。
- ⚠️ 人工真值集有噪声，引用「假错/假对」须说明是含噪上限。

## 6d. 参考答案抽取与显示（2026-09-24「看得到判不出」事故）
- 教师复核页「参考答案」位只能显示 `q.answer`；⛔ 禁 analysis 兜底（空时显示提示，QuestionDetailPanel.vue:125）。
- 该提示成因（全库 125 条实测）：88 占位串「待人工补充」/ 29 缺条件 / 8 抽取器 miss ⇒ 只有 8 条值得回填。⛔ 别一律当 AI 能力问题。
- ⛔ 「AI 自述缺条件」一半是假的：parent_stem 在库里但当初没拼进引擎输入；带题干重跑 43 条救回 23 条（人工验算全对）。⇒ 先查 parent_stem 非空，再归因「AI 能力」。
- 抽取器必须有填空题末句兜底（因此/所以/故/解得/求得…数值，含 3/2、-√2、±√2）；抽取结果必过占位串过滤。
- 存量回填 `backfill-extract-answer-from-analysis.mjs`（只从现存 analysis 抽，零引擎调用，dry-run 默认）；回归 test/aiParseSelfCheck.test.mjs。

## 6e. 错题入册「补全即补入」（详情 topics/wrongbook-gate-requeue）
- `wrong_no_book` 是终态；已修：PUT /api/questions/:id 独立一段，判据 = wrongGateRequeue.js（唯一口径）。
- ⛔ 红线：手动「本次不加入」绝不自动拉回；唯一可靠判据 = skipReason ∧ gateAuto===true（WRONG_GATE_AUTO_FLAG），只靠 skipReason 区分不了来源。
- 置信度闸不跳过；判错口径与 wrongBookCompensation.isJudgedWrong 同源；入册后不改 review_status。
- ⚠️ 未修：confidence=0 两来源（模型没给 / answer_exception 答案不可用），且补答案不重置 confidence ⇒ 永久卡死。

## 6f. 存量缺答案重跑口径（2026-09-24）
- 工具 `rerun-blank-answer-with-figure.mjs`：dry-run `--out` 出清单 → 人工过 → `--commit <json>` 落库（零 AI 调用）。
- ⛔ Bailian:qwen3.8-flash 并发承受力 = 1：`--conc 2` 大面积 90s 超时，`--conc 1` 同题 9~19s。批量必须 `--conc 1`。
- ⛔ 防幻觉比对用 `isSameAnswerSemantic`（四层判据），不能用 isSameMathAnswer（run1 完整证明/run2 结论、不正确 vs 错误、带单位、k=-1 vs -1 全判成矛盾；实测 8/8 误杀）。
- ⛔ 保守处走人工清单 `_commit-manual-verified.mjs`（每条写可复核 basis：人工验算或同题副本交叉验证）；不得放宽判据。
- 中断补救 `_commit-ok-from-log.mjs` 从运行日志回收 OK 行；诊断三件套（零 AI 只读）：diagnose-blank-answers / _diag_parent_stat / _diag_blank_triage。

## 7. 其他硬约定
- 错题「同一题」判定走 questionIdentity.js，禁相似度阈值合并；变式题不进重练卷与组卷，仅作讲义素材。
- 练习册质量闸：OCR 锁主力 + 3 并发 + 文字层门禁 + 控制字符过滤；published 必经 getWorksheetPublishRisk（blocking→409，须 force=true）。新增版式异常只许加规则/加测试。
- processWorkbookGrading 从不读 r.answer_status；processAnswerBankGrading 有 → 未审核答案库被判分产生假红叉。
- 参考答案空值：唯一可信判据 = 数 questions.answer，⛔ 别只看 tasks.last_error；answer_exception_reason 空=静默空，有值=主动丢弃。
- ⛔ 下载 OSS 图片必须禁代理（唯一来源 noProxyHttp.js；回归 test/noProxyDownload.test.mjs 扫描漏带即失败）。
- 题目解析入口唯一化：只走题干行「解析」按钮（review/AnalysisSource.vue）。
- 答案册完整性体检只报内部空洞 + 孤立题号，禁按 1..max(题号) 全量报缺。
- 重练卷答卷（generated_exam_id 非空 或 task_type='wrong_retry'）不是独立作业：题目挂原作业 task，只进「错题重练」入口；识别唯一口径 = retryPaperState.js#isRetryPaperTask，禁各判一套（09-24 分家致 17 条混进「作业批改」下拉）。

## 8. 长耗时接口与错误外露（详情 topics/long-request-and-error-surfacing）
- ⛔ 含 AI/外部服务/长事务的 POST 必须显式 `apiRequest(path, opts, 1)`（默认 3 次重放写操作 + 等待拉到 95s）并放宽 timeout。
- ⛔ 后端错误体契约 `{ error:'<code>', message:'<中文可读>' }`；前端展示一律读 `err?.payload?.message || err?.message`。
- ⛔ pg 的 query 在已建连接上无限等（connectionTimeoutMillis 只管建连）；手动触发类路由必须自带应用层超时。
- DB 故障（503 db-unavailable）与业务失败（502 engine-empty）分开报；结算类后置动作失败只告警，不得吞掉已写库的主结果。

## 9. 缺配图预判闸（2026-09-24，用户要求「缺图就别解析」）
- `figureRequirementGuard.js`：判据 = hasFigureReference(q)（复用 questionCompleteness，绝不自写正则）∧ 无 geometry_image_url；开关 ANSWER_FIGURE_PREFLIGHT_SKIP=0；不是终态，补图后可重算。
- 接线：worker.js#generateMissingAnswers（缓存查找之后、引擎调用之前；配图 URL 必回查 DB，查不到 fail-open 不拦）+ 重解析端点 400 figure-missing。
- 背景：128 条空答案中 25 条「引图无配图」，引擎只有文字题干 100% 答不出（白耗额度与 10~150s）。同类根因还有：选项全空 3 条、漏 parent_stem 9 条、题干截断 8 条、引导句被单独成题、同题干重复 4 份。
- ⛔ 回填写 answer 时必须同时复位 answer_exception=FALSE，只清 reason 会留「有答案却标异常」矛盾行。

## 10. 同卷副本交叉验证（2026-09-24，零 token 补答案最强路径）
- 事实：同一练习册被多学生扫描 ⇒ 同题副本有的早已有答案（26 条缺答案题有带答案副本）。优先级：同卷副本回填 > 文本链重跑 > 读图解题 > 转人工。
- 工具 `backfill-answers-from-copies.mjs`，四道闸：①归一化 content 完全相等（norm 必须去掉填空下划线 _）②副本答案非空且非占位串（抄「待人工补充」比留空更糟）③选择题/判断题必须核对选项（选项为图/空时该闸失效）④多副本语义一致（isSameAnswerSemantic）。
- ⛔ 多数票 ≠ 正确：「√9 的算术平方根」6 份副本 4 份答 3（错）、2 份答 √3（对）—— 该题型族引擎系统性算成 √X。
- ⛔ 判断「几源一致」必须剔除本轮自己写入的行（循环引用）。
- ⛔ 跨 task 借 parent_stem 是错的（同题号不同 task 内容不同，实测 32 组全同 0 组）；只有同 task 同题号能配对。
- 探针：`_diag_cross_copy.mjs --all-blank` 全库扫；`_diag_orphan_stem.mjs` 扫引导语误当独立题。

## 11. 读图解题判幻觉纪律（2026-09-24）
- ⛔ 「两次独立运行一致」不构成证据（becce0b7 批次内两次 40 过闸，第三次 32，analysis 空无从审计）；多子图题一致只是巧合。
- 可靠手段 = 只转录、不计算：`_probe-figure-labels.mjs` 逐字转录图上标注（看比算稳），两次内容一致才说明图读得准；--mode shape 只描述阴影构成。
- ⛔ 错的答案比空答案更糟（会拿去判分）⇒ `_commit-manual-verified.mjs` 的 OVERWRITE 清单必带 wasWrong 条件更新（当前值不符即停手）+ 写明原因为何错。
- `solve-with-figure.mjs` 的 --force（审计已落库答案，与 --apply 互斥）与默认落盘明细必须含 analysis（否则无法复核读图过程）。
- ⛔ 「只剩引导语」的行不是题目（列式计算。/ 运用适当方法计算。等公共题干被单独存行），answer 本就该空，要产品标注而非补答案。
