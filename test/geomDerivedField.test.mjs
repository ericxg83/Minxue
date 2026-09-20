/**
 * 视觉模型 derived 字段 → 约束 的翻译回归测试。
 *
 * 背景：OCR prompt 只给了扁平示例 { "on_segment": "AB" }，垂足/中点/交点没给格式。
 * 实测模型对这三类会写成嵌套对象，而原实现只认扁平键，导致「模型标了 derived
 * 却一条约束都抽不出来」——派生点于是退化成自由点，停在模型目测的位置上。
 *
 * 另一个坑：parseSeg 对对象会退化成 String(obj) = "[object Object]"，
 * 剥掉非字母后剩 "objectObject"，再被正则切出 ['o','b'] 这种垃圾字母，
 * 生成一条假的 midpoint(D, ['o','b'])。所以对象必须先被识别，绝不能直接丢给 parseSeg。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fromDerivedField } from '../server/utils/geom/constraintSchema.js'

/** 抽取结果里所有作为点标签出现的单字母（用于抓垃圾字母污染） */
const lettersIn = (constraints) => {
  const out = []
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk)
    if (o && typeof o === 'object') return Object.values(o).forEach(walk)
    if (typeof o === 'string' && /^[A-Za-z]$/.test(o)) out.push(o)
  }
  constraints.forEach(c => walk(c.args))
  return out
}

const typesOf = (cs) => cs.map(c => c.type)

// ── 垂足：扁平与嵌套都要认 ──

test('扁平形式 foot_of + perpendicular_to', () => {
  const out = fromDerivedField('D', { foot_of: 'C', perpendicular_to: 'AB' })
  assert.deepEqual(typesOf(out), ['foot'])
  assert.deepEqual(out[0].args, { point: 'D', from: 'C', onLine: ['A', 'B'] })
})

test('嵌套形式 foot:{from,on_line}', () => {
  const out = fromDerivedField('D', { foot: { from: 'C', on_line: ['A', 'B'] } })
  assert.deepEqual(typesOf(out), ['foot'])
  assert.deepEqual(out[0].args, { point: 'D', from: 'C', onLine: ['A', 'B'] })
})

test('嵌套形式 footOf:{from,onLine}（驼峰键）', () => {
  const out = fromDerivedField('D', { footOf: { from: 'C', onLine: ['A', 'B'] } })
  assert.deepEqual(typesOf(out), ['foot'])
  assert.deepEqual(out[0].args.onLine, ['A', 'B'])
})

test('嵌套形式 foot:{from,to}（to 也当落线）', () => {
  const out = fromDerivedField('D', { foot: { from: 'C', to: 'AB' } })
  assert.deepEqual(typesOf(out), ['foot'])
  assert.deepEqual(out[0].args.onLine, ['A', 'B'])
})

test('垂足缺 from 或缺落线时不出约束（不猜）', () => {
  assert.deepEqual(fromDerivedField('D', { foot: { on_line: ['A', 'B'] } }), [])
  assert.deepEqual(fromDerivedField('D', { foot: { from: 'C' } }), [])
})

// ── 中点 ──

test('中点：扁平数组 / 扁平字符串 / 嵌套对象 三种都认', () => {
  const expect = { point: 'D', of: ['A', 'B'] }
  for (const d of [{ midpoint: ['A', 'B'] }, { midpoint: 'AB' }, { midpoint_of: 'AB' }, { midpoint: { of: ['A', 'B'] } }]) {
    const out = fromDerivedField('D', d)
    assert.deepEqual(typesOf(out), ['midpoint'], JSON.stringify(d))
    assert.deepEqual(out[0].args, expect, JSON.stringify(d))
  }
})

// ── 交点 ──

test('交点：扁平数组 / 嵌套 l1+l2 / 嵌套 of+with 都认', () => {
  for (const d of [
    { intersection: ['AF', 'BC'] },
    { intersection: { l1: ['A', 'F'], l2: ['B', 'C'] } },
    { intersection: { of: 'AF', with: 'BC' } },
    { intersection_of: ['AF', 'BC'] }
  ]) {
    const out = fromDerivedField('D', d)
    assert.deepEqual(typesOf(out), ['line_intersect'], JSON.stringify(d))
    assert.deepEqual(out[0].args, { point: 'D', l1: ['A', 'F'], l2: ['B', 'C'] }, JSON.stringify(d))
  }
})

// ── 落边 / 在圆上 ──

test('落边与在圆上的扁平形式', () => {
  assert.deepEqual(fromDerivedField('D', { on_segment: 'AB' })[0].args, { point: 'D', of: ['A', 'B'] })
  assert.deepEqual(fromDerivedField('D', { on_line: 'AB' })[0].args, { point: 'D', of: ['A', 'B'] })
  assert.deepEqual(fromDerivedField('D', { on_circle: 'O' })[0].args, { point: 'D', circle: 'O' })
})

// ── 垃圾输入必须 fail-closed，绝不产出垃圾字母 ──

test('对象混进扁平键时不产出垃圾字母约束', () => {
  // 老实现会走 parseSeg({a:1}) → String → "[object Object]" → 切出 "ob"
  const out = fromDerivedField('D', { on_segment: { a: 1 } })
  assert.deepEqual(out, [], '应完全抽不出，而不是抽出一条垃圾约束')
})

test('空对象 / 非对象 / 缺 label 一律返回空', () => {
  assert.deepEqual(fromDerivedField('D', {}), [])
  assert.deepEqual(fromDerivedField('D', null), [])
  assert.deepEqual(fromDerivedField('D', 'on_segment'), [])
  assert.deepEqual(fromDerivedField('', { midpoint: ['A', 'B'] }), [])
})

test('所有已支持形态都不得产出小写垃圾字母', () => {
  const forms = [
    { foot_of: 'C', perpendicular_to: 'AB' },
    { foot: { from: 'C', on_line: ['A', 'B'] } },
    { footOf: { from: 'C', onLine: ['A', 'B'] } },
    { midpoint: ['A', 'B'] },
    { midpoint: { of: ['A', 'B'] } },
    { intersection: ['AF', 'BC'] },
    { intersection: { l1: ['A', 'F'], l2: ['B', 'C'] } },
    { on_segment: 'AB' },
    { on_line: 'AB' },
    { on_circle: 'O' }
  ]
  for (const d of forms) {
    const bad = lettersIn(fromDerivedField('D', d)).filter(l => /^[a-z]$/.test(l))
    assert.deepEqual(bad, [], `${JSON.stringify(d)} 产出了小写垃圾字母 ${bad.join(',')}`)
  }
})

test('一条 derived 最多给一个"落点类"约束（保持原 else-if 语义）', () => {
  // {on_segment} 与 {on_line} 同时出现时只取前者，与历史行为一致
  const out = fromDerivedField('D', { on_segment: 'AB', on_line: 'CD' })
  assert.deepEqual(typesOf(out), ['on_segment'])
})

// ── 折叠对称像（reflect） ──
// 带撇点（B′）是原像点关于折痕的镜像。**轴缺失就整条不认**——猜轴会把图拧变形。

test('折叠：扁平 reflect_of + axis', () => {
  const out = fromDerivedField('B′', { reflect_of: 'B', axis: 'AC' })
  assert.deepEqual(typesOf(out), ['reflect'])
  assert.deepEqual(out[0].args, { point: 'B′', source: 'B', axis: ['A', 'C'] })
})

test('折叠：嵌套 reflect:{source,axis}', () => {
  for (const d of [
    { reflect: { source: 'B', axis: ['A', 'C'] } },
    { reflect: { from: 'B', over: 'AC' } },
    { mirror_of: { of: 'B', line: 'AC' } }
  ]) {
    const out = fromDerivedField('B′', d)
    assert.deepEqual(typesOf(out), ['reflect'], JSON.stringify(d))
    assert.deepEqual(out[0].args, { point: 'B′', source: 'B', axis: ['A', 'C'] }, JSON.stringify(d))
  }
})

test('折叠：缺轴或缺原像时不出约束（绝不猜轴）', () => {
  assert.deepEqual(fromDerivedField('B′', { reflect_of: 'B' }), [])
  assert.deepEqual(fromDerivedField('B′', { reflect: { axis: ['A', 'C'] } }), [])
  assert.deepEqual(fromDerivedField('B′', { reflect: {} }), [])
})

test('折叠：顶层 source/axis 只在有 reflect 键时才采信', () => {
  // 没有 reflect 键时，裸的 { source, axis } 含义不明，不能当折叠
  assert.deepEqual(fromDerivedField('D', { source: 'B', axis: 'AC' }), [])
  assert.deepEqual(typesOf(fromDerivedField('B′', { reflect: 'B', axis: 'AC' })), ['reflect'])
})

// ── 三心（重心/内心/外心） ──

test('三心：centroid_of / incenter_of / circumcenter_of 接受 ABC 或数组', () => {
  for (const [key, type] of [
    ['centroid_of', 'centroid'],
    ['incenter_of', 'incenter'],
    ['circumcenter_of', 'circumcenter']
  ]) {
    for (const v of ['ABC', ['A', 'B', 'C']]) {
      const out = fromDerivedField('G', { [key]: v })
      assert.deepEqual(typesOf(out), [type], `${key}=${JSON.stringify(v)}`)
      assert.deepEqual(out[0].args, { point: 'G', of: ['A', 'B', 'C'] }, `${key}=${JSON.stringify(v)}`)
    }
  }
})

test('三心：嵌套 { centroid: { of: [...] } } 也认', () => {
  const out = fromDerivedField('G', { centroid: { of: ['A', 'B', 'C'] } })
  assert.deepEqual(typesOf(out), ['centroid'])
  assert.deepEqual(out[0].args.of, ['A', 'B', 'C'])
})

test('三心：顶点数不是 3 时不出约束', () => {
  assert.deepEqual(fromDerivedField('G', { centroid_of: 'AB' }), [])
  assert.deepEqual(fromDerivedField('G', { centroid_of: 'ABCD' }), [])
  assert.deepEqual(fromDerivedField('G', { centroid_of: [] }), [])
})

test('所有已支持形态都不得产出小写垃圾字母（含新增的折叠与三心）', () => {
  const forms = [
    { foot_of: 'C', perpendicular_to: 'AB' },
    { foot: { from: 'C', on_line: ['A', 'B'] } },
    { footOf: { from: 'C', onLine: ['A', 'B'] } },
    { midpoint: ['A', 'B'] },
    { midpoint: { of: ['A', 'B'] } },
    { intersection: ['AF', 'BC'] },
    { intersection: { l1: ['A', 'F'], l2: ['B', 'C'] } },
    { on_segment: 'AB' },
    { on_line: 'AB' },
    { on_circle: 'O' },
    { reflect_of: 'B', axis: 'AC' },
    { reflect: { source: 'B', axis: ['A', 'C'] } },
    { centroid_of: 'ABC' },
    { centroid: { of: ['A', 'B', 'C'] } },
    { incenter_of: 'ABC' },
    { circumcenter_of: 'ABC' }
  ]
  for (const d of forms) {
    const bad = lettersIn(fromDerivedField('D', d)).filter(l => /^[a-z]$/.test(l))
    assert.deepEqual(bad, [], `${JSON.stringify(d)} 产出了小写垃圾字母 ${bad.join(',')}`)
  }
})
