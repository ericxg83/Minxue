/**
 * 参考答案来源标签的回归锁（2026-09-14 P2）。
 *
 * 这个标签是**纯展示**的，但它会影响老师的判断方向：看到「AI 生成」老师才会先怀疑答案，
 * 看到「卷面印刷」老师才会先怀疑学生。所以判据必须只用确定的信号，不能猜。
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

test('AI 生成：cache_id 非空（只在答案引擎补答案时写入）', () => {
  const o = getReferenceAnswerOrigin({ answer: '0.31818...', answer_source: 'recognized', cache_id: '83365918-0000-0000-0000-000000000000' })
  assert.equal(o.key, REFERENCE_ANSWER_ORIGIN.AI_GENERATED)
  assert.equal(o.label, 'AI 生成')
  assert.equal(o.tone, 'warning', 'AI 生成要弱提示，所以是 warning 档')
  assert.match(o.hint, /仅供参考/)
  assert.match(o.hint, /改判/, '要告诉老师可以自己改判，不能只提示不给出路')
})

test('卷面印刷：两个信号都没有', () => {
  const o = getReferenceAnswerOrigin({ answer: '√6+2 或 √6-2', answer_source: 'recognized', cache_id: null })
  assert.equal(o.key, REFERENCE_ANSWER_ORIGIN.PRINTED)
  assert.equal(o.label, '卷面印刷')
  assert.equal(o.tone, 'info')
})

test('无参考答案 → 不标来源（异常态另有「AI未判定」提示，别抢它的位置）', () => {
  assert.equal(getReferenceAnswerOrigin({ answer: '', cache_id: 'x' }), null)
  assert.equal(getReferenceAnswerOrigin({ answer: '   ', cache_id: 'x' }), null)
  assert.equal(getReferenceAnswerOrigin({ answer: null, cache_id: 'x' }), null)
  assert.equal(getReferenceAnswerOrigin({}), null)
  assert.equal(getReferenceAnswerOrigin(null), null)
  assert.equal(getReferenceAnswerOrigin(undefined), null)
})

test('优先级：答案库 > AI 生成（同一题两个信号都在时以答案库为准）', () => {
  const o = getReferenceAnswerOrigin({ answer: 'A', answer_source: 'worksheet', cache_id: 'abc' })
  assert.equal(o.key, REFERENCE_ANSWER_ORIGIN.ANSWER_BANK)
})

test('cache_id 为空串/undefined 不得被当成 AI 生成（falsy 边界）', () => {
  for (const cid of ['', undefined, null, 0]) {
    const o = getReferenceAnswerOrigin({ answer: '3', answer_source: 'recognized', cache_id: cid })
    assert.equal(o.key, REFERENCE_ANSWER_ORIGIN.PRINTED, `cache_id=${JSON.stringify(cid)} 应判为卷面印刷`)
  }
})

test('学生答案语义的值不得被误读成参考答案来源', () => {
  // answer_source 是混用列：'recognized'/'blank'/'teacher_input' 讲的是**学生**答案，
  // 只有 'worksheet' 讲参考答案。后三者必须落到「卷面印刷」而不是被当成某种来源。
  for (const s of ['recognized', 'blank', 'teacher_input']) {
    const o = getReferenceAnswerOrigin({ answer: '3', answer_source: s, cache_id: null })
    assert.equal(o.key, REFERENCE_ANSWER_ORIGIN.PRINTED, `answer_source=${s} 不该被当成参考答案来源`)
  }
})

test('返回值形状稳定（PC 与移动端共用，字段不能少）', () => {
  const o = getReferenceAnswerOrigin({ answer: '11', cache_id: 'c' })
  assert.deepEqual(Object.keys(o).sort(), ['hint', 'key', 'label', 'tone'])
})
