# 敏学识别模型对比测试报告

测试日期：2026-09-04

## 结论先说

**SenseNova 6.8 Flash Lite 值得作为 MiniMax 到期后的第一候选，但目前还不能直接宣布它全面超过魔搭。**

在同一套敏学 OCR 提示词、同一张真实学生作业照片上：

- SenseNova 6.8 Flash Lite：约 17.2 秒，成功返回合法 JSON，识别出 10 题，结构字段完整。
- 魔搭 Qwen3-VL-8B-Instruct：约 61.0 秒，识别出 10 题，结构字段完整。
- SenseNova 的数学答案质量在这张样本上明显好于魔搭 8B，尤其是第 3、6 题；但 SenseNova 仍把第 10 题算错，说明不能只凭单页测试切换生产。
- 魔搭 235B 的同一张手写作业图约 75.9 秒；输出质量看起来比 8B 更强，但返回内容存在字段格式问题，且当前测试遇到过限流。

**建议排序：**

1. 识别/OCR：SenseNova 6.8 Flash Lite
2. 魔搭兜底：Qwen3-VL-235B-A22B-Instruct，其次 Qwen3-VL-8B-Instruct
3. 文本答案/解析：SenseNova GLM-5.2 或 DeepSeek V4 Pro
4. 不用于 OCR：SenseNova U1 Fast、U1.5 Lite，它们是图片生成/编辑模型
5. 暂不推荐：Kimi K3，当前测试受到 RPM 限流，且要求 `temperature=1`

## 测试条件

- 项目：`D:\Minxue_App_V3`
- OCR 提示词：复用 `server/config/ai.js` 中的 `buildOCRPrompt()`，未改业务逻辑。
- 图片样本：
  - `debug_images/pdf_2141_page1_z4.png`：清晰试卷页，原图 2382×3368；魔搭测试前缩放到最长边 1800，避免其 2048×2048 输入限制。
  - `multimodal_exam_engine/real_geometry.png`：真实拍摄、带手写答案和几何图的数学作业页。
- SenseNova：`https://token.sensenova.cn/v1/chat/completions`
- 魔搭：`https://api-inference.modelscope.cn/v1/chat/completions`
- 网络：关闭本机 HTTPS 代理直连测试；代理会把 HTTPS 请求转成错误的 plain HTTP，导致假性 400。
- SenseNova 请求额外使用 `reasoning_effort: "none"`，避免视觉 OCR 把输出额度消耗在推理阶段。

## 视觉 OCR 实测

| 供应商 / 模型 | 样本 | 结果 | 耗时 | Token | 备注 |
|---|---|---:|---:|---:|---|
| SenseNova 6.8 Flash Lite | 手写作业页 | 成功，10 题，合法 JSON | 17.2s | 8,054 | 结构字段完整；数学答案有 1 题明显错误，另有 1 题需人工核验 |
| 魔搭 Qwen3-VL-8B-Instruct | 手写作业页 | 成功，10 题，合法 JSON | 61.0s | 8,871 | 速度慢约 3.5 倍；第 3、6、9、10 题出现答案或推理错误 |
| 魔搭 Qwen3-VL-235B-A22B-Instruct | 手写作业页 | 返回内容，JSON 未通过本地解析 | 75.9s | 7,928 | 输出中出现格式瑕疵；语义能力看起来强于 8B，但受限流影响 |
| SenseNova 6.8 Flash Lite | 清晰试卷页，完整 OCR prompt | 一次 429，重试时成功但仅返回简短答案列表 | 62.1s / 2.8s | 失败无 usage；成功 2,931 | 服务忙时会等待约 60 秒；简短 prompt 下没有完整结构化 JSON |
| 魔搭 Qwen3-VL-235B-A22B-Instruct | 清晰试卷页 | 成功，但 JSON 格式错误 | 33.9s | 6,646 | 原始输出把 bbox 写成错误数组格式，不能直接进入敏学解析器 |
| 魔搭 Qwen3-VL-8B-Instruct | 清晰试卷页 | 成功，5 题，合法 JSON | 31.8s | 6,812 | 本样本识别内容基本完整；第 1 题答案疑似错误（应为 a，模型给出 ab） |

### 手写作业页的数学核对

以题面数学关系人工核对：

- 第 3 题：`y=x-2` 与坐标轴交点距离应为 `2√2`。SenseNova 正确，魔搭 8B 给出 `√5`。
- 第 6 题：两直线交于纵坐标 8，应有 `a+b=16`。SenseNova 正确，魔搭 8B 给出 `0`。
- 第 10 题：直线 `l` 经过 `(2,5)` 和 `(1,1)`，应为 `y=4x-3`。SenseNova 和魔搭 8B 都算错，说明当前 OCR prompt 中“识别 + 独立解题 + JSON”一体化会放大复杂题的推理错误。
- SenseNova 第 4、5 题的 `student_answer` 与图片手写内容存在一定不确定性，需用更多带标准答案的样本继续测。

## 文本模型实测

统一题目：一元一次方程、比例、勾股定理三题，要求只返回 JSON 数组。

| 模型 | 结果 | 耗时 | Token | 备注 |
|---|---:|---:|---:|---|
| SenseNova DeepSeek V4 Pro | 成功 | 3.0s | 211 | 三题答案正确，格式可用 |
| SenseNova GLM-5.2 | 成功 | 3.0s | 239 | 三题答案正确，格式可用 |
| SenseNova 6.8 Flash Lite | 成功 | 6.1s | 209 | 三题答案正确，格式可用；同样可做文本兜底 |
| SenseNova DeepSeek V4 Flash | 失败 | 0.1s | - | 当前 workspace allocated quota exceeded |
| SenseNova Kimi K3 | 失败 | 0.2s | - | 先遇到 temperature 限制，改为 `temperature=1` 后又遇到 RPM 限流 |
| SenseNova U1.5 Lite | 404 | 0.0s | - | 不是 chat completions 模型，应走图片生成/编辑接口 |
| SenseNova U1 Fast | 404 | 0.0s | - | 不是 chat completions 模型，应走图片生成接口 |
| SenseNova 6.7 Flash Lite | 404 | 0.0s | - | 当前端点提示 model route not found；不建议配置 |

## 额度与 Token 估算

截图显示：

- 通用 Free 模型池：周额度 600,000 Token；5 小时窗口 60,000 Token。
- Flash-Lite 专属池：周额度 600,000 Token；5 小时窗口 60,000 Token。

按本次真实敏学 OCR 请求估算：

- SenseNova 6.8：约 8,054 Token/页，理论上约 74 页/周，约 7 页/5 小时。
- 魔搭 8B：约 8,871 Token/页，理论上约 67 页/周，约 6 页/5 小时。
- 若只看简短文本任务：SenseNova 6.8/DeepSeek Pro/GLM-5.2 约 209–239 Token/次。

这些是理想上限，不扣除平台其他请求、重试和不同图片尺寸带来的变化。真正省 Token 的重点不是只换模型，而是：

1. OCR 识别和答案生成拆成两步：第一步只识别题目/学生答案，不要求每题长解析。
2. `max_tokens` 按任务类型设置；OCR 只给足结构化 JSON，不要固定放到 8192。
3. 关闭思考模式：SenseNova 已验证 `reasoning_effort=none` 有效。
4. 对整页图片先做最长边 1600–1800 的压缩；魔搭明确限制输入不超过 2048×2048。
5. 低置信度题目才触发局部重 OCR，避免整页重复调用。
6. 题目答案生成、知识点标签和讲解使用文本模型，不要消耗视觉模型额度。

## 对项目接入的注意事项

当前项目已经在 `server/config/ai.js` 里配置了 SenseNova：

- 视觉模型：`sensenova-6.8-flash-lite`
- 文本模型：`sensenova-6.7-flash-lite`，但本次实测该 ID 返回 404，建议改为 `sensenova-6.8-flash-lite`、`glm-5.2` 或 `deepseek-v4-pro`，具体以账号当前可用模型为准。
- 请求已带 `reasoning_effort: "none"`，方向正确。

需要特别修正的兼容点：

- 当前公共请求函数默认发送 `temperature: 0.2`；Kimi K3 明确只允许 `temperature=1`，不能直接复用默认参数。
- U1 Fast/U1.5 Lite 不应放入 chat completions 的文本/视觉轮换队列。
- SenseNova 6.7 当前端点返回 404，不应作为默认文本或视觉模型。
- 生产切换前应增加“模型名称、供应商、耗时、prompt_tokens、completion_tokens、JSON 解析结果、重试次数”的日志，但不要记录 API Key 和完整图片 base64。

## 最终建议

**不要等 MiniMax 到期后才第一次切换。** 建议现在就让 SenseNova 6.8 Flash Lite 在“影子测试”或手动测试开关下跑至少 20–30 张真实样本，与 MiniMax/魔搭结果逐题对齐，统计：

- 题目漏识别率
- 数学符号错误率
- 题号/题型错误率
- 学生答案提取准确率
- 标准答案错误率
- JSON 解析成功率
- 平均耗时、P95 耗时、429 比例
- 平均 Token/页

如果 SenseNova 在真实样本上达到：JSON 成功率 ≥ 99%、学生答案字段准确率不低于 MiniMax、复杂数学题答案错误率明显低于魔搭 8B，才适合在 MiniMax 到期后直接替换。

本轮最稳妥的切换方案是：

```text
MiniMax 到期前：MiniMax 主用 + SenseNova 6.8 影子/手动测试
MiniMax 到期后：SenseNova 6.8 主 OCR + 魔搭 235B/8B 兜底
文本答案生成：GLM-5.2 或 DeepSeek V4 Pro（按实际额度选择）
图片生成模型：U1 Fast/U1.5 Lite 单独保留，不进入 OCR 链路
```

原始逐次测试记录见：`model_compare_raw_20260904.json`。
