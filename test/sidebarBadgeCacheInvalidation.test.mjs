// 回归测试：侧栏徽标在复核完成后必须立刻归零（2026-10-10 事故）
//
// 现象：老师复核完最后一份卷，批改中心顶部 chip「待人工复核 0」、列表空态「当前筛选下没有任务」，
//   但左侧导航「批改中心」那个角标仍是 1。
//
// 根因（实测排除法定位，不是猜的）：
//   curl /api/tasks/summary 当场返回 pendingReviewPapers: 0 —— 与页内 chip 一致，
//   说明这个 1 **不是后端算出来的**，而是前端 localStorage 里的旧值。
//   徽标 = noti.summary.pendingReviewPapers，而 summary 走 getTasksSummary()，
//   它有 90s 的 localStorage 缓存（apiService.js CACHE 注释写明「让 45s 轮询
//   改成 ~90s 才打一次后端」）。于是形成两级滞后：
//     · 批改中心列表 → getTasksByStudent 缓存 5min，但 completeTaskReview 里的
//       clearStudentCaches(studentId) 会清它 ⇒ chip 立刻归 0；
//     · 摘要→ clearStudentCaches 的清理清单里**没有** tasks_summary_cache
//       ⇒ 徽标要等 90s TTL 自然过期才归零。
//   轮询（45s）救不了它：轮询读的也是同一份 90s 缓存。
//
// 修法（两条都要，缺一条就复发）：
//   ① clearStudentCaches 清理清单加入 'tasks_summary_cache'（任何学生数据变化都影响
//      这个全局计数，复核完成只是其中最明显的一种）；
//   ② updateTaskStatus / retryTask 这两个写操作各自清一次摘要缓存（不依赖调用方
//      记得调 clearStudentCaches —— 那是「同一件事只准一个实现」的反面教材）。
//
// ⛔ 本测试是源码锁：断言「清理动作存在」，不是断言「运行时会归零」——
//    运行时行为受 90s 缓存时序影响，测试没法稳定复现。源码锁是这里唯一稳定的抓手。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { anchoredRange, flatSource } from './sourceLockKit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

test('源码锁：clearStudentCaches 必须清 tasks_summary_cache', () => {
  // 不这样清 ⇒ 复核完成后侧栏徽标最长 90s 显示旧数字，而页内 chip 已是 0
  const src = read('src/services/apiService.js')
  const fails = []
  const block = anchoredRange(
    src,
    'export const clearStudentCaches',
    'console.debug(`学生',
    'apiService.clearStudentCaches',
    fails
  )
  assert.deepEqual(fails, [], fails.join('; '))
  assert.match(
    block,
    /['"`]tasks_summary_cache['"`]/,
    '清理清单必须含 tasks_summary_cache —— 它装的是全系统待复核卷数，复核完成会立刻改'
  )
})

test('源码锁：写操作 updateTaskStatus / retryTask 各自清摘要缓存', () => {
  // 不依赖调用方记得调 clearStudentCaches：写操作自己负责失效自己影响到的缓存。
  // 终点锚点用函数体内**不会**出现的特征串（下一个已知函数的声明），
  // 避免拿 'export const' 当终点 —— 起点本身就含它，b 会等于 a 直接判红。
  const src = read('src/services/apiService.js')
  const cases = [
    { fn: 'export const updateTaskStatus', until: 'export const retryTask', label: 'updateTaskStatus' },
    { fn: 'export const retryTask', until: 'export const TASK_ROUTE_CONVERT_ENABLED', label: 'retryTask' },
  ]
  for (const { fn, until, label } of cases) {
    const fails = []
    const block = anchoredRange(src, fn, until, `apiService.${label}`, fails)
    assert.deepEqual(fails, [], fails.join('; '))
    assert.match(
      block,
      /clearCache\(['"`]tasks_summary_cache['"`]\)/,
      `${label} 改了 task 状态 ⇒ 必须让摘要缓存失效，否则徽标停留在旧数字`
    )
  }
})

test('源码锁：侧栏徽标不得用未读通知数兜底（防 2026-10-09 事故复辟）', () => {
  // pendingReview = 未读通知数（点一次铃铛即归零），pendingReviewPapers = 待复核卷数。
  // 徽标一旦 `?? pendingReview` 兜底，接口少下发一个字段就静默退化成另一个语义，
  // 表现为「徽标 1 / 页面 7」——正是 2026-10-09 那次口径漂移事故。
  const src = flatSource(read('src/workbench/components/layout/AppSidebar.vue'))
  const fails = []
  const start = src.indexOf('constbadgeFor=(path)=>{')
  assert.ok(start >= 0, 'AppSidebar.badgeFor 锚点不在——源码改过请先同步本锁')
  const block = src.slice(start, start + 220)
  assert.match(block, /pendingReviewPapers/, '徽标必须读 pendingReviewPapers（待复核卷数）')
  assert.doesNotMatch(
    block,
    /\?\?.*pendingReview(?!Papers)/,
    '不得用未读通知数 pendingReview 兜底 —— 那是另一个语义，会重现「徽标 1 / 页面 N」'
  )
})

test('反向自检：合成「修复前」片段（含 pendingReview 兜底）必须判红', () => {
  // 空锁检测：把 2026-10-09 事故当时的写法喂给上面那条判据，必须抛
  const oldSnippet = flatSource(
    "const badgeFor = (path) => { if (path === '/grade') { return noti.summary?.pendingReviewPapers ?? noti.summary?.pendingReview ?? 0 } return 0 }"
  )
  const block = oldSnippet.slice(oldSnippet.indexOf('constbadgeFor=(path)=>{'), oldSnippet.indexOf('constbadgeFor=(path)=>{') + 220)
  assert.throws(
    () => assert.doesNotMatch(block, /\?\?.*pendingReview(?!Papers)/),
    '合成旧样本判绿了 —— 说明「不得用 pendingReview 兜底」这条判据没起作用'
  )
})