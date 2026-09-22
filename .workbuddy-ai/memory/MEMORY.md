# 敏学项目长期约定

> 只留硬约定；细节见 `topics/`：`question-completeness`·`geometry-pipeline`·`board`·`answer-bank-trust`·`vision-vendors`·`bbox-contract`·`git-commit-discipline`·`frontend-verify-discipline`·`local-dev-process`·`answer-engine-fallback-chain`

## 1. 完整性判定
- `checkQuestionCompleteness()`（`server/utils/`↔`src/utils/questionCompleteness.js`，两份逐字一致）是唯一判据；`is_complete` 仅缓存列、漂移偏保守，SQL 过滤时写入侧先自愈。
- 重算 SELECT 必带 `parent_stem`；引图判据只此一处。
- 多小问大题 `parent_stem` 三硬约束：①重算 SELECT 必带 ②答案引擎输入必拼它（`worker.js` `content=[q.parent_stem,q.content].join('\n')`，只喂 content→公共题干条件题被判缺条件、answer 永久空）③写入侧 `looksLikeLostParentStem`（`server/utils/parentStemTrust.js`）只告警不拦截。
- 答案引擎输入须与生产逐字同构：`parent_stem`+`content`+`options`（生产 `worker.js:1963-1965` 拼 parent_stem 后 + `'\n选项：'+formatOptionsForPrompt(options)`）；绕 worker 的脚本抽 `buildEngineInput(q)` 复用。漏 options→模型盲猜把字母答案覆盖成选项正文。
- 批量改写库内答案前先小批(15–30) dry-run 冒烟：验①是否模型退让(`待人工补充`绝不覆盖/投票)②旧值叙述尾巴③非等价率(>40%先疑己)。
- 残题分组键必含 `page_number`（按 task#number 跨页撞车）；同页题号撞车禁用公共题干兜底。读取侧白板125题杂交：组内整题行(sub_no=NULL)≥2且互异→放弃合并回落 rep 自身(`numberCollision`)并禁 figureByQGroup 邻题配图兜底（护栏有回归测试）。
- 残句小问号判定(`scripts/fix-subno-parent-stem-20260920.mjs`)：①行首`(N)`最权威(排除「第(N)题」引用、一行两小问拒绝)②OCR值③圈/图号兜底；每级过 usedSubNo 去重闸；不认行首①/②为顶层。宁可留空不填错。
- 「题目完整」跨管线不变量：general/workbook 规则一致(走日常路线)。日常闸=候选`is_correct===false||answer_source='blank'`+`checkQuestionCompleteness(q).isComplete`+入册前`syncQuestionCompleteness`；`missing_answer` 天然豁免，不为练习册另写豁免。练习册 `addSelfContainedWrongQuestion` 已补两闸。
- 配图 A/B 统一：A=`questions.geometry_image_url`(图形元素)两管线采；B=`wrong_questions.question_image_url`(整题裁片)已下线；课件白板题图只认 A(`figure`)。
- ⛔ 禁 `image_bbox`↔`block_coordinates` 互比判配图归属(假阳~28%)；⛔ 禁 `block_coordinates` 定位题目区域(模型按题数均分占位框)，只当纵向粗线索，裁图前过 `server/utils/blockBoxTrust.js` 两道闸，宁可不出图不显示邻题图。

## 2. 选择题选项
- 任何 OCR prompt 必带 `options`（练习册两条曾漏）。渲染守卫：有选项且题干未内联≥2个A–D标号(`hasExplicitOptionMarkers`)；短两列、长单列。图形选项写`["选项A图",…]`绝不因是图留空。存量补全 `backfill-choice-options.mjs`(默认 dry-run)默认 `--mode=page`；魔搭耗尽 `--vendor=Huihuiyun`。

## 3. 视觉模型
- `noBackup:true`=禁静默降级弱备份；答案页OCR、单题重识别已锁，主OCR与练习册未锁。供应商可用性逐个实测(`_visionVendorProbe.mjs` 必传 `imageDataURL`)。Gemini 直连暂不启用(免费档20次/天/模型)。限流：`aiProviderRetry.js` 包 `geometryWorker.js` 三处视觉调用，429 退避≥60s。辉辉云换 key 同步改 `config/ai.js` `Huihuiyun.vlModels`；后备只当文字OCR兜底。答案引擎兜底 key 可能已禁用→换 key 后必实测。

## 4. 几何重画
- 强制走 DSL 构造式通道(`forceDsl`，`=0`仅诊断)；旧 JSON 目测通道不再出图。DSL 成功后必须直接用 `correctDslByVision` 返回的 `structure`，禁 `executeDsl(dsl)` 二次执行。

## 5. 本地开发环境(硬纪律)
- ⛔ 入口第一行必 `import './loadEnv.js'`(`server/loadEnv.js`)：ESM 静态 import 早于模块体，dotenv 写模块体→模块级 env 全 undefined 走默认(曾致 .env 写 Bailian 实际跑 SenseNova)。验配置改动脉必须验入口进程启动日志 `🧠 [Answer Engine] 启用 → …`。
- 后端 `node server/index.js`→**4000**(内嵌 BullMQ worker，重启即生效，须 Redis 6379 先跑)；前端 `npm run dev`→**3000**(`/api` 代理4000)。起后端只用 Bash 后台任务，`curl` 加 `--noproxy '*'`。
- ⛔ 判「有/无」「是不是」高风险结论检索管道不许 `head`（截断误判）；须不带截断检索+全量验证。
- ⛔ `Edit` 报成功≠落盘：关键行改完立刻 `grep -c`/`node --check` 复核。
- DB 串在 `server/.env` 的 `NEON_DATABASE_URL`；只读探针写 `server/_diag_*.mjs` 直跑。`server/.env` 中文注释早成 U+FFFD；改它用原生 Buffer utf8 + round-trip 校验 + 备份。起临时实例验必须把 `REDIS_URL`/`REDIS_POOL_URLS` 指向不存在端口，否则抢生产队列。

## 6. 答案库信任 / 答案引擎
- `processWorkbookGrading`(`worker.js:4377`)从不读 `r.answer_status`，`processAnswerBankGrading`(:5513)有→未审核答案库被判分→假红叉。改练习册判分先想清是否对齐两管线。`PUT /api/questions/:id` 已按 `answerRewritten` 清 `ai_answer_risk_reason`/`answer_exception*`。
- 主供应商已切 **Bailian**（2026-09-21 `de3f569`）：`.env` `ANSWER_ENGINE_VENDOR=Bailian`+`ANSWER_ENGINE_MODEL=qwen3.8-flash`，降级链 `deepseek-v4-pro→qwen3.8-max`；`maxTokens` 2048→4096。⛔ 切供应商必处理 `ANSWER_ENGINE_KEYS`（切 Bailian 后原 SenseNova key 被当 Bailian key 打 token-plan 域名→每题先401空转再降级，已注释停用留原值）。
- 降级链(`topics/answer-engine-fallback-chain`)：主 Key 池×`[MODEL,...FALLBACK_MODELS]`→`FALLBACK_VENDORS`→通用文本。当前=`Bailian:[qwen3.8-flash→deepseek-v4-pro→qwen3.8-max]`→`SenseNova:deepseek-v4-pro`→`Huihuiyun:deepseek-v4-flash`(开思考)→通用。理由：Bailian 付费不被免费额度打满影响→SenseNova 免费可用就用→Huihuiyun 开思考正确率达标但慢放链尾。
  - ⚠️ 备用供应商必写 `Vendor:model`（只写 `SenseNova` 会用58%正确率 textModel 顶参考答案）。
  - ⚠️ extraBody 必走 `resolveModelExtraBody(vendor,model)`，禁裸用 `vendor.extraBody`。
  - ⚠️ 备用通道 `retry429:false`（辉辉云上游限流重试≈59s 才得429）。
  - ⚠️ `server/.env` 不入库→线上 Render 须手动配四个 `ANSWER_ENGINE_*`，否则走代码默认(SenseNova/Huihuiyun)。
- 答案质量=用没用上强模型不是判据问题：SenseNova rpm 打满→静默降级 Huihuiyun 同题10采样错答40%；Bailian deepseek-v4-pro 3/3 全对。判可信度先看 `result.engine`。
- 确定性题型独立于模型硬校验：`server/utils/comparisonAnswerVerifier.js`(`verifyComparisonAnswer`+受限求值器`safeEval`)在 worker.js 落库点 AI生成+缓存命中两路径加闸，比较大小结论与数值求解不符即清 answer+标异常+转人工。
- `answerConsensus` 只服务答案引擎内部多路采样共识(`worker.js:100`→`generateAnswerForQuestion`)，不参与学生判分(`judgeService.js`未引用)；投票口径±10 与 10 判不同答案；改归一化前先 `npm test`(1045条)。⛔ 别用 `aiParseSelfCheck` 筛「自相矛盾那路」(会删正确路)。
- Token Plan Lite=2,500 Credits/7天(39元/月，触顶即暂停余额不结转)；Credits 无法从 API 读，只能控制台用量详情读。`qwen3.8-flash` 7天约155–276 Credits(6–11%✅)；`deepseek-v4-pro`约1,718–3,067(超额度⚠️)。⚠️ Token Plan 官方条款禁止自动化/后端批量调用，合规替代=百炼按量付费 `qwen3.8-flash`≈6元/月。

## 7. 其他硬约定
- 错题「同一题」判定统一走 `src/domain/questionIdentity.js`，禁相似度阈值合并。
- 产品口径「只练错题」：变式题不进重练卷与组卷，仅作讲义素材。
- 练习册答案解析质量闸(AGENTS.md 第11条)：OCR 锁主力+3并发+文字层门禁+控制字符过滤；发布 published 必经 `getWorksheetPublishRisk`(blocking→409，须 `force=true`)。新增版式异常只许加规则/加测试，不得放宽或绕行任一门禁。
- 周末班课件(`lib/weekendHandout.js`↔CLI 同构)：课件内同题只出现一次，全局跨天合并(`mergeKeyOf`=ocrStemKey→normalizeStem→去`_`，长度≥12闸)，跨天共错合并到最晚错题日并累计「共 N 人错」。
- 题目解析入口唯一化(2026-09-21)：解析只走题干行「解析」按钮(`review/AnalysisSource.vue`，MathRender 弹窗)，已下线 `QuestionDetailPanel`「查看解析」折叠区、`QuestionEditForm`「AI 解析」输入框；编辑表单 `form.analysis` 仍原样提交不清空；无解析不渲染按钮。
- 判分器归一化(`server/services/judgeService.js`)：`\FRAC{}{}`→`n/d` 转换**必须排在尾标点剥离之前**(剥离字符集含 `}`，整串 `\frac{3}{2}` 会被吃掉右括号 → 分数不转换 → `parseValueWithUnit` 把 `\FRAC{3}{2` 读成 32)；`extractNumericValues` 必认中文带分数 `N又a/b` 为整体 `N+a/b`(否则被拆成 0.5 与 2，叠上「集合兜底允许多 1 值」→ 学生只写 1/2 判对)。
- 改判分器纪律：先复制一份打补丁 → 全库(answer+student_answer 都非空)新旧对跑量影响面 → 只翻转 N 条且逐条可解释 → 再改生产文件；常备只读审计 `server/_diag_judgeaudit_0922.mjs`，定点回写用 `server/scripts/refixJudge.mjs`(走 `finalizeRejudgeResult` 同步 status/错题本/审计)。⚠️ 2026-09-22 审计存量 167 条库内 `is_correct` 与当前判分器不一致(双向，含当前判分器已知放水通道：数字集合兜底吞符号 `答案="2" 学生="-2"` 判对、子集兜底 `答案="x≤2且x≠±1" 学生="x≤2"` 判对) → **禁批量回写**，须先加固放水通道再分方向分批治理。
- 量补丁影响面的唯一工具：`server/_probe_signimpact_0922.mjs`(`--variant=full|surgical|guard` / `--list` 带 question id / `--keep` 留副本供临时替换跑 npm test)。⛔ 必须**同一时点连跑所有变体**取数(生产在跑，全库基数会漂移)；「改公共解析函数」与「加早退分支」blast radius 差一个数量级，**优先后者**。
- 符号放水通道(2026-09-22 **已落地生产**)：`judgeAnswer` 曾对「只差一个负号」的答案一律判对(`-2`/`2`、`-1/2`/`1/2`、`x=-2`/`x=2`、`-√5`/`√5` 共 9/9)。根因：① `parseValueWithUnit` 剥前导运算符时把前导负号一起剥了；② `extractNumericValues` 完全不认符号。⛔ **两个解析函数都不能单独改**：只修①修不掉(命中通道是②)且在长解答题上误翻 2 条(净负收益)；①②都修会误杀约 6 条语义正确的长解答(`y=-(x+1)²` 展开就是参考值，实测 43 条翻转里的误杀)。唯一安全解 = **纯结构窄闸**：插在 `judgeAnswer` 的 `normStudentWhole === normalizeAnswer(referenceAnswer)` 早退**之后**、任何宽松兜底**之前**，判据「归一化后删掉所有正负号字符两侧相同 + 负号数量不同 + 剥符号后含非零数字 → 直接判错」。全库 1912 条只翻转 10 条(全部对→错)、人工真值集假错/假对零变化、符号 9→0；回归测试 `test/judgeService.test.mjs` 的 `sign-only mismatches are judged wrong`，全量 1111 条 0 失败。⚠️ 落闸后库内那 10 条判定仍与判分器不一致(9 条在授权 6 任务外)，回写待批。
- 存量债分类(2026-09-22)：`server/_diag_judgetriage_0922.mjs`(只读) → `_判定存量债-分类清单-20260922.md`。全库 1912 条里**不一致 175 条**(落闸前 167)，按「方向 × 人工真值」分：A-wrong 2｜A-correct 35｜A-unknown 48｜B-correct 35｜B-wrong 11｜B-unknown 44 → **可安全回写 37 条**、**判分器与真值冲突 46 条**。⛔ 方向别搞反：**放水只会让「现判对」**(即库=false 现=true)，不可能出现在「库=true 现=false」里。
- ⚠️ **人工真值集(`review_status`)有噪声，不能直接当判分器准确率的分母**：语义已核实(`server/index.js:1824` `correct→true` / `wrong|wrong_no_book→false`，描述学生答案对错)，但 ① 288 样本里 **7 条自相矛盾**(标 wrong 却 `student_answer` 与 `answer` 逐字相同)——因 **`answer` 会被后续批处理改写**(答案库同步/回填，`updated_at` 远晚于 `created_at`)，复核时的参考与现存的不一定是同一个；② **24 条学生答案为空**(OCR 未识别/真未作答)，若教师标 correct 会被算成判分器假错。用 `server/_diag_judgefpfn_0922.mjs` 取明细；引用「假错/假对」必须说明是含噪上限。
- 判分器已知可修形态(2026-09-22，**未修**)：① **判断题参考答案带引号** —— `judgeAnswer('√','“正确”','fill')=false`(应 true)，`('√','正确','fill')=true`，根因 `normalizeJudgeAnswer` 只 `.trim()` 未剥引号(库内 3 条)；② **参考用省略号写循环/近似小数** —— `('5.2954','5.29545454……')=false` 但 `('3.142857','3.142857142857…')=true`，**同形态一对一错纯碰运气**(库内 10 条)。另有一类「参考答案与题目不匹配」属答案库质量问题，不要改判分器硬修。
