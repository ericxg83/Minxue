/**
 * 「不该重绘」判据回归测试（2026-09-21 建立）。
 *
 * 覆盖 `geometryContentGate.js` 的 `detectNonGeometryFigure`（= 流程图/输入输出表格 + 多子图/多面板）
 * 与新增的 `detectMultiPanelFigure`。
 *
 * 全部题干取自 2026-09-21 老师报障的线上原文（第90题/第20题）与同批存量审计结果，
 * 不是编造的样例。
 *
 * ⚠️ 这套判据有**两个必须同时生效的调用点**，缺一个就会漏：
 *   · 生成侧 server/geometryWorker.js
 *   · 发布侧 server/scripts/publish-nonc3-dsl-redraws.mjs
 * 2026-09-20 事故就是"只加了生成侧"：判据上线前跑出的空框流程图照样被发布上线。
 * 本文件只管判据本身；调用点由脚本层保证（见 publish 脚本头部的说明）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { detectNonGeometryFigure, detectMultiPanelFigure } from '../server/utils/geometryContentGate.js'

// ────────────────────────── 应当跳过（不该重绘） ──────────────────────────

test('数值转换器（老师报障第90题原文）→ 不重绘', () => {
  const r = detectNonGeometryFigure('有一个数值转换器，原理如图：当输入x的值为64时，输出y的值是______.')
  assert.equal(r.skip, true)
  assert.equal(r.kind, 'flowchart')
})

test('数值转换器（另一种表述）→ 不重绘', () => {
  const r = detectNonGeometryFigure('欢欢设计了一个数值转换器，它可以根据用户的输入，输出特定的数。数值转换器的工作流程如图所示。')
  assert.equal(r.skip, true)
  assert.equal(r.kind, 'flowchart')
})

test('程序框图 / 流程图 / 运算程序 → 不重绘', () => {
  for (const s of ['按如图所示的程序框图计算，输出结果是', '根据下面的流程图回答问题', '按图示的运算程序，输入x=3时输出', '按图所示的算法程序计算']) {
    assert.equal(detectNonGeometryFigure(s).skip, true, s)
  }
})

test('输入→运算→输出表格 → 不重绘', () => {
  const r = detectNonGeometryFigure('输入：______, 9/35, 22/35, 13/35。输出：对应的小数')
  assert.equal(r.skip, true)
  assert.equal(r.kind, 'io_table')
})

test('图1 + 图2（老师报障第20题原文）→ 不重绘（多子图）', () => {
  const r = detectNonGeometryFigure('如图1，小明把长为2，宽为1的两个长方形沿对角线剪开，围成如图2所示的一个大正方形，则空白部分小正方形的边长x的值是（ ）')
  assert.equal(r.skip, true)
  assert.equal(r.kind, 'multi_panel')
  assert.match(r.reason, /图1|图2/)
})

test('图① + 图② → 不重绘；圈号带「图」前缀才认', () => {
  assert.equal(detectMultiPanelFigure('观察图①与图②，两图形的面积关系是').skip, true)
})

test('（甲）+（乙）两图 → 不重绘', () => {
  assert.equal(detectMultiPanelFigure('比较（甲）、（乙）两图中阴影部分的面积').skip, true)
  assert.equal(detectMultiPanelFigure('如图甲、图乙所示，两种放置方式').skip, true)
})

test('「两幅图」「左右两图」 → 不重绘', () => {
  for (const s of ['下面两幅图中，说法正确的是', '比较左右两图可知', '甲乙两图所示的实验现象']) {
    assert.equal(detectMultiPanelFigure(s).skip, true, s)
  }
})

test('四选项函数图象题 → 不重绘（DSL 无多坐标系）', () => {
  const r = detectNonGeometryFigure('6. 函数 y=a/x 与 y=-ax²-a(a≠0) 在同一平面直角坐标系中的大致图像可能是（ ）')
  assert.equal(r.skip, true)
  assert.equal(r.kind, 'multi_panel_option_graph')
})

// ────────────────────────── 格点/网格图（2026-09-26 图5事故沉淀） ──────────────────────────

test('格点三等分点（图5原文）→ 不重绘（网格底图丢失）', () => {
  const r = detectNonGeometryFigure('如图，每个小正方形的边长均为1，点A、B、C均在格点上。请仅用无刻度的直尺作线段BC的三等分点E、F。')
  assert.equal(r.skip, true)
  assert.equal(r.kind, 'grid_figure')
})

test('格点相似三角形题 → 不重绘', () => {
  const r = detectNonGeometryFigure('如图，每个小正方形的边长均为1，图中三角形的顶点都在格点上。在△ABC、△ABD中与涂色三角形相似的是____')
  assert.equal(r.skip, true)
  assert.equal(r.kind, 'grid_figure')
})

test('正方形网格题 → 不重绘', () => {
  assert.equal(detectNonGeometryFigure('如图，在正方形网格中，小正方形的边长均为1，△ABC的顶点都在格点上').skip, true)
})

test('普通「正方形ABCD」题不含格点信号 → 照常重绘（防误伤）', () => {
  for (const s of ['如图，在正方形ABCD中，E是边BC上一点，连接AE，求∠AEB的度数', '如图，两个相邻的正方形面积分别为4和10，求阴影面积']) {
    assert.equal(detectNonGeometryFigure(s).skip, false, s)
  }
})

// ────────────────────────── 不得跳过（防误伤，比漏判更重要） ──────────────────────────

test('只引用「图2」一处 → 照常重绘', () => {
  const r = detectNonGeometryFigure('如图2，在△ABC中，AB=AC，求∠B的度数')
  assert.equal(r.skip, false)
})

test('裸的 ①②③ 是条件编号、不是子图编号 → 照常重绘', () => {
  const r = detectNonGeometryFigure('如图，下列说法正确的是①∠1与∠2是同位角 ②∠3与∠4是内错角 ③∠5与∠6是同旁内角')
  assert.equal(r.skip, false)
})

test('单图常规几何题 → 照常重绘', () => {
  const stems = [
    '如图，在梯形ABCD中，AB//CD，∠C=90°，求AD的长',
    '如图，两个圆的圆心相同，圆环的面积是小圆面积的2倍。若大圆的半径是√15 cm，求小圆的半径。',
    '如图，长方形内有两个相邻的正方形，其面积分别为4和10，则图中阴影部分面积为____.',
    '如图，在数轴上，-√2与√5之间的整数的个数是____.',
    '如图，抛物线 y=ax²+bx+c 与 x 轴相交于 A、B 两点，求该抛物线的表达式',
  ]
  for (const s of stems) assert.equal(detectNonGeometryFigure(s).skip, false, s)
})

test('「图形」「图象」「图案」等普通词 → 不误判', () => {
  for (const s of ['把一个图形沿某条直线翻折，得到的图形与原图形全等', '该函数的图象经过第一、三象限', '用如图所示的图案密铺平面']) {
    assert.equal(detectNonGeometryFigure(s).skip, false, s)
  }
})

test('空题干 / 非字符串 → 不误判（交给上游的"题干为空"分支处理）', () => {
  for (const v of ['', null, undefined, 0]) {
    assert.equal(detectNonGeometryFigure(v).skip, false, String(v))
  }
})
