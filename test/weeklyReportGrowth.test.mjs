// 成长历史 P0 口径测试：buildRetryProgress / shiftPrevPeriod
// 锁死：重练判题只信任 tasks.result（error 卷排除）、retryAccuracy 只按已判定题、
//        prev 周期 = 当前周期的前一期（all 模式无对比）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRetryProgress, shiftPrevPeriod } from '../server/routes/weeklyReport.js'

const task = (id = 'a', over = {}) => ({
  id,
  result: {
    questionCount: 10, correctCount: 7, wrongCount: 2, pendingCount: 1,
    autoCount: 8, manualCount: 1, emptyCount: 1, completedAt: '2026-09-18T10:00:00Z',
    ...over
  }
})

test('buildRetryProgress：有效卷聚合', () => {
  const rows = [
    task('a'),
    task('b', { questionCount: 20, correctCount: 12, wrongCount: 5, pendingCount: 3 }),
    // 失败卷（error/failedAt）不计入
    task('c', { error: 'boom', failedAt: '2026-09-19T00:00:00Z', questionCount: 99 })
  ]
  const p = buildRetryProgress(rows)
  assert.equal(p.examCount, 2)
  assert.equal(p.retriedCount, 30)
  assert.equal(p.correctCount, 19)
  assert.equal(p.wrongCount, 7)
  assert.equal(p.pendingCount, 4)
  // 只按已判定题（19+7=26）算正确率
  assert.equal(p.retryAccuracy, Math.round((19 / 26) * 1000) / 10)
})

test('buildRetryProgress：全失败卷 → 全部归零', () => {
  const p = buildRetryProgress([task('a', { error: 'x' })])
  assert.deepEqual(p, {
    examCount: 0, retriedCount: 0, correctCount: 0, wrongCount: 0,
    pendingCount: 0, retryAccuracy: 0
  })
})

test('buildRetryProgress：空输入安全', () => {
  const p = buildRetryProgress([])
  assert.equal(p.examCount, 0)
  assert.equal(p.retryAccuracy, 0)
})

test('buildRetryProgress：结果缺失数量字段的旧数据不算有效卷', () => {
  const p = buildRetryProgress([{ id: 'old', result: { progress: 100 } }])
  assert.equal(p.examCount, 0)
})

test('shiftPrevPeriod：week offset 0 → 上一自然周（周一 ~ 下周一）', () => {
  const prev = shiftPrevPeriod('week', 0)
  assert.ok(prev)
  const day = prev.periodStart.getDay()
  assert.equal(day, 1, '上周起点应为周一')
  assert.equal(prev.periodEnd.getTime() - prev.periodStart.getTime(), 7 * 86400000)
})

test('shiftPrevPeriod：week offset 1 → 上上周（比本周再前一周）', () => {
  const cur = shiftPrevPeriod('week', 0)
  const prev1 = shiftPrevPeriod('week', 1)
  // 上上周起点应比本周起点早 7 天；上上周终点 = 本周起点（相邻周首尾相连）
  assert.equal(cur.periodStart.getTime() - prev1.periodStart.getTime(), 7 * 86400000)
  assert.equal(prev1.periodEnd.getTime(), cur.periodStart.getTime())
})

test('shiftPrevPeriod：month 偏移一个月', () => {
  const prev = shiftPrevPeriod('month', 0)
  assert.ok(prev)
  assert.equal(prev.periodStart.getDate(), 1, '上月起点应为月初')
  const next = new Date(prev.periodEnd.getTime())
  assert.equal(next.getDate(), 1, '上月终点应为下月月初')
  assert.equal(next.getMonth() - prev.periodStart.getMonth() <= 1 || next.getMonth() - prev.periodStart.getMonth() === -11, true)
})

test('shiftPrevPeriod：all 模式无对比对象', () => {
  assert.equal(shiftPrevPeriod('all', 0), null)
})
