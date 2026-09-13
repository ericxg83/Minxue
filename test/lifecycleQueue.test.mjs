// 回归测试：错题生命周期状态机（2026-09-13 队列分层定稿）
//
// 口径变更：
//   旧：答错不重置进度（review_1 答错原地不动）
//   新：review_1（基本掌握）答错退回 new（假掌握回池重练），error_count+1；
//       mastered 答错退回 review_1 重新走周回顾验证（不变）
//
// 锁定三份同构实现不漂移：
//   1. 服务端结算唯一真相：server/services/gradingFinalizer.js getNextLifecycle（本测试直接调用）
//   2. 移动端预览：src/pages/Grading/index.jsx getNextLifecycle（源码级断言含新分支）
//   3. PC 端展示：src/workbench/stores/lifecycleStore.js processReviewResult（源码级断言含新分支）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getNextLifecycle } from '../server/services/gradingFinalizer.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

test('答对推进：new → review_1 → mastered，mastered 保持', () => {
  assert.equal(getNextLifecycle('new', true), 'review_1')
  assert.equal(getNextLifecycle('review_1', true), 'mastered')
  assert.equal(getNextLifecycle('mastered', true), 'mastered')
})

test('答错推进（新口径）：review_1/review_2 退回 new；mastered 退回 review_1；new 原地', () => {
  assert.equal(getNextLifecycle('review_1', false), 'new', '基本掌握答错必须回池，不能滞留')
  assert.equal(getNextLifecycle('review_2', false), 'new', '历史 review_2 按 review_1 语义处理')
  assert.equal(getNextLifecycle('mastered', false), 'review_1')
  assert.equal(getNextLifecycle('new', false), 'new')
  assert.equal(getNextLifecycle(undefined, false), undefined, '未知/缺失状态答错不推进')
})

test('全状态 × 全结果 覆盖：任何转移的终点都是合法枚举', () => {
  const LEGAL = new Set(['new', 'review_1', 'review_2', 'mastered'])
  for (const current of ['new', 'review_1', 'review_2', 'mastered']) {
    for (const isCorrect of [true, false]) {
      assert.ok(LEGAL.has(getNextLifecycle(current, isCorrect)), `${current}+${isCorrect} 非法转移`)
    }
  }
})

test('移动端 Grading 预览状态机与服务端同构（含 review_1 答错回 new 分支）', () => {
  const src = read('src/pages/Grading/index.jsx')
  assert.match(src, /if \(current === 'review_1' \|\| current === 'review_2'\) return 'new'/)
  assert.match(src, /review_1: '基本掌握'/)
  assert.match(src, /mastered: '完全掌握'/)
})

test('PC 端 lifecycleStore 状态机与服务端同构（含 review_1 答错回 new 分支）', () => {
  const src = read('src/workbench/stores/lifecycleStore.js')
  assert.match(src, /LIFECYCLE_STATUS\.REVIEW_1 \|\| currentStatus === LIFECYCLE_STATUS\.REVIEW_2/)
  assert.match(src, /review_1: '基本掌握'/)
  assert.match(src, /mastered: '完全掌握'/)
})

test('每日重练卷服务端选题默认排除 review_1/mastered（队列分层）', () => {
  const svc = read('server/services/wrongRetryPdfService.js')
  // 默认分支必须只放行 new；opt-in 分支才排除 mastered
  assert.match(svc, /: wqRows\.filter\(\(r\) => r\.lifecycle_status === 'new'\)/)
  assert.match(svc, /includeReview1 = false/)

  const route = read('server/routes/wrongQuestionsExport.js')
  assert.match(route, /includeReview1: includeReview1 === true/)
})

test('周报重练卷选题必须包含到期 review_1（第二次验证承载）', () => {
  const src = read('server/routes/weeklyReport.js')
  assert.match(src, /lifecycle_status IN \('review_1', 'review_2'\)/)
  assert.match(src, /INTERVAL '7 days'/)
})

test('Dashboard 重练概览拆分两级掌握率', () => {
  const svc = read('server/services/weaknessService.js')
  assert.match(svc, /fullyMasteredRate/)
  assert.match(svc, /basicMasteredRate/)
  assert.match(svc, /lifecycle_status = 'mastered'/, '完全掌握只数 mastered，不得再把 review_2 混入')
})
