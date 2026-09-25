// 回归测试：跨页题缝合（2026-09-25 第04周 程思豪 第24/25题拆分事故）
//
// 根因：原卷上一道题跨两页（题干前半在上页末尾、后半在本页顶部），
// 三条 OCR 管线逐页独立识别、页间无状态接力，把这道题切成了两道独立题
// （列表中的第 24、25 题，前者题干以"剪下一个与△ABC相似的"戛然而止，
// 后者以"三角形，问有几种不同的剪法……"凭空开头）。
//
// 修复：上一成功页末题通过 buildCrossPageHint 拼进下一页 OCR 的 userText，
// 模型在首题上显式标记 continues_previous_page 时，mergeCrossPageContinuation
// 把本页首题片段缝回上一页末题。只信模型显式标记，不做"末题没句号就并"的
// 启发式（填空题横线结尾、解答题无句号都是合法版式，启发式必误合并）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mergeCrossPageContinuation, buildCrossPageHint } from '../server/services/answerParseService.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

test('模型标记 continues_previous_page 的本页首题缝回上一页末题', () => {
  const prev = {
    question_number: 9, sub_no: null,
    content: '数学课上，甲、乙、丙三名学生讨论题目："一张直角三角形纸片ABC的直角边AC=6,BC=8,P是△ABC边上不与A、B、C重合的一点，欲过点P沿一条直线剪一刀，剪下一个与△ABC相似的',
    student_answer: null, options: [],
  }
  const fragment = {
    question_number: 10, sub_no: null,
    content: '三角形，问有几种不同的剪法？甲说："当点P在斜边AB上时，有三种不同的剪法。"乙说："当点P在直角边BC上时，有三种不同的剪法."丙说："当点P在直角边AC上时，有四种不同的剪法."其中，说法正确的学生是___(填人名)',
    student_answer: '丙', question_type: 'fill',
    continues_previous_page: true,
  }
  const allQuestions = [prev]
  const pageQuestions = [fragment, { question_number: 10, content: '下一道独立新题' }]

  assert.equal(mergeCrossPageContinuation(allQuestions, pageQuestions), true)
  // 片段被移除，独立新题顶到首位
  assert.equal(pageQuestions.length, 1)
  assert.equal(pageQuestions[0].content, '下一道独立新题')
  // 题干无缝拼接、答案/题型回填、题号保持上一页末题
  assert.ok(prev.content.includes('剪下一个与△ABC相似的三角形，问有几种不同的剪法？'))
  assert.equal(prev.student_answer, '丙')
  assert.equal(prev.question_type, 'fill')
  assert.equal(prev.question_number, 9)
})

test('无标记/无上页时不合并（防误并护栏）', () => {
  // 模型未标记 → 原样保留两道题
  const q1 = { question_number: 1, content: '计算：3+4=' }
  const q2 = { question_number: 2, content: '解方程：x²=9' }
  const pageQuestions = [q2]
  assert.equal(mergeCrossPageContinuation([q1], pageQuestions), false)
  assert.equal(pageQuestions.length, 1)
  assert.equal(q1.content, '计算：3+4=')

  // 标记了但上一页没有题 → 不合并、片段不丢
  const lonely = { question_number: 1, content: '……续文', continues_previous_page: true }
  const lonelyPage = [lonely]
  assert.equal(mergeCrossPageContinuation([], lonelyPage), false)
  assert.equal(lonelyPage.length, 1)
})

test('合并时回填选项/配图，已有字段不被覆盖', () => {
  const prev = { question_number: 5, content: '如图，在四边形ABCD中……', options: [], has_figure: false }
  const fragment = {
    question_number: 6, content: '的值。',
    continues_previous_page: true,
    options: ['A图', 'B图'], has_figure: true, image_type: 'geometry',
    image_bbox: { x: 1, y: 2, width: 3, height: 4 },
    student_answer: '手写答案',
  }
  const allQuestions = [prev]
  assert.equal(mergeCrossPageContinuation(allQuestions, [fragment]), true)
  assert.deepEqual(prev.options, ['A图', 'B图'])
  assert.equal(prev.has_figure, true)
  assert.equal(prev.image_type, 'geometry')
  assert.deepEqual(prev.image_bbox, { x: 1, y: 2, width: 3, height: 4 })
  assert.equal(prev.student_answer, '手写答案')
  // 标记字段清理
  assert.equal(prev.continues_previous_page, undefined)
})

test('buildCrossPageHint 携带上一页末题题号与题干结尾，无末题返回空串', () => {
  const hint = buildCrossPageHint({ question_number: 9, sub_no: null, content: '……剪下一个与△ABC相似的' }, 3)
  assert.ok(hint.includes('第9题'))
  assert.ok(hint.includes('第3页'))
  assert.ok(hint.includes('剪下一个与△ABC相似的'))
  assert.ok(hint.includes('continues_previous_page'))
  // 多小问末题带上小问号
  const hintSub = buildCrossPageHint({ question_number: 12, sub_no: '2', content: '求证：△ADC∽△ABC。' }, 4)
  assert.ok(hintSub.includes('第12题'))
  assert.ok(hintSub.includes('小问(2)'))
  // 无上下文时不拼接提示（首页/上一页失败的页，绝不能误导模型）
  assert.equal(buildCrossPageHint(null, 3), '')
  assert.equal(buildCrossPageHint({ question_number: 1, content: '' }, 1), '')
})

test('worker.js 三处逐页 OCR（练习册主/重试轮 + 答案册）都接入了跨页缝合', () => {
  const src = read('server/worker.js')
  // userText 注入上一页末题上下文：练习册主循环 + 重试轮 + 答案册 = 3 处
  const hintCount = (src.match(/buildCrossPageHint\(prevPageTail/g) || []).length
  assert.ok(hintCount === 3, `worker.js 应有 3 处 buildCrossPageHint 注入（练习册主/重试 + 答案册），实际 ${hintCount} 处`)
  // 识别后缝合：同为 3 处
  const mergeCount = (src.match(/mergeCrossPageContinuation\(/g) || []).length
  assert.ok(mergeCount === 3, `worker.js 应有 3 处 mergeCrossPageContinuation 调用，实际 ${mergeCount} 处`)
})
