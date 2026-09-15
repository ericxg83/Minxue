/**
 * 参考答案来源标签的回归锁（2026-09-14 P2 引入，2026-09-15 收敛为两档）。
 *
 * 这个标签是**纯展示**的，但它会影响老师的判断方向：看到「AI 解答」老师才会先怀疑答案，
 * 看到「答案库」老师才会信任参考。口径（负责人 2026-09-15 确认）：卷面上只印题目、
 * 不印答案，参考答案只可能来自练习册答案库或 AI 解答 —— 原来的「卷面印刷」兜底档
 * 前提不成立，已废除；无 cache_id 的非练习册答案同样来自 AI 链路。
 * 事故背景：错题再测-0911 里老师反复怀疑批改逻辑，实际是 AI 补的参考答案错了（`29`、`2`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getReferenceAnswerOrigin, REFERENCE_ANSWER_ORIGIN } from '../src/utils/reviewDecision.js'

test('答案库：answer_source=worksheet（练习册管线显式写入）', () => {
  const o = getReferenceAnswerOrigin({ answer: '11', answer_source: 'worksheet', cache_id: null })
  assert.equal(o.key, REFERENCE_ANSWER_ORIGIN.ANSWER_BANK)
  assert.equal(o.label, '答案库')
  assert.equal(o.tone, 'info')
})

test('AI 解答：cache_id 非空（答案引擎补答案的强信号）', () => {
  const o = getReferenceAnswerOrigin({ answer: '0.31818...', answer_source: 'recognized', cache_id: '83365918-0000-0000-0000-000000000000' })
  assert.equal(o.key, REFERENCE_ANSWER_ORIGIN.AI_GENERATED)
  assert.equal(o.label, 'AI 解答')
  assert.equal(o.tone, 'warning', 'AI 解答要弱提示，所以是 warning 档')
  assert.match(o.hint, /仅供参考/)
  assert.match(o.hint, /改判/, '要告诉老师可以自己改判，不能只提示不给出路')
})

test('非练习册答案一律归 AI 解答（卷面印刷兜底档已废除）', () => {
  const o = getReferenceAnswerOrigin({ answer: '√6+2 或 √6-2', answer_source: 'recognized', cache_id: null })
  assert.equal(o.key, REFERENCE_ANSWER_ORIGIN.AI_GENERATED, '无 cache_id 的存量数据同样来自 AI 链路，不许标「卷面印刷」')
  assert.equal(o.label, 'AI 解答')
  assert.equal(o.tone, 'warning')
})

test('无参考答案 → 不标来源（异常态另有「AI未判定」提示，别抢它的位置）', () => {
  assert.equal(getReferenceAnswerOrigin({ answer: '', cache_id: 'x' }), null)
  assert.equal(getReferenceAnswerOrigin({ answer: '   ', cache_id: 'x' }), null)
  assert.equal(getReferenceAnswerOrigin({ answer: null, cache_id: 'x' }), null)
  assert.equal(getReferenceAnswerOrigin({}), null)
  assert.equal(getReferenceAnswerOrigin(null), null)
  assert.equal(getReferenceAnswerOrigin(undefined), null)
})

test('优先级：答案库 > AI 解答（同一题两个信号都在时以答案库为准）', () => {
  const o = getReferenceAnswerOrigin({ answer: 'A', answer_source: 'worksheet', cache_id: 'abc' })
  assert.equal(o.key, REFERENCE_ANSWER_ORIGIN.ANSWER_BANK)
})

test('cache_id 为空串/undefined 同样归 AI 解答（兜底口径，不再单列第三档）', () => {
  for (const cid of ['', undefined, null, 0]) {
    const o = getReferenceAnswerOrigin({ answer: '3', answer_source: 'recognized', cache_id: cid })
    assert.equal(o.key, REFERENCE_ANSWER_ORIGIN.AI_GENERATED, `cache_id=${JSON.stringify(cid)} 应归为 AI 解答`)
  }
})

test('学生答案语义的值不得被误读成参考答案来源', () => {
  // answer_source 是混用列：'recognized'/'blank'/'teacher_input' 讲的是**学生**答案，
  // 只有 'worksheet' 讲参考答案。后三者必须落「AI 解答」而不是被当成某种来源。
  for (const s of ['recognized', 'blank', 'teacher_input']) {
    const o = getReferenceAnswerOrigin({ answer: '3', answer_source: s, cache_id: null })
    assert.equal(o.key, REFERENCE_ANSWER_ORIGIN.AI_GENERATED, `answer_source=${s} 不该被当成参考答案来源`)
  }
})

test('返回值形状稳定（PC 与移动端共用，字段不能少）', () => {
  const o = getReferenceAnswerOrigin({ answer: '11', cache_id: 'c' })
  assert.deepEqual(Object.keys(o).sort(), ['hint', 'key', 'label', 'tone'])
})

test('PRINTED 档已删除（防止旧代码继续引用）', () => {
  assert.equal(REFERENCE_ANSWER_ORIGIN.PRINTED, undefined)
})
