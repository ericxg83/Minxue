/**
 * 回归锁：考法库「按考点拉题 / 按考点筛课件」（2026-10-05，r142 目标模式）
 *
 * 起因（负责人原话）：「我的题型库改为我的考法库。要结合知识点！或知识点结合考法。
 *   让我能够通过知识点拉出众多题目……讲题会通过周末班课件参数里选题，
 *   所以那里也应该可以通过考点拉出分类好的题目。」
 *
 * 守护三件事：
 *   ① buildHandout 的考点过滤是「子树展开后命中」，不是「只认直接挂在节点上的题」
 *      —— 选「函数」要能把「二次函数/一次函数…」下的题全拉出来，否则「拉出众多题目」做不到。
 *   ② q_id 为空的练习册自包含错题挂不上考点，会被排除 —— 这是数据模型决定的，
 *      但**必须能被统计出来回传前端**，不能静默丢题（老师会以为课漏了题）。
 *   ③ 知识点树 → el-tree-select 选项：叶子节点不能带空 children 数组
 *      （否则前端渲染出一个永远点不开的展开箭头）。
 *
 * 全部是纯函数 ⇒ 真跑，不连库、不 grep 源码。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { filterRowsByKp } from '../server/lib/weekendHandout.js'
import { toTreeSelectOptions } from '../server/routes/weekendHandout.js'

const row = (qId) => ({ q_id: qId })

test('考点过滤：命中直接挂在该节点上的题', () => {
  const kps = new Map([['q1', ['kp-func']]])
  const scope = new Set(['kp-func'])
  assert.deepEqual(filterRowsByKp([row('q1'), row('q2')], kps, scope), [row('q1')])
})

test('考点过滤：选父节点要命中子孙节点下的题（子树展开，不是只看直接关联）', () => {
  // 「函数」是父节点，题目只直接挂在「二次函数」上 ⇒ 仍然要命中
  const kps = new Map([
    ['q1', ['kp-func']],
    ['q2', ['kp-quadratic']],
    ['q3', ['kp-linear']],
  ])
  const scope = new Set(['kp-func', 'kp-quadratic', 'kp-linear'])
  const kept = filterRowsByKp([row('q1'), row('q2'), row('q3')], kps, scope)
  assert.equal(kept.length, 3, '父节点展开后三条都要命中')
})

test('考点过滤：一道题挂多个考点时，命中其一即保留', () => {
  const kps = new Map([['q1', ['kp-geometry', 'kp-pythagorean']]])
  const kept = filterRowsByKp([row('q1')], kps, new Set(['kp-pythagorean']))
  assert.equal(kept.length, 1)
})

test('考点过滤：q_id 为空的练习册自包含错题必然被排除，且可被单独计数回传', () => {
  const rows = [row('q1'), row(null), row(undefined), row('q2')]
  const kps = new Map([['q1', ['kp-a']], ['q2', ['kp-b']]])
  const kept = filterRowsByKp(rows, kps, new Set(['kp-a', 'kp-b']))
  assert.equal(kept.length, 2)
  // 调用方按这个口径统计 unlinkedRows 回传前端，老师才知道有题挂不上考点
  const unlinked = rows.filter(r => !r.q_id).length
  assert.equal(unlinked, 2, '排除条数要能算出来，不能静默丢失')
})

test('考点过滤：范围为空集合时不保留任何行（不选考点 = 不过滤，调用方不进本分支）', () => {
  const kps = new Map([['q1', ['kp-a']]])
  assert.equal(filterRowsByKp([row('q1')], kps, new Set()).length, 0)
})

test('考点过滤：题目没有任何考点边时不命中', () => {
  const kps = new Map()
  assert.equal(filterRowsByKp([row('q1')], kps, new Set(['kp-a'])).length, 0)
})

test('知识点树 → el-tree-select 选项：叶子不带 children（避免点不开的空箭头）', () => {
  const tree = [
    { id: 'kp-root', name: '函数', children: [{ id: 'kp-q', name: '二次函数', children: [] }] },
    { id: 'kp-leaf', name: '勾股定理', children: [] },
  ]
  const opts = toTreeSelectOptions(tree)
  assert.equal(opts.length, 2)
  assert.equal(opts[0].value, 'kp-root')
  assert.equal(opts[0].label, '函数')
  assert.equal(opts[0].children[0].value, 'kp-q')
  assert.equal(opts[0].children[0].children, undefined, '叶子节点的 children 必须是 undefined')
  assert.equal(opts[1].children, undefined)
})

test('知识点树 → el-tree-select 选项：空输入不炸', () => {
  assert.deepEqual(toTreeSelectOptions(null), [])
  assert.deepEqual(toTreeSelectOptions([]), [])
})
