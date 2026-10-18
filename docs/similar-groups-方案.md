# 疑似同类题 → 考法库积累 实施方案（2026-10-18）

> 负责人拍板口径（2026-10-18）：
> 1. 同类判定：**A 字符相似粗分为主 + B 同知识点辅助**
> 2. 练习形式：**以生成重练卷为主**
> 3. P18 人工合并**撤案**（完全重复全库极少）；完全重复数据已单独清理（陈施君 4 组 8 条，见 commit 记录）
> 4. P19/P20 暂缓

## 一、要解决的真实问题

- 错题海里存在**同考法、题面相近**的题（如「√3/3=__」与「√2/4=__」），现系统把它们当独立散题，老师逐条看。
- 完全重复（同一道题多条）极少且已清理；**近似同类**才是主体——它们是考法库的珍贵素材，而非脏数据。
- 现状考法库靠 AI 归纳（花钱、慢、按考点）；字符聚类**免费、快、能发现"你没注意到的同类"**。

## 二、方案骨架

```
错题(wrong_questions)
   │  A 主: 字符相似聚类（normalizeStem + 编辑距离）
   │  B 辅: 同知识点辅助（question_knowledge 同 kp 并入组）
   ▼
疑似同类题组 similar_question_groups（新表，学生维度，status=pending）
   │  老师逐组：确认 / 忽略
   ▼ 确认(confirm)
沉淀为考法 draft（teaching_question_types + examples 挂组内题）→ 复用现有考法库确认/改名流程
   ▼
整组送重练（复用 POST /api/generated-exams，questionIds 取组内错题）或进周末班课件
```

## 三、数据模型（新增 1 张表，纯增量，零改动现有表）

```sql
CREATE TABLE similar_question_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending',   -- pending | confirmed | ignored
  reason      text NOT NULL DEFAULT 'content',   -- content(字符相似) | kp(同知识点)
  title       text,                              -- 自动生成："○○·内容相近 N 道"
  wrong_ids   jsonb NOT NULL DEFAULT '[]',       -- 组内错题 id 快照（学生维度）
  question_ids jsonb NOT NULL DEFAULT '[]',      -- 对应 question_id（重练卷入参）
  question_preview jsonb NOT NULL DEFAULT '[]',  -- 前几道题干预览（列表展示）
  type_id     uuid,                              -- 确认后沉淀成的考法 id
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  ignored_at  timestamptz
);
CREATE INDEX idx_simgrp_student_status ON similar_question_groups(student_id, status);
CREATE INDEX idx_simgrp_status ON similar_question_groups(status);
```

- ⛔ 组表**不删除/不合并/不修改**任何错题记录——完全绕开"禁止相似度自动合并错题"红线。
- 组是**候选快照**（wrong_ids 存 id），确认后真正沉淀走现有 examples 表。

## 四、聚类算法（A 主 + B 辅）

1. 拉取全部非 mastered 错题（含 q_content，JOIN questions）。
2. 排除：已存在于 pending/confirmed 组中的错题（幂等，不重复骚扰）。
3. A 主：同学生内，normalizeStem 后**编辑距离 ≤ 2 且长度差 ≤ 2** 的错题聚为一组（`reason='content'`）。
4. B 辅：同学生内，共享 question_knowledge 中同一 kp 且该 kp 下错题 ≥ 2 的（`reason='kp'`）。
5. 组标题自动生成「学生名 · 内容相近 N 道」。
6. 每道题保留 original 顺序，最多截断组内 20 道（防巨型组）。

## 五、API（挂考法库路由文件，复用 userId 口径）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/teaching-question-types/similar-groups?status=pending` | 列出疑似组（含预览题） |
| GET | `/api/teaching-question-types/similar-groups/:id` | 组详情（全部错题） |
| POST | `/api/teaching-question-types/similar-groups/scan` | 触发一次聚类扫描（免费，幂等） |
| POST | `/api/teaching-question-types/similar-groups/:id/confirm` | 确认：创建考法 draft + examples 挂题，组→confirmed |
| POST | `/api/teaching-question-types/similar-groups/:id/ignore` | 忽略：组→ignored |

confirm 详规：
- 创建 `teaching_question_types`（status='draft', source='auto', kp_id 取组内题最多的知识点, name=组标题, auto_summary 记 action='同类错题组'）。
- 按 r220 机制为组内每道错题建 `teaching_question_type_examples`（source_wrong_question_id=错题 id, snapshot 带 wrongCount）。
- 组.status='confirmed', type_id=新建考法 id。
- 老师随后在考法库现有流程确认/改名/忽略该 draft（复用，不新造）。

## 六、前端（QuestionBankWorkbench.vue 考法库线）

- 考法库 tab 下新增子模式「疑似同类题」（subMode='similar'）。
- 顶部「扫描疑似同类题」按钮 → POST scan → 刷新列表。
- 列表：组标题、学生、题数、前 2 道预览；操作：确认沉淀 / 忽略。
- 确认后弹 toast「已沉淀为考法 draft，可到「待确认」里改名/确认」。
- 「整组送重练」：考法详情挂载后，复用现有重练卷入口（移动端/工作台生成重练卷），questionIds 取 examples。

## 七、不做的事（刻意）

- ❌ 不自动合并错题 / 不删除任何错题记录（红线）。
- ❌ 不自动确认（机器粗分不可靠，最终裁判是老师）。
- ❌ 不接入 AI（零成本聚类；需要语义提纯时可后续叠加）。
- ❌ 不加跨学生组（重练卷是学生维度，跨学生组无练习意义）。
- ❌ 不做组内排序算法（按错次简单排，可后续优化）。

## 八、验证方式

- 迁移：本地跑通 → 台账记录 → 幂等重跑不炸。
- 聚类纯函数单测（不连库）：固定输入 → 期望分组。
- API：scan 后在真库产生 pending 组；confirm 生成考法 + examples；ignore 归档。
- 全量测试 + 构建 + lint（automation 闸）。

## 九、影响范围

- 新增表 similar_question_groups（不动任何现有表/约束/状态机）。
- teachingQuestionTypes.js 加路由（纯新增，不改现有端点行为）。
- index.js 迁移注册列表追加 1 项（幂等）。
- QuestionBankWorkbench.vue 加 1 子模式（纯新增）。
- 【并行 WIP 检查】QuestionBankWorkbench.vue / teachingQuestionTypes.js 无未提交改动；weekendHandout.js 有 M（并行在制，不碰）。