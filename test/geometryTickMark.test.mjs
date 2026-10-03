/**
 * 回归锁：等比/等长刻度短杠图元（P2-8，第 76 轮，负责人裁决「最好自己解决丢失问题」）。
 *
 * 事故：题干「AB/AD = AC/AE = BC/DE」的证明题（asset 73506ed1 / 0e235860），
 * 原卷在对应边上画了 1~4 道短杠标出成比例的边，重绘产物把标记全丢了——
 * DSL 命令集里根本没有这个图元，模型想标也标不了。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStructureFromDsl, commandReference, COMMANDS } from '../server/utils/geom/dsl/index.js'
import { normalizeStructure } from '../server/utils/geom/structure.js'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'

const BASE_DSL = [
  'point : 0 0 -> A',
  'point : 100 0 -> B',
  'point : 50 80 -> C',
  'segment : A B -> AB',
  'segment : B C -> BC',
  'segment : C A -> CA'
].join('\n')

test('DSL：tick 命令存在且进 prompt 命令参考（单一真值源）', () => {
  assert.ok(COMMANDS.tick, 'tick 必须在命令表里')
  assert.match(commandReference(), /tick : A B 2/, 'prompt 命令参考必须自动带上 tick 用法')
})

test('DSL：tick 编译成结构里的 ticks 条目', () => {
  const r = buildStructureFromDsl(`${BASE_DSL}\ntick : A B 2 -> m1\ntick : B C 1 -> m2`)
  assert.ok(r.ok, `DSL 应执行通过，实际 ${JSON.stringify(r.errors)}`)
  assert.deepEqual(r.structure.ticks, [
    { from: 'A', to: 'B', count: 2 },
    { from: 'B', to: 'C', count: 1 }
  ])
})

test('不猜：道数越界/非整数一律报错交 ReAct 修，绝不自己挑一个', () => {
  for (const bad of ['tick : A B 0 -> m1', 'tick : A B 5 -> m1', 'tick : A B 2.7 -> m1']) {
    const r = buildStructureFromDsl(`${BASE_DSL}\n${bad}`)
    assert.equal(r.ok, false, `${bad} 必须失败`)
    assert.ok(JSON.stringify(r.errors).includes('BAD_TICK_COUNT'), `${bad} 必须报 BAD_TICK_COUNT，实际 ${JSON.stringify(r.errors)}`)
  }
  const same = buildStructureFromDsl(`${BASE_DSL}\ntick : A A 2 -> m1`)
  assert.equal(same.ok, false, '两端同点必须报错')
})

test('normalizeStructure：非法与重复的 ticks 丢弃（同一对点只留第一条）', () => {
  const s = normalizeStructure({
    points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 }],
    segments: [{ from: 'A', to: 'B' }],
    ticks: [
      { from: 'A', to: 'B', count: 2 },
      { from: 'B', to: 'A', count: 3 },   // 同一对点重复 → 丢
      { from: 'A', to: 'A', count: 1 },   // 自环 → 丢
      { from: 'A', to: 'B', count: 9 },   // 越界（已在前面占位，这里也丢）
      { from: 'A', to: 'C', count: 1 }    // 端点不存在 → 渲染层跳过，结构层保留
    ]
  })
  assert.deepEqual(s.ticks, [{ from: 'A', to: 'B', count: 2 }], '只留第一条合法 tick')
})

test('渲染：短杠道数正确、垂直于边、居中在边中点', () => {
  const svg = renderGeometrySvg({
    points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 100, y: 0 }, { label: 'C', x: 50, y: 80 }],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }],
    ticks: [{ from: 'A', to: 'B', count: 3 }, { from: 'B', to: 'C', count: 1 }]
  })
  assert.ok(svg, '应出图')
  const g = svg.match(/(<g stroke="#111111" stroke-width="1\.4"[\s\S]*?<\/g>)/)
  assert.ok(g, '刻度短杠必须单独成组')
  const lines = [...g[1].matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"\/>/g)]
  assert.equal(lines.length, 4, `3 道 + 1 道 = 4 条短杠，实际 ${lines.length}`)
  // AB 是水平边 → 短杠应竖直（x1≈x2），且关于边中点对称分布
  const ab = lines.slice(0, 3).map(m => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }))
  for (const l of ab) {
    assert.ok(Math.abs(l.x1 - l.x2) < 0.01, '水平边的短杠必须垂直于边（x 不变）')
    assert.ok(Math.abs(l.y1 - l.y2) > 5, '短杠要有可见长度')
  }
  const xs = ab.map(l => l.x1)
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], '多道短杠沿边依次排开')
  assert.ok(Math.abs((xs[0] + xs[2]) / 2 - xs[1]) < 0.01, '三道杠等距、中间那道在边中点')
})

test('向后兼容：无 ticks 字段的旧结构渲染结果不受影响（不新增图元）', () => {
  const svg = renderGeometrySvg({
    points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 100, y: 0 }],
    segments: [{ from: 'A', to: 'B' }]
  })
  assert.ok(svg)
  assert.ok(!/stroke-width="1\.4"/.test(svg), '没有 tick 就不该出现短杠组')
})
