import test from 'node:test'
import assert from 'node:assert/strict'
import { computeWrongBookRisks } from '../server/utils/wrongBookRisks.js'
import { checkQuestionCompleteness, COMPLETENESS_CODES } from '../server/utils/questionCompleteness.js'

const THRESHOLD = 0.8

// 2026-09-11 用户报「这题根本没有图啊」：复核页对题干无图的填空题打「⚠ 缺图」。
// 根因是 computeWrongBookRisks 拿 questions.is_complete 落库列判缺图，而该列是建题
// 那一刻算一次的反范式缓存，答案为空 → false，答案解析补齐后无人回写。
// 这条用例锁定「必须按动态口径现算，且不能被落库列带偏」。
test('题干无图且答案齐全的题不报缺图（is_complete 落库列 false 也不算）', () => {
  const risks = computeWrongBookRisks({
    is_correct: false,
    answer_source: 'recognized',
    answer: '12',
    question_type: 'fill',
    content: '能被2、3整除的最小两位数是___。',
    options: [],
    geometry_image_url: null,
    confidence: 0.95,
    is_complete: false // 陈旧落库列，必须被忽略
  }, false, THRESHOLD)
  assert.deepEqual(risks, [])
})

test('算式类题干不含"图"字样时不报缺图', () => {
  const risks = computeWrongBookRisks({
    is_correct: false,
    answer_source: 'recognized',
    answer: '45能被5整除',
    question_type: 'fill',
    content: '算式45÷5=9中，___能被___整除；算式18÷6=3中，18÷6能整除___。',
    confidence: 0.95,
    is_complete: false
  }, false, THRESHOLD)
  assert.deepEqual(risks, [])
})

test('题干引图但无配图才报缺图，补上配图即消失', () => {
  const base = {
    is_correct: false,
    answer_source: 'recognized',
    answer: 'AB=5',
    question_type: 'answer',
    content: '如图，在△ABC中，AB=AC，求AB的长。',
    confidence: 0.95
  }
  assert.deepEqual(
    computeWrongBookRisks(base, false, THRESHOLD),
    [COMPLETENESS_CODES.missing_figure]
  )
  assert.deepEqual(
    computeWrongBookRisks({ ...base, geometry_image_url: 'https://oss/fig.png' }, false, THRESHOLD),
    []
  )
})

// 四种缺项此前共用一个 missing_figure 标签，老师按提示去补图永远补不好。
test('选择题缺选项报 missing_options 而不是 missing_figure', () => {
  const risks = computeWrongBookRisks({
    is_correct: false,
    answer_source: 'recognized',
    answer: 'C',
    question_type: 'choice',
    content: '下列说法中正确的是',
    options: [],
    confidence: 0.95,
    is_complete: false
  }, false, THRESHOLD)
  assert.deepEqual(risks, ['missing_options'])
  assert.ok(!risks.includes('missing_figure'))
})

test('题型非法报 invalid_type', () => {
  const risks = computeWrongBookRisks({
    is_correct: false,
    answer_source: 'recognized',
    answer: 'x=1',
    question_type: null,
    content: '解方程 x+1=2',
    confidence: 0.95,
    is_complete: false
  }, false, THRESHOLD)
  assert.deepEqual(risks, ['invalid_type'])
})

test('多种缺项同时存在时逐个上报', () => {
  const risks = computeWrongBookRisks({
    is_correct: false,
    answer_source: 'recognized',
    answer: 'C',
    question_type: 'choice',
    content: '如图，下列说法正确的是',
    options: [],
    confidence: 0.95
  }, false, THRESHOLD)
  assert.deepEqual(risks, ['missing_figure', 'missing_options'])
})

test('低置信与硬缺项可以叠加', () => {
  const risks = computeWrongBookRisks({
    is_correct: false,
    answer_source: 'recognized',
    answer: 'AB=5',
    question_type: 'answer',
    content: '如图，求AB的长',
    confidence: 0.5
  }, false, THRESHOLD)
  assert.deepEqual(risks, ['missing_figure', 'low_confidence'])
})

test('已入册、判对、无答案的题不报风险', () => {
  const q = {
    is_correct: false,
    answer_source: 'recognized',
    answer: 'AB=5',
    question_type: 'answer',
    content: '如图，求AB的长',
    confidence: 0.95
  }
  // 已入册：老师可能强入过，再显示标签会自相矛盾
  assert.deepEqual(computeWrongBookRisks(q, true, THRESHOLD), [])
  // 判对的题不会被错题本挡
  assert.deepEqual(computeWrongBookRisks({ ...q, is_correct: true }, false, THRESHOLD), [])
  // 无参考答案：沿用既有语义，不刷标签（缺答案不在此处提示）
  assert.deepEqual(computeWrongBookRisks({ ...q, answer: '' }, false, THRESHOLD), [])
})

test('未作答（answer_source=blank）同样参与风险判定', () => {
  const risks = computeWrongBookRisks({
    is_correct: null,
    answer_source: 'blank',
    answer: 'AB=5',
    question_type: 'answer',
    content: '如图，求AB的长',
    confidence: null
  }, false, THRESHOLD)
  assert.deepEqual(risks, ['missing_figure'])
})

test('checkQuestionCompleteness 返回与 issues 一一对应的稳定 codes', () => {
  const r = checkQuestionCompleteness({
    content: '如图，求AB的长',
    question_type: 'choice',
    options: [],
    answer: '',
    geometry_image_url: null
  })
  assert.equal(r.isComplete, false)
  assert.deepEqual(r.codes, [
    COMPLETENESS_CODES.missing_figure,
    COMPLETENESS_CODES.missing_options,
    COMPLETENESS_CODES.missing_answer
  ])
  assert.equal(r.issues.length, r.codes.length)
})

test('完整题目 codes 为空数组', () => {
  const r = checkQuestionCompleteness({
    content: '12的正因数有___。',
    question_type: 'fill',
    options: [],
    answer: '1,2,3,4,6,12',
    geometry_image_url: null
  })
  assert.equal(r.isComplete, true)
  assert.deepEqual(r.codes, [])
  assert.deepEqual(r.issues, [])
})
