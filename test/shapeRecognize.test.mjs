/**
 * 手绘图形识别回归测试（2026-10-09 · 白板「画完停顿 1 秒自动拉直」）
 *
 * 锁定 src/workbench/utils/shapeRecognize.js 的两类行为：
 * ① 该认的认：直线（含水平/垂直吸附）、三角、矩形（含斜矩形直角化）、
 *    四边形、五/六边形、圆；
 * ② 不该认的绝不硬凑：抛物线、对勾、3/4 弧、椭圆、细长 0/O 形、
 *    顿笔短标记 —— 老师写的东西不能被改坏。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { recognizeShape } from '../src/workbench/utils/shapeRecognize.js'

// 确定性伪随机（LCG），保证测试可复现
function makeRng(seed) {
  let s = seed
  return () => {
    s = (s * 48271) % 2147483647
    return s / 2147483647
  }
}

/** 沿路径每 ~step px 采样并加 ±amp 抖动，模拟手绘笔迹的点列 */
function handDraw(path, { step = 10, amp = 2, seed = 42 } = {}) {
  const rnd = makeRng(seed)
  const pts = []
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    const k = Math.max(1, Math.round(L / step))
    for (let s = 0; s < k; s++) {
      const t = s / k
      pts.push({
        x: a.x + (b.x - a.x) * t + (rnd() - 0.5) * 2 * amp,
        y: a.y + (b.y - a.y) * t + (rnd() - 0.5) * 2 * amp,
        p: 0.5,
      })
    }
  }
  const last = path[path.length - 1]
  pts.push({ x: last.x + (rnd() - 0.5) * 2 * amp, y: last.y + (rnd() - 0.5) * 2 * amp, p: 0.5 })
  return pts
}

/** 点到线段距离（测试内部自用） */
function segDist(p, a, b) {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const wx = p.x - a.x
  const wy = p.y - a.y
  const len2 = vx * vx + vy * vy
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2))
  return Math.hypot(wx - t * vx, wy - t * vy)
}

// ── 直线 ──────────────────────────────────────────────────────────────
test('近水平手绘直线 → 拉直并吸附成精确水平', () => {
  const pts = handDraw([{ x: 100, y: 300 }, { x: 500, y: 292 }], { amp: 2 })
  const r = recognizeShape(pts)
  assert.ok(r, '应识别为直线')
  assert.equal(r.kind, 'line')
  assert.equal(r.points.length, 2)
  // 1.1° 倾斜在 7° 吸附带内：两端 y 应一致（水平）
  assert.equal(r.points[0].y, r.points[1].y)
  assert.ok(Math.abs((r.points[1].x - r.points[0].x) - 400) < 4, '长度应保持 ~400')
})

test('斜直线 → 拉直但不吸附轴向', () => {
  const pts = handDraw([{ x: 100, y: 100 }, { x: 400, y: 210 }], { amp: 2 })
  const r = recognizeShape(pts)
  assert.ok(r)
  assert.equal(r.kind, 'line')
  // 20° 不在吸附带：两端 y 保持各自值
  assert.notEqual(r.points[0].y, r.points[1].y)
})

test('近垂直手绘直线 → 吸附成精确垂直', () => {
  const pts = handDraw([{ x: 300, y: 80 }, { x: 306, y: 420 }], { amp: 2 })
  const r = recognizeShape(pts)
  assert.ok(r)
  assert.equal(r.kind, 'line')
  assert.equal(r.points[0].x, r.points[1].x)
})

test('抛物线草图 → 保持原样（绝不拉直成直线）', () => {
  const pts = []
  for (let i = 0; i <= 80; i++) {
    const t = i / 80
    pts.push({ x: 100 + t * 300, y: 300 - 40 * (1 - (2 * t - 1) ** 2), p: 0.5 })
  }
  assert.equal(recognizeShape(pts), null)
})

test('对勾 → 保持原样', () => {
  const pts = handDraw([{ x: 100, y: 200 }, { x: 140, y: 260 }, { x: 220, y: 120 }], { amp: 1.5 })
  assert.equal(recognizeShape(pts), null)
})

test('小笔迹（顿笔 / 短标记）→ 不识别', () => {
  const pts = handDraw([{ x: 100, y: 100 }, { x: 125, y: 108 }], { amp: 1 })
  assert.equal(recognizeShape(pts), null)
})

// ── 三角形 ────────────────────────────────────────────────────────────
test('手绘三角形 → 拉直为三角形（顶点保留、边笔直、闭合）', () => {
  const V = [{ x: 100, y: 100 }, { x: 420, y: 130 }, { x: 220, y: 360 }, { x: 100, y: 100 }]
  const pts = handDraw(V, { amp: 2 })
  const r = recognizeShape(pts)
  assert.ok(r, '应识别为三角形')
  assert.equal(r.kind, 'triangle')
  // 闭合：首尾点重合
  const first = r.points[0]
  const lastP = r.points[r.points.length - 1]
  assert.ok(Math.hypot(first.x - lastP.x, first.y - lastP.y) < 0.5, '首尾应封口')
  // 三个原始顶点附近都有输出点（顶点被保留）
  for (const v of V.slice(0, 3)) {
    const near = r.points.some((p) => Math.hypot(p.x - v.x, p.y - v.y) < 6)
    assert.ok(near, `顶点 (${v.x},${v.y}) 附近应有输出点`)
  }
  // 所有输出点都贴近理想三角形边上（边是直的）
  let maxEdgeDev = 0
  for (const p of r.points) {
    let best = Infinity
    for (let i = 0; i < 3; i++) best = Math.min(best, segDist(p, V[i], V[(i + 1) % 3]))
    maxEdgeDev = Math.max(maxEdgeDev, best)
  }
  assert.ok(maxEdgeDev < 4, `输出点应贴边（≤4px），实际 ${maxEdgeDev.toFixed(2)}`)
})

// ── 矩形 / 四边形 ─────────────────────────────────────────────────────
test('手绘矩形（近轴对齐）→ 吸附成轴对齐矩形', () => {
  const V = [{ x: 100, y: 100 }, { x: 400, y: 104 }, { x: 396, y: 300 }, { x: 102, y: 296 }, { x: 100, y: 100 }]
  const pts = handDraw(V, { amp: 2 })
  const r = recognizeShape(pts)
  assert.ok(r)
  assert.equal(r.kind, 'rect')
  // 轴对齐：每个输出点都落在输出包盒的边界上（水平边的点 y=±边，竖直边的点 x=±边）
  const xs = r.points.map((p) => p.x)
  const ys = r.points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  for (const p of r.points) {
    const onBorder = Math.abs(p.x - minX) < 0.6 || Math.abs(p.x - maxX) < 0.6
      || Math.abs(p.y - minY) < 0.6 || Math.abs(p.y - maxY) < 0.6
    assert.ok(onBorder, `点 (${p.x},${p.y}) 应在包盒边界上`)
  }
  assert.ok(Math.abs((maxX - minX) - 300) < 6 && Math.abs((maxY - minY) - 196) < 6, '外包尺寸应与手绘一致')
})

test('斜矩形（15°）→ 拉直为带直角的旋转矩形', () => {
  const cx = 300
  const cy = 250
  const w = 280
  const h = 160
  const th = (15 * Math.PI) / 180
  const rot = (x, y) => ({
    x: cx + x * Math.cos(th) - y * Math.sin(th),
    y: cy + x * Math.sin(th) + y * Math.cos(th),
  })
  const c1 = rot(-w / 2, -h / 2)
  const c2 = rot(w / 2, -h / 2)
  const c3 = rot(w / 2, h / 2)
  const c4 = rot(-w / 2, h / 2)
  const pts = handDraw([c1, c2, c3, c4, c1], { amp: 2 })
  const r = recognizeShape(pts)
  assert.ok(r)
  assert.equal(r.kind, 'rect')
  // 反向旋转回正后应成为轴对齐矩形：所有点落在包盒边界上，包盒 ≈ w×h
  const cos = Math.cos(-th)
  const sin = Math.sin(-th)
  const back = r.points.map((p) => ({
    x: (p.x - cx) * cos - (p.y - cy) * sin,
    y: (p.x - cx) * sin + (p.y - cy) * cos,
  }))
  const xs = back.map((p) => p.x)
  const ys = back.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  for (const p of back) {
    const onBorder = Math.abs(p.x - minX) < 1.5 || Math.abs(p.x - maxX) < 1.5
      || Math.abs(p.y - minY) < 1.5 || Math.abs(p.y - maxY) < 1.5
    assert.ok(onBorder, `回正后点 (${p.x.toFixed(1)},${p.y.toFixed(1)}) 应在包盒边界上`)
  }
  assert.ok(Math.abs((maxX - minX) - w) < 6, `宽应 ≈ ${w}，实际 ${(maxX - minX).toFixed(1)}`)
  assert.ok(Math.abs((maxY - minY) - h) < 6, `高应 ≈ ${h}，实际 ${(maxY - minY).toFixed(1)}`)
})

test('手绘梯形 → 识别为四边形（不硬凑成矩形）', () => {
  const V = [{ x: 150, y: 150 }, { x: 400, y: 150 }, { x: 350, y: 330 }, { x: 180, y: 330 }, { x: 150, y: 150 }]
  const pts = handDraw(V, { amp: 2 })
  const r = recognizeShape(pts)
  assert.ok(r)
  assert.equal(r.kind, 'quad')
})

// ── 多边形 ────────────────────────────────────────────────────────────
test('手绘五边形 → 识别为多边形', () => {
  const V = []
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
    V.push({ x: 300 + 150 * Math.cos(a), y: 300 + 150 * Math.sin(a) })
  }
  V.push(V[0])
  const pts = handDraw(V, { amp: 2 })
  const r = recognizeShape(pts)
  assert.ok(r)
  assert.equal(r.kind, 'polygon')
})

test('手绘六边形 → 识别为多边形', () => {
  const V = []
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 6
    V.push({ x: 300 + 150 * Math.cos(a), y: 300 + 150 * Math.sin(a) })
  }
  V.push(V[0])
  const pts = handDraw(V, { amp: 2 })
  const r = recognizeShape(pts)
  assert.ok(r)
  assert.equal(r.kind, 'polygon')
})

// ── 圆 ────────────────────────────────────────────────────────────────
test('手绘圆 → 拉正为圆（圆心 / 半径还原、封口）', () => {
  const rnd = makeRng(7)
  const pts = []
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * 2 * Math.PI
    const r = 120 + (rnd() - 0.5) * 6
    pts.push({ x: 300 + r * Math.cos(a), y: 300 + r * Math.sin(a), p: 0.5 })
  }
  const rec = recognizeShape(pts)
  assert.ok(rec, '应识别为圆')
  assert.equal(rec.kind, 'circle')
  const cx = rec.points.reduce((s, p) => s + p.x, 0) / rec.points.length
  const cy = rec.points.reduce((s, p) => s + p.y, 0) / rec.points.length
  assert.ok(Math.abs(cx - 300) < 4 && Math.abs(cy - 300) < 4, `圆心应 ≈ (300,300)，实际 (${cx.toFixed(1)},${cy.toFixed(1)})`)
  const rr = Math.hypot(rec.points[0].x - cx, rec.points[0].y - cy)
  assert.ok(Math.abs(rr - 120) < 4, `半径应 ≈ 120，实际 ${rr.toFixed(1)}`)
  const first = rec.points[0]
  const lastP = rec.points[rec.points.length - 1]
  assert.ok(Math.hypot(first.x - lastP.x, first.y - lastP.y) < 0.01, '首尾应封口')
})

test('椭圆 → 保持原样（不硬凑成圆或多边形）', () => {
  const pts = []
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * 2 * Math.PI
    pts.push({ x: 300 + 180 * Math.cos(a), y: 300 + 110 * Math.sin(a), p: 0.5 })
  }
  assert.equal(recognizeShape(pts), null)
})

test('3/4 圆弧 → 保持原样（未闭合，也不是直线）', () => {
  const pts = []
  for (let i = 0; i <= 54; i++) {
    const a = (i / 54) * 1.5 * Math.PI
    pts.push({ x: 300 + 120 * Math.cos(a), y: 300 + 120 * Math.sin(a), p: 0.5 })
  }
  assert.equal(recognizeShape(pts), null)
})

test('细长闭合曲线（0 / O 形）→ 保持原样', () => {
  const pts = []
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * 2 * Math.PI
    pts.push({ x: 300 + 150 * Math.cos(a), y: 300 + 55 * Math.sin(a) + 8 * Math.sin(3 * a), p: 0.5 })
  }
  assert.equal(recognizeShape(pts), null)
})

// ── 输出契约 ──────────────────────────────────────────────────────────
test('输出点已量化到 2 位小数（与 strokePoint 纪律一致）', () => {
  const pts = handDraw([{ x: 100, y: 300 }, { x: 500, y: 292 }], { amp: 2, seed: 99 })
  const r = recognizeShape(pts)
  assert.ok(r)
  for (const p of r.points) {
    assert.equal(p.x, Math.round(p.x * 100) / 100)
    assert.equal(p.y, Math.round(p.y * 100) / 100)
  }
})

test('脏数据防御：非法点被过滤，点数不足返回 null', () => {
  assert.equal(recognizeShape(null), null)
  assert.equal(recognizeShape([]), null)
  assert.equal(recognizeShape([{ x: 1, y: 2 }, { x: 'a', y: 3 }, { x: NaN, y: 0 }]), null)
})
