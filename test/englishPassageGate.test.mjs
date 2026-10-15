/**
 * 回归测试：英语语篇拆题校验闸 validateEnglishPassageSplit（worker.js，英语语法重练 T3）
 *
 * 数据取自 2026-10-15 upcycling 语篇真实照片 A/B 实验（探针 _diag_english_ocr_split.mjs）：
 *   实验 B 实测两类转录事故——卷面印 might 被读成 can、threw away 被读成 throw away
 *   （B/C 变重复项）。本闸拦截此类结构违规：首轮违规重试一次，仍违规标记 is_suspicious。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEnglishPassageSplit } from '../server/worker.js'

/** 从实测合格输出缩编：语篇全文（4 空，所有题的 parent_stem 必须逐字相同）+ 拆出的空号列表 */
const PASSAGE = 'Have you ever __1__ of upcycling? It is a way of turning old things into something useful. ' +
  'Many ideas behind modern-day upcycling __2__ the past. In those days, things were repurposed over and over __3__ they were no longer useful. ' +
  'It is also considered to be more __4__ friendly than recycling.'
const GOOD_Q = (nums) => nums.map(n => ({
  question_number: n,
  sub_no: null,
  parent_stem: PASSAGE,
  content: `Sentence with __${n}__ inside.`,
  options: ['optA', 'optB', 'optC'],
  answer: 'B',
  question_type: 'choice',
}))

test('数学页与无挖空页不适用本闸（零影响）', () => {
  const mathQs = [{ question_number: 1, content: '计算 √12 × √(1/3)', options: [], answer: null, question_type: 'fill' }]
  assert.equal(validateEnglishPassageSplit(mathQs, '数学').applicable, false)
  assert.equal(validateEnglishPassageSplit(mathQs, null).applicable, false)
  // 英语页但无挖空形态（普通单句选择题）也不适用
  const plainEn = [{ question_number: 1, content: 'Which of the following is correct?', options: ['a', 'b', 'c', 'd'], answer: 'A', question_type: 'choice' }]
  assert.equal(validateEnglishPassageSplit(plainEn, '英语').applicable, false)
})

test('合格英语语篇拆题通过（含 parent_stem 全文 + 逐字 options）', () => {
  const r = validateEnglishPassageSplit(GOOD_Q([1, 2, 3, 4]), '英语')
  assert.equal(r.applicable, true)
  assert.equal(r.ok, true)
  assert.deepEqual(r.issues, [])
})

test('B/C 重复项被拦截（实测事故：threw away 被还原成 throw away）', () => {
  const qs = GOOD_Q([1, 2, 3, 4])
  qs[1].options = ['thrown away', 'throw away', 'throw away'] // B 被顺手纠正 → 与 C 重复
  const r = validateEnglishPassageSplit(qs, '英语')
  assert.equal(r.ok, false)
  assert.ok(r.issues.some(i => i.includes('空2') && i.includes('重复')), 'issue 应指明空2 重复')
})

test('漏空被拦截（语篇 4 空只拆出 3 题）', () => {
  // PASSAGE 含 __1__..__4__，questions 只拆出 1/2/3 → 空号 4 缺失
  const qs = GOOD_Q([1, 2, 3])
  const r = validateEnglishPassageSplit(qs, '英语')
  assert.equal(r.ok, false)
  assert.ok(r.issues.some(i => i.includes('缺少空号')), 'issue 应指出缺失空号')
})

test('空号重复被拦截', () => {
  const qs = GOOD_Q([1, 2, 2, 4])
  const r = validateEnglishPassageSplit(qs, '英语')
  assert.equal(r.ok, false)
  assert.ok(r.issues.some(i => i.includes('重复')), 'issue 应指出题号重复')
})

test('answer 非三选项字母被拦截', () => {
  const qs = GOOD_Q([1, 2, 3, 4])
  qs[0].answer = 'D'
  qs[1].answer = null
  const r = validateEnglishPassageSplit(qs, '英语')
  assert.equal(r.ok, false)
  assert.ok(r.issues.some(i => i.includes('空1') && i.includes('answer')), 'issue 应指出空1 answer 异常')
  assert.ok(r.issues.some(i => i.includes('空2') && i.includes('answer')), 'issue 应指出空2 answer 异常')
})

test('content 缺挖空标记被拦截', () => {
  const qs = GOOD_Q([1, 2, 3, 4])
  qs[2].content = 'A complete sentence without any blank.'
  const r = validateEnglishPassageSplit(qs, '英语')
  assert.equal(r.ok, false)
  assert.ok(r.issues.some(i => i.includes('空3') && i.includes('挖空')), 'issue 应指出空3 缺挖空')
})

test('多问题聚合输出（一次校验报全所有违规）', () => {
  const qs = GOOD_Q([1, 2, 3, 4])
  qs[0].options = ['x', 'x', 'y']
  qs[0].answer = 'E'
  const r = validateEnglishPassageSplit(qs, '英语')
  assert.equal(r.ok, false)
  assert.ok(r.issues.length >= 2, `同题多违规应聚合，实得: ${JSON.stringify(r.issues)}`)
})
