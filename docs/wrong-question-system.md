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

## 复核影响

人工复核可以修改答案、改判或排除题目。复核结果会影响错题记录和任务统计，因此不能只修改前端展示结果。
