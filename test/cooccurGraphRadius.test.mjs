/**
 * 共现聚焦图的节点半径回归锁（r145）
 *
 * 为什么要锁：r145 实测发现中心节点被邻居压住 ——
 *   原实现 `radius = n => n.is_center ? 34 : 12+26*Math.sqrt(cooccur/maxW)`，
 *   中心硬编码 34，但邻居上限就是 12+26=38。
 *   平方根自身 353 题、邻居「平方」共现也是 353 ⇒ 邻居 38.0 > 中心 34，
 *   「我选中的考点」在图上比它最强的邻居还小，主次颠倒。
 *
 * ⛔ 这类缺陷不报错、测试全绿、只在真实数据上看图才发现 ⇒ 必须用真实数值锁死。
 *   判据：中心半径必须 **严格大于** 所有邻居。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(
  resolve(ROOT, 'src/workbench/views/QuestionBankWorkbench.vue'), 'utf8')

// 与组件内实现保持一致（组件是压缩写法，无法直接 import）
const weightOf = (n) => Math.max(Number(n.is_center ? n.own_count : n.cooccur) || 0, 0)
const radiusOf = (nodes) => {
  const maxW = Math.max(...nodes.map(weightOf), 1)
  return (n) => {
    const base = 12 + 26 * Math.sqrt(weightOf(n) / maxW)
    return n.is_center ? Math.max(Math.round(base * 1.2), 30) : base
  }
}

test('共现图：中心节点不得硬编码半径（会被邻居压住）', () => {
  assert.doesNotMatch(
    SRC,
    /is_center\s*\?\s*34\s*:/,
    '中心半径不能写死 34：邻居上限 12+26=38 > 34，主次会颠倒。必须走同一套缩放公式。',
  )
})

test('共现图：中心半径必须严格大于所有邻居（用平方根真实数据）', () => {
  // r145 实测快照：/api/teaching-question-types/kp-cooccur?kpId=平方根&limit=8
  const nodes = [
    { name: '平方根', is_center: true, own_count: 353 },
    { name: '平方', cooccur: 353 },
    { name: '实数', cooccur: 235 },
    { name: '立方根', cooccur: 60 },
    { name: '绝对值', cooccur: 53 },
    { name: '二次根式', cooccur: 43 },
    { name: '代数', cooccur: 43 },
    { name: '方程', cooccur: 42 },
    { name: '无理数', cooccur: 39 },
  ]
  const radius = radiusOf(nodes)
  const center = nodes.find((n) => n.is_center)
  const centerR = radius(center)
  const maxPeer = Math.max(...nodes.filter((n) => !n.is_center).map(radius))

  assert.ok(
    centerR > maxPeer,
    `中心半径 ${centerR} 必须 > 最大邻居 ${maxPeer.toFixed(1)}，否则图上看不出「我选中的是哪个」`,
  )
})

test('共现图：半径算法对缺失/零权重不得产出 NaN', () => {
  // 后端中心节点没有 cooccur 字段、邻居理论上可能有 0
  const nodes = [
    { name: 'A', is_center: true, own_count: 0 },
    { name: 'B', cooccur: 0 },
    { name: 'C', cooccur: null },
    { name: 'D' },
  ]
  const radius = radiusOf(nodes)
  for (const n of nodes) {
    const r = radius(n)
    assert.ok(Number.isFinite(r), `${n.name} 半径必须是有限数，实际 ${r}`)
    assert.ok(r >= 0, `${n.name} 半径不能为负，实际 ${r}`)
  }
})

test('共现图：弱邻居不能被压到看不见（下限 12）', () => {
  const nodes = [
    { name: '强', is_center: true, own_count: 1000 },
    { name: '极弱', cooccur: 1 },
  ]
  const radius = radiusOf(nodes)
  // 1/1000 开方 ≈ 0.0316 ⇒ 12+26*0.0316 ≈ 12.8，仍可见
  assert.ok(radius(nodes[1]) >= 12, `最弱邻居半径 ${radius(nodes[1]).toFixed(1)} 应 ≥12，否则点太小点不中`)
})
