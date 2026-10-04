/**
 * 专项重练卷预览 · 预筛与勾选语义（r142）—— 真跑断言，不看源码
 *
 * 为什么单独一个文件：这些是本轮唯一有分支语义的东西（三种预筛 + 去重 + 排除）。
 * 只写在 .vue 里就只能上源码锁，而源码锁看不见语义变化
 * ——把 `>= 2` 改成 `> 2`、把 errorType 全等改成 includes，grep 全绿但功能已错。
 * 提成纯函数后可以直接喂真实形状的数据断言行为。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWrongItems, inScope, pickDefaults, toExamQuestionIds, errorTypeTone } from '../src/workbench/components/diagnosis/retryPaperScope.js'

/** 造一条错题行，形状与 getWrongQuestionsByStudent 的返回一致 */
const wq = (over = {}) => ({
  id: over.wqId || 'w1',
  question_id: 'q1',
  error_type: '计算错误',
  error_count: 1,
  lifecycle_status: 'new',
  subject: '数学',
  question: { content: '  3+ 5 = ?  ', subject: '数学' },
  ...over
})

test('normalizeWrongItems：题干压缩空白、字段自包含优先', () => {
  const [it] = normalizeWrongItems([wq()])
  assert.equal(it.stem, '3+ 5 = ?')          // 多余空白已压掉
  assert.equal(it.errorType, '计算错误')
  assert.equal(it.errorCount, 1)
  assert.equal(it.subject, '数学')
  assert.equal(it.questionId, 'q1')
})

test('normalizeWrongItems：同一题被记多条错题时只留一条（否则组出会重复题）', () => {
  const items = normalizeWrongItems([
    wq({ wqId: 'w1', question_id: 'q1' }),
    wq({ wqId: 'w2', question_id: 'q1' }),
    wq({ wqId: 'w3', question_id: 'q2' })
  ])
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((i) => i.questionId), ['q1', 'q2'])
})

test('normalizeWrongItems：题干超长截断到 96 字并带省略号', () => {
  const long = 'x'.repeat(200)
  const [it] = normalizeWrongItems([wq({ question: { content: long } })])
  assert.equal(it.stem.length, 97)
  assert.ok(it.stem.endsWith('…'))
})

test('normalizeWrongItems：question_id 为空的练习册自包含错题要保留（老师得看见少了什么）', () => {
  const items = normalizeWrongItems([
    wq({ wqId: 'w1' }),
    wq({ wqId: 'w2', question_id: '', question: { content: '练习册原题' } })
  ])
  assert.equal(items.length, 2)
  const selfContained = items.find((i) => i.wqId === 'w2' || i.key === 'w2')
  assert.ok(selfContained, '自包含错题被静默丢掉了 —— 命中数会与诊断页对不上')
  assert.equal(selfContained.questionId, '')
  assert.equal(selfContained.stem, '练习册原题')
})

test('inScope · error-cause：按错因全等匹配（不是模糊包含）', () => {
  const calc = inScope({ errorType: '计算错误' }, { kind: 'error-cause', errorType: '计算错误' })
  const other = inScope({ errorType: '审题错误' }, { kind: 'error-cause', errorType: '计算错误' })
  assert.equal(calc, true)
  assert.equal(other, false)
  // 错因为空的题不该被任何错因命中
  assert.equal(inScope({ errorType: '' }, { kind: 'error-cause', errorType: '计算错误' }), false)
})

test('inScope · repeat：error_count >= 2（边界 2 算，1 不算）', () => {
  const scope = { kind: 'repeat' }
  assert.equal(inScope({ errorCount: 1 }, scope), false)
  assert.equal(inScope({ errorCount: 2 }, scope), true)
  assert.equal(inScope({ errorCount: 5 }, scope), true)
})

test('inScope · basic：review_1 / review_2 都算「已答对 1 次」', () => {
  const scope = { kind: 'basic' }
  assert.equal(inScope({ lifecycle: 'review_1' }, scope), true)
  assert.equal(inScope({ lifecycle: 'review_2' }, scope), true)
  assert.equal(inScope({ lifecycle: 'new' }, scope), false)
  assert.equal(inScope({ lifecycle: 'mastered' }, scope), false)
})

test('pickDefaults：打开弹窗默认勾上全部命中项（老师点开看到的就该是诊断页承诺的那 N 道）', () => {
  const items = normalizeWrongItems([
    wq({ wqId: 'a', question_id: 'q1', error_type: '计算错误' }),
    wq({ wqId: 'b', question_id: 'q2', error_type: '计算错误' }),
    wq({ wqId: 'c', question_id: 'q3', error_type: '审题错误' })
  ])
  const keys = pickDefaults(items, { kind: 'error-cause', errorType: '计算错误' })
  assert.deepEqual(keys, ['a', 'b'], '默认勾选不是「该错因的全部题」')
  assert.equal(keys.length, 2)
})

test('toExamQuestionIds：剔除 question_id 为空的题并如实报数', () => {
  const items = normalizeWrongItems([
    wq({ wqId: 'a', question_id: 'q1' }),
    wq({ wqId: 'b', question_id: 'q2' }),
    wq({ wqId: 'c', question_id: '' })
  ])
  const r = toExamQuestionIds(items)
  assert.deepEqual(r.questionIds, ['q1', 'q2'])
  assert.equal(r.dropped, 1)
  // 全是不可用项时不能返回空数组却dropped=0（老师会以为没题）
  const none = toExamQuestionIds([wq({ question_id: '' })])
  assert.deepEqual(none.questionIds, [])
  assert.equal(none.dropped, 1)
})

test('toExamQuestionIds：空输入不炸', () => {
  assert.deepEqual(toExamQuestionIds([]), { questionIds: [], dropped: 0 })
  assert.deepEqual(toExamQuestionIds(undefined), { questionIds: [], dropped: 0 })
})

test('errorTypeTone：错因分三类色（与错题清单同一套）', () => {
  assert.equal(errorTypeTone('计算错误'), 'is-danger')
  assert.equal(errorTypeTone('运算失误'), 'is-danger')
  assert.equal(errorTypeTone('审题错误'), 'is-warning')
  assert.equal(errorTypeTone('单位错误'), 'is-warning')
  assert.equal(errorTypeTone('概念不清'), 'is-primary')
  assert.equal(errorTypeTone('步骤遗漏'), 'is-primary')
  assert.equal(errorTypeTone('其他'), '')
})
