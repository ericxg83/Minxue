/**
 * taskResultStats.test.mjs — 批改结果成色 / 通知文案回归测试（2026-09-23 P1）
 *
 * 事故：移动端「批改完成」通知永远宣「xxx 的作业全部正确 / 全部做对」。
 * 两条根因在这里被锁死：
 *   ① 字段命名漂移：`/api/tasks/summary` 读 result->>'wrong_count'（下划线），
 *      而 worker 写的是驼峰 wrongCount（实测全库 163/164 条是驼峰、0 条下划线）
 *      ⇒ 错题数恒 0 ⇒ 一律走「全对」分支。任何读统计的地方都必须兼容两种命名。
 *   ② 判据过窄：wrong=0 就说全对。空题与 AI 判不出的题既不进 wrongCount 也不进
 *      emptyCount，只看 wrong 会把「待复核」的题静默算成做对。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeTaskStats,
  resolveTaskResultTone,
  describeTaskResult,
  buildGradingDoneNotification,
  buildLatestTaskReminder
} from '../src/domain/taskResultStats.js'

const task = (result, extra = {}) => ({ studentName: '朱思诺', result, ...extra })

// ── ① 命名兼容：驼峰 / 下划线都要读得出来 ──

test('驼峰命名（worker 实际写的）能读出统计', () => {
  assert.deepEqual(normalizeTaskStats({ result: { questionCount: 14, wrongCount: 5, emptyCount: 2, pendingCount: 1 } }), {
    questionCount: 14, wrongCount: 5, emptyCount: 2, pendingCount: 1
  })
})

test('下划线命名（历史/后端映射）也能读出统计', () => {
  assert.deepEqual(normalizeTaskStats({ result: { question_count: 14, wrong_count: 5, empty_count: 2, pending_count: 1 } }), {
    questionCount: 14, wrongCount: 5, emptyCount: 2, pendingCount: 1
  })
})

test('summary 的 mapTask 扁平结构（无 result 壳）同样可读', () => {
  assert.equal(normalizeTaskStats({ wrongCount: 3, questionCount: 10 }).wrongCount, 3)
})

test('字段缺失/脏值一律归 0，不得变成 NaN', () => {
  const s = normalizeTaskStats({ result: { wrongCount: null, questionCount: 'x' } })
  assert.equal(s.wrongCount, 0)
  assert.equal(s.questionCount, 0)
})

// ── ② 成色判据：wrong=0 不等于全对 ──

test('有错题 → has-wrong', () => {
  assert.equal(resolveTaskResultTone({ questionCount: 14, wrongCount: 5, emptyCount: 2, pendingCount: 1 }), 'has-wrong')
})

test('无错题但有空题 → needs-review（不得报全对）', () => {
  assert.equal(resolveTaskResultTone({ questionCount: 14, wrongCount: 0, emptyCount: 4, pendingCount: 0 }), 'needs-review')
})

test('无错题但有 AI 判不出的待复核题 → needs-review', () => {
  assert.equal(resolveTaskResultTone({ questionCount: 12, wrongCount: 0, emptyCount: 0, pendingCount: 3 }), 'needs-review')
})

test('OCR 截断（可能漏题）→ needs-review', () => {
  assert.equal(resolveTaskResultTone({ questionCount: 12, wrongCount: 0, emptyCount: 0, pendingCount: 0 }, { truncated: true }), 'needs-review')
})

test('三桶全空且统计可信 → all-correct（唯一允许说全对的情形）', () => {
  assert.equal(resolveTaskResultTone({ questionCount: 10, wrongCount: 0, emptyCount: 0, pendingCount: 0 }), 'all-correct')
})

test('统计未落库（questionCount=0，如老重练答卷）→ unknown，不许下结论', () => {
  assert.equal(resolveTaskResultTone({ questionCount: 0, wrongCount: 0, emptyCount: 0, pendingCount: 0 }), 'unknown')
})

// ── ③ 通知文案 —— 本次事故正面约束 ──

test('有错题：报错题数，绝不出现「全部正确 / 全部做对」', () => {
  const n = buildGradingDoneNotification(task({ questionCount: 14, wrongCount: 5, emptyCount: 2, pendingCount: 1 }))
  assert.equal(n.title, '朱思诺的作业批改完成')
  assert.equal(n.body, '本次作业有 5 道错题，点此查看')
  assert.ok(!/全部正确|全部做对|全对/.test(n.title + n.body))
})

test('错题数为 0 但有空题/待复核：说清待确认，不夸全对', () => {
  const n = buildGradingDoneNotification(task({ questionCount: 14, wrongCount: 0, emptyCount: 4, pendingCount: 3 }))
  assert.equal(n.title, '朱思诺的作业批改完成')
  assert.equal(n.body, '有 4 道未作答、3 道待确认，点此查看')
  assert.ok(!/全部做对/.test(n.body))
})

test('统计缺失：只说批改完成，不夸全对', () => {
  const n = buildGradingDoneNotification(task({}))
  assert.equal(n.body, '点此查看批改结果')
})

test('真·全对：才允许「全部做对」，且带上题数', () => {
  const n = buildGradingDoneNotification(task({ questionCount: 10, wrongCount: 0, emptyCount: 0, pendingCount: 0 }))
  assert.equal(n.title, '朱思诺的作业全部正确')
  assert.equal(n.body, '本次 10 题全部做对，太棒了！')
})

test('无学生名时回落「作业」主语', () => {
  const n = buildGradingDoneNotification({ result: { questionCount: 3, wrongCount: 1 } })
  assert.equal(n.title, '作业批改完成')
})

test('下划线命名同样出对文案（后端映射兜底路径）', () => {
  const n = buildGradingDoneNotification(task({ question_count: 10, wrong_count: 2, questionCount: undefined }))
  assert.equal(n.body, '本次作业有 2 道错题，点此查看')
})

// ── ④ 首页「上次作业」卡同源判据 ──

test('首页：有错题显示错题数', () => {
  assert.equal(buildLatestTaskReminder(task({ questionCount: 12, wrongCount: 3 })).title, '上次作业已批改 · 3 道错题')
})

test('首页：没错题但有空题 → 有题待确认，而非「表现不错」', () => {
  const r = buildLatestTaskReminder(task({ questionCount: 12, wrongCount: 0, emptyCount: 5 }))
  assert.equal(r.title, '上次作业已批改 · 有题待确认')
  assert.ok(!/表现不错/.test(r.title))
})

test('首页：真全对才说表现不错', () => {
  assert.equal(buildLatestTaskReminder(task({ questionCount: 12, wrongCount: 0 })).title, '上次作业已批改，表现不错')
})

// ── ⑤ 列表摘要：与通知同一判据 ──

test('列表摘要：有错题时列出错/空/待复核三桶', () => {
  const { parts } = describeTaskResult({ questionCount: 14, wrongCount: 5, emptyCount: 2, pendingCount: 1 })
  assert.deepEqual(parts.map((p) => p.label), ['共14题', '错5', '空2', '待复核1'])
})

test('列表摘要：统计缺失只说批改完成', () => {
  const { parts } = describeTaskResult({})
  assert.deepEqual(parts.map((p) => p.label), ['批改完成'])
})
