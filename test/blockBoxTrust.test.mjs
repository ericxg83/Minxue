/**
 * block_coordinates 可信度判据的测试。
 *
 * 样本全部取自库内真实数据（2026-09-18）：
 *   fd8b6bc9 p1 —— 19.2(4) 实数的绝对值和大小比较，12 题，y 步长恒为 60（典型「均分占位」）
 *   e01d0548 p1 —— 3072×4096，10 题，真实测量（叠加目检 `_diag_overlay_block_visual.mjs` 通过）
 *   ec11a3cc p1 / fac27053 p1 —— 高度、间距都不均匀，不是占位
 *
 * 判据本体：`server/utils/blockBoxTrust.js`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseBlockBox, isOutOfRangeBox, isUntrustworthyBlock,
  isPlaceholderBlockBoxes, findPlaceholderBlockPages,
} from '../server/utils/blockBoxTrust.js'

// ── 真实样本 ──
const FD8B6BC9_P1 = [
  [100, 250, 800, 60], [100, 310, 800, 60], [100, 370, 800, 60], [100, 430, 800, 60],
  [100, 490, 800, 60], [100, 550, 800, 60], [100, 610, 800, 60], [100, 670, 800, 60],
  [100, 730, 800, 60], [100, 790, 800, 60], [100, 850, 800, 60], [100, 910, 800, 150],
].map(([x, y, width, height]) => ({ x, y, width, height }))

const E01D0548_P1 = [
  [140, 148, 460, 122], [140, 270, 460, 80], [140, 350, 460, 80], [140, 450, 460, 50],
  [140, 500, 460, 50], [140, 550, 460, 50], [140, 600, 460, 50], [140, 650, 460, 50],
  [140, 700, 460, 50], [140, 750, 460, 50],
].map(([x, y, width, height]) => ({ x, y, width, height }))

const EC11A3CC_P1 = [
  [50, 200, 900, 75], [50, 275, 900, 100], [50, 370, 900, 100], [50, 465, 900, 100],
].map(([x, y, width, height]) => ({ x, y, width, height }))

const FAC27053_P1 = [
  [140, 180, 460, 110], [140, 290, 460, 230], [140, 530, 460, 100], [140, 630, 460, 80],
].map(([x, y, width, height]) => ({ x, y, width, height }))

// ── 均分占位 ──
test('占位检测：fd8b6bc9 第1页（y 等差 60、等宽等高）判为占位', () => {
  const v = isPlaceholderBlockBoxes(FD8B6BC9_P1)
  assert.equal(v.placeholder, true, v.reason)
})

test('占位检测：e01d0548 第1页（真实测量）不误判', () => {
  const v = isPlaceholderBlockBoxes(E01D0548_P1)
  assert.equal(v.placeholder, false, v.reason)
})

test('占位检测：ec11a3cc 第1页（高度/间距不均）不误判', () => {
  const v = isPlaceholderBlockBoxes(EC11A3CC_P1)
  assert.equal(v.placeholder, false, v.reason)
})

test('占位检测：fac27053 第1页（高度差异大）不误判', () => {
  const v = isPlaceholderBlockBoxes(FAC27053_P1)
  assert.equal(v.placeholder, false, v.reason)
})

test('占位检测：题数不足 3 不判占位（无法判断均分）', () => {
  const v = isPlaceholderBlockBoxes([
    { x: 100, y: 200, width: 800, height: 100 },
    { x: 100, y: 300, width: 800, height: 100 },
  ])
  assert.equal(v.placeholder, false)
  assert.match(v.reason, /样本不足/)
})

test('占位检测：等距但宽高各异 → 不算占位（真实题高本来就不同）', () => {
  const v = isPlaceholderBlockBoxes([
    { x: 100, y: 100, width: 800, height: 120 },
    { x: 100, y: 220, width: 800, height: 60 },
    { x: 100, y: 280, width: 800, height: 200 },
    { x: 100, y: 480, width: 800, height: 90 },
  ])
  assert.equal(v.placeholder, false, v.reason)
})

test('占位检测：等宽等高但间距不齐 → 不算占位', () => {
  const v = isPlaceholderBlockBoxes([
    { x: 100, y: 100, width: 800, height: 80 },
    { x: 100, y: 400, width: 800, height: 80 },
    { x: 100, y: 500, width: 800, height: 80 },
  ])
  assert.equal(v.placeholder, false, v.reason)
})

test('占位检测：非对象/数组/缺字段一律过滤，过滤后不足 3 条不判占位', () => {
  const v = isPlaceholderBlockBoxes([null, [10, 20, 30, 40], { x: 1 }, 'x', { x: 0, y: 0, width: 10, height: 10 }])
  assert.equal(v.placeholder, false)
})

test('findPlaceholderBlockPages：按 task+page 分组，只标出占位页', () => {
  const rows = [
    ...FD8B6BC9_P1.map(b => ({ taskId: 'T1', pageNumber: 1, block: b })),
    ...E01D0548_P1.map(b => ({ taskId: 'T2', pageNumber: 1, block: b })),
  ]
  const hit = findPlaceholderBlockPages(rows)
  assert.equal(hit.size, 1)
  assert.ok(hit.has('T1|1'))
  assert.ok(!hit.has('T2|1'))
})

test('findPlaceholderBlockPages：同一任务不同页互不影响', () => {
  const rows = [
    ...FD8B6BC9_P1.map(b => ({ taskId: 'T1', pageNumber: 1, block: b })),
    ...E01D0548_P1.map(b => ({ taskId: 'T1', pageNumber: 2, block: b })),
  ]
  const hit = findPlaceholderBlockPages(rows)
  assert.ok(hit.has('T1|1'))
  assert.ok(!hit.has('T1|2'))
})

test('findPlaceholderBlockPages：block 为 null 的行不参与', () => {
  const hit = findPlaceholderBlockPages([{ taskId: 'T1', pageNumber: 1, block: null }])
  assert.equal(hit.size, 0)
})

// ── 越界/退化 ──
test('越界：右下角超出 1000 → 不可信（此前漏判，裁出页面底部横条）', () => {
  // 存量真实样本 a775a783 第11题 y920 h300 / 9eff748b 第9题 y920 h200
  assert.equal(isOutOfRangeBox({ x: 140, y: 920, width: 860, height: 300 }), true)
  assert.equal(isOutOfRangeBox({ x: 80, y: 920, width: 850, height: 200 }), true)
  assert.equal(isOutOfRangeBox({ x: 150, y: 1300, width: 700, height: 100 }), true)
  assert.equal(isOutOfRangeBox({ x: 900, y: 100, width: 300, height: 150 }), true)
})

test('越界：贴边但未越界仍放行（交给 clamp + 墨迹校验）', () => {
  assert.equal(isOutOfRangeBox({ x: 0, y: 0, width: 1000, height: 1000 }), false)
  assert.equal(isOutOfRangeBox({ x: 100, y: 100, width: 800, height: 900 }), false)
  assert.equal(isOutOfRangeBox({ x: 100, y: 850, width: 800, height: 150 }), false)
})

test('越界：左上角越界、宽高非法、空框仍判不可信', () => {
  assert.equal(isOutOfRangeBox({ x: 100, y: 1200, width: 800, height: 60 }), true)
  assert.equal(isOutOfRangeBox({ x: -5, y: 100, width: 800, height: 60 }), true)
  assert.equal(isOutOfRangeBox({ x: 100, y: 100, width: 0, height: 60 }), true)
  assert.equal(isOutOfRangeBox({ x: 100, y: 100, width: 800, height: -1 }), true)
  assert.equal(isOutOfRangeBox(null), true)
})

test('parseBlockBox：兼容 width/height 与 w/h 两种键名', () => {
  assert.deepEqual(parseBlockBox({ x: 1, y: 2, width: 3, height: 4 }), { x: 1, y: 2, width: 3, height: 4 })
  assert.deepEqual(parseBlockBox({ x: 1, y: 2, w: 3, h: 4 }), { x: 1, y: 2, width: 3, height: 4 })
})

test('parseBlockBox：数组形态与畸形字段返回 null（不猜）', () => {
  // 存量真实样本：4 条 {"x":[140,650,880,720]} —— 模型给了 [x1,y1,x2,y2]，解析器把整串塞进 x
  assert.equal(parseBlockBox([140, 650, 880, 720]), null)
  assert.equal(parseBlockBox({ x: [140, 650, 880, 720] }), null)
  assert.equal(parseBlockBox(null), null)
  assert.equal(parseBlockBox('{"x":1}'), null)
})

test('isUntrustworthyBlock：直接吃原始 JSONB 值', () => {
  assert.equal(isUntrustworthyBlock({ x: 140, y: 920, width: 860, height: 300 }), true)
  assert.equal(isUntrustworthyBlock({ x: 100, y: 100, width: 800, height: 150 }), false)
  assert.equal(isUntrustworthyBlock(null), true)
})

// ── 接线契约（防回归：护栏被误删）──
const HANDOUT_SRC = readFileSync(new URL('../server/lib/weekendHandout.js', import.meta.url), 'utf8')
const CROP_SRC = readFileSync(new URL('../server/utils/cropAndUpload.js', import.meta.url), 'utf8')

test('契约：weekendHandout.resolveWbImage 必须同时拦「占位页」与「越界框」', () => {
  const m = HANDOUT_SRC.match(/function resolveWbImage\(r\)\s*\{[\s\S]{0,900}?\n  \}/)
  assert.ok(m, '找到 resolveWbImage')
  assert.ok(m[0].includes('isPlaceholderPage(r)'), '必须拦均分占位页')
  assert.ok(m[0].includes('isOutOfRangeBox(b)'), '必须拦越界框（存量 24/125 条错题的裁片是页面底部横条）')
})

test('契约：weekendHandout 的 SELECT 必须带出 wq.block_coordinates（否则拦不了）', () => {
  assert.ok(HANDOUT_SRC.includes('wq.block_coordinates AS wq_block_coordinates'), '缺 wq_block_coordinates')
})

test('契约：cropAndUpload.isUnreliableBox 必须走 blockBoxTrust 的共用判据', () => {
  assert.ok(CROP_SRC.includes("from './blockBoxTrust.js'"), '必须 import 共用判据')
  const m = CROP_SRC.match(/export function isUnreliableBox\(box\)\s*\{[\s\S]{0,200}?\n\}/)
  assert.ok(m, '找到 isUnreliableBox')
  assert.ok(m[0].includes('isOutOfRangeBox(box)'), '必须复用 isOutOfRangeBox，禁止另写一份')
})
