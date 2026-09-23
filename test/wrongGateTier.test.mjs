/**
 * 回归测试：闸1 门禁分层（P2，2026-09-23）
 *
 * 锁定的红线（负责人原则）：
 *   **只自动放行「系统没补上」，绝不放行「低置信度需人拍板」。**
 *
 * 背景：原来清单非空即拦整卷。实测 14 天中位每卷只有 1 题需要拍板，但有 51 份卷
 * 需要点「完成复核」→ 成本在弹窗次数，不在每题难度。
 *
 * 本测试的作用是防止后续有人把 low_confidence（或新增 code）顺手塞进自动放行组，
 * 造成"AI 判错但没底气"的题被静默放弃 —— 那会让学生白练、错题本失真。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const {
  classifyWrongGateItem,
  splitWrongGateList,
  WRONG_GATE_AUTO_RESOLVABLE,
  WRONG_GATE_MANUAL_ONLY,
} = await import('../src/domain/wrongGateTier.js')

const item = (issues, extra = {}) => ({ questionId: 'q1', index: 0, source: 'ai', reason: issues.length ? 'incomplete' : 'complete', issues, ...extra })

test('★ 红线：low_confidence 永不自动放行', () => {
  const c = classifyWrongGateItem(item(['low_confidence']))
  assert.equal(c.autoResolvable, false, 'low_confidence 必须拦卷')
  assert.deepEqual(c.manualIssues, ['low_confidence'])
})

test('★ 红线：low_confidence 与系统缺项同时存在时，仍不得自动放行', () => {
  for (const sys of WRONG_GATE_AUTO_RESOLVABLE) {
    const c = classifyWrongGateItem(item([sys, 'low_confidence']))
    assert.equal(c.autoResolvable, false, `${sys} + low_confidence 必须拦卷（取更严的一侧）`)
    assert.ok(c.manualIssues.includes('low_confidence'))
  }
})

test('系统侧缺项（缺图/缺选项/题型非法）可自动放行', () => {
  for (const sys of WRONG_GATE_AUTO_RESOLVABLE) {
    const c = classifyWrongGateItem(item([sys]))
    assert.equal(c.autoResolvable, true, `${sys} 应自动放行`)
    assert.deepEqual(c.autoIssues, [sys])
    assert.deepEqual(c.manualIssues, [])
  }
})

test('系统侧缺项组合（缺图+缺选项）也能整体自动放行', () => {
  const c = classifyWrongGateItem(item(['missing_figure', 'missing_options']))
  assert.equal(c.autoResolvable, true)
  assert.equal(c.autoIssues.length, 2)
})

test('元素完整、无 issues：属系统性漏入，自动放行', () => {
  const c = classifyWrongGateItem(item([], { reason: 'complete' }))
  assert.equal(c.autoResolvable, true)
})

test('★ fail-closed：未知 code 一律按需人工处理，不得自动放行', () => {
  for (const unknown of ['some_future_risk', 'missing_answer', 'weird_thing']) {
    const c = classifyWrongGateItem(item([unknown]))
    assert.equal(c.autoResolvable, false, `未知 code ${unknown} 必须 fail-closed 拦卷`)
    assert.ok(c.manualIssues.includes(unknown))
  }
})

test('splitWrongGateList：按层拆分并给出 needsManual', () => {
  const list = [
    item(['missing_figure'], { questionId: 'a' }),
    item(['low_confidence'], { questionId: 'b' }),
    item(['invalid_type'], { questionId: 'c' }),
    item([], { questionId: 'd', reason: 'complete' }),
  ]
  const { blocking, autoResolvable, needsManual } = splitWrongGateList(list)
  assert.equal(needsManual, true)
  assert.deepEqual(blocking.map(x => x.questionId), ['b'], '只有 low_confidence 那条拦卷')
  assert.deepEqual(autoResolvable.map(x => x.questionId), ['a', 'c', 'd'])
  // 每条都带上分层结论，供 UI 展示 why
  assert.ok(blocking[0].gateClass?.why)
})

test('splitWrongGateList：全是系统侧缺项时 needsManual=false（闸1 可放行）', () => {
  const list = [item(['missing_figure'], { questionId: 'a' }), item(['missing_options'], { questionId: 'b' })]
  const { blocking, autoResolvable, needsManual } = splitWrongGateList(list)
  assert.equal(needsManual, false, '★ 这正是 P2 要省的弹窗')
  assert.equal(blocking.length, 0)
  assert.equal(autoResolvable.length, 2)
})

test('splitWrongGateList：空列表不报错', () => {
  const r = splitWrongGateList([])
  assert.equal(r.needsManual, false)
  assert.equal(r.blocking.length, 0)
  assert.equal(r.autoResolvable.length, 0)
  // 容错：非数组输入
  const r2 = splitWrongGateList(null)
  assert.equal(r2.needsManual, false)
})

test('两个分组常量互斥且覆盖已知 code', () => {
  const overlap = WRONG_GATE_AUTO_RESOLVABLE.filter(c => WRONG_GATE_MANUAL_ONLY.includes(c))
  assert.deepEqual(overlap, [], '两组不得有交集')
  // 与后端 wrongBookRisks.js 的四个 code 对齐（low_confidence 必在人工组）
  assert.ok(WRONG_GATE_MANUAL_ONLY.includes('low_confidence'))
  assert.deepEqual(
    [...WRONG_GATE_AUTO_RESOLVABLE].sort(),
    ['invalid_type', 'missing_figure', 'missing_options']
  )
})
