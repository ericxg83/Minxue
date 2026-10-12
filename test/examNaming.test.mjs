/**
 * P12 同名去重提醒 · examNaming 单测
 *
 * 锁定：
 *   1. countSameBaseToday 与 buildExamNameWithSeq 共享同一口径（同学号+当天+去 -NN 前缀）
 *   2. 同名卷数 = 序号 - 1（buildExamNameWithSeq 返回 -NN，countSameBaseToday 返回 N-1）
 *   3. 不同学生互不影响
 *   4. 跨日不算
 *   5. 不同基名不算
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import dayjs from 'dayjs'
import { buildExamBaseName, buildExamNameWithSeq, countSameBaseToday } from '../src/domain/examNaming.js'

const today = dayjs().format('YYYY-MM-DD')

const mkExam = (name, studentId, createdDay = today) => ({
  name,
  student_id: studentId,
  created_at: createdDay ? `${createdDay}T10:00:00Z` : null,
})

test('countSameBaseToday: 同学生同日同名计为 1，序号应为 02', () => {
  const base = '数学-1012'
  const existing = [mkExam('数学-1012-01', 's1')]
  assert.equal(countSameBaseToday(base, existing, 's1'), 1)
  assert.equal(buildExamNameWithSeq(base, existing, 's1'), '数学-1012-02')
})

test('countSameBaseToday: 多份同名卷按数量计', () => {
  const base = '错题重练-1012'
  const existing = [
    mkExam('错题重练-1012-01', 's1'),
    mkExam('错题重练-1012-02', 's1'),
    mkExam('错题重练-1012-03', 's1'),
  ]
  assert.equal(countSameBaseToday(base, existing, 's1'), 3)
  assert.equal(buildExamNameWithSeq(base, existing, 's1'), '错题重练-1012-04')
})

test('countSameBaseToday: 不同学生互不影响', () => {
  const base = '数学-1012'
  const existing = [
    mkExam('数学-1012-01', 's1'),
    mkExam('数学-1012-01', 's2'),
    mkExam('数学-1012-02', 's2'),
  ]
  assert.equal(countSameBaseToday(base, existing, 's1'), 1)
  assert.equal(countSameBaseToday(base, existing, 's2'), 2)
})

test('countSameBaseToday: 跨日不算', () => {
  const base = '数学-1012'
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
  const existing = [mkExam('数学-1012-01', 's1', yesterday)]
  assert.equal(countSameBaseToday(base, existing, 's1'), 0)
})

test('countSameBaseToday: 不同基名不算', () => {
  const existing = [mkExam('数学-1012-01', 's1')]
  assert.equal(countSameBaseToday('英语-1012', existing, 's1'), 0)
})

test('countSameBaseToday: 空列表返回 0', () => {
  assert.equal(countSameBaseToday('数学-1012', [], 's1'), 0)
  assert.equal(countSameBaseToday('数学-1012', null, 's1'), 0)
})

test('buildExamBaseName: 单科含科目名', () => {
  const name = buildExamBaseName([{ subject: '数学' }])
  assert.match(name, /数学/)
})

test('口径一致性: countSameBaseToday 结果 = 序号 - 1', () => {
  const base = '数学-1012'
  const existing = [
    mkExam('数学-1012-01', 's1'),
    mkExam('数学-1012-02', 's1'),
  ]
  const count = countSameBaseToday(base, existing, 's1')
  const seq = Number(buildExamNameWithSeq(base, existing, 's1').match(/-(\d{2})$/)[1])
  assert.equal(count, seq - 1, 'countSameBaseToday 必须等于序号-1，否则 buildExamNameWithSeq 与提醒不一致')
})
