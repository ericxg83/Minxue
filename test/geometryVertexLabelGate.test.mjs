import test from 'node:test'
import assert from 'node:assert/strict'
import { isVertexSymbolLabel, isSymbolLabel } from '../server/utils/geom/structure.js'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'
import { renderGeometryTikZ } from '../server/utils/geometryTikZ.js'

/**
 * 2026-09-19 事故：换用 gemini-3.7-flash 后，视觉模型生成 DSL 时用「变量名」
 * 给点命名（pt_a / arr_u / Axis_start / T1_b / T_n2_b / P_left…），
 * 渲染器把顶点 label 原样上屏，于是图上一堆英文占位符，真实刻度（-2、-1、0、1、2）
 * 反而丢失——老师看到的就是「这画的什么鬼、连刻度都没了」。
 *
 * 修复分两处，本测试同时锁死：
 *   1) 判据 isVertexSymbolLabel（server/utils/geom/structure.js）
 *   2) 两个渲染器的顶点标注过滤（geometrySvg.js / geometryTikZ.js）
 * 少改任何一处，PDF/讲义（TikZ）与 App（SVG）就会有一端继续露占位符。
 */

// ── 1. 判据：放行数学符号，拦掉占位符 ──

test('顶点标注判据放行数学符号', () => {
  const allow = [
    'A', 'B', 'C', 'O', 'M', 'P', 'Q', 'a', 'b', 'c', 'x', 'y', 'm', 'n',
    'α', 'β', 'γ', 'θ',
    "A'", 'B′', 'A₁', 'B₂', 'x₁',
    '0', '1', '2', '3', '10', '-1', '-2', '-10',
    '∠A', '∠α'
  ]
  for (const t of allow) {
    assert.equal(isVertexSymbolLabel(t), true, `${JSON.stringify(t)} 应放行`)
  }
})

test('顶点标注判据拦掉模型占位符命名', () => {
  const block = [
    'pt_a', 'pt_b', 'arr_u', 'arr_v', 'top_b', 'left_0',
    'Axis_start', 'Axis_end', 'Axis_x', 'Axis_y',
    'T1_b', 'T_0_b', 'T_n2_b', 'T_n1_b',
    'P_left', 'P_right', 'L_bot', 'L_top', 'X_neg', 'Y_pos', 'OM_neg',
    'Axis', 'Point', 'Start', 'Bottom', 'Center',
    'AB', 'ABC', 'ABCD', 'pointA',
    '点A', '原点', '刻度',
    '', '   ', null, undefined
  ]
  for (const t of block) {
    assert.equal(isVertexSymbolLabel(t), false, `${JSON.stringify(t)} 应拦住`)
  }
})

test('isSymbolLabel 同步拦住下划线占位符（线段/标注通道）', () => {
  // isSymbolLabel 原本只按"纯字母且长度≤4"判定，pt_a 恰好 4 字符被放行。
  assert.equal(isSymbolLabel('pt_a'), false)
  assert.equal(isSymbolLabel('arr_u'), false)
  assert.equal(isSymbolLabel('top_b'), false)
  // 正常线段/角度名不受影响
  assert.equal(isSymbolLabel('A'), true)
  assert.equal(isSymbolLabel('AB'), true)
  assert.equal(isSymbolLabel('α'), true)
})

// ── 2. SVG 渲染器：占位符不上屏，数学符号照常上屏 ──

test('SVG 渲染器不把占位符顶点名画上图', () => {
  const structure = {
    figure_type: 'coordinate',
    points: [
      { label: 'Axis_start', x: -3, y: 0 },
      { label: 'pt_a', x: -2, y: 0 },
      { label: 'T_1_b', x: -1, y: 0 },
      { label: 'T_n2_b', x: 0, y: 0 },
      { label: 'arr_u', x: 1, y: 0 },
      { label: 'P_left', x: 2, y: 0 },
      { label: 'A', x: 3, y: 0 },
      { label: '-2', x: -2, y: -0.6 },
      { label: '0', x: 0, y: -0.6 }
    ],
    segments: [{ from: 'Axis_start', to: 'A' }]
  }
  const svg = renderGeometrySvg(structure)
  assert.ok(svg, '应产出 SVG')
  for (const junk of ['pt_a', 'arr_u', 'Axis_start', 'T_1_b', 'T_n2_b', 'P_left']) {
    assert.ok(!svg.includes(junk), `占位符 ${junk} 不应出现在 SVG 里`)
  }
  // 数学符号必须保留
  assert.ok(svg.includes('>A<'), '顶点 A 应保留')
  assert.ok(svg.includes('>-2<'), '刻度 -2 应保留')
  assert.ok(svg.includes('>0<'), '刻度 0 应保留')
})

test('SVG 渲染器对只有占位符名的图不会画出英文标注', () => {
  const svg = renderGeometrySvg({
    figure_type: 'geometry',
    points: [{ label: 'pt_a', x: 0, y: 0 }, { label: 'pt_b', x: 5, y: 0 }],
    segments: [{ from: 'pt_a', to: 'pt_b' }]
  })
  assert.ok(svg, '几何元素（点/线）照常渲染')
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1])
  assert.equal(texts.length, 0, `不应有任何文字标注，实际: ${texts.join(',')}`)
})

test('下划线开头的「辅助点」只参与计算、既不画标注也不画圆点（prompt 约定的逃生通道）', () => {
  // reactLoop 的规则 11 让模型把"画图必须用到、但题面不标注"的位置命名为 _k1/_p1…
  // 这是一条契约：改判据时必须保证 _ 前缀仍然被隐藏，否则源头约定失效。
  const structure = {
    figure_type: 'geometry',
    points: [
      { label: '_k1', x: 0, y: 0 },
      { label: '_k2', x: 4, y: 0 },
      { label: '_k3', x: 4, y: 4 },
      { label: 'A', x: 0, y: 4 }
    ],
    polygons: [{ points: ['_k1', '_k2', '_k3'], fill: true }],
    segments: [{ from: '_k1', to: 'A' }]
  }
  const svg = renderGeometrySvg(structure)
  assert.ok(svg, '辅助点定义的图形必须照常渲染')
  for (const junk of ['_k1', '_k2', '_k3']) {
    assert.ok(!svg.includes(junk), `辅助点名 ${junk} 不应上屏`)
  }
  assert.ok(svg.includes('>A<'), '真实顶点 A 仍应上屏')
  // 关键：辅助点本身仍要参与几何计算（否则多边形/线段会缺顶点而消失）
  assert.ok(/<polygon|<path|<rect/.test(svg), '阴影多边形仍应画出')
  // 关键：辅助点不画圆点——曲线采样点/网格交点动辄几十个，画成实心点会让图变成"一片黑点"
  const dots = [...svg.matchAll(/<circle[^>]*\/>/g)].length
  assert.equal(dots, 1, `只应有顶点 A 的 1 个圆点，实际 ${dots} 个`)

  const tikz = renderGeometryTikZ(structure)
  assert.ok(!tikz.includes('_k1'), 'TikZ 同样不得出现辅助点名')
  assert.equal([...tikz.matchAll(/circle \(0\.06\)/g)].length, 1, 'TikZ 也只应画 A 一个圆点')
})

// ── 3. TikZ 渲染器：同一条判据，避免 PDF/讲义端漏修 ──

test('TikZ 渲染器与 SVG 渲染器共用同一条顶点标注判据', () => {
  const structure = {
    figure_type: 'geometry',
    points: [
      { label: 'A', x: 0, y: 0 },
      { label: 'pt_b', x: 5, y: 0 },
      { label: 'Axis_start', x: 2, y: 3 },
      { label: 'B₂', x: 5, y: 4 }
    ],
    segments: [{ from: 'A', to: 'pt_b' }]
  }
  const tikz = renderGeometryTikZ(structure)
  assert.ok(tikz?.startsWith('\\begin{tikzpicture}'))
  assert.ok(!tikz.includes('pt_b'), 'TikZ 不应出现 pt_b')
  assert.ok(!tikz.includes('Axis_start'), 'TikZ 不应出现 Axis_start')
  assert.ok(tikz.includes('{$A$}'), '顶点 A 应保留')
  assert.ok(tikz.includes('{ $B_2$ }') || tikz.includes('{$B₂$}'), '下标顶点应保留')
})
