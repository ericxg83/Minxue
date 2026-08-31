import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dot, cross, dist, unit, footOfPerp, lineIntersect, divideRatio, bisectorDir,
  reflectOverLine, rotateAbout, circleLineIntersect, circleCircleIntersect,
  tangentFromExternal, circumcenter, incenter, angleAt, signedArea, bestSimilarity,
  pointToLineDist, pointToSegmentDist
} from '../server/utils/geom/vec.js'

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('垂足落在直线上且与该直线正交', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 10, y: 0 }
  const p = { x: 3, y: 7 }
  const f = footOfPerp(p, a, b)
  near(f.x, 3)
  near(f.y, 0)
  near(f.t, 0.3)
  near(dot({ x: f.x - p.x, y: f.y - p.y }, { x: b.x - a.x, y: b.y - a.y }), 0)
})

test('垂足参数 t 能暴露落在线段外的退化解', () => {
  const f = footOfPerp({ x: -5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })
  assert.ok(f.t < 0, '垂足在 a 之外应给出负参数')
})

test('点到直线与点到线段的区别在端点外', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 10, y: 0 }
  const p = { x: -6, y: 8 }
  near(pointToLineDist(p, a, b), 8)
  near(pointToSegmentDist(p, a, b), 10)
})

test('两直线交点；平行返回 null', () => {
  const hit = lineIntersect({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 })
  near(hit.x, 2)
  near(hit.y, 2)
  assert.equal(lineIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 2 }), null)
})

test('直线与圆的交点数覆盖相离/相切/相交三种判别', () => {
  const c = { x: 0, y: 0 }
  assert.equal(circleLineIntersect(c, 1, { x: -5, y: 3 }, { x: 5, y: 3 }).length, 0)
  const tangent = circleLineIntersect(c, 3, { x: -5, y: 3 }, { x: 5, y: 3 })
  assert.equal(tangent.length, 1)
  near(tangent[0].x, 0)
  const two = circleLineIntersect(c, 5, { x: -9, y: 3 }, { x: 9, y: 3 })
  assert.equal(two.length, 2)
  near(two[0].t < two[1].t ? 1 : 0, 1)
  for (const p of two) near(dist(p, c), 5, 1e-9)
})

test('两圆交点在两圆上；相离与同心返回空', () => {
  const pts = circleCircleIntersect({ x: 0, y: 0 }, 5, { x: 8, y: 0 }, 5)
  assert.equal(pts.length, 2)
  for (const p of pts) {
    near(dist(p, { x: 0, y: 0 }), 5, 1e-9)
    near(dist(p, { x: 8, y: 0 }), 5, 1e-9)
  }
  assert.equal(circleCircleIntersect({ x: 0, y: 0 }, 1, { x: 99, y: 0 }, 1).length, 0)
  assert.equal(circleCircleIntersect({ x: 0, y: 0 }, 1, { x: 0, y: 0 }, 2).length, 0)
})

test('切点满足半径垂直于切线', () => {
  const c = { x: 0, y: 0 }
  const p = { x: 10, y: 0 }
  const ts = tangentFromExternal(p, c, 6)
  assert.equal(ts.length, 2)
  for (const t of ts) {
    near(dist(t, c), 6, 1e-9)
    near(dot({ x: t.x - c.x, y: t.y - c.y }, { x: p.x - t.x, y: p.y - t.y }), 0, 1e-9)
  }
})

test('镜像点与原点到轴等距且连线垂直于轴', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 6, y: 6 }
  const p = { x: 4, y: 0 }
  const q = reflectOverLine(p, a, b)
  near(q.x, 0)
  near(q.y, 4)
  near(pointToLineDist(p, a, b), pointToLineDist(q, a, b))
  near(dot({ x: q.x - p.x, y: q.y - p.y }, { x: b.x - a.x, y: b.y - a.y }), 0, 1e-9)
})

test('旋转保持到中心的距离，正角为逆时针', () => {
  const c = { x: 1, y: 1 }
  const q = rotateAbout({ x: 4, y: 1 }, c, 90)
  near(dist(q, c), 3, 1e-9)
  near(q.x, 1, 1e-9)
  near(q.y, 4, 1e-9)
})

test('角平分方向与两边夹角相等', () => {
  const v = { x: 0, y: 0 }
  const d = bisectorDir(v, { x: 5, y: 0 }, { x: 0, y: 5 })
  near(angleAt(v, { x: 5, y: 0 }, d), 45, 1e-9)
  near(angleAt(v, { x: 0, y: 5 }, d), 45, 1e-9)
})

test('外心到三顶点等距，内心到三边等距', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 8, y: 0 }
  const c = { x: 0, y: 6 }
  const o = circumcenter(a, b, c)
  near(dist(o, a), dist(o, b), 1e-9)
  near(dist(o, a), dist(o, c), 1e-9)
  const i = incenter(a, b, c)
  near(pointToLineDist(i, a, b), pointToLineDist(i, b, c), 1e-9)
  near(pointToLineDist(i, a, b), pointToLineDist(i, a, c), 1e-9)
})

test('有向面积的符号区分顶点绕行方向', () => {
  const ccw = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }]
  assert.ok(signedArea(ccw) > 0)
  assert.ok(signedArea([...ccw].reverse()) < 0)
  near(Math.abs(signedArea(ccw)), 6)
})

test('定比分点与中点一致', () => {
  const m = divideRatio({ x: 0, y: 0 }, { x: 10, y: 4 }, 0.5)
  near(m.x, 5)
  near(m.y, 2)
})

test('最优相似变换保向，绝不把图镜像翻转', () => {
  // 精确构造出的等腰直角三角形，与模型给的"同形状但旋转过"的坐标对齐
  const exact = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
  const target = [{ x: 5, y: 5 }, { x: 5, y: 8 }, { x: 2, y: 5 }]
  const sim = bestSimilarity(exact, target)
  assert.ok(sim)
  const mapped = exact.map(sim.apply)
  for (let i = 0; i < 3; i++) near(dist(mapped[i], target[i]), 0, 1e-9)
  // 关键性质：绕行方向不变。允许反射会让重绘图左右颠倒。
  assert.ok(signedArea(exact) * signedArea(mapped) > 0)
  near(sim.scale, 3, 1e-9)
})

test('目标点集是镜像时不会翻转，只给最优保向近似', () => {
  const exact = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
  const mirrored = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }]
  const sim = bestSimilarity(exact, mirrored)
  const mapped = exact.map(sim.apply)
  assert.ok(signedArea(exact) * signedArea(mapped) > 0, '保向约束必须优先于贴合误差')
})

test('退化输入返回 null 而不抛异常', () => {
  assert.equal(unit({ x: 0, y: 0 }), null)
  assert.equal(footOfPerp({ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 2 }), null)
  assert.equal(circumcenter({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null)
  assert.equal(bisectorDir({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }), null)
  assert.equal(bestSimilarity([], []), null)
  near(cross({ x: 1, y: 0 }, { x: 0, y: 1 }), 1)
})



