/**
 * 题目定位框（bbox）共享判据的测试 + 「禁止再分叉」的接线契约。
 *
 * 背景（2026-09-18）：全仓曾同时存在 **4 份** parseBbox/unionBbox 副本，越界处理两两不同：
 *   ① src/utils/questionBbox.js              越界 → null（严格，绘制用）
 *   ② src/workbench/.../PaperViewerPanel.vue 越界 → 保留   ← 已合并到 ①
 *   ③ src/workbench/.../QuestionDetailPanel.vue 越界 → 保留 ← 已合并到 ①（显式 allowOutOfRange）
 *   ④ server/utils/gradingDetailView.js      越界 → 保留   ← 已合并到 ①（显式 allowOutOfRange）
 *   ⑤ server/scripts/backfill-choice-options.mjs 越界 → 保留 ← 已合并到 ①（显式 allowOutOfRange）
 * 后果：同一道题在「原卷查看」（严格）与「单题详情裁剪」（宽松）会一个有框一个没框；
 * 且 ④ 的注释自称「与 ② 逐字同口径」，在 ② 改成严格后变成谎话 —— 另写一份必然漂移。
 *
 * 实测影响面（`server/_diag_bbox_impl_divergence.mjs`）：
 *   · union(text,image) 越界：240/2018 题（11.9%）→ 严格版会不画框
 *   · retryAlign 对位框越界：17/170 条（10%）→ 严格版会让移动端标注框消失
 * 所以合并时**保留了各调用方的策略**（allowOutOfRange），只统一实现，不统一策略。
 *
 * 判据本体：`src/utils/questionBbox.js`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseBbox, unionBbox, clampBbox, getQuestionDisplayBox } from '../src/utils/questionBbox.js'

// ── 解析 ──
test('parseBbox：兼容 JSON 字符串与多种字段命名', () => {
  assert.deepEqual(parseBbox('{"x":1,"y":2,"width":3,"height":4}'), { x: 1, y: 2, width: 3, height: 4 })
  assert.deepEqual(parseBbox({ left: 10, top: 20, w: 30, h: 40 }), { x: 10, y: 20, width: 30, height: 40 })
  assert.deepEqual(parseBbox({ x: 1, y: 2, x_max: 11, y_max: 22 }), { x: 1, y: 2, width: 10, height: 20 })
})

test('parseBbox：非法输入一律 null（不抛异常）', () => {
  for (const bad of [null, undefined, '', 'not json', 42, [], {}, { x: 1, y: 2, width: 0, height: 5 },
    { x: NaN, y: 2, width: 3, height: 4 }, { x: [140, 650, 880, 720] }]) {
    assert.equal(parseBbox(bad), null, `应拒绝：${JSON.stringify(bad)}`)
  }
})

// ── 两种策略：默认严格 vs allowOutOfRange ──
test('parseBbox 默认严格：明显越界返回 null（避免把框画到图外）', () => {
  // 库内真实越界样本
  assert.equal(parseBbox({ x: 140, y: 920, width: 860, height: 300 }), null, 'y+h=1220 越界')
  assert.equal(parseBbox({ x: 150, y: 1300, width: 800, height: 100 }), null, 'y 本身越界')
  assert.equal(parseBbox({ x: 100, y: 660, width: 800, height: 660 }), null, 'retryAlign 样本 y+h=1320')
  assert.equal(parseBbox({ x: 100, y: 100, width: 950, height: 160 }), null, 'x+w=1050 越界')
})

test('parseBbox 默认严格：轻微越界（浮点误差，≤5）容忍', () => {
  assert.deepEqual(parseBbox({ x: -2, y: 0, width: 500, height: 100 }), { x: -2, y: 0, width: 500, height: 100 })
  assert.deepEqual(parseBbox({ x: 0, y: 0, width: 1003, height: 100 }), { x: 0, y: 0, width: 1003, height: 100 })
})

test('parseBbox allowOutOfRange：原样返回越界框（调用方自己夹紧的场景）', () => {
  const o = { x: 100, y: 660, width: 800, height: 660 }
  assert.deepEqual(parseBbox(o, { allowOutOfRange: true }), o)
  // 但非法值仍然要拦
  assert.equal(parseBbox({ x: 1, y: 2, width: 0, height: 5 }, { allowOutOfRange: true }), null)
})

// ── 并集 / 夹紧 / 显示框 ──
test('unionBbox：外接矩形；任一为空返回另一个', () => {
  assert.equal(unionBbox(null, null), null)
  assert.deepEqual(unionBbox(null, { x: 1, y: 2, width: 3, height: 4 }), { x: 1, y: 2, width: 3, height: 4 })
  assert.deepEqual(
    unionBbox({ x: 100, y: 100, width: 200, height: 50 }, { x: 150, y: 200, width: 300, height: 60 }),
    { x: 100, y: 100, width: 350, height: 160 }
  )
})

test('clampBbox：越界部分截掉，整框不至于全丢', () => {
  assert.deepEqual(clampBbox({ x: 100, y: 900, width: 800, height: 300 }), { x: 100, y: 900, width: 800, height: 100 })
  assert.deepEqual(clampBbox({ x: -20, y: -30, width: 200, height: 200 }), { x: 0, y: 0, width: 180, height: 170 })
  assert.equal(clampBbox({ x: 1200, y: 100, width: 100, height: 100 }), null, '整体在图外 → null')
  assert.equal(clampBbox(null), null)
})

test('getQuestionDisplayBox：text ∪ image 优先，都缺才回退 block', () => {
  const q = {
    text_bbox: { x: 100, y: 200, width: 400, height: 100 },
    image_bbox: { x: 300, y: 250, width: 300, height: 200 },
    block_coordinates: { x: 50, y: 50, width: 900, height: 900 },
  }
  assert.deepEqual(getQuestionDisplayBox(q), { x: 100, y: 200, width: 500, height: 250 })
  // 只有 block
  assert.deepEqual(
    getQuestionDisplayBox({ block_coordinates: { x: 50, y: 50, width: 900, height: 900 } }),
    { x: 50, y: 50, width: 900, height: 900 }
  )
  // 并集越界 → 严格解析后并集为 null → 回退 block
  assert.deepEqual(
    getQuestionDisplayBox({ text_bbox: { x: 100, y: 100, width: 950, height: 160 }, block_coordinates: { x: 60, y: 60, width: 800, height: 80 } }),
    { x: 60, y: 60, width: 800, height: 80 }
  )
  assert.equal(getQuestionDisplayBox(null), null)
})

// ── 接线契约（防回归：判据再被分叉 / 再被抄一份）──
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const SHARED = read('../src/utils/questionBbox.js')
const PAPER_VIEWER = read('../src/workbench/components/review/PaperViewerPanel.vue')
const DETAIL_PANEL = read('../src/workbench/components/review/QuestionDetailPanel.vue')
const GRADING_DETAIL = read('../server/utils/gradingDetailView.js')
const BACKFILL = read('../server/scripts/backfill-choice-options.mjs')

test('契约：questionBbox.js 是全仓唯一实现（4 份分叉必须保持合并状态）', () => {
  const forked = [
    ['PaperViewerPanel.vue', PAPER_VIEWER, "../../../utils/questionBbox"],
    ['QuestionDetailPanel.vue', DETAIL_PANEL, "../../../utils/questionBbox"],
    ['server/utils/gradingDetailView.js', GRADING_DETAIL, "../../src/utils/questionBbox.js"],
    ['backfill-choice-options.mjs', BACKFILL, "../../src/utils/questionBbox.js"],
  ]
  for (const [name, src, importPath] of forked) {
    assert.ok(src.includes(importPath), `${name} 必须 import 共享实现（${importPath}）`)
    assert.ok(!/const parseBbox\s*=/.test(src), `${name} 不得再自带 parseBbox`)
    assert.ok(!/const unionBbox\s*=/.test(src), `${name} 不得再自带 unionBbox`)
  }
})

test('契约：PaperViewerPanel 的绘制路径必须用严格解析（越界不画）', () => {
  // 该组件与兄弟组件 OriginalPaperSource.vue 同为「原图上画定位框」，
  // 必须同口径；此前自带一份不拒绝越界的实现 → workbook 路径 16 题的框被画到图外。
  assert.ok(PAPER_VIEWER.includes('getQuestionDisplayBox'), '非 paper 分支必须走共享 getQuestionDisplayBox')
  assert.ok(!/getBlockCoords\s*\(/.test(PAPER_VIEWER), '本地 getBlockCoords 已删除，不得复活为调用')
})

test('契约：裁剪预选类调用方必须显式声明 allowOutOfRange（策略是调用方的，不是解析函数的）', () => {
  assert.ok(DETAIL_PANEL.includes('allowOutOfRange: true'), 'QuestionDetailPanel 预选裁剪框需保留越界框（否则 11.9% 无预选）')
  assert.ok(GRADING_DETAIL.includes('allowOutOfRange: true'), 'gradingDetailView 需保留越界框（否则移动端 10% 标注消失）')
  assert.ok(BACKFILL.includes('allowOutOfRange: true'), 'backfill 脚本需保留越界框')
})

test('契约：gradingDetailView 不得再自称「与 PaperViewerPanel 逐字同口径」', () => {
  assert.ok(!GRADING_DETAIL.includes('与 PaperViewerPanel.parseBbox 逐字同口径'), '该注释已过时且误导，必须改掉')
  assert.ok(GRADING_DETAIL.includes("from '../../src/utils/questionBbox.js'"), '必须 re-export 共享实现')
})

test('契约：共享模块必须保留两种策略的开关（严格为默认）', () => {
  assert.ok(SHARED.includes('allowOutOfRange === true'), '必须有 allowOutOfRange 开关')
  assert.ok(/export function parseBbox \(b, opts = \{\}\)/.test(SHARED), '默认必须严格（opts 缺省即严格）')
})
