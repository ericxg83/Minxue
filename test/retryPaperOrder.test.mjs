/**
 * retryPaperOrder.test.mjs — 重练卷「排卷编号」与「判题对位」回归测试
 *
 * 锁定 2026-09-13 严重事故的修复：
 *   事故：打印卷按题型分块（选择→填空→解答）产生卷面编号 1..N，
 *        而判题按 generated_exams.question_ids 原序与 OCR 顺序按位置硬对齐，
 *        两套顺序只要题型混合就整体错位（实测 25 份卷里 21 份错位，首个错位多是第 1 题）。
 *
 * 本测试锁死三件事：
 *   ① 排卷顺序与卷面编号（分块 / 跨块累加编号 / 连排小问共号）；
 *   ② OCR 答案对位：题号优先、位置兜底、漏题不串位、孤立答案不得判定；
 *   ③ 服务端与前端两份实现必须逐字同构（分叉就会再次错位）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

import {
  buildRetryPaperOrder,
  buildRetryPaperLabelMap,
  alignRetryAnswers,
  normalizeRetryPaperLabel,
  retryPaperBucketOf,
  difficultyStars,
} from '../server/utils/retryPaperOrder.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')

/** 造一道题（只带排卷需要的字段） */
const mkQ = (id, questionType, extra = {}) => ({
  id,
  question_type: questionType,
  question_number: null,
  sub_no: null,
  page_number: 1,
  task_id: 'task-1',
  ...extra,
})

test('排卷：按题型分块（选择 → 填空 → 解答），块内保持输入相对顺序', () => {
  // 刻意让输入顺序是「填空、选择、解答」—— 分块后必须重排为「选择、填空、解答」
  const qs = [mkQ('f1', 'fill'), mkQ('c1', 'choice'), mkQ('a1', 'answer'), mkQ('c2', 'choice')]
  const order = buildRetryPaperOrder(qs)
  assert.deepEqual(order.map((it) => it.question.id), ['c1', 'c2', 'f1', 'a1'])
  // 卷面编号跨块累加
  assert.deepEqual(order.map((it) => it.label), ['1', '2', '3', '4'])
})

test('排卷：未知题型归解答题块，绝不整题漏掉', () => {
  const qs = [mkQ('j1', 'judge'), mkQ('c1', 'choice')]
  const order = buildRetryPaperOrder(qs)
  assert.equal(order.length, 2)
  assert.equal(retryPaperBucketOf('judge'), 'answer')
  assert.deepEqual(order.map((it) => it.question.id), ['c1', 'j1'])
})

test('排卷：同一大题的连续小问共用一个编号（连排）', () => {
  // 同 task + 同页 + 同题号 = 同一大题
  const qs = [
    mkQ('s1', 'fill', { question_number: 10, sub_no: '1' }),
    mkQ('s2', 'fill', { question_number: 10, sub_no: '2' }),
    mkQ('s3', 'fill', { question_number: 11 }),
  ]
  const order = buildRetryPaperOrder(qs)
  assert.deepEqual(order.map((it) => it.label), ['1(1)', '1(2)', '2'])
  assert.equal(order[1].isContinuation, true)
  assert.equal(order[0].isContinuation, false)
})

test('卷面编号归一化：题号 + 小问号压成印刷形态', () => {
  assert.equal(normalizeRetryPaperLabel(1, null), '1')
  assert.equal(normalizeRetryPaperLabel('4', '1'), '4(1)')
  assert.equal(normalizeRetryPaperLabel(' 3 ', ' (2) '), '3(2)')
  assert.equal(normalizeRetryPaperLabel(null, '1'), '')
})

test('对位：题型混合时按卷面题号命中，不再按 question_ids 原序串位', () => {
  // question_ids 顺序（分块前）：填空 f1、选择 c1、解答 a1
  const qs = [mkQ('f1', 'fill'), mkQ('c1', 'choice'), mkQ('a1', 'answer')]
  const order = buildRetryPaperOrder(qs)
  // 卷面顺序：c1(1) → f1(2) → a1(3)
  assert.deepEqual(order.map((it) => it.label), ['1', '2', '3'])

  // 学生按卷面作答：第1题答 c、第2题答 f、第3题答 a
  const ocr = [
    { question_number: 1, student_answer: 'C' },
    { question_number: 2, student_answer: '3/4' },
    { question_number: 3, student_answer: '解：…' },
  ]
  const pairs = alignRetryAnswers(order, ocr)
  const byLabel = Object.fromEntries(
    pairs.filter((p) => p.item).map((p) => [p.item.label, p.ocr.student_answer])
  )
  // 修复前：按 question_ids 原序硬对齐 → 第1题答案落到 f1、第2题落到 c1，全错位
  assert.equal(byLabel['1'], 'C', '卷面第1题（选择题）必须拿到 C')
  assert.equal(byLabel['2'], '3/4', '卷面第2题（填空题）必须拿到 3/4')
  assert.equal(byLabel['3'], '解：…')
  assert.ok(pairs.every((p) => p.matchedBy === 'number'))
})

test('对位：学生跳做第2题时，第3题的答案不会前移串到第2题', () => {
  const qs = [mkQ('c1', 'choice'), mkQ('c2', 'choice'), mkQ('c3', 'choice')]
  const order = buildRetryPaperOrder(qs)
  // 学生只做了第1题和第3题
  const ocr = [
    { question_number: 1, student_answer: 'A' },
    { question_number: 3, student_answer: 'B' },
  ]
  const pairs = alignRetryAnswers(order, ocr)
  // 只取「有题也有答案」的对位（未作答的题 ocr 为 null）
  const got = pairs.filter((p) => p.item && p.ocr).map((p) => [p.item.label, p.ocr.student_answer])
  assert.deepEqual(got, [['1', 'A'], ['3', 'B']])
  // 第2题：卷面有、答案没有 → 未作答
  const blank = pairs.filter((p) => p.matchedBy === 'none')
  assert.equal(blank.length, 1)
  assert.equal(blank[0].item.label, '2')
})

test('对位：OCR 未输出题号时按位置兜底（卷面顺序）', () => {
  const qs = [mkQ('f1', 'fill'), mkQ('c1', 'choice')]
  const order = buildRetryPaperOrder(qs) // 卷面：c1(1) → f1(2)
  const ocr = [{ student_answer: 'B' }, { student_answer: '0.5' }]
  const pairs = alignRetryAnswers(order, ocr)
  assert.deepEqual(
    pairs.filter((p) => p.item).map((p) => [p.item.label, p.ocr.student_answer]),
    [['1', 'B'], ['2', '0.5']]
  )
  assert.ok(pairs.every((p) => p.matchedBy === 'position'))
})

test('对位：卷面上没有的多余答案不得判给任何题目', () => {
  const qs = [mkQ('c1', 'choice')]
  const order = buildRetryPaperOrder(qs)
  const ocr = [
    { question_number: 1, student_answer: 'A' },
    { question_number: 9, student_answer: '乱入的答案' }, // 卷面只有 1 题
  ]
  const pairs = alignRetryAnswers(order, ocr)
  const orphan = pairs.filter((p) => !p.item)
  assert.equal(orphan.length, 1, '多余答案必须悬空')
  assert.equal(orphan[0].ocr.student_answer, '乱入的答案')
  // 卷面第1题仍然只拿到自己的答案
  assert.equal(pairs.find((p) => p.item)?.ocr.student_answer, 'A')
})

test('对位：连排小问按「大题号(小问号)」分别命中', () => {
  const qs = [
    mkQ('s1', 'fill', { question_number: 10, sub_no: '1' }),
    mkQ('s2', 'fill', { question_number: 10, sub_no: '2' }),
  ]
  const order = buildRetryPaperOrder(qs)
  const ocr = [
    { question_number: 1, sub_no: '2', student_answer: '第二问答案' },
    { question_number: 1, sub_no: '1', student_answer: '第一问答案' },
  ]
  const pairs = alignRetryAnswers(order, ocr)
  const got = Object.fromEntries(
    pairs.filter((p) => p.item && p.ocr).map((p) => [p.item.label, p.ocr.student_answer])
  )
  assert.equal(got['1(1)'], '第一问答案')
  assert.equal(got['1(2)'], '第二问答案')
})

test('编号映射：重复编号只保留卷面靠前的一项', () => {
  const qs = [mkQ('a', 'choice'), mkQ('b', 'choice')]
  const order = buildRetryPaperOrder(qs)
  const map = buildRetryPaperLabelMap(order)
  assert.equal(map.size, 2)
  assert.equal(map.get('1').question.id, 'a')
})

test('双端同构：server/utils/retryPaperOrder.js 与 src/utils/retryPaperOrder.js 代码主体必须逐字一致', () => {
  const serverSrc = readFileSync(resolve(PROJECT_ROOT, 'server/utils/retryPaperOrder.js'), 'utf8')
  const webSrc = readFileSync(resolve(PROJECT_ROOT, 'src/utils/retryPaperOrder.js'), 'utf8')
  // 两端只在 import 后缀（.js）与文件头注释上不同，代码主体（从第一个导出常量起）必须一致
  const ANCHOR = '/** 卷面分块顺序'
  const serverBody = serverSrc.slice(serverSrc.indexOf(ANCHOR)).trim()
  const webBody = webSrc.slice(webSrc.indexOf(ANCHOR)).trim()
  assert.equal(
    serverBody,
    webBody,
    '服务端与前端的排卷实现已分叉 —— 打印的卷与判的题会再次错位，请同步两侧'
  )
})

test('难度→卷面星级：三档映射，缺失值一律不标星', () => {
  // 三档：1-2 简单 / 3 中等 / 4-5 难（与 weeklyReport 5b 选题排序同一难度口径）
  assert.equal(difficultyStars(1), '★☆☆')
  assert.equal(difficultyStars(2), '★☆☆')
  assert.equal(difficultyStars(3), '★★☆')
  assert.equal(difficultyStars(4), '★★★')
  assert.equal(difficultyStars(5), '★★★')
  // 字符串形态（DB 偶有文本）也要正确归一
  assert.equal(difficultyStars('2'), '★☆☆')
  assert.equal(difficultyStars('4'), '★★★')
  // 缺失值必须返回空串（卷面不标星）：
  // 注意 Number(null) === 0，若不先判空会被误判成「难度 0 → 一星（简单）」，
  // 把没标难度的题印成最简单题，等于用假难度误导学生。
  assert.equal(difficultyStars(null), '')
  assert.equal(difficultyStars(undefined), '')
  assert.equal(difficultyStars(''), '')
  assert.equal(difficultyStars('abc'), '')
})
