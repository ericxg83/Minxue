// 回归测试：跨页补选项兜底（2026-10-30 任务 606935bf 事故沉淀）
//
// 根因回顾：英语语法重练卷两页拍照，「digital legacy」语篇题干在第 2 页、词库选项表
// 在第 1 页。逐页独立 OCR 把两页拆开 → 第 2 页切出的 5 道选择题 options=[]；
// 英语页组合并重识别弃用回落后没有任何补救（21 题 is_suspicious）→ 完整性闸
// 拦住错题本（missing_options），老师手动重裁也因弹窗单页作用域裁不全。
//
// 修复：worker.js 落库前对「choice 且 options=[]」的题做跨页定向补选项
// （题干页 + 相邻页竖拼 → buildOptionsBackfillPrompt 提取 → 只回填空 options）。
// 本测试锁定 utils 纯函数行为 + worker 接线不被拆。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  isMissingChoiceOptions,
  collectMissingChoiceItems,
  buildBackfillGroups,
  parseBackfillJson,
  sanitizeBackfillOptions,
  applyOptionsBackfill,
} from '../server/utils/optionsBackfill.js'
import { buildOptionsBackfillPrompt } from '../server/config/ai.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

// ── isMissingChoiceOptions ──

test('缺选项判定: choice+空选项 命中（各空形态）', () => {
  assert.equal(isMissingChoiceOptions({ question_type: 'choice', options: [] }), true)
  assert.equal(isMissingChoiceOptions({ question_type: 'choice', options: null }), true)
  assert.equal(isMissingChoiceOptions({ question_type: '选择题', options: [] }), true)
  assert.equal(isMissingChoiceOptions({ question_type: 'choice' }), true)
})

test('缺选项判定: 有选项的 choice / fill / answer 都不命中', () => {
  assert.equal(isMissingChoiceOptions({ question_type: 'choice', options: ['a', 'b'] }), false)
  assert.equal(isMissingChoiceOptions({ question_type: 'fill', options: [] }), false)
  assert.equal(isMissingChoiceOptions({ question_type: 'answer', options: null }), false)
  assert.equal(isMissingChoiceOptions(null), false)
})

// ── collectMissingChoiceItems / buildBackfillGroups ──

const mkPages = () => ([
  { pageNumber: 1, pageQuestions: [
    { id: 'p1-choice-ok', question_type: 'choice', options: ['a', 'b', 'c', 'd'], content: 'ok题' },
    { id: 'p1-fill', question_type: 'fill', options: [], content: '填空题' },
  ] },
  { pageNumber: 2, pageQuestions: [
    { id: 'p2-q4', question_type: 'choice', options: [], content: 'Still, others think some parts are too __4__ to be shared.', question_number: 4 },
    { id: 'p2-q5', question_type: 'choice', options: [], content: 'Whether social media accounts can be inherited is still questionable __5__.', question_number: 5 },
    { id: 'p2-choice-ok', question_type: 'choice', options: ['touch', 'type'], content: '有选项' },
  ] },
])

test('收集: 只收 choice+空，且保留页索引与题引用', () => {
  const pages = mkPages()
  const items = collectMissingChoiceItems(pages)
  assert.equal(items.length, 2)
  assert.equal(items[0].pageNumber, 2)
  assert.equal(items[0].q.id, 'p2-q4')
  assert.equal(items[1].q.id, 'p2-q5')
  assert.ok(items[0].stem.includes('__4__'))
})

test('分组: 题干页与前一页拼组；同页多题共用一组；首页缺选项时取后页', () => {
  const pages = mkPages()
  const items = collectMissingChoiceItems(pages)
  const groups = buildBackfillGroups(pages, items)
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].pageNumbers, [1, 2])
  assert.equal(groups[0].items.length, 2)

  // 第 1 页也出现缺选项题 → 与第 2 页拼（前页不存在取后页）。
  // 两组 pageNumbers 同为 [1,2] → 合并一组、一次调用提取全部 3 题（省一次模型调用）。
  pages[0].pageQuestions.push({ id: 'p1-q0', question_type: 'choice', options: [], content: '首页缺选项' })
  const items2 = collectMissingChoiceItems(pages)
  const groups2 = buildBackfillGroups(pages, items2)
  assert.equal(groups2.length, 1)
  assert.deepEqual(groups2[0].pageNumbers, [1, 2])
  assert.equal(groups2[0].items.length, 3)
})

test('分组: 单页任务无相邻页 → 只本页一组', () => {
  const pages = [{ pageNumber: 1, pageQuestions: [{ question_type: 'choice', options: [], content: 'x' }] }]
  const groups = buildBackfillGroups(pages, collectMissingChoiceItems(pages))
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].pageNumbers, [1])
})

// ── parseBackfillJson / sanitizeBackfillOptions ──

test('解析: 直接 JSON / {items:[]} 包裹 / 纯数组 / 带围栏与前后噪声都能读出', () => {
  const direct = parseBackfillJson('{"items":[{"index":0,"options":["a","b"]}]}')
  assert.deepEqual(direct.items, [{ index: 0, options: ['a', 'b'] }])
  assert.deepEqual(parseBackfillJson('[{"index":0,"options":["a","b"]}]'), [{ index: 0, options: ['a', 'b'] }])
  const noisy = parseBackfillJson('好的，以下是提取结果：\n```json\n{"items":[{"index":0,"options":["a","b"]}]}\n```\n以上。')
  assert.deepEqual(noisy.items, [{ index: 0, options: ['a', 'b'] }])
  assert.equal(parseBackfillJson(''), null)
  assert.equal(parseBackfillJson('完全不是 JSON'), null)
})

test('清洗: 2~10 项合法；重复去重；空项剔除；不足 2 项/单项超长/非数组拒绝', () => {
  assert.deepEqual(sanitizeBackfillOptions([' includes ', 'form', '', 'death', null]), ['includes', 'form', 'death'])
  assert.deepEqual(sanitizeBackfillOptions(['a', 'a', 'b']), ['a', 'b'])
  assert.equal(sanitizeBackfillOptions(['only']), null)
  assert.equal(sanitizeBackfillOptions([]), null)
  assert.equal(sanitizeBackfillOptions('a,b'), null)
  assert.equal(sanitizeBackfillOptions([['嵌套']]), null)
  assert.equal(sanitizeBackfillOptions(['x'.repeat(81), 'y']), null)
  assert.ok(sanitizeBackfillOptions(['x'.repeat(80), 'y']).length === 2)
})

// ── applyOptionsBackfill ──

test('回填: 正常回填空选项题；index 越界/已有选项/非法选项均拒绝且不覆盖', () => {
  const pages = mkPages()
  const items = collectMissingChoiceItems(pages) // [p2-q4, p2-q5]
  const parsed = {
    items: [
      { index: 0, options: ['includes', 'form', 'death', 'personal', 'highly'] },
      { index: 1, options: [] },            // 模型老实说没找到 → 拒绝
      { index: 2, options: ['a', 'b'] },    // 越界 → 拒绝
      { index: -1, options: ['a', 'b'] },   // 非法 index → 拒绝
      { index: 'x', options: ['a', 'b'] },  // 非整数 index → 拒绝
    ],
  }
  const { filled, rejected } = applyOptionsBackfill(items, parsed)
  assert.equal(filled, 1)
  assert.equal(rejected, 4)
  assert.deepEqual(items[0].q.options, ['includes', 'form', 'death', 'personal', 'highly'])
  assert.deepEqual(items[1].q.options, [])
})

test('回填: 目标题在中途已有选项时不覆盖（防并发写入）', () => {
  const pages = mkPages()
  const items = collectMissingChoiceItems(pages)
  items[0].q.options = ['someone', 'filled']
  const { filled } = applyOptionsBackfill(items, { items: [{ index: 0, options: ['a', 'b'] }] })
  assert.equal(filled, 0)
  assert.deepEqual(items[0].q.options, ['someone', 'filled'])
})

test('回填: 解析结果为 null / 无 items 字段时零写入', () => {
  const pages = mkPages()
  const items = collectMissingChoiceItems(pages)
  assert.deepEqual(applyOptionsBackfill(items, null), { filled: 0, rejected: 0 })
  assert.deepEqual(applyOptionsBackfill(items, { foo: 1 }), { filled: 0, rejected: 0 })
})

// ── prompt 内容护栏 ──

test('提示词: 必须锁死「逐字照抄/禁编造/词库全表/只返回 JSON」四条规则并携带题干', () => {
  const p = buildOptionsBackfillPrompt([
    { questionNumber: 4, stem: 'Still, others think some parts are too __4__ to be shared.' },
  ])
  assert.ok(p.includes('逐字照抄'), '必须要求逐字照抄')
  assert.ok(p.includes('禁止编造'), '必须禁止编造')
  assert.ok(p.includes('完整词库'), '词库型必须返回全表')
  assert.ok(p.includes('只返回 JSON'), '必须锁 JSON 输出')
  assert.ok(p.includes('__4__'), '必须携带待匹配题干')
  assert.ok(p.includes('[0]'), '必须带 index 供回填定位')
})

// ── worker 接线护栏（防未来改动悄悄拆掉调用点）──

test('worker 必须在英语页组块后、落库 push 前调用跨页补选项', () => {
  const src = read('server/worker.js')
  const callAt = src.indexOf('await backfillMissingChoiceOptions(pageResults, taskId)')
  assert.ok(callAt > 0, 'worker.js 缺少跨页补选项调用点')
  const pushAt = src.indexOf('questions.push(...r.pageQuestions)')
  assert.ok(pushAt > callAt, '补选项必须发生在题集 push 之前')
  const titleAt = src.indexOf('let ocrPageTitle = null')
  assert.ok(titleAt > callAt, '调用点应位于英语页组聚合块之后')
})
