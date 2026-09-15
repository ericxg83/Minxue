/**
 * gradingDetailView.test.mjs — 组卷「批改详情」视图构建器回归测试（2026-09-15 P1）
 *
 * 锁定口径（server/utils/gradingDetailView.js，移动端批改详情唯一数据构建器）：
 *   ① 页图展开：行内 images 按序展开成全局页序；无 images 回退行 image_url。
 *   ② 行内 pageNumber → 全局页号换算：多行答卷（分批上传）时每行 pageNumber 是
 *      行内 1-based，必须按行跨度换算；旧记录缺 pageNumber 视为该行第 1 页。
 *   ③ 取框优先级：text_bbox ∪ image_bbox 并集 → 回退 block_coordinates →
 *      记录在而框全空 → 不画（绝无回退）。与 PC PaperViewerPanel 逐字同口径。
 *   ④ 孤立 OCR 答案（卷面上没有的题）不得给任何题造标记。
 *   ⑤ 同一 questionId 多行出现时后写者覆盖（最新提交为准）。
 *   ⑥ 判定由调用方注入（人工复核优先口径在 questionResultCaliber），本模块不判题。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseBbox,
  unionBbox,
  buildGradingDetailView,
} from '../server/utils/gradingDetailView.js'

const B = (x, y, w, h) => ({ x, y, width: w, height: h })
const ROW = (id, images, result, image_url = null) => ({ id, images, result, image_url })

// ── parseBbox / unionBbox ──

test('parseBbox：兼容对象与 JSON 字符串、left/top 别名，拒绝非法框', () => {
  assert.deepEqual(parseBbox(B(1, 2, 3, 4)), B(1, 2, 3, 4))
  assert.deepEqual(parseBbox('{"x":1,"y":2,"width":3,"height":4}'), B(1, 2, 3, 4))
  assert.deepEqual(parseBbox('{"left":5,"top":6,"width":7,"height":8}'), B(5, 6, 7, 8))
  assert.equal(parseBbox(null), null)
  assert.equal(parseBbox('not json'), null)
  assert.equal(parseBbox(B(1, 2, 0, 4)), null)
  assert.equal(parseBbox(B(1, 2, -3, 4)), null)
  assert.equal(parseBbox({ x: 'a', y: 1, width: 2, height: 3 }), null)
})

test('unionBbox：外接矩形；任一为空返回另一框', () => {
  assert.deepEqual(unionBbox(B(0, 0, 10, 10), B(5, 5, 10, 10)), B(0, 0, 15, 15))
  assert.deepEqual(unionBbox(null, B(1, 1, 2, 2)), B(1, 1, 2, 2))
  assert.deepEqual(unionBbox(B(1, 1, 2, 2), null), B(1, 1, 2, 2))
  assert.equal(unionBbox(null, null), null)
})

// ── 页图展开 ──

test('单行多图：images 按序展开成全局页序', () => {
  const rows = [ROW('t1', [
    { image_url: 'u1', page_number: 1 },
    { image_url: 'u2', page_number: 2 },
  ], null)]
  const { pages } = buildGradingDetailView(['a'], rows, () => 'unjudged')
  assert.deepEqual(pages, [
    { page: 1, imageUrl: 'u1' },
    { page: 2, imageUrl: 'u2' },
  ])
})

test('无 images 回退行 image_url；images/image_url 双缺的行不产页', () => {
  const rows = [
    ROW('t1', null, null, 'solo.jpg'),
    ROW('t2', null, null, null),
  ]
  const { pages } = buildGradingDetailView([], rows, () => 'unjudged')
  assert.deepEqual(pages, [{ page: 1, imageUrl: 'solo.jpg' }])
})

// ── 行内 pageNumber → 全局页号 ──

test('两行答卷（分批上传）：第二行的 pageNumber=1 落到全局第 3 页', () => {
  // 实锤场景：学生分两次上传，每行 images 的 page_number 都是 1
  const rows = [
    ROW('t1', [{ image_url: 'u1', page_number: 1 }], {
      retryAlign: [{ questionId: 'a', label: '1', matchedBy: 'number', pageNumber: 1, text_bbox: B(10, 10, 50, 20) }],
    }),
    ROW('t2', [{ image_url: 'u2', page_number: 1 }], {
      retryAlign: [{ questionId: 'b', label: '2', matchedBy: 'number', pageNumber: 1, text_bbox: B(10, 30, 50, 20) }],
    }),
  ]
  const { pages, marks } = buildGradingDetailView(['a', 'b'], rows, () => 'unjudged')
  assert.equal(pages.length, 2)
  const byId = Object.fromEntries(marks.map(m => [m.questionId, m]))
  assert.equal(byId.a.page, 1)
  assert.equal(byId.b.page, 2)
})

test('单行多图：pageNumber=2 落到全局第 2 页；缺 pageNumber 视为第 1 页', () => {
  const rows = [ROW('t1', [
    { image_url: 'u1', page_number: 1 },
    { image_url: 'u2', page_number: 2 },
  ], {
    retryAlign: [
      { questionId: 'a', label: '1', matchedBy: 'number', pageNumber: 2, text_bbox: B(10, 10, 50, 20) },
      { questionId: 'b', label: '2', matchedBy: 'number', text_bbox: B(10, 30, 50, 20) },
    ],
  })]
  const { marks } = buildGradingDetailView(['a', 'b'], rows, () => 'unjudged')
  const byId = Object.fromEntries(marks.map(m => [m.questionId, m]))
  assert.equal(byId.a.page, 2)
  assert.equal(byId.b.page, 1)
})

test('pageNumber 越界收敛到该行最后一页（防御脏数据）', () => {
  const rows = [ROW('t1', [{ image_url: 'u1', page_number: 1 }], {
    retryAlign: [{ questionId: 'a', label: '1', matchedBy: 'number', pageNumber: 9, text_bbox: B(1, 1, 2, 2) }],
  })]
  const { marks } = buildGradingDetailView(['a'], rows, () => 'unjudged')
  assert.equal(marks[0].page, 1)
})

// ── 取框优先级 ──

test('取框：text_bbox ∪ image_bbox 并集优先，其次 block_coordinates，全空不画', () => {
  const rows = [ROW('t1', [{ image_url: 'u1', page_number: 1 }], {
    retryAlign: [
      { questionId: 'a', text_bbox: B(10, 10, 50, 20), image_bbox: B(5, 5, 60, 30) },
      { questionId: 'b', text_bbox: null, image_bbox: null, block_coordinates: B(1, 2, 3, 4) },
      { questionId: 'c', text_bbox: null, image_bbox: null, block_coordinates: null },
    ],
  })]
  const { marks } = buildGradingDetailView(['a', 'b', 'c'], rows, () => 'unjudged')
  const byId = Object.fromEntries(marks.map(m => [m.questionId, m]))
  assert.deepEqual(byId.a.bbox, B(5, 5, 60, 30))
  assert.deepEqual(byId.b.bbox, B(1, 2, 3, 4))
  assert.equal(byId.c.bbox, null)
})

// ── 对位纪律 ──

test('孤立 OCR 答案（卷面上没有的题）不给任何题造标记', () => {
  const rows = [ROW('t1', [{ image_url: 'u1', page_number: 1 }], {
    retryAlign: [
      { questionId: 'a', label: '1', matchedBy: 'number', pageNumber: 1, text_bbox: B(1, 1, 2, 2) },
      { questionId: 'orphan-ghost', label: '99', matchedBy: null, pageNumber: 1, text_bbox: B(9, 9, 9, 9) },
    ],
  })]
  const { marks } = buildGradingDetailView(['a', 'b'], rows, () => 'unjudged')
  assert.equal(marks.length, 2)
  assert.ok(!marks.some(m => m.questionId === 'orphan-ghost'))
  // 题单里没对位记录的题也给一条「无记录」占位，视图按无记录处理
  assert.equal(marks[1].questionId, 'b')
  assert.equal(marks[1].matchedBy, null)
  assert.equal(marks[1].page, null)
  assert.equal(marks[1].bbox, null)
})

test('matchedBy=none（图上无作答痕迹）：记录在但无页码无框，视图原样透传', () => {
  const rows = [ROW('t1', [{ image_url: 'u1', page_number: 1 }], {
    retryAlign: [
      { questionId: 'a', label: '1', matchedBy: 'none', pageNumber: null, text_bbox: null, image_bbox: null, block_coordinates: null, studentAnswer: '' },
    ],
  })]
  const { marks } = buildGradingDetailView(['a'], rows, () => 'wrong')
  assert.equal(marks[0].matchedBy, 'none')
  assert.equal(marks[0].bbox, null)
  // 判定仍以调用方注入的口径为准（老师复核结论优先），不因缺痕迹改判
  assert.equal(marks[0].verdict, 'wrong')
})

test('同一 questionId 多行出现：后写者覆盖（最新提交为准）', () => {
  const rows = [
    ROW('t-old', [{ image_url: 'u1', page_number: 1 }], {
      retryAlign: [{ questionId: 'a', label: '1', matchedBy: 'position', pageNumber: 1, text_bbox: B(1, 1, 1, 1), studentAnswer: '旧' }],
    }),
    ROW('t-new', [{ image_url: 'u2', page_number: 1 }], {
      retryAlign: [{ questionId: 'a', label: '1', matchedBy: 'number', pageNumber: 1, text_bbox: B(2, 2, 2, 2), studentAnswer: '新' }],
    }),
  ]
  const { marks } = buildGradingDetailView(['a'], rows, () => 'correct')
  assert.equal(marks[0].page, 2)
  assert.deepEqual(marks[0].bbox, B(2, 2, 2, 2))
  assert.equal(marks[0].studentAnswer, '新')
})

test('label 缺失时按题单序号兜底；判定注入函数决定 verdict', () => {
  const rows = []
  const { marks } = buildGradingDetailView(['a', 'b'], rows, qid => (qid === 'a' ? 'correct' : 'wrong'))
  assert.deepEqual(marks.map(m => m.label), ['1', '2'])
  assert.deepEqual(marks.map(m => m.verdict), ['correct', 'wrong'])
})
