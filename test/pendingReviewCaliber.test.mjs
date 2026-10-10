// 回归测试：「待人工复核卷数」唯一口径（2026-10-09 口径漂移事故）
//
// 事故：首页 KPI「待复核」显示 1 份，点进批改中心却是 7 份。
//   首页那个数字读的是 `/api/tasks/summary` 的 `pendingReview`
//   （SQL: status='done' AND notification_read_at IS NULL）—— 那是**未读通知数**，
//   老师点一次通知铃铛就全部标已读、数字塌缩到 0，与"还有几份要复核"无关；
//   而且只数 status='done'、按 tasks 原始行计数（重练卷多页答卷算多行）。
//
// 修复：判据收敛到 src/workbench/utils/pendingReviewCaliber.js 唯一实现，
//   前端批改中心（GradeCenterWorkbench.pendingCount）与服务端
//   （/api/tasks/summary 的 pendingReviewPapers）import 同一份。
//
// 本测试两层：
//   A. 口径行为（纯函数，无 DB）
//   B. 源码锁：三个消费方不得再各判一套 / 首页不得退回未读数
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  countPendingReviewPapers,
  isPendingReviewItem,
  normalizeHomeworkStatus,
  PENDING_REVIEW_WORKFLOW_STATUSES,
} from '../src/workbench/utils/pendingReviewCaliber.js'
import { anchoredSlice, anchoredRange, flatSource } from './sourceLockKit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const task = (over = {}) => ({
  id: over.id || `t-${Math.random().toString(36).slice(2)}`,
  status: 'done',
  task_type: 'homework',
  generated_exam_id: null,
  auto_retry: { state: '', willRetry: false },
  ...over,
})

// ─────────────────────────── A. 口径行为 ───────────────────────────

test('作业：done → 待复核（计入）；reviewed / failed 不计入', () => {
  const n = countPendingReviewPapers({
    tasks: [
      task({ id: 'a', status: 'done' }),
      task({ id: 'b', status: 'reviewed' }),
      task({ id: 'c', status: 'failed' }),
      task({ id: 'd', status: 'processing' }),
    ],
    exams: [],
  })
  // done + processing 计入；reviewed / failed 不计
  assert.equal(n, 2)
})

test('未读与否不影响计数 —— 这正是首页旧口径错的地方', () => {
  const withRead = (readAt) => ({
    tasks: [task({ id: 'a', status: 'done', notification_read_at: readAt })],
    exams: [],
  })
  const before = countPendingReviewPapers(withRead(null))
  const after = countPendingReviewPapers(withRead('2026-10-09T00:00:00Z'))
  assert.equal(before, 1)
  assert.equal(after, 1, '标已读不能把「待复核」数抹掉（首页旧口径就是被这一条坑的）')
})

test('重练卷：多页答卷合并成 1 张卡（不是 N 行）', () => {
  const examId = 'e1'
  const n = countPendingReviewPapers({
    tasks: [
      task({ id: 'p1', task_type: 'wrong_retry', generated_exam_id: examId, status: 'done' }),
      task({ id: 'p2', task_type: 'wrong_retry', generated_exam_id: examId, status: 'done' }),
      task({ id: 'p3', task_type: 'wrong_retry', generated_exam_id: examId, status: 'done' }),
    ],
    exams: [{ id: examId, status: 'pending' }],
  })
  assert.equal(n, 1, '同一份卷交 3 次答卷，老师只看到 1 张卡')
})

test('重练卷·已布置待学生作答（无答卷）不计入', () => {
  const n = countPendingReviewPapers({
    tasks: [],
    exams: [{ id: 'e1', status: 'pending' }],
  })
  assert.equal(n, 0)
  assert.equal(isPendingReviewItem({ source: 'retry', retryState: 'issued', workflowStatus: 'retry' }), false)
})

test('重练卷：AI 已出结果且没有未判定题 → 已确认，不再打扰老师', () => {
  const examId = 'e1'
  const n = countPendingReviewPapers({
    tasks: [task({ task_type: 'wrong_retry', generated_exam_id: examId, status: 'done' })],
    exams: [{ id: examId, status: 'graded' }],
    unjudgedByExam: new Map([[examId, 0]]),
  })
  assert.equal(n, 0)
})

test('重练卷：AI 已出结果但仍有未判定题 → 待确认，计入', () => {
  const examId = 'e1'
  const n = countPendingReviewPapers({
    tasks: [task({ task_type: 'wrong_retry', generated_exam_id: examId, status: 'done' })],
    exams: [{ id: examId, status: 'graded' }],
    unjudgedByExam: new Map([[examId, 2]]),
  })
  assert.equal(n, 1)
})

test('重练卷：答卷 latest 状态为 reviewed → 已确认，不计入', () => {
  const examId = 'e1'
  const n = countPendingReviewPapers({
    tasks: [
      task({ task_type: 'wrong_retry', generated_exam_id: examId, status: 'done' }),
      task({ task_type: 'wrong_retry', generated_exam_id: examId, status: 'reviewed' }),
    ],
    exams: [{ id: examId, status: 'graded' }],
    unjudgedByExam: new Map([[examId, 3]]),
  })
  assert.equal(n, 0, '取最新一次答卷的状态：老师已确认就不再算待办')
})

test('自愈中的失败算「AI 处理中」（计入），真失败不计入', () => {
  const selfHealing = countPendingReviewPapers({
    tasks: [task({ status: 'failed', auto_retry: { state: 'retrying', willRetry: true } })],
    exams: [],
  })
  assert.equal(selfHealing, 1)
  const reallyFailed = countPendingReviewPapers({
    tasks: [task({ status: 'failed', auto_retry: { state: 'gave-up', willRetry: false } })],
    exams: [],
  })
  assert.equal(reallyFailed, 0)
})

test('孤儿重练答卷（卷被删）降级成独立卡，不凭空消失', () => {
  const n = countPendingReviewPapers({
    tasks: [task({ task_type: 'wrong_retry', generated_exam_id: 'missing-exam', status: 'done' })],
    exams: [],
  })
  assert.equal(n, 1)
})

test('待复核家族集合 = {pending, processing, review, retry}（retry 只作族内合法态，不直接当列表过滤）', () => {
  assert.deepEqual(
    [...PENDING_REVIEW_WORKFLOW_STATUSES].sort(),
    ['pending', 'processing', 'retry', 'review']
  )
})

test('源码锁：批改中心「待处理」必须用 isPendingReviewItem，不得退回集合直判', () => {
  // 2026-10-09 负责人截图：顶部 chip「重练待验证 0」，点进「错题重练」tab 却列出 10 张
  // 「待学生作答」的卡（点不进批改）。根因就是这里当时写的是
  // `activeStatuses.has(item.workflowStatus)` —— 集合含 'retry'，把未交卷的卷也列了进来。
  const src = flatSource(read('src/workbench/views/GradeCenterWorkbench.vue'))
  assert.doesNotMatch(src, /activeStatuses/, '不得再用 activeStatuses 做列表过滤（会把未交卷重练卷列进待处理）')
  const fails = []
  const block = anchoredSlice(
    src,
    "if(statusFilter.value==='active')",
    120,
    'GradeCenterWorkbench.matchesStatusFilter',
    fails
  )
  assert.deepEqual(fails, [], fails.join('; '))
  assert.match(block, /isPendingReviewItem\(item\)/, '「待处理」与「待人工复核」必须同一判据')
})

test('normalizeHomeworkStatus：status → workflowStatus 映射（含自愈失败改判处理中）', () => {
  assert.equal(normalizeHomeworkStatus({ status: 'done' }).workflowStatus, 'review')
  assert.equal(normalizeHomeworkStatus({ status: 'reviewed' }).workflowStatus, 'completed')
  assert.equal(normalizeHomeworkStatus({ status: 'failed' }).workflowStatus, 'failed')
  assert.equal(
    normalizeHomeworkStatus({ status: 'failed', auto_retry: { state: 'retrying', willRetry: true } }).workflowStatus,
    'processing'
  )
  assert.equal(normalizeHomeworkStatus({ status: 'queued' }).workflowStatus, 'processing')
})

// ─────────────────────────── B. 源码锁（fail-closed）───────────────────────────

test('源码锁：首页 KPI「待复核」必须读 pendingReviewPapers，不得退回未读数', () => {
  // 压空白后匹配（锚点/断言都不吃缩进与换行 —— 纯格式化不该把锁打成假红）
  const src = flatSource(read('src/workbench/views/DashboardWorkbench.vue'))
  const fails = []
  const block = anchoredSlice(src, 'constpendingCount=computed(', 220, 'DashboardWorkbench.pendingCount', fails)
  assert.deepEqual(fails, [], fails.join('; '))
  assert.match(block, /pendingReviewPapers/, '首页 KPI 必须优先取 pendingReviewPapers（待复核卷数）')
})

test('源码锁：侧栏「批改中心」徽标同样读 pendingReviewPapers', () => {
  const src = flatSource(read('src/workbench/components/layout/AppSidebar.vue'))
  const fails = []
  const block = anchoredSlice(src, "if(path==='/grade')", 240, 'AppSidebar.badgeFor', fails)
  assert.deepEqual(fails, [], fails.join('; '))
  assert.match(block, /pendingReviewPapers/, '徽标不得用未读通知数（会出现「徽标 1 / 页面 7」）')
})

test('源码锁：批改中心不得再自建 normalizeHomeworkStatus / isAwaitingStudent', () => {
  const src = flatSource(read('src/workbench/views/GradeCenterWorkbench.vue'))
  assert.doesNotMatch(src, /constnormalizeHomeworkStatus=/, '判据必须来自 pendingReviewCaliber.js')
  assert.doesNotMatch(src, /constisAwaitingStudent=/, '判据必须来自 pendingReviewCaliber.js')
  assert.match(src, /from'\.\.\/utils\/pendingReviewCaliber'/, '必须 import 共享口径模块')
})

test('源码锁：服务端计数必须走共享口径模块，不得在 SQL 里另写一套', () => {
  const src = read('server/services/pendingReviewService.js')
  assert.match(src, /countPendingReviewPapers/, '服务端必须调用共享口径函数')
  assert.doesNotMatch(src, /status\s*=\s*'done'/, '服务端不得自己写 status=done 的待复核判据')
})

test('源码锁：/api/tasks/summary 必须同时下发 pendingReview（未读）与 pendingReviewPapers（待办）', () => {
  const src = read('server/index.js')
  const fails = []
  const block = anchoredRange(
    src,
    'app.get(\'/api/tasks/summary\'',
    'res.json(data)',
    'tasks/summary',
    fails
  )
  assert.deepEqual(fails, [], fails.join('; '))
  assert.match(block, /pendingReviewPapers/, '缺少待复核卷数字段')
  assert.match(block, /getPendingReviewPaperCount\(\)/, '必须调用服务端计数服务')
})

// ─────────── C. 通知中心那张「未读通知数」卡的标签（2026-10-10 第 254 轮）───────────
//
// 缺陷：PC 通知中心（NotificationList.vue）那张卡的数字取 `summary.pendingReview`
//   —— 那是**未读通知数**（点一次铃铛即归零），卡片标签却写「待复核」；
//   而 PC 别处的「待复核」= **待人工复核的卷数**（pendingReviewPapers，首页 KPI / 侧栏徽标 /
//   批改中心 chip 同口径）。**同一个词、两个数**，正是 2026-10-09「首页 1 vs 批改中心 7」
//   事故的另一个入口（那一次只改了 KPI/徽标，通知中心漏网）。
// 修复：该卡改叫「待确认」—— 与移动端 NotificationsPanel.jsx 对同一字段的用词一致（两端一个名）。
//   ⛔ 不改卡片的数字来源（它本来就该是「未读」，随已读归零），只改词。

test('源码锁：PC 通知中心「未读通知数」卡的标签不得叫「待复核」，须与移动端同词', () => {
  const pc = read('src/workbench/components/layout/NotificationList.vue')
  const mobile = flatSource(read('src/components/NotificationsPanel.jsx'))

  // 移动端的词作为「唯一来源」抽出（不硬编码，两端才真会同进同退）
  const m = mobile.match(/key:'pendingReview',label:'([^']+)'/)
  assert.ok(m, '移动端 NotificationsPanel 的 pendingReview 卡片标签没解析到 —— 更新本锁前先对账')
  const mobileLabel = m[1]

  const fails = []
  const block = anchoredSlice(
    flatSource(pc),
    '{{summary.pendingReview}}',
    120,
    'NotificationList.pendingReviewCard',
    fails
  )
  assert.deepEqual(fails, [], fails.join('; '))
  assert.doesNotMatch(
    block,
    /待复核/,
    '该卡数字是「未读通知数」（点一次铃铛即归零），叫「待复核」会与 PC 别处的「待复核=卷数」撞词'
  )
  assert.ok(
    block.includes(mobileLabel),
    `该卡标签应与移动端同词「${mobileLabel}」（同一字段两端一个名）`
  )
})

test('反向自检：合成「修复前」片段（该卡标签写「待复核」）必须判红', () => {
  const oldSnippet = flatSource(
    '<span class="card-num">{{ summary.pendingReview }}</span>' +
      '<span class="card-label">待复核</span>'
  )
  const fails = []
  const block = anchoredSlice(oldSnippet, '{{summary.pendingReview}}', 120, 'synthetic-old', fails)
  assert.deepEqual(fails, [], fails.join('; '))
  // 把上面那条「不得叫待复核」的判据原样套到旧片段上，必须抛 —— 否则本锁是空锁
  assert.throws(
    () => assert.doesNotMatch(block, /待复核/),
    '合成旧样本判绿了 —— 说明「不得叫待复核」这条判据没起作用'
  )
})
