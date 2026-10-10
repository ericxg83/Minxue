/**
 * wrongQuestionRelink 匹配逻辑回归测试（2026-10-10 断根/清存量前置）
 *
 * ⛔ 本测试锁的是「宁可少接、不可接错」的精确匹配口径：
 *   - 题号/小问号精确相等；多小问时内容归一化逐字相等辅助定位
 *   - 档案被占用 → merge（删孤儿），绝不覆写占用者
 *   - 匹配不上 → keep，绝不硬凑（接错档案比不接更糟）
 *   违反任何一条的历史教训：相似度合并会毁掉错题长期数据（AGENTS.md 禁止事项 6）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { planForOrphan, planRelinks, normContent, snapshotWrongQuestionsForTask, relinkWithSnapshot } from '../server/utils/wrongQuestionRelink.js'

const row = (id, question_number, sub_no, content, occupied = false) => ({
  id, question_number, sub_no, content, occupied,
})

test('normContent：空白与大小写不影响逐字相等判定', () => {
  assert.equal(normContent(' 求 BC₁ 的长； '), normContent('求bc₁的长；'))
  assert.notEqual(normContent('求BC₁的长'), normContent('求BC2的长'))
})

test('唯一同题号且空闲 → relink', () => {
  const plan = planForOrphan(
    { wqId: 'w1', questionNumber: 3, content: '下列式子正确的是' },
    [row('q1', 3, null, '下列式子正确的是')]
  )
  assert.equal(plan.action, 'relink')
  assert.equal(plan.targetId, 'q1')
})

test('唯一同题号但被占用 → merge（重跑后同题已重新入册）', () => {
  const plan = planForOrphan(
    { wqId: 'w1', questionNumber: 3, content: '下列式子正确的是' },
    [row('q1', 3, null, '下列式子正确的是', true)]
  )
  assert.equal(plan.action, 'merge')
  assert.equal(plan.targetId, 'q1')
})

test('同题号多行（小问拆分）+ 内容唯一命中 → relink', () => {
  const plan = planForOrphan(
    { wqId: 'w1', questionNumber: 5, content: '求 BC₁ 的长；' },
    [
      row('q1', 5, '1', '(1) 求证：XX'),
      row('q2', 5, '2', '求 BC₁ 的长；'),
    ]
  )
  assert.equal(plan.action, 'relink')
  assert.equal(plan.targetId, 'q2')
})

test('同题号多行且内容无法唯一定位 → keep（不硬接）', () => {
  const plan = planForOrphan(
    { wqId: 'w1', questionNumber: 5, content: '第2问被OCR改写了' },
    [
      row('q1', 5, '1', '(1) 求证：XX'),
      row('q2', 5, '2', '求 BC₁ 的长；'),
    ]
  )
  assert.equal(plan.action, 'keep')
})

test('断根场景：snapshot 带 sub_no，二元组精确匹配（不依赖内容）', () => {
  const plan = planForOrphan(
    { wqId: 'w1', questionNumber: 5, subNo: '2', content: '重跑后OCR文字略有不同' },
    [
      row('q1', 5, '1', '(1) 求证：XX'),
      row('q2', 5, '2', '(2) 求BC的长'), // 内容与孤儿不同，但 (5,'2') 唯一
    ]
  )
  assert.equal(plan.action, 'relink')
  assert.equal(plan.targetId, 'q2')
})

test('断根场景：重跑后小问结构变化 → keep（宁缺毋滥）', () => {
  const plan = planForOrphan(
    { wqId: 'w1', questionNumber: 5, subNo: '3', content: 'x' },
    [
      row('q1', 5, '1', 'a'),
      row('q2', 5, '2', 'b'),
    ]
  )
  assert.equal(plan.action, 'keep')
})

test('同task下无同题号档案 → keep', () => {
  const plan = planForOrphan(
    { wqId: 'w1', questionNumber: 9, content: 'x' },
    [row('q1', 3, null, 'x')]
  )
  assert.equal(plan.action, 'keep')
})

test('planRelinks：按 student|task 分桶路由', () => {
  const orphans = [
    { id: 'w1', student_id: 's1', last_wrong_task_id: 't1', question_no: 3, content: 'A题' },
    { id: 'w2', student_id: 's2', last_wrong_task_id: 't1', question_no: 3, content: 'B题' },
  ]
  const archive = new Map([
    ['s1|t1', [row('q1', 3, null, 'A题')]],
    // s2|t1 缺失 → keep
  ])
  const plans = planRelinks(orphans, archive)
  assert.equal(plans[0].action, 'relink')
  assert.equal(plans[0].targetId, 'q1')
  assert.equal(plans[1].action, 'keep')
})

test('relinkWithSnapshot：UPDATE 带.question_id IS NULL 守卫；keep 不写库', async () => {
  const updates = []
  const fakeQuery = async (sql, params) => {
    updates.push({ sql, params })
    return { rowCount: 1 }
  }
  const snapshot = [
    { wqId: 'w1', questionNumber: 3, subNo: null, content: 'A题' },
    { wqId: 'w2', questionNumber: 9, subNo: null, content: '不存在' },
  ]
  const newRows = [row('q-new', 3, null, 'A题')]
  const res = await relinkWithSnapshot(fakeQuery, 't1', snapshot, newRows)
  assert.equal(res.relinked, 1)
  assert.equal(res.kept, 1)
  assert.equal(updates.length, 1) // keep 不得写库
  assert.match(updates[0].sql, /question_id IS NULL/)
  assert.equal(updates[0].params[0], 'q-new')
  assert.equal(updates[0].params[1], 'w1')
})

test('snapshotWrongQuestionsForTask：只取挂在该 task 档案上的错题', async () => {
  const calls = []
  const fakeQuery = async (sql, params) => {
    calls.push({ sql, params })
    return { rows: [{ wq_id: 'w1', question_number: 3, sub_no: '1', content: 'x' }] }
  }
  const snap = await snapshotWrongQuestionsForTask(fakeQuery, 't1')
  assert.equal(snap.length, 1)
  assert.equal(snap[0].wqId, 'w1')
  assert.equal(snap[0].subNo, '1')
  assert.match(calls[0].sql, /q\.task_id = \$1/)
})
