/**
 * 完整性口径：拆小问后「如图」只留在 parent_stem 的场景（2026-09-17 周末班课件第12题）
 *
 * 事故：一道几何证明大题被拆成 (1)(2) 两个小问，公共题干「如图，在△ABC中，D为BC上一点，
 * 点P在AD上…」存在 parent_stem，两个小问 content 只有「(1)若D是BC的中点…」「(2)若D是BC上
 * 任意一点…」，且 geometry_image_url 全为 NULL。
 * 旧口径只读 content → 判不出「题干引图但缺配图」→ is_complete=true → 错题本入册闸放行、
 * 周末班课件与白板都拿到一道没有图的几何题。
 *
 * 这里锁定三条：
 *   1. 引图判定必须看 parent_stem + content；
 *   2. 服务端与前端两份镜像结果必须逐字一致（文件头注释的硬要求）；
 *   3. 错题本风险标签（复核页）与完整性闸同源，不能只拦入册、不提示老师。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkQuestionCompleteness,
  hasFigureReference,
  COMPLETENESS_CODES
} from '../server/utils/questionCompleteness.js'
import { checkQuestionCompleteness as checkFrontend } from '../src/utils/questionCompleteness.js'
import { computeWrongBookRisks } from '../server/utils/wrongBookRisks.js'

const THRESHOLD = 0.8

// 真实事故数据（陈施君/周俊辰 2026-09-17 数学·九上上海作业答案 第12题）
const SHARED_STEM = '如图，在△ABC中，D为BC上一点，点P在AD上，过点P作PM//AC交AB于点M，作PN//AB交AC于点N.'
const SUB_1 = '(1)若D是BC的中点，且AP:PD=2:1，求AM:AB的值;'
const SUB_2 = '(2)若D是BC上任意一点，试证明：AM/AB + AN/AC = AP/AD.'
const ANSWER = '(1) 解：如图 1，过点 D 作 DE // PM 交 AB 于点 E。…'

test('公共题干引图、子题正文不引图、无裁图 → 判不完整（missing_figure）', () => {
  const r = checkQuestionCompleteness({
    parent_stem: SHARED_STEM,
    content: SUB_1,
    geometry_image_url: null,
    question_type: 'answer',
    options: [],
    answer: ANSWER
  })
  assert.equal(r.isComplete, false)
  assert.deepEqual(r.codes, [COMPLETENESS_CODES.missing_figure])
})

test('同母题的第二个小问同样被拦住（不能只拦第一个）', () => {
  const r = checkQuestionCompleteness({
    parent_stem: SHARED_STEM,
    content: SUB_2,
    geometry_image_url: null,
    question_type: 'answer',
    options: [],
    answer: ANSWER
  })
  assert.equal(r.isComplete, false)
  assert.ok(r.codes.includes(COMPLETENESS_CODES.missing_figure))
})

test('补上裁图后同一题立即判完整', () => {
  const r = checkQuestionCompleteness({
    parent_stem: SHARED_STEM,
    content: SUB_1,
    geometry_image_url: 'https://oss/fig-q12.png',
    question_type: 'answer',
    options: [],
    answer: ANSWER
  })
  assert.equal(r.isComplete, true)
  assert.deepEqual(r.codes, [])
})

test('公共题干与子题正文都没有引图词时不误伤（纯代数小问）', () => {
  const r = checkQuestionCompleteness({
    parent_stem: '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).',
    content: '(1)求 a、b 的值；',
    geometry_image_url: null,
    question_type: 'answer',
    options: [],
    answer: 'a=1,b=6'
  })
  assert.equal(r.isComplete, true)
  assert.deepEqual(r.codes, [])
})

test('parent_stem 缺失/为空时行为与旧口径一致（只看 content）', () => {
  const base = {
    content: '如图，求AB的长',
    geometry_image_url: null,
    question_type: 'answer',
    options: [],
    answer: 'AB=5'
  }
  for (const stem of [undefined, null, '', '   ']) {
    const r = checkQuestionCompleteness({ ...base, parent_stem: stem })
    assert.equal(r.isComplete, false, `parent_stem=${JSON.stringify(stem)} 应仍判缺图`)
    assert.deepEqual(r.codes, [COMPLETENESS_CODES.missing_figure])
  }
})

test('hasFigureReference 覆盖 parent_stem，与完整性规则同源', () => {
  assert.equal(hasFigureReference({ content: SUB_1, parent_stem: SHARED_STEM }), true)
  assert.equal(hasFigureReference({ content: SUB_1, parent_stem: null }), false)
  assert.equal(hasFigureReference({ content: '如图，求AB', parent_stem: null }), true)
  assert.equal(hasFigureReference({ content: '', parent_stem: '' }), false)
  assert.equal(hasFigureReference({}), false)
  assert.equal(hasFigureReference(null), false)
})

test('服务端与前端两份镜像对同一输入结果一致', () => {
  const cases = [
    { parent_stem: SHARED_STEM, content: SUB_1, geometry_image_url: null, question_type: 'answer', options: [], answer: ANSWER },
    { parent_stem: SHARED_STEM, content: SUB_2, geometry_image_url: 'https://oss/f.png', question_type: 'answer', options: [], answer: ANSWER },
    { parent_stem: null, content: '如图，求AB的长', geometry_image_url: null, question_type: 'answer', options: [], answer: 'AB=5' },
    { parent_stem: null, content: '12的正因数有___。', geometry_image_url: null, question_type: 'fill', options: [], answer: '1,2,3,4,6,12' },
    { parent_stem: null, content: '下列说法正确的是', geometry_image_url: null, question_type: 'choice', options: [], answer: 'C' },
    { parent_stem: null, content: '解方程 x+1=2', geometry_image_url: null, question_type: null, options: [], answer: 'x=1' },
    { parent_stem: '如图，抛物线…', content: '(1)求解析式', geometry_image_url: null, question_type: 'choice', options: [], answer: '' }
  ]
  for (const [i, q] of cases.entries()) {
    const s = checkQuestionCompleteness(q)
    const f = checkFrontend(q)
    assert.equal(s.isComplete, f.isComplete, `case#${i} isComplete 不一致`)
    assert.deepEqual(s.issues, f.issues, `case#${i} issues 不一致`)
  }
})

test('复核页风险标签与入册闸同源：共享题干缺图题报 missing_figure', () => {
  const risks = computeWrongBookRisks({
    parent_stem: SHARED_STEM,
    content: SUB_1,
    geometry_image_url: null,
    question_type: 'answer',
    options: [],
    answer: ANSWER,
    is_correct: false,
    answer_source: 'worksheet',
    confidence: 0.95,
    is_complete: true // 陈旧缓存列，必须被忽略
  }, false, THRESHOLD)
  assert.deepEqual(risks, [COMPLETENESS_CODES.missing_figure])

  // 补图后标签消失
  assert.deepEqual(computeWrongBookRisks({
    parent_stem: SHARED_STEM,
    content: SUB_1,
    geometry_image_url: 'https://oss/fig-q12.png',
    question_type: 'answer',
    options: [],
    answer: ANSWER,
    is_correct: false,
    answer_source: 'worksheet',
    confidence: 0.95
  }, false, THRESHOLD), [])
})
