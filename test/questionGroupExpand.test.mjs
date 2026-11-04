/**
 * questionGroupExpand.test.mjs — 「整题入卷」扩展的回归锁（2026-11-04）
 *
 * 背景：错题按小问记行，重练卷只印一个小问 ⇒ 学生做得莫名其妙。
 * 新口径：小问成为错题 ⇒ 整道大题（同 task+页+题号的全部小问）一起组卷。
 *
 * 本测试锁四件事：
 *   ① 正常的 (1)(2)(10) 组按**数值**排序展开（不是字典序）；
 *   ② 数据可疑的组一律不扩展（空 sub_no 兄弟 / 同 sub 内容冲突 / parent_stem 不一致）；
 *   ③ 展开后保持入参顺序、同组不重复、幂等；
 *   ④ 纯函数与查询版共用同一套判据（不各写一份）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  planGroupExpansion,
  expandQuestionIdsForPaper,
  subNoSortValue,
  normalizeSubNo,
} from '../server/utils/questionGroupExpand.js'

const mkRow = (id, subNo, extra = {}) => ({
  id,
  task_id: 't1',
  page_number: 1,
  question_number: 10,
  sub_no: subNo,
  parent_stem: '已知抛物线 y=x²-2x+2m-4，其中 m 为常数.',
  content: `第${subNo}问`,
  ...extra,
})

test('sub_no 归一化与排序：10 排在 2 之后', () => {
  assert.equal(normalizeSubNo(' （2） '), '2')
  assert.ok(subNoSortValue('10') > subNoSortValue('2'))
  assert.ok(subNoSortValue('2-1') > subNoSortValue('2'))
  assert.ok(subNoSortValue('2-2') < subNoSortValue('3'))
})

test('正常大题：整组按数值序展开', () => {
  const sel = mkRow('q2', '2')
  const rows = [mkRow('q10', '10'), mkRow('q2', '2'), mkRow('q1', '1')]
  const plan = planGroupExpansion(sel, rows)
  assert.equal(plan.reason, 'ok')
  assert.deepEqual(plan.ids, ['q1', 'q2', 'q10'])
})

test('选中行没有 sub_no（整题行）⇒ 不扩展', () => {
  const sel = mkRow('q1', null)
  const plan = planGroupExpansion(sel, [sel, mkRow('q2', '2')])
  assert.equal(plan.ids, null)
  assert.equal(plan.reason, 'selected_without_sub_no')
})

test('组里只有自己一个小问 ⇒ 不扩展', () => {
  const sel = mkRow('q1', '1')
  const plan = planGroupExpansion(sel, [sel])
  assert.equal(plan.ids, null)
  assert.equal(plan.reason, 'no_sibling_sub')
})

test('空 sub_no 的兄弟行（OCR 题号错编）不得混进卷子', () => {
  const sel = mkRow('q2', '2')
  const rows = [
    sel,
    mkRow('q1', '1'),
    mkRow('qx', null, { parent_stem: '', content: '另一道无关题' }),
  ]
  const plan = planGroupExpansion(sel, rows)
  assert.equal(plan.reason, 'ok')
  assert.deepEqual(plan.ids, ['q1', 'q2'])
})

test('同一 sub_no 内容不同（题号错编）⇒ 整组放弃', () => {
  const sel = mkRow('q1', '1')
  const rows = [sel, mkRow('q1b', '1', { content: '完全不同的另一道题' }), mkRow('q2', '2')]
  const plan = planGroupExpansion(sel, rows)
  assert.equal(plan.ids, null)
  assert.equal(plan.reason, 'duplicate_sub_conflict')
})

test('同一 sub_no 内容相同（重复入库，仅格式差异）⇒ 去重保留一条', () => {
  const sel = mkRow('q1', '1', { content: 'x² + 1 = 0' })
  const rows = [sel, mkRow('q1b', '1', { content: 'x²+1=0' }), mkRow('q2', '2')]
  const plan = planGroupExpansion(sel, rows)
  assert.equal(plan.reason, 'ok')
  assert.equal(plan.ids.length, 2)
  assert.ok(plan.ids.includes('q2'))
})

test('parent_stem 各不相同（不同题共用题号）⇒ 整组放弃', () => {
  const sel = mkRow('q1', '1', { parent_stem: '已知二次函数图像经过原点' })
  const rows = [sel, mkRow('q2', '2', { parent_stem: '某班有 40 名学生' })]
  const plan = planGroupExpansion(sel, rows)
  assert.equal(plan.ids, null)
  assert.equal(plan.reason, 'parent_stem_mismatch')
})

test('parent_stem 部分为空的历史数据：非空的一致即可扩展', () => {
  const sel = mkRow('q1', '1', { parent_stem: '' })
  const rows = [sel, mkRow('q2', '2', { parent_stem: '公共条件' }), mkRow('q3', '3', { parent_stem: '' })]
  const plan = planGroupExpansion(sel, rows)
  assert.equal(plan.reason, 'ok')
  assert.deepEqual(plan.ids, ['q1', 'q2', 'q3'])
})

/* ── 查询版：顺序 / 去重 / 幂等 ───────────────────────────── */

const makeRunQuery = (allRows) => async (sql, params) => {
  if (sql.includes('ANY($1::uuid[])')) {
    const set = new Set((params[0] || []).map(String))
    return { rows: allRows.filter((r) => set.has(String(r.id))) }
  }
  // 组查询：按 (task_id, page_number, question_number) 元组返回
  const tuples = []
  for (let i = 0; i + 2 < params.length; i += 3) {
    tuples.push(`${params[i]}|${params[i + 1]}|${params[i + 2]}`)
  }
  return {
    rows: allRows.filter((r) => tuples.includes(`${r.task_id}|${r.page_number}|${r.question_number}`)),
  }
}

const POOL = [
  // 组 A：第 10 题 (1)(2)(3)
  mkRow('a1', '1'), mkRow('a2', '2'), mkRow('a3', '3'),
  // 组 B：第 12 题 (1)(2)，另一页
  mkRow('b1', '1', { question_number: 12, page_number: 2, content: 'B1' }),
  mkRow('b2', '2', { question_number: 12, page_number: 2, content: 'B2' }),
  // 单题（无小问）
  { id: 'c1', task_id: 't1', page_number: 3, question_number: 5, sub_no: null, parent_stem: '', content: 'C' },
]

test('查询版：勾 (2) ⇒ 整组 (1)(2)(3)，单题保持原位', async () => {
  const { ids, groups, addedCount } = await expandQuestionIdsForPaper(
    ['c1', 'a2'], { runQuery: makeRunQuery(POOL) }
  )
  assert.deepEqual(ids, ['c1', 'a1', 'a2', 'a3'])
  assert.equal(addedCount, 2)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].questionNumber, 10)
  assert.deepEqual(groups[0].addedIds, ['a1', 'a3'])
})

test('查询版：同组勾了两个小问 ⇒ 只展开一次、不重复', async () => {
  const { ids } = await expandQuestionIdsForPaper(['a2', 'a3'], { runQuery: makeRunQuery(POOL) })
  assert.deepEqual(ids, ['a1', 'a2', 'a3'])
})

test('查询版：幂等 —— 扩展结果再扩展不变', async () => {
  const runQuery = makeRunQuery(POOL)
  const first = await expandQuestionIdsForPaper(['a2'], { runQuery })
  const second = await expandQuestionIdsForPaper(first.ids, { runQuery })
  assert.deepEqual(second.ids, first.ids)
  assert.equal(second.addedCount, 0)
})

test('查询版：两个组各自展开，组间顺序按入参', async () => {
  const { ids } = await expandQuestionIdsForPaper(['b1', 'a3'], { runQuery: makeRunQuery(POOL) })
  assert.deepEqual(ids, ['b1', 'b2', 'a1', 'a2', 'a3'])
})
