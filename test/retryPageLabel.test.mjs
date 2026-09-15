/**
 * retryPageLabel.test.mjs — 重练批改页「第N页」页标回归测试（2026-09-15 P1）
 *
 * 锁定两件事：
 *   ① 页标规则：同一页只在**首次出现处**标一次；无对位记录的题不标；单页不出页标。
 *      —— 这条规则是 bc94558「关掉页标」的替代方案：当年关页标是因为
 *      「换页即标注」在页码交错时会打出 第1页→第2页→第1页 的乱跳序列。
 *   ② 页码源必须是【答卷图】页码（retryAlign.pageNumber → currentPaperPages 索引），
 *      **不能**退回 q.page_number（原始作业页码，与答卷图不是同一套编号）。
 *   ③ paper 模式画定位框时不得回退到题目行自身的坐标（原作业图坐标系 → 必然错位）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildRetryAnswerPageLabels } from '../src/utils/retryAnswerPageLabel.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const Q = (...ids) => ids.map((id) => ({ id }))

// ── ① 页标规则 ──

test('单页不出页标（没有"页"可言）', () => {
  const labels = buildRetryAnswerPageLabels(Q('a', 'b'), { a: 1, b: 1 }, 1)
  assert.deepEqual(labels, ['', ''])
})

test('双页：同一页只在首次出现处标一次', () => {
  const labels = buildRetryAnswerPageLabels(
    Q('a', 'b', 'c', 'd'),
    { a: 1, b: 1, c: 2, d: 2 },
    2
  )
  assert.deepEqual(labels, ['第1页', '', '第2页', ''])
})

test('页码交错时也不重复跳号（1,2,1 → 第三次的 1 不再标）', () => {
  const labels = buildRetryAnswerPageLabels(
    Q('a', 'b', 'c'),
    { a: 1, b: 2, c: 1 },
    2
  )
  assert.deepEqual(labels, ['第1页', '第2页', ''])
})

test('无对位记录的题不标页码（宁可不标，也绝不猜）', () => {
  const labels = buildRetryAnswerPageLabels(
    Q('a', 'b', 'c'),
    { a: 1, c: 2 }, // b 在图上没痕迹
    2
  )
  assert.deepEqual(labels, ['第1页', '', '第2页'])
})

test('只有第 2 页拍到答案时，页标如实写「第2页」（不重新编号成第1页）', () => {
  const labels = buildRetryAnswerPageLabels(Q('a', 'b'), { a: 2, b: 2 }, 2)
  assert.deepEqual(labels, ['第2页', ''])
})

test('全部题都无对位记录时不产生任何页标', () => {
  const labels = buildRetryAnswerPageLabels(Q('a', 'b', 'c'), {}, 2)
  assert.deepEqual(labels, ['', '', ''])
})

test('返回数组长度恒等于题目数（模板按索引取标签，长度必须对齐）', () => {
  const cases = [
    [Q('a', 'b', 'c'), { a: 1 }, 3],
    [Q(), {}, 2],
    [Q('a'), { a: 1 }, 1],
  ]
  for (const [qs, map, n] of cases) {
    assert.equal(buildRetryAnswerPageLabels(qs, map, n).length, qs.length)
  }
})

test('边界：questions / pageMap 缺失或非数组都不炸', () => {
  assert.deepEqual(buildRetryAnswerPageLabels(null, { a: 1 }, 2), [])
  assert.deepEqual(buildRetryAnswerPageLabels(undefined, undefined, 2), [])
  assert.deepEqual(buildRetryAnswerPageLabels(Q('a'), null, 2), [''])
  assert.deepEqual(buildRetryAnswerPageLabels(Q('a'), { a: 1 }, 0), [''])
  assert.deepEqual(buildRetryAnswerPageLabels(Q('a'), { a: 1 }, undefined), [''])
})

// ── ② 页码源与接线 ──

test('页标必须由「答卷图页码」映射驱动，且只在多页时生效', () => {
  const panel = read('src/workbench/components/review/QuestionNavPanel.vue')
  assert.ok(panel.includes('buildRetryAnswerPageLabels('), '页标必须走唯一实现，不得内联')
  assert.ok(
    panel.includes('store.retryAnswerPageMap'),
    '页码必须来自 retryAnswerPageMap（答卷图页码），不得用 q.page_number'
  )
  assert.ok(
    panel.includes('store.currentPaperPages.length'),
    '必须把答卷页数传给页标函数（单页时不标）'
  )
})

test('retryAnswerPageMap 不得用原始作业页码，必须换算成 currentPaperPages 索引', () => {
  const store = read('src/workbench/stores/reviewStore.js')
  assert.ok(store.includes('const retryAnswerPageMap = computed('), '必须存在 retryAnswerPageMap')
  assert.ok(store.includes('retryAnswerPageMap,'), '必须导出 retryAnswerPageMap')
  assert.ok(
    store.includes('if (map[r.questionId] == null) map[r.questionId] = idx + 1'),
    '必须写 currentPaperPages 的索引（多行 task 时两行 page_number 都是 1，直接用会串页）'
  )
  assert.ok(
    store.includes('if (isUnmatchedOnPaper(r)) continue'),
    '图上没痕迹的题不得进入页码映射（不猜页码）'
  )
  assert.ok(
    store.includes("if (Number(r.pageNumber || 1) !== Number(pageNum || 1)) continue"),
    '记录页号必须与所在页一致（旧记录无 pageNumber 视为第 1 页）'
  )
})

// ── ③ 定位框：paper 模式绝不回退到原作业坐标系 ──

test('paper 模式取不到对位框时必须不画，禁止回退到题目行自身的原作业坐标', () => {
  const viewer = read('src/workbench/components/review/PaperViewerPanel.vue')
  assert.ok(viewer.includes('if (store.source === \'paper\') {'), 'getDisplayBox 必须有 paper 分支')
  assert.ok(
    viewer.includes('if (!retryRaw) return null'),
    'paper 模式无对位记录 → 返回 null（不画），不许往下落到 q.text_bbox'
  )
  assert.ok(
    !viewer.includes('if (retryBlock) return retryBlock'),
    '禁止旧写法：对位框全 null 时继续往下走，会落到原作业坐标画出错位框'
  )
})
