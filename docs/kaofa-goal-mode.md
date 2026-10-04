# 考法库目标模式手册（2026-10-05 立）

> **目标（长期不变）：老师能按「知识点（考点）」拉出一批题，按「考法」分类，直接送进周末班课件讲。**
> 红线：① 考法 ≠ 形式（选择/填空/解答只是壳，考法是这道题在考哪套动作）；
> ② 挂不上考点的题必须**如实告知**，不许静默丢；
> ③ 知识点树只当骨架，别拿外部词表当匹配面（r142 实测：外部词表只贡献 9pp 覆盖）。

## 一、目标口径（负责人原话，逐条对应）

> 「我的题型库改为我的考法库。要结合知识点！或知识点结合考法。让我能够通过知识点拉出众多题目。
> 然后分类给学生讲题。讲题会通过周末班课件参数里选题，所以那里也应该可以通过考点拉出分类好的题目。」

| # | 诉求 | 落点 | 状态 |
|---|---|---|---|
| 1 | 题型库 → 考法库 | 侧边栏 / 页头 / 全部文案「题型」→「考法」（`AppSidebar.vue`、`QuestionBankWorkbench.vue`） | ✅ 已交付 |
| 2 | 结合知识点（知识点 × 考法） | 考法库新增「按考点选题」模式：选考点 → 拉题 → 看详情 | ✅ 已交付 |
| 3 | 通过知识点拉出众多题目 | `GET /api/teaching-question-types/kp-questions`，父节点递归展开到全部子孙 | ✅ 已交付 |
| 4 | 分类给学生讲题 | 题单按错次/人数排序，右侧详情含错过的学生名单 | ✅ 已交付 |
| 5 | 周末班课件参数页按考点选题 | `WeekendHandout.vue` 新增「考点」树选 + `buildHandout` 支持 `kpIds` | ✅ 已交付 |
| 6 | 考法 ↔ 知识点**多对多**（一个考法跨多个知识点） | 新表 `teaching_question_type_kps` | ⏸ 未做，见第四节 |

## 二、记分板（数据地基，2026-10-05 六遍回填后）

| 指标 | 回填前 | 现在 | 说明 |
|---|---|---|---|
| 数学知识点节点 | 42 | **521**（13 个板块 / 2 层） | 骨架来自 MIT `mewamew/math-atlas` |
| `question_knowledge` 边 | 886 | **6446** | 平均 2.45 个考点/题 |
| 题目考点覆盖率 | 18.5% | **2458/2458 = 100%** | 可关联池内全量 |
| 错题里能挂考点 | — | **770 / 1120**（68.8%） | 74 条无 question_id + 276 条题目在池外 |
| 考法（teaching_question_types） | 41（全 draft/auto） | 41 | 未动数据 |

**「拉出众多题目」实测（120 天窗口，初三）**：

| 考点 | 含子树拉题 | 仅自身 | 课件里命中错题 → 题数 |
|---|---|---|---|
| 函数（父节点，展开 50 个节点） | 120（截断） | 84 | 135/391 → **99 题** |
| 二次函数 | 120（截断） | 120 | 100/391 → **76 题** |
| 勾股定理 | 97 | 97 | 39/391 → **23 题** |

不选考点时全量 391 条错题 → 240 题。**选父节点能拉到的题明显多于仅自身**，子树展开是「众多」的关键。

## 三、改动清单

**后端**
- `server/lib/weekendHandout.js` — 新增 `kpIds` 选项；递归 CTE 展开子树；导出纯函数 `filterRowsByKp`
  （可测）；结果 `scope.kpIds/kpNames`、`stats.kpFilter{matchedRows,droppedRows,unlinkedRows}`。
- `server/routes/weekendHandout.js` — `sanitizeParams` 加 `kpIds`（数组白名单）；
  新增 `GET /api/weekend-ppt/knowledge-points`；导出纯函数 `toTreeSelectOptions`。
- `server/routes/teachingQuestionTypes.js` — 新增 `GET /kp-questions`
  （`kpId` / `includeChildren` / `onlyWrong` / `days` / `limit`）。

**前端**
- `src/workbench/views/QuestionBankWorkbench.vue` — 题型→考法；新增「按考点选题」模式（题目清单 + 详情 + 一键进课件）。
- `src/workbench/views/WeekendHandout.vue` — 参数区加「考点」多选树；URL `?kpIds=` 从考法库跳入；
  预览元信息显示命中条数与「挂不上考点已排除」条数。
- `src/workbench/components/layout/AppSidebar.vue` — 「我的题型库」→「我的考法库」。

**回归锁**：`test/kaofaKpFilter.test.mjs`（8 条，纯函数真跑，不连库）。

## 四、踩坑记录

### A. 挂载路径两套约定（写探针必看）
`teachingQuestionTypes.js` 用相对路径（`router.get('/')`）⇒ 挂 `/api/teaching-question-types`；
`weekendHandout.js` 自带 `/api` 前缀（`router.get('/api/weekend-ppt/chapters')`）⇒ **挂根**。
搞反一律 404（本次实测全 404，浪费一轮）。

### B. 考点 ≠ 章节，别互相替代
章节 = `server/config/textbookCatalog.js` 静态教材目录（OCR/任务名映射）；
考点 = `knowledge_points` + `question_knowledge`（题目实际关联）。
两者**可叠加**（实测：章节「九年级数学」+ 考点「函数」→ 77 题，单独函数 99 题，叠加生效）。

### C. 挂不上考点的题必须说出来
46 条练习册自包含错题 `question_id` 为空，不在 `question_knowledge` 里，筛考点时必然被排除。
`kpFilter.unlinkedRows` 单独计数，前端预览元信息原话提示，**不许静默丢题**。

### D. 子树展开放在 SQL，不在内存
`WITH RECURSIVE` 一次拿全（521 节点里「函数」子树 50 个），别把整棵树拉进 JS 再遍历。

### E. 叶子节点 children 必须是 undefined
`el-tree-select` 收到 `children: []` 会渲染一个永远点不开的展开箭头。`toTreeSelectOptions` 已处理并上锁。

### F. 并行赛道冲突（未解）
`WeekendHandout.vue` 属「周末班课件 + 白板」赛道、`QuestionBankWorkbench.vue` 属「PC 工作台」赛道，
本轮因负责人直接指派而动手。已在 `docs/auto/backlog.md` 记提案，验收时请负责人确认赛道归属。

## 五、未做 / 待负责人拍板

1. **`teaching_question_type_kps`（考法 ↔ 知识点多对多）** —— 现在考法只有一个主知识点 `kp_id`，
   「先证直角再求边」这类跨勾股定理+逆定理+直角判定的考法挂不到多个点上。
   不动 `wrong_questions`，新增关联表。
2. **考法命名仍是「知识点 · 形式」**（如「勾股定理 · 选择题方法辨析」）—— 与负责人口径（考法≠形式）冲突。
   改名需要重跑 auto-organize 并处理旧 draft 去重，**未做**。
3. **生产 AI 打标已关闭**（`worker.js` 只走 `classifyQuestionLocally`），考法归纳需要的细粒度标签
   没有新增来源，存量 1368 个细标签是历史数据。要不要恢复，请负责人定。
4. **2 字泛节点吸走题目**（`knowledgeService.js:92` 只要求 `n.length >= 2`）：「平方」153、
   「代数」87、「倍数」55。一行改成 `>= 3` 即可，但属共享服务，需影响分析。
5. **真题语料表 `corpus_questions`**：`examCount`（真题语料）与 `wrongCount`（本班错次）是两个计数，
   真题无学生，`questions.student_id NOT NULL`，不能造影子学生，需要独立表。

## 六、复查工具

| 用途 | 命令 / 文件 |
|---|---|
| 考点覆盖与分布 | `node server/_diag_kp_backfill_verify_1005.mjs` → `_tmp_kp_backfill_report.txt` |
| 列类型 / 错题考点覆盖 | `node server/_diag_kp_cols_1005.mjs` → `server/_tmp_kp_cols.txt` |
| 考法库端到端（真路由 + 真库） | `node server/_diag_kaofa_e2e_1005.mjs` → `server/_tmp_kaofa_e2e.txt` |
| Vue SFC 编译校验 | `node server/_diag_kaofa_sfc_1005.mjs` → `server/_tmp_kaofa_sfc.txt` |
| 回归锁 | `node --test test/kaofaKpFilter.test.mjs` |
| 回滚（回填前） | `node server/_tmp_kp_rollback_1005.mjs --apply` |
