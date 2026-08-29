# 错题系统

## 错题来源

普通作业批改通过 `addWrongQuestions` 处理错误题目。

通常要求：

- 判题结果为错误；
- AI 置信度达到既定阈值，常见阈值为 `0.8`；
- 题目通过完整性检查；
- 按 `(student_id, question_id)` 去重。

新错题通常使用 `status='pending'`，并将 `error_count` 初始为 `1`。

练习册批改通过 `processWorkbookGrading` 和 `addSelfContainedWrongQuestion` 处理。此类错题可以不依赖 `question_id`，而是保存完整题目内容。

## 「同一题」判定口径

去重与合并统一使用 `src/domain/questionIdentity.js`，前端三端（React 移动端、Vue 工作台错题本、成长中心）不得各写一套。

身份键按优先级取第一个可用值：

```text
qid:{question_id}                        -- 普通错题，对应后端 (student_id, question_id) 唯一约束
ws:{worksheet_id}|p{page}|n{question_no} -- 练习册自包含错题，对应 addSelfContainedWrongQuestion 的自然键
stem:{归一化题干}                        -- 以上两者都缺时的兜底
```

三者皆缺的记录判定为无法定位，直接丢弃，不参与统计。

题干归一化只做无损清理：NFKC 正规化、去 LaTeX 间距命令、去空白、去句读标点、折叠重复下划线与破折号、转小写。数字之间的小数点必须保留（`1.5` 与 `15` 是不同题）。

**判定必须是归一化后精确匹配，禁止按相似度阈值自动合并。** 曾用的 90% 相似度方案已被实测否决：

- 只改数字的变式题相似度 96.2%、只改角度的几何题 96.7%，会被误判为同一题；
- 语义相反题（求最小值 vs 求最大值）相似度 93.3%，同样会被误合并；
- 合并时取组内最高 `lifecycle_status`，一条 `mastered` 会让同组真实未掌握的错题从错题本消失；
- OCR 漏字造成的编辑距离与真实不同题的编辑距离区间完全重叠，字符距离无法区分二者。

因此 OCR 漏字导致的重复错题属于 OCR 侧问题，应在识别与拆题环节治理，或提供复核台人工合并，不得在读取侧用相似度兜底。`src/utils/questionDedup.js` 的 `calculateSimilarity` 等函数仅可用于人工合并的候选提示，不得接入自动去重路径。

该口径下错题条数可能多于旧实现，这是把此前被误合并隐藏的错题还原，不是缺陷。

## 保存结构

核心关系：

```text
wrong_questions.student_id -> students.id
wrong_questions.question_id -> questions.id
```

`question_id` 允许为空，以支持练习册自包含错题。

重要字段包括：

```text
status
lifecycle_status
error_count
practice_count
last_wrong_at
mastered_at
source_type
subject
error_type
error_reason
is_blank
ai_confidence
content
correct_answer
student_answer
question_type
answer_type
question_image_url
page_number
question_no
block_coordinates
worksheet_id
```

练习册错题通常按 `(student_id, worksheet_id, question_no)` 去重，并保存题干、答案、学生答案、图片、页码、题号和坐标等信息。

## 生命周期

当前确认的典型生命周期为：

```text
new -> review_1 -> review_2 -> mastered
```

重练答对时推进生命周期；答错时回到 `new`，并增加错误次数。`practice_count`、`error_count`、`last_wrong_at` 和 `mastered_at` 共同记录练习历史。

## 重练和组卷

组卷题目 ID 保存在 `generated_exams.question_ids` JSONB 中。重练任务上传答案后，会关联 `tasks` 和 `generated_exams`，批改完成后更新错题生命周期、练习次数和错误次数。

组卷状态会更新为 `graded`，知识点掌握度随后进行后台同步。

### 重练范围限制（当前生效）

**重练只使用学生的原始错题，不使用 AI 变式题。** 组卷题目必须来自 `wrong_questions` 指向的真实做错题目，禁止把 `variant_questions` 的内容混入 `generated_exams.question_ids` 或重练卷。

原因：学生要先把原题真正做对，重练结果才能干净地对应错题生命周期与掌握度；掺入变式题会让「答对」无法归因到原错题，也会污染 `error_count` 与 `practice_count` 的语义。

`variant_questions`、`server/services/variantService.js` 和 `/api/variants/*` 保留为讲义侧的教学素材能力，不接入重练与组卷。若将来要放开此限制，必须先单独评审重练归因与掌握度口径。

## 复核影响

人工复核可以修改答案、改判或排除题目。复核结果会影响错题记录和任务统计，因此不能只修改前端展示结果。
