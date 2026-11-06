// 题库列表「同组小问之间去重」回归锁（2026-11-06）
// 背景：resource_questions 每行都要能独立组卷 ⇒ parent_stem 与配图逐行冗余存储。
//       列表逐行渲染就必然出现「同一段材料印 N 遍、同一幅图贴 N 张」。
//       负责人报障的徐汇一模 20「三张表格」就是这一形态（图撤掉后文字表格还会重复）。
// 锁 src/workbench/utils/paperRowDisplay.js 的三个判据：showStem / bodyText / showFigure
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { showStem, bodyText, showFigure, sameQuestionGroup } from '../src/workbench/utils/paperRowDisplay.js'

const row = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  resource_id: 'paper-1',
  question_no: 20,
  sub_no: null,
  parent_stem: '已知二次函数 y=ax²+bx+c(a≠0) 的图像经过 A、B 两点。',
  content: '',
  image_url: null,
  ...over,
})

test('题干：同组小问只在第一条显示（徐汇 20 三行同题干）', () => {
  const rows = [row({ sub_no: '1' }), row({ sub_no: '2' }), row({ sub_no: '3' })]
  assert.deepEqual(rows.map((_, i) => showStem(rows, i)), [true, false, false])
})

test('题干：不同题（题号不同）即使题干逐字相同也各自显示', () => {
  const rows = [row({ question_no: 20 }), row({ question_no: 21 })]
  assert.deepEqual(rows.map((_, i) => showStem(rows, i)), [true, true])
})

test('题干：不同卷同题号不互相影响', () => {
  const rows = [row({ resource_id: 'a' }), row({ resource_id: 'b' })]
  assert.deepEqual(rows.map((_, i) => showStem(rows, i)), [true, true])
})

test('题干：每行都没有 parent_stem ⇒ 一条都不显示（不臆造题干）', () => {
  const rows = [row({ parent_stem: null }), row({ parent_stem: null })]
  assert.deepEqual(rows.map((_, i) => showStem(rows, i)), [false, false])
})

test('正文：整题行 content 与 parent_stem 逐字相同（忽略空白）时不再重复显示', () => {
  const stem = '如何用尺规把一条线段进行黄金分割呢？'
  const q = row({ parent_stem: stem, content: '如何用尺规把一条线段\n  进行黄金分割呢？' })
  assert.equal(bodyText(q), '')
})

test('正文：内容不同就照常显示', () => {
  const q = row({ content: '(1) 求这条抛物线的表达式；' })
  assert.equal(bodyText(q), '(1) 求这条抛物线的表达式；')
})

test('配图：同组多行共用同一张图 ⇒ 只在第一条显示', () => {
  const u = 'https://cdn.example.com/paper-p7-q25-fig.jpg'
  const rows = [row({ question_no: 25, sub_no: '1', image_url: u }), row({ question_no: 25, sub_no: '2', image_url: u }), row({ question_no: 25, sub_no: '3', image_url: u })]
  assert.deepEqual(rows.map((_, i) => showFigure(rows, i)), [true, false, false])
})

test('配图：同组但 URL 不同 ⇒ 当作不同的图，各自显示（宁可多显示，不藏真图）', () => {
  const rows = [
    row({ question_no: 24, sub_no: '1', image_url: 'https://cdn/a.jpg' }),
    row({ question_no: 24, sub_no: '2', image_url: 'https://cdn/b.jpg' }),
  ]
  assert.deepEqual(rows.map((_, i) => showFigure(rows, i)), [true, true])
})

test('配图：无图的行不出图，也不会挡住下一条', () => {
  const rows = [
    row({ question_no: 22, sub_no: '1', image_url: null }),
    row({ question_no: 22, sub_no: '2', image_url: 'https://cdn/c.jpg' }),
  ]
  assert.deepEqual(rows.map((_, i) => showFigure(rows, i)), [false, true])
})

test('配图：同 URL 但不同题号 ⇒ 不当作同一张（保守显示）', () => {
  const u = 'https://cdn/d.jpg'
  const rows = [row({ question_no: 19, image_url: u }), row({ question_no: 20, image_url: u })]
  assert.deepEqual(rows.map((_, i) => showFigure(rows, i)), [true, true])
})

test('sameQuestionGroup：同卷同题号才算一组，题号数字/字符串混用也能比', () => {
  assert.equal(sameQuestionGroup({ resource_id: 'p', question_no: 20 }, { resource_id: 'p', question_no: '20' }), true)
  assert.equal(sameQuestionGroup({ resource_id: 'p', question_no: 20 }, { resource_id: 'q', question_no: 20 }), false)
  assert.equal(sameQuestionGroup(null, { resource_id: 'p', question_no: 20 }), false)
})
