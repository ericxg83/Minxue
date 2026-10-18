// similarGroupClustering 纯函数测试（不连库）
// 覆盖：A 字符相似聚类、B 同知识点聚类、边界（跨学生/超长题干/单条不聚）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clusterContentGroups,
  clusterKpGroups,
  normalizeStemV2,
  levenshtein,
} from '../server/services/similarGroupClustering.js'

test('normalizeStemV2: 全半角冒号/句读归一化后一致', () => {
  assert.equal(normalizeStemV2('求BM：MN：NF的值。'), normalizeStemV2('求BM:MN:NF的值.'))
  assert.ok(normalizeStemV2('求BM：MN：NF的值。').length > 0)
})

test('normalizeStemV2: 保留小数点的语义（1.5 vs 15 不同）', () => {
  const a = normalizeStemV2('1.5')
  const b = normalizeStemV2('15')
  assert.notEqual(a, b)
})

test('levenshtein: 基本距离', () => {
  assert.equal(levenshtein('abc', 'abc'), 0)
  assert.equal(levenshtein('abc', 'abd'), 1)
  assert.equal(levenshtein('', 'abc'), 3)
})

test('A 主聚类: 内容相近的两题聚成一组', () => {
  const items = [
    { id: 'a1', studentId: 's1', content: '求BM：MN：NF的值。' },
    { id: 'a2', studentId: 's1', content: '求BM:MN:NF的值.' },
  ]
  const groups = clusterContentGroups(items)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].wrongIds.length, 2)
  assert.equal(groups[0].reason, 'content')
  assert.deepEqual(new Set(groups[0].wrongIds), new Set(['a1', 'a2']))
})

test('A 主聚类: 同学生内相近聚组，跨学生不混', () => {
  const items = [
    { id: 'a1', studentId: 's1', content: '若D是BC上任意一点，试证明：AM/AB+AN/AC=AP/AD。' },
    { id: 'a2', studentId: 's1', content: '若D是BC上任意一点，试证明: AM/AB + AN/AC = AP/AD.' },
    { id: 'b1', studentId: 's2', content: '若D是BC上任意一点，试证明：AM/AB+AN/AC=AP/AD。' },
  ]
  const groups = clusterContentGroups(items)
  // s1 有两相近题聚一组；s2 只有一条不聚
  assert.equal(groups.length, 1)
  assert.deepEqual(new Set(groups[0].wrongIds), new Set(['a1', 'a2']))
})

test('A 主聚类: 数字不同（√3/3 vs √2/4）编辑距离 > 2 不聚（避免把变式题误聚）', () => {
  const items = [
    { id: 'a1', studentId: 's1', content: '(2) 根号3/3 = __' },
    { id: 'a2', studentId: 's1', content: '(1) 根号2/4 = __' },
    { id: 'a3', studentId: 's1', content: '(2) 根号3/3 = ___.' },
  ]
  const groups = clusterContentGroups(items)
  // a1 与 a3 相近（句尾标点差）可聚；a2 数字差 > 2 不并入
  assert.ok(groups.length >= 1)
  for (const g of groups) {
    assert.ok(!(g.wrongIds.includes('a1') && g.wrongIds.includes('a2')))
  }
})

test('A 主聚类: 超长题干（>120 字符）不参与聚类', () => {
  const long = '这是一道非常长的多小问大题，'.repeat(12)
  const items = [
    { id: 'a1', studentId: 's1', content: long + '第一问' },
    { id: 'a2', studentId: 's1', content: long + '第一问.' },
  ]
  assert.equal(clusterContentGroups(items).length, 0)
})

test('A 主聚类: 单条不聚', () => {
  assert.equal(clusterContentGroups([{ id: 'a1', studentId: 's1', content: '独题' }]).length, 0)
})

test('B 辅聚类: 同学生同知识点 ≥2 题聚组', () => {
  const items = [
    { id: 'a1', studentId: 's1', kpIds: ['kp1', 'kp2'] },
    { id: 'a2', studentId: 's1', kpIds: ['kp1'] },
    { id: 'b1', studentId: 's2', kpIds: ['kp1'] },
  ]
  const groups = clusterKpGroups(items)
  // s1 的 kp1 有 a1,a2 两题 → 聚组；s2 仅 1 题不聚
  assert.equal(groups.length, 1)
  assert.equal(groups[0].reason, 'kp')
  assert.deepEqual(new Set(groups[0].wrongIds), new Set(['a1', 'a2']))
})

test('B 辅聚类: 单条或跨学生不聚', () => {
  assert.equal(clusterKpGroups([{ id: 'a1', studentId: 's1', kpIds: ['k1'] }]).length, 0)
  assert.equal(clusterKpGroups([{ id: 'a1', studentId: 's1', kpIds: ['k1'] }, { id: 'b1', studentId: 's2', kpIds: ['k1'] }]).length, 0)
})