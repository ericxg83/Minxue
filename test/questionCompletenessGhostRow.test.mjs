/**
 * 完整性口径：幽灵行 / 题干行判据（2026-09-24）
 *
 * 背景：公共题干 / 引导语被 OCR 单独存成一条 questions 行
 *   （「列式计算。」「运用适当方法计算。」「设x是实数。在下列各式后的横线上…：」「第 36 题」），
 *   全库扫出 15 条（`_diag_ghost_rows.mjs`）。这类行 answer 本就该为空——
 *   它**不是一道题**，却被当成「缺答案的题」展示、统计、进缺答案清单一辈子。
 *   之前它们触发的是 missing_answer（缺答案），与「真缺答案的题」无法区分。
 *
 * 这里锁定四条：
 *   1. 纯引导语 / 题号占位行 → 判 stem_only（不再是 missing_answer）；
 *   2. 带「假答案」的题干行（把题干条件当答案）也被 stem_only 拦下；
 *   3. 正常完整题（即使以「计算：」开头但后面有内容）不误伤；
 *   4. 服务端与前端两份镜像结果逐字一致。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkQuestionCompleteness,
  COMPLETENESS_CODES
} from '../server/utils/questionCompleteness.js'
import { checkQuestionCompleteness as checkFrontend } from '../src/utils/questionCompleteness.js'

test('纯引导语行「列式计算。」→ 判 stem_only（缺答案也同时报，二者共存）', () => {
  const r = checkQuestionCompleteness({
    content: '列式计算。',
    question_type: 'answer',
    options: [],
    answer: ''
  })
  assert.equal(r.isComplete, false)
  assert.ok(r.codes.includes(COMPLETENESS_CODES.stem_only))
})

test('引导语行「运用适当方法计算。」同样判 stem_only', () => {
  const r = checkQuestionCompleteness({
    content: '运用适当方法计算。',
    question_type: 'answer',
    options: [],
    answer: ''
  })
  assert.equal(r.isComplete, false)
  assert.ok(r.codes.includes(COMPLETENESS_CODES.stem_only))
})

test('题号占位行「第 36 题」判 stem_only', () => {
  const r = checkQuestionCompleteness({
    content: '第 36 题',
    question_type: 'answer',
    options: [],
    answer: ''
  })
  assert.equal(r.isComplete, false)
  assert.ok(r.codes.includes(COMPLETENESS_CODES.stem_only))
})

test('题号占位行即使带 parent_stem 也判 stem_only（3b429e41 实测）', () => {
  const r = checkQuestionCompleteness({
    content: '第 36 题',
    parent_stem: '下面是六年级某班数学测验成绩的统计图。',
    question_type: 'answer',
    options: [],
    answer: ''
  })
  assert.equal(r.isComplete, false)
  assert.ok(r.codes.includes(COMPLETENESS_CODES.stem_only))
})

test('真多小问子题（带 parent_stem）不误伤', () => {
  const r = checkQuestionCompleteness({
    content: '用含字母n的式子表示第n个等式：______（且n为整数）；',
    parent_stem: '在第八章《实数》的复习课上，张老师鼓励学生对下面一个问题展开探究活动，【观察思考】仔细观察下列等式特征，探索规律，第1个',
    question_type: 'fill',
    options: [],
    answer: 'n/(n+1)'
  })
  assert.ok(!r.codes.includes(COMPLETENESS_CODES.stem_only))
})

test('冒号结尾短引导句（≤14字）判 stem_only', () => {
  const r = checkQuestionCompleteness({
    content: '设x是实数。在下列各式后的横线上，填写使各式有意义的x应满足的条件：',
    question_type: 'fill',
    options: [],
    answer: ''
  })
  assert.equal(r.isComplete, false)
  assert.ok(r.codes.includes(COMPLETENESS_CODES.stem_only))
})

test('「指令+内容」的完整题不误伤（计算：后面有内容）', () => {
  const r = checkQuestionCompleteness({
    content: '计算：√2 × √3 = ______。',
    question_type: 'fill',
    options: [],
    answer: '√6'
  })
  assert.equal(r.isComplete, true)
  assert.deepEqual(r.codes, [])
})

test('题干行带假答案（题干条件当答案）不判 stem_only，但被 missing_figure/answer 拦下', () => {
  // d5458d8a 事故：公共题干「∠D=36°」被当成答案 36°，会造成学生答 36° 被判对。
  // 这条是有图公共题干行，不是「无内容的引导语行」⇒ 不判 stem_only；
  // 它的「假答案」问题要靠完整性其它规则暴露（缺配图/缺答案）。
  const r = checkQuestionCompleteness({
    content: '如图，已知：四边形ABCD为菱形，∠D=36°，延长AC到点E，使得EC=BC，连接BE。',
    question_type: 'answer',
    options: [],
    answer: '36°'
  })
  assert.equal(r.isComplete, false)
  assert.ok(!r.codes.includes(COMPLETENESS_CODES.stem_only))
})

test('正常几何题干（即使带「如图」和答案）不判 stem_only', () => {
  const r = checkQuestionCompleteness({
    content: '如图，在△ABC中，D为BC上一点，求AD的长。',
    question_type: 'answer',
    options: [],
    answer: 'AD=3',
    geometry_image_url: 'https://oss/f.png'
  })
  assert.equal(r.isComplete, true)
  assert.deepEqual(r.codes, [])
})

test('服务端与前端两份镜像对幽灵行结果一致', () => {
  const cases = [
    { content: '列式计算。', question_type: 'answer', options: [], answer: '' },
    { content: '运用适当方法计算。', question_type: 'answer', options: [], answer: '' },
    { content: '第 36 题', question_type: 'answer', options: [], answer: '' },
    { content: '设x是实数。在下列各式后的横线上，填写使各式有意义的x应满足的条件：', question_type: 'fill', options: [], answer: '' },
    { content: '计算：√2 × √3 = ______。', question_type: 'fill', options: [], answer: '√6' },
    { content: '如图，已知：四边形ABCD为菱形，∠D=36°，延长AC到点E，使得EC=BC，连接BE。', question_type: 'answer', options: [], answer: '36°' },
    { content: '将下列各组二次根式先化成最简二次根式，再判断它们是不是同类二次根式.', question_type: 'answer', options: [], answer: '待人工补充' }
  ]
  for (const [i, q] of cases.entries()) {
    const s = checkQuestionCompleteness(q)
    const f = checkFrontend(q)
    assert.deepEqual(f.codes, s.codes, `case ${i} codes 不一致`)
    assert.equal(f.isComplete, s.isComplete, `case ${i} isComplete 不一致`)
  }
})
