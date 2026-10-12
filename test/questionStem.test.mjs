/**
 * 回归锁：questionStem.js 题干展示口径（多小问共享题干）
 *
 * 背景：一道大题含 (1)(2) 时拆成多条 questions 行，公共题干存 parent_stem。
 * 本模块是三处渲染（错题本 / 重练 PDF / 批改页题干区）的唯一展示口径，
 * 且 src/server 双轨要求逐字一致（同一题三端渲染完全相同）。
 *
 * 判据（纯函数真跑）：
 *   - 组键：跨页同题号不归组、缺 task_id 退化、两者缺返回空；
 *   - 题干去重：content 已含 parent_stem 时不重复渲染；
 *   - 前置引用：提取 (1)/(2) 引用号、去重、按严格口径拆段；
 *   - 双轨一致：src 与 server 两份逐字相等。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const {
  getQuestionGroupKey,
  resolveQuestionDisplayStem,
  extractPrereqRefs,
  formatQuestionLabel,
  isStemContainedInContent,
} = await import('../src/utils/questionStem.js')

// ── 组键 ────────────────────────────────────────────────
test('组键：同 task 同页同题号归同组', () => {
  const a = getQuestionGroupKey({ task_id: 't1', page_number: 2, question_number: 5 })
  const b = getQuestionGroupKey({ task_id: 't1', page_number: 2, question_number: 5 })
  assert.equal(a, 't1|p2|n5')
  assert.equal(a, b)
})

test('组键：跨页相同题号不归组（page_number 参与）', () => {
  const p1 = getQuestionGroupKey({ task_id: 't1', page_number: 1, question_number: 5 })
  const p2 = getQuestionGroupKey({ task_id: 't1', page_number: 2, question_number: 5 })
  assert.notEqual(p1, p2)
})

test('组键：缺 task_id 退化为 p{page}|n{no}', () => {
  assert.equal(getQuestionGroupKey({ page_number: 3, question_number: 7 }), 'p3|n7')
})

test('组键：两者都缺返回空（不归组）', () => {
  assert.equal(getQuestionGroupKey({}), '')
  assert.equal(getQuestionGroupKey(null), '')
})

// ── 题干去重 ────────────────────────────────────────────
test('题干：content 未含 parent_stem → 渲染 parentStem+content', () => {
  const r = resolveQuestionDisplayStem({ parent_stem: '如图，已知△ABC。', content: '(1) 求∠A的度数' })
  assert.equal(r.parentStem, '如图，已知△ABC。')
  assert.equal(r.content, '(1) 求∠A的度数')
})

test('题干：content 已含 parent_stem（历史数据）→ 不重复渲染', () => {
  const r = resolveQuestionDisplayStem({ parent_stem: '如图，已知△ABC。', content: '如图，已知△ABC。(1) 求∠A的度数' })
  assert.equal(r.parentStem, '')
  assert.equal(r.content, '如图，已知△ABC。(1) 求∠A的度数')
})

test('题干：parent_stem 为空 → 只渲染 content（历史行为）', () => {
  const r = resolveQuestionDisplayStem({ content: '独立题' })
  assert.equal(r.parentStem, '')
  assert.equal(r.content, '独立题')
})

test('题干：包含判断对全半角/空白/标点归一（NFKC）', () => {
  assert.equal(isStemContainedInContent('已知ABC', '请回答(1)题'), false, '正文不含题干则不算包含')
  assert.ok(isStemContainedInContent(' 已知ABC。', '已知ABC。（1）求x'), '归一后应包含')
})

// ── 前置引用 ────────────────────────────────────────────
test('前置引用：提取「根据(1)(2)的结果」→ [1,2]，去重', () => {
  assert.deepEqual(extractPrereqRefs('根据(1)(2)的结果'), ['1', '2'])
  assert.deepEqual(extractPrereqRefs('根据(1)(1)的结果'), ['1'])
  assert.deepEqual(extractPrereqRefs('无引用的题'), [])
  // 引导词限定在「在/根据/由/结合/利用/按照/依」——「求(2)」不带引导词不算引用
  assert.deepEqual(extractPrereqRefs('在(1)的条件下，求(2)'), ['1'])
})

test('前置引用：全角括号也识别', () => {
  assert.deepEqual(extractPrereqRefs('在（3）的条件下'), ['3'])
})

// ── 标注文案 ────────────────────────────────────────────
test('标注：第10题(2) / 第10题 / 第3题（fallback）/ 题目', () => {
  assert.equal(formatQuestionLabel(10, 2), '第10题(2)')
  assert.equal(formatQuestionLabel(10, null), '第10题')
  assert.equal(formatQuestionLabel(null, null, 3), '第3题')
  assert.equal(formatQuestionLabel(null, null, null), '题目')
})

// ── 双轨一致（2026-09-11 产品评审：三端渲染同题同文案） ──
test('双轨：src 与 server 两份 questionStem 逐字一致', () => {
  const front = readFileSync(resolve(ROOT, 'src', 'utils', 'questionStem.js'), 'utf8')
  const server = readFileSync(resolve(ROOT, 'server', 'utils', 'questionStem.js'), 'utf8')
  assert.equal(front, server, '两份镜像必须逐字一致（改任一份必须同步另一份）')
})