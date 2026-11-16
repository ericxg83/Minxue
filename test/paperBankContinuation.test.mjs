/**
 * 跨页续行合并回归锁（2026-11-16 闵行七宝文来卷：原卷 25 题、系统 26 题）
 *
 * 事故形态：第 5 题在第 1 页装不下，「续图 + 选项 A~D」印到第 2 页顶部；
 * 那段卷面上没有题号，OCR 当成新题（content「题目文字在图片上方被截断，仅可见选项」），
 * 补号后顶成 q6 ⇒ 原卷 6..25 全部变成 7..26。
 *
 * 锁 mergePageContinuationRows 的三条判据与「宁可漏合并、不可误伤」的方向。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergePageContinuationRows } from '../server/services/paperBankService.js'

const r = (pageNo, qno, { sub = '', opts = [], content = '', printed = true, key = '', img = null, bbox = null } = {}) => ({
  __key: key || `${pageNo}:0`,
  page_no: pageNo,
  question_no: qno,
  __printedNo: printed,
  sub_no: sub,
  options: opts,
  content,
  bbox: bbox || { x: 60, y: 100, width: 900, height: 90 },
  page_image_url: img || `https://example.com/p${pageNo}.jpg`,
})

const MOCK_OPTIONS = ['△ABD∽△ACE', '∠B=∠C', 'BD=2CE', 'AB·EC=AC·BD']

test('★ 页首选项块 + 上一题缺选项 ⇒ 合并（本卷 q5 事故形态）', () => {
  const rows = [
    r(1, 4, { content: '(4分)如图，△ABC中…', opts: ['A', 'B', 'C', 'D'], key: '1:0' }),
    r(1, 5, { content: '(4分)如图，已知AB=2AD，AC=2AE，则下列结论错误的是(   )', key: '1:1' }),
    r(2, null, {
      content: '（题目文字在图片上方被截断，仅可见选项）',
      opts: MOCK_OPTIONS,
      printed: false,
      key: '2:0',
      bbox: { x: 60, y: 0, width: 900, height: 275 },
    }),
    r(2, 6, { content: '(4分) 如图，在▱ABCD中，AB=√3…', key: '2:1' }),
  ]
  const out = mergePageContinuationRows(rows)
  assert.equal(out.merged.length, 1)
  assert.equal(out.merged[0].withOptions, true)
  assert.equal(out.merged[0].withFigure, true)
  assert.equal(out.rows.length, 3, '续行必须从 rows 里摘掉')
  const q5 = out.rows.find(x => x.question_no === 5)
  assert.deepEqual(q5.options, MOCK_OPTIONS, '选项必须补给上一题')
  assert.equal(q5.__continuationFigure.page_no, 2, '跨页配图来源必须记下来')
  assert.equal(q5.__continuationFigure.bbox.height, 275)
  // 后续题号不再被顶：合并后 q6 仍是 6
  assert.ok(out.rows.some(x => x.question_no === 6))
})

test('⛔ 页首块有印刷题号 ⇒ 绝不合并（那就是正常的一道题）', () => {
  const rows = [
    r(1, 5, { content: '题干', key: '1:0' }),
    r(2, 6, { content: '(4分) 正常题', opts: MOCK_OPTIONS, printed: true, key: '2:0' }),
  ]
  assert.deepEqual(mergePageContinuationRows(rows).merged, [])
})

test('⛔ 第 1 页页首无号 ⇒ 不合并（没有上一页，属于正常缺号，交给补号逻辑）', () => {
  const rows = [
    r(1, null, { content: '（题目文字被截断）', opts: MOCK_OPTIONS, printed: false, key: '1:0' }),
    r(1, 2, { content: 'second', key: '1:1' }),
  ]
  assert.deepEqual(mergePageContinuationRows(rows).merged, [])
})

test('⛔ 上一题已经有选项 ⇒ 不抢它的选项（防「两题的选择项混在一起」）', () => {
  const rows = [
    r(1, 5, { content: '选择题', opts: ['A', 'B', 'C', 'D'], key: '1:0' }),
    r(2, null, { content: '(4分) 另一题', opts: MOCK_OPTIONS, printed: false, key: '2:0' }),
  ]
  // 页首块有选项但上一题已经有选项：不是跨页续行的形态，保持原样
  assert.deepEqual(mergePageContinuationRows(rows).merged, [])
})

test('★ 纯图续页（无选项、占位描述）⇒ 只补配图，不动选项', () => {
  const rows = [
    r(1, 8, { content: '(4分) 如图，△ABC…', key: '1:0' }),
    r(2, null, {
      content: '（图片上方文字被截断）',
      printed: false,
      key: '2:0',
      bbox: { x: 60, y: 0, width: 900, height: 300 },
    }),
    r(2, 9, { content: '(4分) 下一题', key: '2:1' }),
  ]
  const out = mergePageContinuationRows(rows)
  assert.equal(out.merged.length, 1)
  assert.equal(out.merged[0].withOptions, false)
  assert.equal(out.merged[0].withFigure, true)
  const q8 = out.rows.find(x => x.question_no === 8)
  assert.deepEqual(q8.options, [])
  assert.ok(q8.__continuationFigure)
})

test('⛔ 无题号但内容正常（既无选项也不是占位描述）⇒ 不合并，交给补号', () => {
  const rows = [
    r(1, 5, { content: '题干', key: '1:0' }),
    r(2, null, { content: '(4分) 一道模型没给号的新题', printed: false, key: '2:0' }),
  ]
  assert.deepEqual(mergePageContinuationRows(rows).merged, [])
})

test('★ 续行顶掉题号时，其后题号自动前移一位（本卷原 6..25 被读成 7..26）', () => {
  // 模型把原卷 6..8 读成 7..9（+1），页首续行占号 6
  const rows = [
    r(1, 5, { content: '(4分) 选择题(   )', key: '1:0' }),
    r(2, null, { content: '（题目文字在图片上方被截断，仅可见选项）', opts: MOCK_OPTIONS, printed: false, key: '2:0' }),
    r(2, 7, { content: '(4分) 原卷第六题', key: '2:1' }),
    r(2, 8, { content: '(4分) 原卷第七题', key: '2:2' }),
    r(2, 9, { content: '(4分) 原卷第八题', key: '2:3' }),
  ]
  const out = mergePageContinuationRows(rows)
  assert.equal(out.merged.length, 1)
  assert.equal(out.renumbered, 3, '三行被顶后的题号都要前移')
  const nos = out.rows.map(x => x.question_no).sort((a, b) => a - b)
  assert.deepEqual(nos, [5, 6, 7, 8], '题号必须回到 5,6,7,8')
})

test('⛔ 反证：续行的号确实有真题在用（重号而非顶号）⇒ 不平移', () => {
  const rows = [
    r(1, 5, { content: '题干', key: '1:0' }),
    r(1, 6, { content: '原卷第六题，模型也给了 6', key: '1:1' }),
    r(2, 6, { content: '（题目文字被截断）', opts: MOCK_OPTIONS, printed: false, key: '2:0' }),
  ]
  const out = mergePageContinuationRows(rows)
  assert.equal(out.merged.length, 1)
  assert.equal(out.renumbered, 0, '6 有真题在用 ⇒ 只摘行，不许平移')
  assert.deepEqual(out.rows.map(x => x.question_no).sort((a, b) => a - b), [5, 6])
})
