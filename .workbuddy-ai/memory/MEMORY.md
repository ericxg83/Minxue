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
