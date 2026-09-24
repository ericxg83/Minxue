import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RETRY_PAPER_STATE,
  resolveRetryPaperState,
  hasAnswerSheet,
  canOpenReview,
  canSettleReview,
  isIssued,
  isPendingReview,
  isReviewed,
  getRetryPaperStateMeta,
  RETRY_STATE_TO_WORKFLOW,
  RETRY_STATE_TO_TASK_STATUS,
  isRetryPaperTask
} from '../src/workbench/utils/retryPaperState.js'

/**
 * 2026-09-12 事故回归锁定：
 * 批改中心「重练批改」把从未有学生答卷的重练卷也放进待复核队列，
 * 老师点进去中间栏「图片加载失败」、左右栏是原始作业的旧判定。
 *
 * 根因：`status = exam.status === 'graded' ? 'reviewed' : 'done'`，
 * 而 generated_exams.status 全库 24 份都是 'ungraded'（连已批完那份也是）。
 *
 * 本测试锁死口径：
 *   1. 「交没交卷」只看 tasks.generated_exam_id 是否存在 —— 不看 exam.status
 *   2. [2026-09-17 更新] 结算已提前到「AI 批完时」（与通用作业管线的
 *      finalizeGradingBatch 对齐），所以 exam.status='graded' 的语义是「结果已出」，
 *      **不再等于**「老师确认了」。三分档：
 *        · 答卷 task 已 reviewed（老师拍板）→ REVIEWED
 *        · 未拍板 + 还有未判定题（exam.not_answered_count>0）→ PENDING_CONFIRM
 *        · 未拍板 + 没有未判定题 → REVIEWED
 *      少了 PENDING_CONFIRM 这一档，那几道 AI 给不出结论的题会随"已确认"
 *      一起从老师待办里消失（2026-09-17 之前的隐患）。
 */

const sheet = (status, createdAt) => ({
  id: `task-${status}-${createdAt}`,
  status,
  created_at: createdAt || '2026-09-08T03:00:00.000Z'
})

test('没有学生答卷 → ISSUED，不进复核队列', () => {
  const state = resolveRetryPaperState({ status: 'ungraded' }, [])
  assert.equal(state, RETRY_PAPER_STATE.ISSUED)
  assert.equal(isIssued(state), true)
  assert.equal(hasAnswerSheet(state), false)
  assert.equal(canOpenReview(state), false, '未交卷的卷不允许进入批改页')
  assert.equal(canSettleReview(state), false)
})

test('exam.status 绝不能用来判断「有没有交卷」', () => {
  // 已交卷且 AI 批完，但 exam.status 仍是 ungraded（全库 24 份的真实形态，
  // 含那份已经批完的陆晨曦 错题再测-0904）
  const state = resolveRetryPaperState({ status: 'ungraded' }, [sheet('done')])
  assert.equal(state, RETRY_PAPER_STATE.PENDING_REVIEW, '有答卷就是待复核，与 exam.status 无关')
  assert.equal(canOpenReview(state), true)

  // 反过来：没有答卷时，即使 exam.status 是 graded 也不能当已确认
  assert.equal(
    resolveRetryPaperState({ status: 'graded' }, []),
    RETRY_PAPER_STATE.ISSUED
  )
})

test('有答卷 + AI 处理中 → GRADING，不允许进入批改页', () => {
  for (const status of ['pending', 'processing', 'queued']) {
    const state = resolveRetryPaperState({ status: 'ungraded' }, [sheet(status)])
    assert.equal(state, RETRY_PAPER_STATE.GRADING, `${status} 应判为批改中`)
    assert.equal(canOpenReview(state), false)
    assert.equal(canSettleReview(state), false)
  }
})

test('有答卷 + 识别异常 → FAILED，可进去查看答卷但不能直接结算', () => {
  const state = resolveRetryPaperState({ status: 'ungraded' }, [sheet('failed')])
  assert.equal(state, RETRY_PAPER_STATE.FAILED)
  assert.equal(canOpenReview(state), true)
  assert.equal(canSettleReview(state), false)
  assert.equal(getRetryPaperStateMeta(state).tone, 'danger')
})

test('答卷已批完但未结算：待复核（结算失败/历史数据）', () => {
  const pending = resolveRetryPaperState({ status: 'ungraded' }, [sheet('done')])
  assert.equal(pending, RETRY_PAPER_STATE.PENDING_REVIEW)
  assert.equal(isPendingReview(pending), true)
  assert.equal(canSettleReview(pending), true)
})

test('已结算：还有未判定题 → 待确认（老师仍要处理这几道）', () => {
  const confirm = resolveRetryPaperState(
    { status: 'graded', not_answered_count: 3 },
    [sheet('done')]
  )
  assert.equal(confirm, RETRY_PAPER_STATE.PENDING_CONFIRM)
  // 必须进待办、必须可结算 —— 否则这几道题会永远没人处理
  assert.equal(isPendingReview(confirm), true, '待确认的卷必须进老师的待办队列')
  assert.equal(canSettleReview(confirm), true, '待确认的卷必须允许老师点完成确认')
  assert.equal(canOpenReview(confirm), true)
  assert.equal(isReviewed(confirm), false)
  assert.equal(RETRY_STATE_TO_WORKFLOW[confirm], 'review')
})

test('已结算且无未判定题 → 已确认（老师无需再动手）', () => {
  const reviewed = resolveRetryPaperState({ status: 'graded', not_answered_count: 0 }, [sheet('done')])
  assert.equal(reviewed, RETRY_PAPER_STATE.REVIEWED)
  assert.equal(isReviewed(reviewed), true)
  assert.equal(isPendingReview(reviewed), false)
  assert.equal(canOpenReview(reviewed), true, '已确认的卷仍可只读查看')
  assert.equal(canSettleReview(reviewed), false, '已确认的卷不该再结算一次')
})

test('老师拍板后（答卷 task 已 reviewed）→ 已确认，即使还有未判定题', () => {
  // 「完成复核」会同时把答卷 task 标 reviewed（reviewStore.persistTaskCompletion 的 paper 分支）。
  // 不认这个信号的话，老师点完确认下次加载又回到「待确认」，卷子永远点不掉。
  const state = resolveRetryPaperState({ status: 'graded', not_answered_count: 2 }, [sheet('reviewed')])
  assert.equal(state, RETRY_PAPER_STATE.REVIEWED)
  assert.equal(isPendingReview(state), false)
})

test('同一份卷被交多次 → 取最新一次答卷的状态', () => {
  const pages = [
    sheet('failed', '2026-09-08T03:00:00.000Z'),
    sheet('done', '2026-09-09T03:00:00.000Z')
  ]
  assert.equal(
    resolveRetryPaperState({ status: 'ungraded' }, pages),
    RETRY_PAPER_STATE.PENDING_REVIEW
  )
  // 传入顺序颠倒也要一致（内部自行排序）
  assert.equal(
    resolveRetryPaperState({ status: 'ungraded' }, pages.slice().reverse()),
    RETRY_PAPER_STATE.PENDING_REVIEW
  )
})

test('pages 为 null / undefined / 非数组都不炸', () => {
  for (const input of [null, undefined, 'x', 0, {}]) {
    assert.equal(
      resolveRetryPaperState({ status: 'ungraded' }, input),
      RETRY_PAPER_STATE.ISSUED,
      `pages=${JSON.stringify(input)} 应兜底为 ISSUED`
    )
  }
  // exam 缺失也不能炸
  assert.equal(resolveRetryPaperState(null, []), RETRY_PAPER_STATE.ISSUED)
  assert.equal(resolveRetryPaperState(undefined, [sheet('done')]), RETRY_PAPER_STATE.PENDING_REVIEW)
})

test('每个状态都有元信息、workflowStatus 与 task.status 映射', () => {
  for (const state of Object.values(RETRY_PAPER_STATE)) {
    const meta = getRetryPaperStateMeta(state)
    assert.ok(meta.statusLabel, `${state} 缺 statusLabel`)
    assert.ok(meta.actionLabel, `${state} 缺 actionLabel`)
    // tone 必须是 StatusTag 的合法枚举，写错会在开发态报 prop 校验警告
    assert.ok(
      ['neutral', 'success', 'info', 'warning', 'danger', 'processing'].includes(meta.tone),
      `${state} 的 tone=${meta.tone} 不在 StatusTag 枚举内`
    )
    assert.ok(RETRY_STATE_TO_WORKFLOW[state], `${state} 缺 workflowStatus 映射`)
    assert.ok(RETRY_STATE_TO_TASK_STATUS[state], `${state} 缺 task.status 映射`)
  }
  // 未知状态兜底不能返回 undefined（否则卡片渲染崩）
  assert.equal(getRetryPaperStateMeta('不存在的状态').statusLabel, '待学生作答')
})

test('可进入批改页的状态集合精确等于「有答卷且 AI 不在跑」', () => {
  const enterable = Object.values(RETRY_PAPER_STATE).filter(canOpenReview)
  assert.deepEqual(
    enterable.sort(),
    [
      RETRY_PAPER_STATE.FAILED,
      RETRY_PAPER_STATE.PENDING_REVIEW,
      RETRY_PAPER_STATE.PENDING_CONFIRM,
      RETRY_PAPER_STATE.REVIEWED
    ].sort()
  )
})

test('移动端：待确认也直接出结果（不等老师确认）', async () => {
  const { resolveRetryExamStage, RETRY_EXAM_STAGE } = await import('../src/domain/retryExamStage.js')
  const exam = (status, notAnswered, sheets) => ({
    status, not_answered_count: notAnswered, answer_sheets: sheets
  })
  // 已结算 + 还有未判定题 → 移动端已经是「已出结果」，不再卡在「等待复核」
  assert.equal(
    resolveRetryExamStage(exam('graded', 3, [sheet('done')])),
    RETRY_EXAM_STAGE.RESULT
  )
  // 已结算 + 无未判定题 → 同样是已出结果
  assert.equal(
    resolveRetryExamStage(exam('graded', 0, [sheet('done')])),
    RETRY_EXAM_STAGE.RESULT
  )
  // 批完但没结算（结算失败）→ 仍停在等待复核（这时确实还没结果可给）
  assert.equal(
    resolveRetryExamStage(exam('ungraded', 0, [sheet('done')])),
    RETRY_EXAM_STAGE.PENDING_REVIEW
  )
})

/**
 * 2026-09-24 事故回归锁定：「作业批改」下拉混入重练卷答卷
 *
 * 现象：PC 工作台「作业批改」（homework 模式）的试卷下拉里出现该学生的重练卷答卷。
 * 根因：后端 GET /api/tasks/student/:id 返回该学生全部 tasks（不过滤类型），
 *      reviewStore.loadStudentTasks 的 homework 分支只按 status ∈ {done, reviewed}
 *      过滤，**没排除重练卷答卷**；而批改中心（GradeCenterWorkbench）另有一套
 *      本地 isRetryTask 判据 —— 两处分家，homework 这条路径漏判。
 * 影响：全库 17 条重练卷答卷（涉 8 名学生）进下拉，其中 4 条 status='done' 进
 *      待复核队列，虞晨熙 / 陈昊煜 / 蔡怡希 三人这条卷被 autoSelectPendingTask
 *      自动打开；打开后题目列表与右栏全空（题目挂在原作业 task 上，
 *      按 task_id 拉必然为空），只剩中间一张卷面图。
 * 锁定：判据 isRetryPaperTask 必须是唯一口径，两个消费方共用。
 */
test('isRetryPaperTask：重练卷答卷的识别口径', () => {
  // 带 generated_exam_id（学生提交的答题卡照片）→ 是重练卷答卷
  assert.equal(isRetryPaperTask({ generated_exam_id: 'caab8c34', task_type: 'general' }), true)
  // 无 exam 但 task_type 标记（孤儿答卷）→ 仍是重练卷答卷，不能当独立作业
  assert.equal(isRetryPaperTask({ generated_exam_id: null, task_type: 'wrong_retry' }), true)
  // 普通作业 / 练习册 / 试卷：三种 task_type 都不得被误判
  assert.equal(isRetryPaperTask({ generated_exam_id: null, task_type: 'general' }), false)
  assert.equal(isRetryPaperTask({ generated_exam_id: null, task_type: 'homework' }), false)
  assert.equal(isRetryPaperTask({ generated_exam_id: null, task_type: 'workbook' }), false)
  // 防御：脏数据 / 空值不得抛错，且不得把未知记录当成重练卷
  assert.equal(isRetryPaperTask({}), false)
  assert.equal(isRetryPaperTask(null), false)
  assert.equal(isRetryPaperTask(undefined), false)
})

test('isRetryPaperTask：homework 队列过滤后重练卷答卷必须清零', () => {
  // 模拟 GET /api/tasks/student/:id 的真实返回（陆晨曦 2026-09-24 实测样本）
  const tasks = [
    { id: 'a1', status: 'done', task_type: 'wrong_retry', generated_exam_id: 'caab8c34',
      original_name: 'MINXUE_20260908_110144_01ar78.jpg 等2页' },
    { id: 'a2', status: 'reviewed', task_type: 'wrong_retry', generated_exam_id: 'd75533d4',
      original_name: 'MINXUE_20260916_201220_01akmf.jpg 等3页' },
    { id: 'b1', status: 'done', task_type: 'general', generated_exam_id: null,
      original_name: '六年级数学周末卷（3）' },
    { id: 'b2', status: 'reviewed', task_type: 'general', generated_exam_id: null,
      original_name: '2.2(1) 分数的基本性质' },
    { id: 'c1', status: 'processing', task_type: 'general', generated_exam_id: null,
      original_name: '进行中的作业' },
  ]

  // 与 reviewStore.loadStudentTasks 的 homework 分支逐字同构
  const sorter = { done: 0, reviewed: 1 }
  const queue = tasks
    .filter(t => t.status === 'done' || t.status === 'reviewed')
    .filter(t => !isRetryPaperTask(t))
    .sort((a, b) => (sorter[a.status] ?? 99) - (sorter[b.status] ?? 99))

  assert.deepEqual(queue.map(t => t.id), ['b1', 'b2'], '只剩普通作业，且 done 优先')
  assert.equal(queue.filter(isRetryPaperTask).length, 0, '重练卷答卷必须一条不剩')
  // 未完成的作业照旧不进队列（回归保护，与本修复无关但同属该 filter 链）
  assert.equal(queue.some(t => t.id === 'c1'), false)
})
