/**
 * 回归测试：闸1 卷级自动完成判据（L0，2026-09-23）
 *
 * 锁定的目标（负责人原话）：
 *   「AI 已经判定是正确是错误，那就应该自动复核」
 *   「如果说是不能复核，因为图没有、选项没有这种的话，应该先行判断，
 *     该补的补上再进行判断。而不是全部等着人工来补。」
 *   「如果是主观题的话，判断不出，可以人工来判断。」
 *
 * ⇒ L0 已判出 → 自动；L1 系统侧缺口 → 先补（不拦老师）；L2 真判不出 → 人工。
 *
 * 本测试防止两件坏事：
 *   ① 有人把「低置信度的 AI 判错」当成"没判出"顺手自动放行
 *      → 学生会白练错题、错题本失真。低置信≠没判出，它仍是 AI 的明确结论。
 *   ② 有人把 blank（未作答）算成"要老师处理"
 *      → 实测 14 天有 83 道空题在拦卷，老师只能点一次记录一次系统给空题打分。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const {
  isJudgedForPaperAutoComplete,
  resolveJudgeOutcome,
  resolvePaperAutoComplete,
} = await import('../src/domain/paperReviewDecision.js')

// ── 单题：什么算「已判出」──────────────────────────────

test('★ L0：is_correct 非空即已判出（置信度高低不影响"已判出"）', () => {
  assert.equal(isJudgedForPaperAutoComplete({ id: 'a', is_correct: true, confidence: 0.99 }), true)
  assert.equal(isJudgedForPaperAutoComplete({ id: 'b', is_correct: false, confidence: 0.55 }), true)
  // ★ 红线：低置信 ≠ 没判出。0.2 也是明确结论，不能自动放行掉。
  assert.equal(isJudgedForPaperAutoComplete({ id: 'c', is_correct: false, confidence: 0.2 }), true)
  assert.equal(isJudgedForPaperAutoComplete({ id: 'd', is_correct: true, confidence: 0 }), true)
})

test('★ L0：未作答（blank）是终态，算已判出', () => {
  assert.equal(
    isJudgedForPaperAutoComplete({ id: 'a', answer_source: 'blank', is_correct: null, confidence: 0 }),
    true
  )
  // blank 且管线给了判定的（有的分支会写 is_correct）同样算已判出
  assert.equal(
    isJudgedForPaperAutoComplete({ id: 'b', answer_source: 'blank', is_correct: false, confidence: 0 }),
    true
  )
})

test('★ L0：老师已下过结论的算已判出（含"排除"）', () => {
  for (const rs of ['correct', 'wrong', 'wrong_no_book', 'exclude']) {
    assert.equal(
      isJudgedForPaperAutoComplete({ id: 'x', review_status: rs, is_correct: null, confidence: null }),
      true,
      `review_status=${rs} 是老师已处理，不该再拦卷`
    )
  }
})

test('★ L2：is_correct 为空且非 blank ⇒ 未判出，留人工', () => {
  // exception：AI 拒绝给结论（有 confidence 说明跑完了）
  assert.equal(isJudgedForPaperAutoComplete({ id: 'a', is_correct: null, confidence: 0.7 }), false)
  // processing：还没跑完（confidence 也是空）
  assert.equal(isJudgedForPaperAutoComplete({ id: 'b', is_correct: null, confidence: null }), false)
  // 主观题典型形态：判不出，等人工
  assert.equal(
    isJudgedForPaperAutoComplete({ id: 'c', is_correct: null, confidence: 0.4, answer_source: 'recognized' }),
    false
  )
})

test('resolveJudgeOutcome：人工结论优先于 AI，exclude 视为未定', () => {
  assert.equal(resolveJudgeOutcome({ review_status: 'correct', is_correct: false }), true)
  assert.equal(resolveJudgeOutcome({ review_status: 'wrong', is_correct: true }), false)
  assert.equal(resolveJudgeOutcome({ review_status: 'wrong_no_book', is_correct: null }), false)
  assert.equal(resolveJudgeOutcome({ review_status: 'exclude', is_correct: false }), null)
  assert.equal(resolveJudgeOutcome({ is_correct: true }), true)
  assert.equal(resolveJudgeOutcome({ is_correct: false }), false)
  assert.equal(resolveJudgeOutcome({}), null)
  assert.equal(resolveJudgeOutcome(null), null)
})

// ── 卷级：能不能自动完成 ────────────────────────────────

test('★ 全卷已判出、无人工项 ⇒ 可自动完成', () => {
  const qs = [
    { id: 'q1', is_correct: true, confidence: 0.95 },
    { id: 'q2', is_correct: false, confidence: 0.92 },
    { id: 'q3', is_correct: false, confidence: 0.3 },   // 低置信但已判出
    { id: 'q4', answer_source: 'blank', is_correct: null, confidence: 0 },
  ]
  const r = resolvePaperAutoComplete(qs, [])
  assert.equal(r.canAutoComplete, true)
  assert.equal(r.judgedCount, 4)
  assert.deepEqual(r.unjudged, [])
  assert.deepEqual(r.reasons, [])
})

test('★ 有未判出题 ⇒ 不自动完成，并把题点出来', () => {
  const qs = [
    { id: 'q1', is_correct: true, confidence: 0.95 },
    { id: 'q2', is_correct: null, confidence: 0.8 },   // exception
    { id: 'q3', is_correct: null, confidence: null },  // processing
  ]
  const r = resolvePaperAutoComplete(qs, [])
  assert.equal(r.canAutoComplete, false)
  assert.equal(r.judgedCount, 1)
  assert.deepEqual(r.unjudged.map(u => [u.questionId, u.state]), [['q2', 'exception'], ['q3', 'processing']])
  assert.ok(r.reasons.some(x => x.includes('未判出')))
})

test('★ 有待拍板错题 ⇒ 不自动完成', () => {
  const qs = [{ id: 'q1', is_correct: false, confidence: 0.9 }]
  const r = resolvePaperAutoComplete(qs, [{ questionId: 'q1', index: 0 }])
  assert.equal(r.canAutoComplete, false)
  assert.ok(r.reasons.some(x => x.includes('待老师拍板')))
})

test('★ 空卷不自动完成（避免误关）', () => {
  const r = resolvePaperAutoComplete([], [])
  assert.equal(r.canAutoComplete, false)
  assert.ok(r.reasons.some(x => x.includes('题目列表为空')))
})

test('★ 入参容错：非数组不炸', () => {
  assert.doesNotThrow(() => resolvePaperAutoComplete(null, null))
  assert.doesNotThrow(() => resolvePaperAutoComplete(undefined, undefined))
  assert.equal(resolvePaperAutoComplete(null, null).canAutoComplete, false)
})

// ── 与场景数据对齐（复现近 14 天实测分布）────────────────

test('★ 场景：30 题卷（已判出 24 + 未作答 6），旧的错题门禁拦着 ⇒ 现在应自动完成', () => {
  // 对应实测：7 份卷「只被未作答拦住」。这 6 道空题在旧实现里因 confidence=0
  // 命中 low_confidence 进了闸1 清单 → 整卷拦下。现在空题是终态、不入清单。
  const qs = []
  for (let i = 0; i < 24; i++) qs.push({ id: `r${i}`, is_correct: i % 3 === 0, confidence: 0.9 })
  for (let i = 0; i < 6; i++) qs.push({ id: `b${i}`, answer_source: 'blank', is_correct: null, confidence: 0 })
  const r = resolvePaperAutoComplete(qs, [])
  assert.equal(r.canAutoComplete, true, '空题是终态，不该再拦整卷')
  assert.equal(r.judgedCount, 30)
})

test('★ 场景：主观题卷（3 题 AI 拒绝给结论）⇒ 仍需人工，但只需看那 3 题', () => {
  const qs = [
    { id: 'q1', is_correct: true, confidence: 0.95 },
    { id: 'q2', is_correct: null, confidence: 0.6 },
    { id: 'q3', is_correct: null, confidence: 0.6 },
    { id: 'q4', is_correct: null, confidence: 0.6 },
  ]
  const r = resolvePaperAutoComplete(qs, [])
  assert.equal(r.canAutoComplete, false)
  assert.equal(r.unjudged.length, 3)
  assert.equal(r.judgedCount, 1)
})
