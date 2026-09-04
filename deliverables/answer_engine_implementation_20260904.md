# 答案引擎上线报告：视觉模型只管卷面，DeepSeek V4 Pro 只管解题

日期：2026-09-04
结论：**已实施并完成冒烟验证，4/4 全对，全部命中 `SenseNova:deepseek-v4-pro`，2.9–4.2 秒/题。**

---

## 一、为什么要拆

一次实测把问题钉死了。同一张真实作业页（`debug_images/pdf_2141_page1_z4.png`），
同一视觉模型（`sensenova-6.8-flash-lite`），只换提示词里的答案字段语义：

| | legacy（视觉模型自己解题） | copy_only（只抄印刷答案） |
|---|---|---|
| 输出 token | 1,511 | **1,283（-15.1%）** |
| 总 token | 6,746 | **5,948（-11.8%）** |
| 用时 | 13.4s | **11.8s（-12.0%）** |
| 题目数 | 5 | 5 |
| JSON 合法性 | ✅ | ✅ |

**省 token 只是顺带，真正的问题是准确率。** legacy 模式下视觉模型对第一道题
「若 a÷b=9（a,b 都是正整数），则 a 与 b 的最小公倍数是（ ）」给出的是：

```
answer = "a"      ← 选项正文，不是选项字母
```

判题是按字母比对的（`extractChoiceLetters` / `normalizeChoiceAnswer`），
学生写「A」就对不上「a」这条标准答案 —— 这是会直接判错的缺陷。
而 `copy_only` 模式下 `answer=null`，Step 7 由答案引擎生成，返回的是规范的 `A`。

再加上此前 12 道复杂题基准：

| 模型 | 正确率 | token |
|---|---|---|
| **DeepSeek V4 Pro** | **12/12** | **2,398（最省）** |
| GLM-5.2 | 9/12 | 2,476 |
| SenseNova 6.8 | 7/12 | 2,741 |

以及一个硬约束：**DeepSeek V4 Pro 不支持图片输入**
（实测 400 `Model do not support image input`）。
所以"让 DeepSeek 做视觉"不是效果问题，是能力边界 —— 只能拆成两段式。

---

## 二、改了什么

### 1. `server/config/ai.js` — 新增答案引擎（核心）

新增 `ANSWER_ENGINE` 配置 + `callAnswerEngineCompletion()`：

```js
ANSWER_ENGINE = {
  ENABLED:         ANSWER_ENGINE_ENABLED !== '0',
  VENDOR:          ANSWER_ENGINE_VENDOR || 'SenseNova',
  MODEL:           ANSWER_ENGINE_MODEL  || 'deepseek-v4-pro',
  FALLBACK_MODELS: ['glm-5.2', 'sensenova-6.8-flash-lite'],
  TIMEOUT_MS:      60000,
}
```

调用顺序：`SenseNova:deepseek-v4-pro` → `glm-5.2` → `sensenova-6.8-flash-lite`
→ 通用文本链路 → 抛错（由 worker 转人工复核）。

**为什么不复用 `callTextCompletion` 传 model**：那条链路是
`GMI/MiniMax → 魔搭 → 备用供应商`，而 `TEXT_MODELS` 当前是空数组、
`GMI_FIRST=1` 时又会优先打 GMI —— 指定 `deepseek-v4-pro` 在前几站必然 404，
全是无效往返（实测 legacy 链路 10.5s，答案引擎 3–4s）。答案引擎直连目标供应商。

容错策略：429 允许重试（最多等 8s，额度真耗尽会立即上抛换模型）；
**503 不重试** —— `RETRY_DELAYS_503` 累计可等 245 秒，会把批改卡死在一条链路上。

### 2. `server/config/ai.js` — OCR 提示词不再要求解题

`answer` 字段语义改为：卷面**印刷体**明确给出标准答案（练习册答案栏、卷末参考答案、
题后括号内印刷答案）时照抄，其余一律填 `null`，不自行解题。

同时把在 OCR 阶段已无意义的「易混概念清单」「算术自检」整块移除（prompt 4,893 → 4,062 字符），
但**保留**了防污染规则：红笔批语、学生笔迹、演算中间结果一律不得进 `answer`。

### 3. `server/config/ai.js` — 解题规则迁移到答案引擎

`buildAnswerGenerationPrompt()` 新增：
- 「算术自检」——解析里的算式必须能回算出 answer，代回原题验一遍，做不到就填"待人工补充"
- 「易混概念清单」——平方根 vs 算术平方根（含「√81 的平方根 = ±3」这个真实事故案例）、
  相反数 vs 绝对值、方程的解 vs 不等式的解集、约分 vs 通分、最简分数 vs 真分数、
  取值范围的隐含约束（分母≠0、根号内≥0、对数真数>0）
- 「解析结尾的最终答案必须与 answer 完全一致」

规则跟着真正解题的模型走 —— 这条之前挂在 OCR prompt 上，等于没生效。

### 4. `server/config/ai.js` — 修掉一个线上故障点

SenseNova 的 `textModel` 原本是 `sensenova-6.7-flash-lite`，实测已下线（404 `model route not found`），
意味着 SenseNova 在通用文本链路上整条是失效的。改为实测可用的 `sensenova-6.8-flash-lite`。

### 5. `server/worker.js` — 链路切换 + 来源可观测

- `generateAnswerForQuestion()` 改用 `callAnswerEngineCompletion()`，返回带 `source` / `engine`
- 启动日志打印当前生效的组合（答案引擎 + OCR 模式），线上出问题先看这两行
- `generateMissingAnswers()` 统计并打印答案来源分布与引擎用量，只记模型名与计数，
  **不记题目正文、不记 API Key**

### 6. `server/.env.example` — 新增配置项说明

全部开关都写进了 `.env.example`，带完整注释。

---

## 三、验证结果

**答案引擎冒烟（真实调用，4/4 全对）**

| 题目 | 期望 | 实际 | 用时 | 供应商 |
|---|---|---|---|---|
| 解方程 √(2x-1)=x-2（需验根） | x=5 | ✅ x = 5 | 4.2s | SenseNova:deepseek-v4-pro |
| gcd=12, lcm=252, 一数 36，求另一数 | 84 | ✅ 84 | 2.9s | SenseNova:deepseek-v4-pro |
| √81 的平方根（易混概念陷阱） | ±3 | ✅ ±3 | 3.0s | SenseNova:deepseek-v4-pro |
| 选择题：下列运算正确的是 | C | ✅ C | 3.4s | SenseNova:deepseek-v4-pro |

第三题是关键：这正是 2026-09-03 的线上事故题，视觉模型的家族在这里会答成 `9`。

**降级链路（三个场景全过）**

| 场景 | 期望 | 实际 |
|---|---|---|
| 主模型名不存在 | 降级到 glm-5.2 | ✅ `SenseNova:glm-5.2`，并打印 404 |
| 供应商未配置 Key | 回落通用文本链路 | ✅ `fallback-text-chain`，5.4s |
| `ANSWER_ENGINE_ENABLED=0` | 走改造前逻辑 | ✅ `legacy-text-chain`，10.5s |

**回归**

- 后端 7 个测试文件、143 项断言全部通过
- `worker.js` 从 `ai.js` 导入的 14 个符号全部解析成功
- 两种 OCR 提示词模式渲染结果已逐行核对（JSON schema、规则 11、条件块）

---

## 四、兼容性与回滚

| 关注点 | 处理 |
|---|---|
| OCR 返回 `answer: null` | `coerceAIText(null) → ''`、`isGradingCommentAnswer('') → false`，均安全 |
| 答案留空后判题 | OCR 阶段 `is_correct` 为 pending；Step 7 生成答案后会**统一重判并回写**，不会停在 pending |
| 答案库/缓存优先 | 未改动 —— 缓存命中不消耗答案引擎额度 |
| 已审核的官方/教师答案 | 未改动 —— 答案引擎只补缺失，不覆盖 |
| 人工复核判定优先 | 未改动 —— Step 7 重判前先查 `judgements.manual_review` |
| 异常路径 | 答案引擎全挂 → 保留 OCR 抄到的印刷答案 → 仍为空则转人工复核，**不拿猜测值顶上** |

**一键回滚（无需改代码，改 env 重启即可）**

```bash
ANSWER_ENGINE_ENABLED=0   # 答案生成回到改造前的通用文本链路
OCR_ANSWER_MODE=legacy    # OCR 回到"视觉模型自行解题"
```

两个开关互相独立，可以单独回退其中一项。

---

## 五、遗留风险与下一步

1. **未完成影子对比。** 这是我之前承诺的第 5 步，本次只做到冒烟级。
   建议用 20–30 份真实作业跑一遍，统计两个指标：
   - 标准答案错误率（新链路 vs 旧链路）
   - 批改一致率（与教师人工判定的吻合度）
   日志里已有 `[答案来源]` 和 `[答案引擎]` 两行，可直接拿来统计。

2. **额度风险。** DeepSeek V4 Pro 走 SenseNova 的周额度（图 1 那张）。
   目前缓存命中不消耗，但首次批改大量新题时会集中消耗。
   建议观察一周，若吃紧可把 `ANSWER_ENGINE_MODEL` 换成 `deepseek-v4-flash`（更快更省，需先实测）。

3. **GLM-5.2 降级会出现质量台阶。** 12/12 → 9/12，一旦主模型额度耗尽，
   答案准确率会肉眼可见地掉。降级发生时日志会打印 `[AnswerEngine] ... 失败`，需要盯。

4. **503 不重试的副作用。** 若 SenseNova 频繁 503，会较快滑到弱模型。
   若日志里 503 增多，考虑把 `retry503` 改成只重试 1 次。

5. **MiniMax（GMI）仍在做视觉。** 它的 10 天免费期到期后，
   视觉链会自动回落到魔搭，SenseNova 6.8 作为兜底已就位，无需再改代码。

---

## 六、5 小时重置问题（配额）的解决方案

**问题**：SenseNova 公测额度是「账号 × 5 小时」重置（约 1500 次/5h）。改造后所有标准答案
生成都走 `SenseNova:deepseek-v4-pro`，是当下最热的消耗点，单 Key 必然周期性撞 5h 上限，
届时滑到 glm-5.2（9/12，掉档）。

**解法：多 Key 池 + 按 Key 冷却（已实施）**

1. `ANSWER_ENGINE_KEYS` 逗号分隔的额外 Key（多个免费账号），与供应商主 Key
   （`SENSENOVA_API_KEY`）合并去重，组成 Key 池。
   **N 把 Key = N 倍额度**（1500 → 3000/4500/… 每 5h）。
2. 调用时按 Key 顺序轮询：某 Key 命中 5h 上限（429 `usage exceeds frequency limit`）→
   立即进入**冷却**（默认 5h），换下一把 Key；全部冷却/全失败再回落通用文本链路。
3. 冷却到期（≈5h，对齐 SenseNova 重置节奏）自动复用，**无需重启、无需手动切 Key**。
4. 无效 Key（401/403）直接跳过该 Key 全部模型，不空打。

**配套修复**：`isQuotaExhaustedError` 原正则没覆盖 SenseNova 的 `usage exceeds frequency limit`
（只认 `rate limit`/`daily limit`），会导致 5h 上限被当成瞬时 429 反复重试浪费时间。
新增 `frequency limit` / `exceeds ... limit` / `too many requests` 匹配，使冷却能正确触发。

**验证**（_smoke_multikeys.mjs）**

| 项 | 结果 |
|---|---|
| getAnswerEngineKeys 合并多 Key（1 主 + 2 额外） | ✅ 3 把，去重正确 |
| 识别 "usage exceeds frequency limit" 为配额耗尽 | ✅ true |
| 普通 429 不误判为配额耗尽 | ✅ false |
| 坏 Key(401) 跳过 → 有效 Key 成功生成 | ✅ answer=5 |
| 按 Key 冷却：冷却中返回 true、其它 Key 不受影响 | ✅ |

**怎么用**：在 `.env` 里把多个 SenseNova 免费账号的 Key 填进 `ANSWER_ENGINE_KEYS`，
重启 worker 即可。启动日志会打印 `🔑 [Answer Engine] Key 池: N 把`。

**兜底**：即便所有 SenseNova Key 都冷却，仍会落回 `callTextCompletion` 通用文本链路
（GLM-5.2 等），批改不卡死；只是准确率从 12/12 暂时掉到 9/12，待额度重置自动恢复。

**可选增强（未做）**：同款多 Key 池也可套到视觉 OCR 链（`callVisionCompletion` 目前
每个供应商只认一个 `envKey`），SenseNova 6.8 视觉同样受 5h 上限约束。

## 附：验证脚本

- `_smoke_answer_engine.mjs` —— 答案引擎正确性冒烟（4 道题）
- `_smoke_fallback.mjs` —— 降级与回滚三场景
- `_smoke_ocr_e2e.mjs` —— 真实作业图 OCR 双模式 token/耗时对比
