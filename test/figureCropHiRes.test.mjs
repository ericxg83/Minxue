/**
 * 配图高清重裁回归（2026-09-26）
 *
 * 锁三件不变量：
 *  ① 映射算术恒等（压缩页框 ⇄ 原图框）
 *  ② 缩放比不一致 / 原图无增益 / 框退化 时必须 fail-closed 返回 null
 *  ③ `resolutionGain` 的增益口径（报告与验收都用它）
 *
 * 用法: node --test test/figureCropHiRes.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertBoxRoundTrip, resolutionGain } from '../server/utils/figureCropHiRes.js'

test('映射恒等：普通框往返误差 ≤ 1px', () => {
  const box = { x: 320, y: 135, width: 620, height: 165 }
  const r = assertBoxRoundTrip(box, 1650 / 1350, 1650, 2200)
  assert.equal(r.ok, true)
  assert.ok(r.maxDelta <= 1.0, `maxDelta=${r.maxDelta}`)
})

test('映射恒等：大图缩放比（3072/1350）也成立', () => {
  const box = { x: 850, y: 130, width: 120, height: 100 }
  const r = assertBoxRoundTrip(box, 3072 / 1350, 3072, 4096)
  assert.equal(r.ok, true)
})

test('fail-closed：框贴到原图右下边界（夹紧改变框）→ 判不合格', () => {
  // width 溢出原图 → 夹紧后往返必然偏差
  const box = { x: 900, y: 900, width: 400, height: 400 }
  const r = assertBoxRoundTrip(box, 2.0, 1000, 1000)
  assert.equal(r.ok, false)
})

test('fail-closed：框超出原图左边界', () => {
  const box = { x: 0, y: 0, width: 500, height: 500 }
  const r = assertBoxRoundTrip(box, 1.0, 1000, 1000)
  assert.equal(r.ok, true)
  const r2 = assertBoxRoundTrip({ x: -50, y: 10, width: 300, height: 300 }, 2.0, 1000, 1000)
  assert.equal(r2.ok, false)
})

test('resolutionGain：增益口径 = 缩放比，短边同步放大', () => {
  const g = resolutionGain({ width: 200, height: 120 }, 1650 / 1350)
  assert.equal(g.beforeShort, 120)
  assert.equal(g.afterShort, Math.round(120 * (1650 / 1350)))
  assert.equal(g.ratio, Number((1650 / 1350).toFixed(3)))
})

test('resolutionGain：入参缺失返回 null（报告侧不得崩）', () => {
  assert.equal(resolutionGain(null, 1.2), null)
  assert.equal(resolutionGain({ width: 1, height: 1 }, 0), null)
})

test('cropFigureHiRes：缩放比不一致（长宽比不同）必须返回 null', async () => {
  const sharp = (await import('sharp')).default
  const { cropFigureHiRes } = await import('../server/utils/figureCropHiRes.js')
  // 压缩页 1350x1800；原图故意用不同长宽比 1650x2000（sy ≠ sx）
  const page = await sharp({ create: { width: 1350, height: 1800, channels: 3, background: '#fff' } }).png().toBuffer()
  const orig = await sharp({ create: { width: 1650, height: 2000, channels: 3, background: '#fff' } }).png().toBuffer()
  const out = await cropFigureHiRes({
    pageBuffer: page, originalBuffer: orig,
    bboxPx: { x: 100, y: 100, width: 200, height: 200 },
    estimateBackground: () => 255,
    cleanCrop: async (b) => b,
  })
  assert.equal(out, null)
})

test('cropFigureHiRes：原图不比压缩页大（scale < 1.02）必须返回 null', async () => {
  const sharp = (await import('sharp')).default
  const { cropFigureHiRes } = await import('../server/utils/figureCropHiRes.js')
  const page = await sharp({ create: { width: 1350, height: 1800, channels: 3, background: '#fff' } }).png().toBuffer()
  const orig = await sharp({ create: { width: 1350, height: 1800, channels: 3, background: '#fff' } }).png().toBuffer()
  const out = await cropFigureHiRes({
    pageBuffer: page, originalBuffer: orig,
    bboxPx: { x: 100, y: 100, width: 200, height: 200 },
    estimateBackground: () => 255,
    cleanCrop: async (b) => b,
  })
  assert.equal(out, null)
})
