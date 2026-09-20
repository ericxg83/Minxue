/**
 * 内容核对闸门 —— 平行线组豁免回归测试
 *
 * 背景（2026-09-18 批量实测）：20 条 pending 几何资产只成功 1 条，失败几乎全是
 * 「重绘线段 AD/BE/CF 在题干中无引用」。原因是平行线分线段成比例题的图上有
 * 三条平行线（模型画成 AD/BE/CF 跨截线连线）是图形主体，但题干文本只写截线上的
 * 线段长度（AB=3, AC=9, DE=2），从不连写平行线两端字母 → 误判「凭空画边」。
 *
 * 修复后：题干声明平行线组（l₁//l₂//l₃ / AB∥CD∥EF）时，模型画的线段只要两端
 * 字母都出现在题干，即视为合法图示元素。点凭空出现仍拦（硬规则 3 不受影响）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateStructureAgainstContent,
  hasParallelLineGroup
} from '../server/utils/geometryContentGate.js'

// ── 平行线组识别 ──

test('识别 l₁//l₂//l₃ 下标式平行线组', () => {
  assert.equal(hasParallelLineGroup('如图，已知直线l₁//l₂//l₃,AB=3,AC=9,DE=2,那么DF的长是'), true)
})

test('识别 l1//l2//l3 数字下标', () => {
  assert.equal(hasParallelLineGroup('如图，直线l1//l2//l3，DE=2，EF=6，BC=5'), true)
})

test('识别 字母式 AB∥CD∥EF（3条平行线）', () => {
  assert.equal(hasParallelLineGroup('如图，AD//EF//BC，梯形ABCD中'), true)
})

test('单对平行关系（CD//AB）不算平行线组', () => {
  assert.equal(hasParallelLineGroup('作图，(1)过△ABC的顶点C作直线CD，使得CD//AB'), false)
})

test('单对平行关系（DE∥BC）不算平行线组', () => {
  assert.equal(hasParallelLineGroup('在△ABC中，点D、E分别在边AB、AC上，且DE∥BC'), false)
})

test('完全无平行关系不算', () => {
  assert.equal(hasParallelLineGroup('如图，在△ABC中，∠C=90°，AB=5，BC=3'), false)
})

// ── 平行线分线段成比例：标准图必须放行 ──

test('l₁//l₂//l₃ 标准图：AD/BE/CF 平行线是图形主体，放行', () => {
  const structure = {
    points: [
      { label: 'A', x: 20, y: 40 }, { label: 'B', x: 40, y: 40 }, { label: 'C', x: 60, y: 40 },
      { label: 'D', x: 20, y: 120 }, { label: 'E', x: 40, y: 120 }, { label: 'F', x: 60, y: 120 }
    ],
    segments: [
      { from: 'A', to: 'D' }, { from: 'B', to: 'E' }, { from: 'C', to: 'F' },  // 三条平行线
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },                          // 截线1片段
      { from: 'D', to: 'E' }, { from: 'E', to: 'F' }                           // 截线2片段
    ]
  }
  const gate = validateStructureAgainstContent(
    structure,
    '如图，已知直线l₁//l₂//l₃,AB=3,AC=9,DE=2,那么DF的长是'
  )
  assert.equal(gate.ok, true, `应放行标准平行线图，实际拒绝: ${gate.reasons.join('；')}`)
})

test('l₁//l₂//l₃：端点是题干字母但出现幻觉点（Z）仍拦', () => {
  const structure = {
    points: [
      { label: 'A', x: 20, y: 40 }, { label: 'B', x: 40, y: 40 }, { label: 'C', x: 60, y: 40 },
      { label: 'D', x: 20, y: 120 }, { label: 'E', x: 40, y: 120 }, { label: 'F', x: 60, y: 120 },
      { label: 'Z', x: 80, y: 80 }  // 幻觉点，题干没有
    ],
    segments: [
      { from: 'A', to: 'D' }, { from: 'B', to: 'E' }, { from: 'C', to: 'F' },
      { from: 'B', to: 'Z' }  // 连到幻觉点
    ]
  }
  const gate = validateStructureAgainstContent(
    structure,
    '如图，已知直线l₁//l₂//l₃,AB=3,AC=9,DE=2,那么DF的长是'
  )
  assert.equal(gate.ok, false, '幻觉点 Z 必须被拦')
  assert.ok(gate.reasons.some(r => r.includes('Z')), `错误里应点名 Z: ${gate.reasons.join('|')}`)
})

// ── 原有防守不能退化 ──

test('四边形对角线 AC 仍是幻觉（无平行线组声明）', () => {
  const structure = {
    points: [
      { label: 'A', x: 0, y: 0 }, { label: 'B', x: 60, y: 0 },
      { label: 'C', x: 60, y: 40 }, { label: 'D', x: 0, y: 40 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'D' }, { from: 'D', to: 'A' },
      { from: 'A', to: 'C' }  // 对角线，题干没写"连接AC"
    ]
  }
  const gate = validateStructureAgainstContent(
    structure,
    '如图，在矩形ABCD中，AB=6，BC=4，求其面积'
  )
  assert.equal(gate.ok, false, '对角线 AC 必须仍被拦')
})

test('纯文本相似题回归：无图结构不误判（空结构放行，不产生幻觉）', () => {
  const structure = {
    points: [{ label: 'A', x: 0, y: 0 }],
    segments: []
  }
  const gate = validateStructureAgainstContent(
    structure,
    '在△ABC中，点D、E分别在边AB、AC上，且DE//BC，如果DE/BC=2/5，那么AE/EC=______'
  )
  // A 在题干字母集合内；无任何 drawnSegs → 无幻觉线段可拦
  assert.equal(gate.ok, true)
})

test('折叠题对角线不能因平行豁免逃逸', () => {
  const structure = {
    points: [
      { label: 'A', x: 0, y: 0 }, { label: 'B', x: 60, y: 0 },
      { label: 'C', x: 60, y: 40 }, { label: 'D', x: 0, y: 40 },
      { label: 'C′', x: 30, y: -40 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'D' }, { from: 'D', to: 'A' },
      { from: 'A', to: 'C′' }, { from: 'B', to: 'C′' }  // 折叠后的像，题干应有引用
    ]
  }
  const gate = validateStructureAgainstContent(
    structure,
    '将矩形ABCD沿对角线AC折叠，点B落在点B′处',
    ['AB=6', 'BC=4']
  )
  // 折叠轴对称结构（AB′ 与 CB′ 是折叠后的边）有题干「沿AC折叠」支撑
  // 但这里故意点了 C′ 而题干说的是 B′ → 应被硬规则1拦（派生点标号不符）
  assert.equal(gate.ok, false, '折叠点标号与题干不符必须拦')
})