# 知识点系统

## 数据关系

```text
students
  -> questions
      -> question_knowledge
          -> knowledge_points
      -> knowledge_mastery
```

- `questions.student_id` 表示学生作答。
- `question_knowledge` 建立题目与知识点的多对多关系。
- 知识点关联支持 `primary`、`secondary` 角色及权重。
- `knowledge_mastery(student_id, kp_id)` 保存学生维度的掌握度。

## 同步流程

`syncQuestionsKnowledgeAndMastery` 负责：

1. 归一化 AI 或本地知识点标签。
2. 匹配知识树节点。
3. 写入 `question_knowledge`。
4. 增量更新 `knowledge_mastery`。

知识点同步通常在批改后后台执行，不阻塞主批改任务完成。

## 掌握度计算范围

空题、`answer_source='blank'` 或无法可靠判定的题目，通常不参与掌握度计算。

掌握度逻辑使用已确认的学习结果进行增量更新，涉及正确率、连续正确奖励和长期未练习衰减等因素。

## 关联业务

知识点关系来源于题目识别、AI 标签、本地知识树和已有题目关联。知识点掌握度会被教学诊断、讲义生成和重练结果使用。

因此，修改题目保存、判题结果、错题重练或知识点匹配逻辑时，都需要检查掌握度同步的影响。
