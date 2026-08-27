# 敏学App V3 - 开发日志

滚动记录已落地的改动与后续待办。新条目放最上面。

---

## 2026-08-28 · 移动端"作业"列表批改结果展示

**改动**：作业列表行摘要由 `6/15 需要关注` 改为 `共15题 · 错6 · 空2`。
- 错用 danger 色、空用 warning 色；计数为 0 的项不显示（纯空卷显示"共22题 · 空2"而非"错0"）。
- 无错无空保留正向文案 `N 道题全部正确`；`ocrTruncated` 保留 `· 可能有漏题` 降级。

**文件**：[src/pages/ProcessingPageV2.jsx](src/pages/ProcessingPageV2.jsx)（新增 `ResultSummary` 组件，读取已下发的 `task.result.emptyCount`）。

**范围**：纯展示层。数据早已落库并随 `/api/tasks/student/:id` 的 `result` JSONB 下发（[server/worker.js:5602](server/worker.js:5602)），未动后端/schema/判题。

**验证**：本地 backend+frontend，test 学生 36 条真实任务，覆盖 有错无空 / 有错有空 / 纯空 / 全部正确 四类，配色与文案正确。

---

## 待办 · 后期需要展示"对题数"（correctCount）

当前列表页刻意**不显示对题数**：`result` 只有 `questionCount / wrongCount / emptyCount`，没有 `correctCount`；若前端用 `总数−错−空` 相减会把两类误算成"对"：
1. 非空但 `is_correct === null` 的无法判定题（答案库无此题等，[server/worker.js:4793](server/worker.js:4793)）→ 静默进"对"。
2. 复核把一道 blank 题改判为 `wrong` 时，`recalculate-stats` 里 `wrongCount` 与 `emptyCount` **同时命中同一行**（[server/index.js:655-659](server/index.js:655)）→ 双重计数，"对"被压低甚至为负。

**正确做法（进入详情页/成长中心时）**：在 `result` 与 `recalculate-stats` 新增权威 `correctCount`，与 wrong/empty 同源同点维护，前端只读不派生。
- 定义建议：`review_status === 'correct'` 或 `is_correct === true` 且 `answer_source !== 'blank'` 且 `review_status !== 'exclude'`。
- 复核回写路径已确认会重算 empty（[recalculate-stats](server/index.js:641)），新增 correct 时一并纳入，保持三者口径一致。
- 改 `result` JSONB 结构需考虑历史数据兼容（旧任务无 correctCount，前端需回退或触发重算）。
