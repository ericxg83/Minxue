import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateStructureAgainstContent,
  extractReferencedPoints
} from '../server/utils/geometryContentGate.js'

// 2026-08-28 抽样实测的两条错图，题干为线上原文。闸门必须拦住它们。
test('折叠题：画成矩形加对角线，缺派生点 C′ 且多画 DB → 拦截', () => {
  const structure = {
    points: [
      { label: 'A', x: 10, y: 80 }, { label: 'B', x: 10, y: 10 },
      { label: 'C', x: 80, y: 10 }, { label: 'D', x: 80, y: 80 },
      { label: 'E', x: 80, y: 45 }
    ],
    segments: [
      { from: 'A', to: 'C' }, { from: 'C', to: 'D' },
      { from: 'D', to: 'B' }, { from: 'A', to: 'B' },
      { from: 'B', to: 'E' }, { from: 'E', to: 'D' }
    ]
  }
  const content = '在边长为5的正方形ABCD中，点E为CD上一点，连接BE，将△BCE沿着BE折叠得到△BC′E，连接AC′、DC′，若∠CDA′的度数'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, false)
  assert.ok(r.reasons.some(s => s.includes('C′')), '必须点出派生点丢失')
  assert.ok(
    r.reasons.some(s => s.includes('AC') || s.includes('BD')),
    '必须点出凭空画出的对角线'
  )
})

test('作图题：题干说垂足为E，模型把 D 画成 E 的错位 → 拦截', () => {
  const structure = {
    points: [{ label: 'C' }, { label: 'E' }, { label: 'B' }, { label: 'A' }],
    segments: [{ from: 'C', to: 'E' }, { from: 'E', to: 'B' }, { from: 'A', to: 'B' }]
  }
  const content = '作图，(1)过△ABC的顶点C作直线CD，使得CD//AB；(2)作点B到直线CD的垂线，垂足为点E'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, false)
})

test('正常梯形图 → 放行', () => {
  const structure = {
    points: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
    ]
  }
  const content = '如图，在梯形ABCD中，AB//CD，∠C=90°，AB=√6，BC=√18，CD=√96，AD=√72'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, true, r.reasons.join('；'))
})

test('正确画出派生点的折叠图 → 放行', () => {
  const structure = {
    points: [{ label: 'C' }, { label: 'B' }, { label: 'E' }, { label: 'C′' }],
    segments: [
      { from: 'C', to: 'B' }, { from: 'B', to: 'E' }, { from: 'E', to: 'C′' }
    ]
  }
  const content = '将△BCE沿着BE折叠得到△BC′E，连接AC′'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, true, r.reasons.join('；'))
})

test('三角形公共边情形：△ABC 与 △DEF 共用题干的顶点都允许', () => {
  const structure = {
    points: [
      { label: 'A' }, { label: 'B' }, { label: 'C' },
      { label: 'D' }, { label: 'E' }, { label: 'F' }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' },
      { from: 'D', to: 'E' }, { from: 'E', to: 'F' }, { from: 'F', to: 'D' }
    ]
  }
  const content = '在△ABC和△DEF中，如果∠A=45°，AB=12cm，AC=15cm，∠D=45°，DE=16cm'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, true, r.reasons.join('；'))
})

test('空题干不拦（无证据时不误杀）', () => {
  const structure = { points: [{ label: 'A' }], segments: [] }
  assert.equal(validateStructureAgainstContent(structure, '').ok, true)
  assert.equal(validateStructureAgainstContent(structure, null).ok, true)
})

test('题干说正方形却画成 2:1 矩形 → 拦截', () => {
  const structure = {
    points: [
      { label: 'A', x: 0, y: 40 }, { label: 'B', x: 0, y: 0 },
      { label: 'C', x: 80, y: 0 }, { label: 'D', x: 80, y: 40 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
    ]
  }
  const r = validateStructureAgainstContent(structure, '在边长为5的正方形ABCD中，点E为CD上一点')
  assert.equal(r.ok, false)
  assert.ok(r.reasons.some(s => s.includes('正方形')), r.reasons.join('；'))
})

test('正方形画成正方形 → 放行', () => {
  const structure = {
    points: [
      { label: 'A', x: 0, y: 40 }, { label: 'B', x: 0, y: 0 },
      { label: 'C', x: 40, y: 0 }, { label: 'D', x: 40, y: 40 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
    ]
  }
  const r = validateStructureAgainstContent(structure, '在正方形ABCD中，AC与BD交于点O')
  assert.equal(r.ok, true, r.reasons.join('；'))
})

test('Rt△/tan 等缩写不当作点', () => {
  const pts = extractReferencedPoints('在Rt△ABC中，tan∠BAC的值是')
  assert.ok(pts.has('A') && pts.has('B') && pts.has('C'))
  assert.ok(!pts.has('R') && !pts.has('T'), 'Rt 不该拆出点')
})

// ── 坐标系豁免（2026-09-18）────────────────────────────────────────────────
// 背景：带坐标轴的插图里，原点 O 与轴标 X/Y 是插图标配，题干通常不写它们。
// 实测「如图，抛物线 y=ax²+1(a<0)…与 y 轴交于点 C」被拒的理由正是
// 「重绘图上的点 O 在题干中未出现」——20 张坐标系题因此 100% 被误杀。

test('坐标系插图：原点 O 与以 O 为端点的线段不算凭空多画 → 放行', () => {
  const structure = {
    points: [
      { label: 'A', x: 10, y: 20 }, { label: 'B', x: 90, y: 20 },
      { label: 'C', x: 50, y: 80 }, { label: 'O', x: 50, y: 50 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'A' }, { from: 'C', to: 'O' }
    ],
    coordinate_system: { exists: true, origin: 'O', x_axis: true, y_axis: true }
  }
  const content = '如图，在平面直角坐标系中，△ABC的三个顶点为A(1,2)、B(4,1)、C(3,5)'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, true, r.reasons.join('；'))
})

test('坐标系豁免只在有坐标轴时生效——无坐标轴的幻觉点 O 仍被拦', () => {
  const structure = {
    points: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'O' }],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }]
  }
  const content = '在△ABC中，AB=BC'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, false)
  assert.ok(r.reasons.some(s => s.includes('点 O')), r.reasons.join('；'))
})

test('坐标系豁免不放过真正的幻觉边', () => {
  // O 被豁免，但题干未提的对角线 BD 仍必须被拦——豁免不能变成放水
  const structure = {
    points: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }, { label: 'O' }],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'D' }, { from: 'D', to: 'A' },
      { from: 'B', to: 'D' }
    ],
    coordinate_system: { exists: true, origin: 'O', x_axis: true, y_axis: true }
  }
  const content = '如图，在平面直角坐标系中，四边形ABCD的顶点为A、B、C、D'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, false)
  assert.ok(r.reasons.some(s => s.includes('BD')), r.reasons.join('；'))
})

test('坐标系插图：形状约束仍照常校验（豁免不影响硬规则4）', () => {
  const structure = {
    points: [
      { label: 'A', x: 0, y: 40 }, { label: 'B', x: 0, y: 0 },
      { label: 'C', x: 80, y: 0 }, { label: 'D', x: 80, y: 40 },
      { label: 'O', x: 40, y: 20 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
    ],
    coordinate_system: { exists: true, origin: 'O', x_axis: true, y_axis: true }
  }
  const r = validateStructureAgainstContent(structure, '在平面直角坐标系中，正方形ABCD的顶点为A、B、C、D')
  assert.equal(r.ok, false)
  assert.ok(r.reasons.some(s => s.includes('正方形')), r.reasons.join('；'))
})

// ── 硬规则 2.7：「点X在YZ上」位置约束（2026-09-21 第04周第7题 beda2c3d 事故）──

test('点在边上：题干「点D在边AB上」，重绘把 D 画进三角形内部 → 拦截', () => {
  // beda2c3d 的真实 tikz_json：A(100,20) B(20,180) C(180,180)，D(60,140) 悬在内部
  const structure = {
    points: [
      { label: 'A', x: 100, y: 20 }, { label: 'B', x: 20, y: 180 },
      { label: 'C', x: 180, y: 180 }, { label: 'D', x: 60, y: 140 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'A' }, { from: 'C', to: 'D' }
    ]
  }
  const content = '如图，已知在△ABC中，点D在边AB上．下列条件中，能判定△ACD与△ABC相似的是'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, false)
  assert.ok(
    r.reasons.some(s => s.includes('点D在AB上') && s.includes('偏离')),
    '必须点出 D 偏离 AB：' + r.reasons.join('；')
  )
})

test('点在边上：D 正确落在 AB 上（共线 + 段内）→ 放行', () => {
  const structure = {
    points: [
      { label: 'A', x: 100, y: 20 }, { label: 'B', x: 20, y: 180 },
      { label: 'C', x: 180, y: 180 }, { label: 'D', x: 60, y: 100 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'A' }, { from: 'C', to: 'D' }
    ]
  }
  const content = '如图，已知在△ABC中，点D在边AB上．下列条件中，能判定△ACD与△ABC相似的是'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, true, r.reasons.join('；'))
})

test('点在边上：无坐标的点 / 「的垂直平分线上」句式 → 不误伤', () => {
  const r1 = validateStructureAgainstContent(
    { points: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
      segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }] },
    '如图，在△ABC中，点D在边AB上'
  )
  assert.equal(r1.ok, true, r1.reasons.join('；'))
  const r2 = validateStructureAgainstContent(
    { points: [
        { label: 'A', x: 0, y: 0 }, { label: 'B', x: 100, y: 0 },
        { label: 'C', x: 50, y: 80 }, { label: 'D', x: 50, y: 30 }
      ],
      segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'C', to: 'D' }] },
    '点C在AB的垂直平分线上，连接CD'
  )
  assert.ok(!r2.reasons.some(s => s.includes('偏离')), r2.reasons.join('；'))
})

test('extractPointOnSegmentConstraints：三种句式 + 防误伤', async () => {
  const { extractPointOnSegmentConstraints } = await import('../server/utils/geometryContentGate.js')
  // ① 点X在边YZ上
  assert.deepEqual(
    extractPointOnSegmentConstraints('如图，点D在边AB上，点E在射线BC上'),
    [
      { point: 'D', on: ['A', 'B'], between: true },
      { point: 'E', on: ['B', 'C'], between: false }
    ]
  )
  // ② X为YZ上一点 / ③ YZ上取一点X
  assert.deepEqual(
    extractPointOnSegmentConstraints('点E为CD上一点；在BC上取一点M'),
    [
      { point: 'E', on: ['C', 'D'], between: true },
      { point: 'M', on: ['B', 'C'], between: true }
    ]
  )
  // 防误伤：「的垂直平分线上」「的上方」「小写直线l」都不收
  assert.deepEqual(
    extractPointOnSegmentConstraints('点C在AB的垂直平分线上；点P在AB的上方；点Q在直线l上'),
    []
  )
})

// ────────────────── 形状约束「闭合成环」前置判据（2026-09-26 图1误杀事故） ──────────────────

test('图1：两三角形顶点碰巧含 A/B/C/D，被兄弟小问「正方形ABCD」污染 → 不得按等边比误杀', () => {
  // Rt△ABC(AB=3,AC=4) + Rt△DEF：segments 只有 AC/AB/CB + DF/DE/FE，
  // A/B/C/D 并未连成闭合四边形（缺 BC/CD/DA 中的 CD、DA）。
  // 旧闸门拿这 4 点当正方形四角、按边长比 2.09:1 拒稿。新判据：不成环 → 豁免形状约束。
  const structure = {
    points: [
      { label: 'A', x: 28, y: 75 }, { label: 'C', x: 10, y: 45 }, { label: 'B', x: 45, y: 45 },
      { label: 'D', x: 70, y: 85 }, { label: 'F', x: 25, y: 20 }, { label: 'E', x: 90, y: 40 }
    ],
    segments: [
      { from: 'A', to: 'C' }, { from: 'A', to: 'B' }, { from: 'C', to: 'B' },
      { from: 'D', to: 'F' }, { from: 'D', to: 'E' }, { from: 'F', to: 'E' }
    ]
  }
  // 题干被兄弟小问污染进一句「在正方形ABCD中…」
  const content = '如图，在Rt△ABC和Rt△DEF中，∠BAC=∠EDF=90°。另：在正方形ABCD中，E是边BC上一点。'
  const r = validateStructureAgainstContent(structure, content)
  assert.ok(
    !r.reasons.some((s) => s.includes('正方形ABCD') && s.includes('边长比')),
    `A/B/C/D 未连成正方形，不得套等边约束误杀：${r.reasons.join('；')}`
  )
})

test('真把正方形画成 2:1 矩形（四边成环）→ 形状约束仍拦住', () => {
  const structure = {
    points: [
      { label: 'A', x: 0, y: 0 }, { label: 'B', x: 100, y: 0 },
      { label: 'C', x: 100, y: 48 }, { label: 'D', x: 0, y: 48 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
    ]
  }
  const content = '在边长为5的正方形ABCD中，求阴影面积'
  const r = validateStructureAgainstContent(structure, content)
  assert.ok(
    r.reasons.some((s) => s.includes('正方形ABCD') && s.includes('边长比')),
    `成环且边长比 100:48 失衡，必须仍判正方形误画：${r.reasons.join('；')}`
  )
})
