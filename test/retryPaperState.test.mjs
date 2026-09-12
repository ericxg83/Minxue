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
  RETRY_STATE_TO_TASK_STATUS
} from '../src/workbench/utils/retryPaperState.js'

/**
 * 2026-09-12 事故回归锁定：
 * 批改中心「重练批改」把从未有学生答卷的重练卷也放进待复核队列，
 * 老师点进去中间栏「图片加载失败」、左右栏是原始作业的旧判定。
 *
 * 根因：`status = exam.status === 'graded' ? 'reviewed' : 'done'`，
 * 而 generated_exams.status 全库 24 份都是 'ungraded'（连已批完那份也是）。
 *
 * 本测试锁死两条口径：
 *   1. 「交没交卷」只看 tasks.generated_exam_id 是否存在 —— 不看 exam.status
 *   2. exam.status 只能区分「待复核 / 已确认」
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

test('答卷已批完：exam.status 决定待复核 / 已确认', () => {
  const pending = resolveRetryPaperState({ status: 'ungraded' }, [sheet('done')])
  assert.equal(pending, RETRY_PAPER_STATE.PENDING_REVIEW)
  assert.equal(isPendingReview(pending), true)
  assert.equal(canSettleReview(pending), true)

  const reviewed = resolveRetryPaperState({ status: 'graded' }, [sheet('done')])
  assert.equal(reviewed, RETRY_PAPER_STATE.REVIEWED)
  assert.equal(isReviewed(reviewed), true)
  assert.equal(canOpenReview(reviewed), true, '已确认的卷仍可只读查看')
  assert.equal(canSettleReview(reviewed), false, '已确认的卷不该再结算一次')
})

test('paper 结算只写 exam.status，task.status 仍是 done —— 不能据此判已确认', () => {
  // reviewStore.persistTaskCompletion 的 paper 分支只调 gradeGeneratedExam，
  // 不会把答卷 task 改成 reviewed。所以 task.status='done' + exam.status='graded'
  // 才是「已确认」的完整形态。
  const state = resolveRetryPaperState({ status: 'graded' }, [sheet('done')])
  assert.equal(state, RETRY_PAPER_STATE.REVIEWED)
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
      RETRY_PAPER_STATE.REVIEWED
    ].sort()
  )
})
