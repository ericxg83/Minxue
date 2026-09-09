# 敏学项目长期约定

## 题目完整性判定：动态口径为唯一真值源

- `checkQuestionCompleteness()`（`server/utils/questionCompleteness.js`、`src/utils/questionCompleteness.js`）是判定"题目是否完整、能否进入错题本重练"的**唯一真值源**。
- `questions.is_complete` 只是它的**反范式缓存列**，不承担业务判定。
  - 原因：questions 表有 20+ 处 UPDATE 写入点，只有 `PUT /api/questions/:id`（server/index.js:1770）会重算该列；答案/选项/几何配图常在入库后被异步补全，补完不回写 → 持久列长期偏旧。
  - 实测（2026-09-08）：全表 584 题中 92 条偏旧，反向 0 条 —— 漂移**单向**（只会偏保守，从不偏宽松），因此放宽到动态口径不会放进任何残题。
- 需要按完整性过滤时：优先用函数现算；若必须用 SQL 列过滤，写入侧要先自愈该列（参考 `POST /api/wrong-questions` 的做法）。
- 已知仍会漂移：`GET /api/wrong-questions/student/:id` 仍按 `is_complete` 过滤（保留列过滤是为了索引性能），靠写入侧自愈兜底；历史数据待全量回填。

## 其他
- 错题"同一题"判定统一走 `src/domain/questionIdentity.js`，禁止相似度阈值合并。
- 当前产品口径「只练错题」：变式题不进重练卷与组卷。
- 练习册答案解析质量闸（通用规则，详见 AGENTS.md 第 11 条）：答案页 OCR 锁主力模型
  （`noBackup:true`）、分批限 3 并发 + 单页重试、文字层质量门禁、渲染层控制字符过滤，
  发布 published 前必经 `getWorksheetPublishRisk` 评估（blocking 即 409 拦截，
  审核页二次确认 + `force=true` 才放行）。新增版式异常只允许加规则/加测试，
  不得放宽或绕行任一门禁。
