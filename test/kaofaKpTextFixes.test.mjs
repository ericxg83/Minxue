/**
 * 考点工作台显示修复回归锁（2026-10-08）
 *
 * 起因（负责人真机截图实测）：
 *   ① 顶部筛选文案显示「共 194 道，已显示前 undefined 道」
 *      —— kpResultText computed 里漏了 `.value`：`kpQuestions` 是 ref 对象、本身没有 length。
 *      ⛔ 这类 bug 不报错、测试全绿，只在真实数据上才暴露（与 r218 的 undefined 家族同源）。
 *   ② 共现图 hover 到连线（边）时 tooltip 露出两个裸 uuid
 *      —— link 数据没有 name，formatter 也没有区分「节点/边」。
 *
 * 判据与 r218 锁同法：组件为压缩写法无法直接 import，按源码子串锁定。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VUE = readFileSync(
  resolve(ROOT, 'src/workbench/views/QuestionBankWorkbench.vue'), 'utf8')

// ── 1. 题数文案：已显示前 N 道 必须走 .value ──────────────────────────
test('考点工作台：截断文案不得渲染 undefined', () => {
  assert.match(
    VUE,
    /已显示前 \$\{kpQuestions\.value\.length\} 道/,
    '「已显示前 N 道」必须用 kpQuestions.value.length：kpQuestions 是 ref，直接 .length 会渲染成 undefined。',
  )
  assert.doesNotMatch(
    VUE,
    /已显示前 \$\{kpQuestions\.length\}/,
    '⛔ 漏 .value 的写法会显示「已显示前 undefined 道」（负责人 2026-10-08 真机截图实锤）。',
  )
})

// ── 2. 共现图边 tooltip：不得露出裸 uuid ─────────────────────────────
test('共现图：hover 连线必须显示中文文案而不是 uuid', () => {
  assert.ok(
    VUE.includes("dataType==='edge'"),
    'tooltip formatter 必须区分边（edge）与节点：旧实现 p.data?.raw||p.name 对边取不到任何中文，露出 source>target 两个裸 uuid。',
  )
  assert.ok(
    VUE.includes('name:`与「'),
    '链接数据必须带中文 name（形如「与「相似三角形的判定」共现 112 道题」）。',
  )
})

// ── 3. 讲题出口：必须说明「不必全讲」 ────────────────────────────────
test('考点工作台：送课件的出口提示必须说清「不必全讲」', () => {
  assert.ok(
    VUE.includes('不必全讲'),
    '负责人痛点「点开有 120 题，我怎么讲」：出口提示要说明课件会按最近错题筛出该讲的，不是让老师讲全量。',
  )
})
