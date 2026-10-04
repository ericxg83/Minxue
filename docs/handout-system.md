# 讲义、资源与组卷系统

## 练习册和答案库

相关数据表包括：

```text
worksheets
worksheet_answers
resources
resource_units
resource_questions
resource_answers
```

典型流程为：

1. 创建练习册或资源。
2. 上传 PDF 或图片。
3. OCR 解析文本、章节、单元、题号和小题号。
4. 写入资源单元、题目和答案。
5. 由教师审核答案。
6. 根据答案审核状态参与后续批改。

答案定位必须结合：

```text
unit
section
question_no
sub_no
```

AI 草稿、教师审核答案和官方审核答案的状态不同，不能混为同一可信等级。

## 讲义（已于 2026-10-04 r137 下线）

负责人裁决：「我的讲义」与学习诊断页的「班级备课」属伪需求，基本用不上，决定不开发了。
以下路由、服务与模板引擎已随之下线：

```text
server/routes/handout.js
server/routes/handoutLecture.js
server/services/handoutService.js
server/services/handoutDiagnosisService.js
server/services/handoutByKnowledgeService.js
server/services/handoutScriptService.js
server/services/handoutDocxService.js
```

曾提供的能力（讲义生成、Word 导出、讲课脚本、讲义 CRUD/复制/笔记/模板）不再对外可调；
工作台页面 `HandoutList.vue`（/handouts）与 `HandoutPreview.vue`（/handout）已删除。

持久化表：

```text
handout_lectures
handout_lecture_notes
handout_lecture_templates
```

存量数据**保留在库中不删**（不删表、不清数据），只断开读写侧；`handout_lectures.blocks`
的 JSONB 结构因此仍按原样存在，将来若要恢复需重建服务层而非改表。

老师侧「讲题」能力由**周末班课件**（`/weekend-ppt`，`server/lib/weekendHandout.js` +
`server/routes/weekendHandout.js`）承担，与本节下线的讲义子系统不是同一条链路，**不要误删**。

## 变式题

变式题使用 `variant_questions` 保存，当前已确认的生成策略包括：

```text
change_number
change_condition
inverse
context_shift
```

**变式题仅作为讲义/题型素材，不进入错题重练与组卷。**（讲义子系统已于 r137 下线，变式题现存于 `variant_questions` 供题型库「生成变式练习」使用，仍不进重练卷。） 当前产品口径是「只练错题」：`generated_exams.question_ids` 必须来自 `wrong_questions` 指向的真实做错题目，不得混入 `variant_questions` 的内容。详见 `docs/wrong-question-system.md` 的「重练范围限制」。

## 组卷和重练

组卷接口包括：

```text
POST /api/generated-exams
GET /api/generated-exams/student/:studentId
GET /api/generated-exams/:id
POST /api/generated-exams/:id/grade
```

组卷题目 ID 保存于 `generated_exams.question_ids` JSONB。学生上传重练答案后，系统通过 `generatedExamId` 关联组卷、任务和学生，批改完成后更新组卷状态、错题状态和知识点掌握度。
