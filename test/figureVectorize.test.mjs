/**
 * 配图矢量化通道回归（2026-09-26）
 *
 * 锁三条不变量 + 两个**真实踩过的坑**：
 *  ① 二值化必须是 raw 像素（写成 PNG 编码流会静默得到垃圾 —— inkRatio 假 0.89）
 *  ② 闭环 DP 必须整圈输入（半圈输入会把 12 顶点细线轮廓压成 3 顶点三角形，
 *     evenodd 填成实心块 —— mismatch 0.5~0.85）
 *  ③ 歧义顶点必须按「最顺时针」配对（随便取会把外轮廓与孔洞拼成自交路径）
 *
 * 用法: node --test test/figureVectorize.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  otsuThreshold, binarize, removeSmallComponents, traceBoundaries,
  simplifyLoop, loopsToPathData, vectorizeFigure, verifyVectorTrace,
} from '../server/utils/figureVectorize.js'

test('otsuThreshold：双峰直方图阈值落在两峰之间', () => {
  const hist = new Int32Array(256)
  for (let i = 0; i < 100; i++) hist[20]++
  for (let i = 0; i < 100; i++) hist[230]++
  const t = otsuThreshold(hist, 200)
  assert.ok(t >= 20 && t < 230, `t=${t}`)
})

test('binarize：白底黑线 → 墨迹比例接近预期', () => {
  const w = 10, h = 10
  const g = Buffer.alloc(w * h, 250)
  for (let i = 0; i < 10; i++) g[5 * w + i] = 10 // 一条横线
  const { mask, inkRatio } = binarize(g, w, h)
  assert.ok(inkRatio > 0.05 && inkRatio < 0.15, `inkRatio=${inkRatio}`)
  assert.equal(mask[5 * w + 0], 1)
  assert.equal(mask[0], 0)
})

test('removeSmallComponents：抹掉单像素噪点，保留细线', () => {
  const w = 10, h = 10
  const m = new Uint8Array(w * h)
  m[0] = 1                       // 噪点
  for (let i = 0; i < 8; i++) m[5 * w + i] = 1 // 细线
  const removed = removeSmallComponents(m, w, h, 6)
  assert.equal(removed, 1)
  assert.equal(m[0], 0)
  assert.equal(m[5 * w + 3], 1)
})

test('traceBoundaries：实心 3x3 块 → 1 个 12 顶点闭环', () => {
  const w = 6, h = 6
  const m = new Uint8Array(w * h)
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) m[y * w + x] = 1
  const loops = traceBoundaries(m, w, h)
  assert.equal(loops.length, 1)
  assert.equal(loops[0].length, 12)
})

test('traceBoundaries：空心方框 → 外轮廓 + 孔洞两个闭环（evenodd 才能镂空）', () => {
  const w = 6, h = 6
  const m = new Uint8Array(w * h)
  for (let x = 1; x <= 4; x++) { m[1 * w + x] = 1; m[4 * w + x] = 1 }
  for (let y = 1; y <= 4; y++) { m[y * w + 1] = 1; m[y * w + 4] = 1 }
  const loops = traceBoundaries(m, w, h)
  assert.equal(loops.length, 2)
  // 两个闭环方向相反（外轮廓与孔洞），或至少面积不同 —— 这里断言一个包住另一个
  const area = (l) => {
    let a = 0
    for (let i = 0; i < l.length; i++) {
      const [x1, y1] = l[i], [x2, y2] = l[(i + 1) % l.length]
      a += x1 * y2 - x2 * y1
    }
    return Math.abs(a / 2)
  }
  const areas = loops.map(area).sort((a, b) => b - a)
  assert.ok(areas[0] > areas[1], `areas=${areas}`)
})

test('【回归·坑②】simplifyLoop：细线轮廓不得被压成 3 顶点三角形', () => {
  // 模拟一段「细线轮廓」：绕一圈的长闭环
  const loop = []
  for (let x = 0; x < 20; x++) loop.push([x, 0])
  for (let y = 1; y < 4; y++) loop.push([19, y])
  for (let x = 18; x >= 0; x--) loop.push([x, 3])
  for (let y = 2; y >= 1; y--) loop.push([0, y])
  const simp = simplifyLoop(loop, 0.8)
  assert.ok(simp.length >= 4, `顶点数 ${simp.length} —— 被压成三角形说明闭环 DP 又写回半圈了`)
  // 简化后的多边形面积应接近原面积（20x3=60）
  const area = (l) => {
    let a = 0
    for (let i = 0; i < l.length; i++) {
      const [x1, y1] = l[i], [x2, y2] = l[(i + 1) % l.length]
      a += x1 * y2 - x2 * y1
    }
    return Math.abs(a / 2)
  }
  assert.ok(area(simp) > 40, `简化后面积 ${area(simp)} 明显小于原 60`)
})

test('【回归·坑①】vectorizeFigure：raw 像素口径 —— 白底 + 单条横线必须出图', async () => {
  const w = 120, h = 40
  const g = Buffer.alloc(w * h, 255)
  for (let x = 5; x < 115; x++) g[20 * w + x] = 0
  const png = await sharp(g, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer()
  const res = await vectorizeFigure(png)
  assert.equal(res.ok, true, res.reason)
  assert.ok(res.stats.inkRatio > 0 && res.stats.inkRatio < 0.1, `inkRatio=${res.stats.inkRatio}（若接近 0.9 说明二值化吃到了编码流）`)
  assert.ok(res.stats.mismatch <= 0.10, `mismatch=${res.stats.mismatch}`)
})

test('【回归·坑③】交叉细线不得填成实心块（歧义顶点配对）', async () => {
  const w = 120, h = 120
  const g = Buffer.alloc(w * h, 255)
  const set = (x, y) => { if (x >= 0 && x < w && y >= 0 && y < h) g[y * w + x] = 0 }
  for (let t = 0; t < 100; t++) { set(10 + t, 10 + t); set(11 + t, 10 + t); set(10 + t, 110 - t); set(11 + t, 110 - t) } // X 形交叉（2px 宽，贴近真实笔画）
  const png = await sharp(g, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer()
  const res = await vectorizeFigure(png)
  assert.equal(res.ok, true, res.reason)
  assert.ok(res.stats.mismatch <= 0.10, `mismatch=${res.stats.mismatch} —— 偏大说明交叉处被填实了`)
})

test('verifyVectorTrace：同构 SVG 通过；空白 SVG 判不合格', async () => {
  const w = 60, h = 60
  const mask = new Uint8Array(w * h)
  for (let x = 5; x < 55; x++) mask[30 * w + x] = 1
  const good = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/><rect x="5" y="30" width="50" height="1" fill="#111"/></svg>`
  const g = await verifyVectorTrace(good, mask, w, h)
  assert.equal(g.ok, true, JSON.stringify(g))
  const blank = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/></svg>`
  const b = await verifyVectorTrace(blank, mask, w, h)
  assert.equal(b.ok, false)
})

test('loopsToPathData：闭环以 Z 收尾，坐标保留 1 位小数', () => {
  const d = loopsToPathData([[[0, 0], [10.25, 0], [10.25, 5]]])
  assert.equal(d, 'M0 0L10.3 0L10.3 5Z')
})
