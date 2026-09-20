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
- 练习册自包含错题入册闸**只拦 `missing_options`**，另两条在该管线不成立，拦了是误伤（改前先读 `worker.js` 注释）。
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

## 7. 其他硬约定

- 错题「同一题」判定统一走 `src/domain/questionIdentity.js`，禁止相似度阈值合并。
- 产品口径「只练错题」：变式题不进重练卷与组卷，仅作讲义素材。
- 练习册答案解析质量闸（AGENTS.md 第 11 条）：OCR 锁主力模型 + 3 并发 + 文字层门禁 + 控制字符过滤；
  发布 published 必经 `getWorksheetPublishRisk`（blocking → 409，须 `force=true`）。
  **新增版式异常只许加规则/加测试，不得放宽或绕行任一门禁。**
