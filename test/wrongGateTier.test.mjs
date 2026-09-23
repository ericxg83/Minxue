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
  for (const unknown of ['some_future_risk', 'weird_thing']) {
    const c = classifyWrongGateItem(item([unknown]))
    assert.equal(c.autoResolvable, false, `未知 code ${unknown} 必须 fail-closed 拦卷`)
    assert.ok(c.manualIssues.includes(unknown))
  }
})

// ── 2026-09-23 补：两个「系统侧失败被当人工」的误拦 ──────────────────
//
// 实测近 14 天：46 份 done 未 reviewed 的卷里，9 份把卷拦下来；
// 逐条拆开后发现其中 2 份是 blank 题被判 low_confidence 造成的纯冗余。

test('★ missing_answer 属系统侧失败，可自动放行（不再 fail-closed 拦卷）', () => {
  // 缺答案是「答案引擎没补上」，补答案不归老师 —— 与 missing_figure 同类。
  // 注意：后端 computeWrongBookRisks 对「无参考答案」直接返回空数组，
  // 能走到分层这一步的 missing_answer 只可能是前后端完整性判据不一致。
  const c = classifyWrongGateItem(item(['missing_answer']))
  assert.equal(c.autoResolvable, true, 'missing_answer 应自动放行')
  assert.deepEqual(c.autoIssues, ['missing_answer'])
  assert.deepEqual(c.manualIssues, [])
})

test('★ 未作答（blank）不参与 low_confidence 闸：空题终态，老师无事可拍板', () => {
  // 根因：批改管线对空题写 confidence=0（server/worker.js blank 分支），
  // 天生 conf < 阈值 → 被判 low_confidence → 整卷被拦。
  // 但 blank 在 getReviewState 里是终态，「未作答等同不会」已是统计口径。
  const c = classifyWrongGateItem(item(['low_confidence'], { answerSource: 'blank' }))
  assert.equal(c.autoResolvable, true, 'blank 题不得因 confidence=0 拦卷')
  assert.deepEqual(c.manualIssues, [])
})

test('★ 未作答（blank）即便带缺图，也不因 low_confidence 被拦', () => {
  const c = classifyWrongGateItem(item(['missing_figure', 'low_confidence'], { answerSource: 'blank' }))
  assert.equal(c.autoResolvable, true, 'blank + 缺图 应整体自动放行')
  assert.deepEqual(c.autoIssues, ['missing_figure'])
})

test('★ 红线不变：已作答（recognized）的 low_confidence 仍一律拦卷', () => {
  // 与上一条形成对照 —— 摘除只认 answer_source，不认 confidence 高低，
  // 防止用「给题补个高 confidence」绕过人工拍板。
  for (const src of ['recognized', 'teacher_input', 'worksheet', null, undefined]) {
    const c = classifyWrongGateItem(item(['low_confidence'], { answerSource: src }))
    assert.equal(c.autoResolvable, false, `answerSource=${src} 的 low_confidence 必须拦卷`)
    assert.ok(c.manualIssues.includes('low_confidence'))
  }
})

test('★ 红线不变：blank 与真实的未知 code 同时存在时，仍拦卷', () => {
  const c = classifyWrongGateItem(item(['low_confidence', 'some_future_risk'], { answerSource: 'blank' }))
  assert.equal(c.autoResolvable, false, '未知 code 优先，仍 fail-closed')
  assert.ok(c.manualIssues.includes('some_future_risk'))
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
    ['invalid_type', 'missing_answer', 'missing_figure', 'missing_options']
  )
  // low_confidence 是唯一的人工项 —— 新增人工 code 前必须回到负责人原则重新评审
  assert.deepEqual([...WRONG_GATE_MANUAL_ONLY], ['low_confidence'])
})
