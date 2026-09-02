import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  aiParseSelfCheck,
  extractFinalAnswerFromAnalysis,
  extractNumericTokens,
  numericJaccard,
  extractExprCandidates,
} from './aiParseSelfCheck.js'

const ScreenshotAnalysis = `(1) 展开 y=3(x-1)²+2:
先计算 (x-1)² = x²-2x+1,
再乘以 3 得: 3x²-6x+3,
最后加 2: y=3x²-6x+5。
(2) 代入 x=6:
y=3×6²-6×6+5 = 3×36-36+5 = 108-36+5 = 77+5 = 83。
最终答案为: y=3x²-6x+5, 83。`

test('83 案例：arithmetic_mismatch 必须触发', () => {
  const result = aiParseSelfCheck({
    answer: 'y = 3x² - 6x + 5, 83',
    student_answer: 'y = 3x² - 6x + 5; y = 77',
    analysis: ScreenshotAnalysis,
  })
  assert.equal(result.pass, false, `期望 fail，实际 issues=${JSON.stringify(result.issues)}`)
  assert.ok(result.issues.includes('arithmetic_mismatch'), `应包含 arithmetic_mismatch，实际 ${JSON.stringify(result.issues)}`)
})

test('83 案例：不触发 serial_pollution（answer 83 是 AI 自己编的，不是学生数字）', () => {
  // 学生数字 {3, 5, 77}，answer 数字 {3, 5, 83}，jaccard = 2/4 = 0.5 ≤ 0.6
  // 且 aOnly = [83] 非空 → 不算 serial_pollution
  const result = aiParseSelfCheck({
    answer: 'y = 3x² - 6x + 5, 83',
    student_answer: 'y = 3x² - 6x + 5; y = 77',
    analysis: ScreenshotAnalysis,
  })
  assert.ok(!result.issues.includes('serial_pollution'))
})

test('正常题：算式 77 与 finalAns 77 一致 → pass', () => {
  const result = aiParseSelfCheck({
    answer: 'y = 3x² - 6x + 5, 77',
    student_answer: '77',  // 学生只写值，不抄函数，避免触发 serial_pollution
    analysis: `(1) 展开 y=3(x-1)²+2。先计算 (x-1)² = x²-2x+1, 再乘以 3 得 3x²-6x+3, 最后加 2: y=3x²-6x+5。
(2) 代入 x=6: y=3×6²-6×6+5 = 3×36-36+5 = 108-36+5 = 77。最终答案为: y=3x²-6x+5, 77。`,
  })
  assert.equal(result.pass, true, `期望 pass，实际 ${JSON.stringify(result.issues)}`)
})

test('强串行污染：answer 数字全在 student_answer 里出现，但 student 还多写几个', () => {
  // 学生写了 77, 3, 5, 99（其中 99 是 AI 漏抄的）；AI 抄了 77, 3, 5 当 answer
  const result = aiParseSelfCheck({
    answer: 'y = 77, 3, 5',
    student_answer: 'y = 77, 3, 5, 99',
    analysis: '...',
  })
  // aNums=[77,3,5], sNums=[77,3,5,99] → jaccard=3/4=0.75, aOnly=[], sOnly=[99] → 触发
  assert.equal(result.pass, false)
  assert.ok(result.issues.includes('serial_pollution'))
})

test('合法答对：answer 与 student_answer 数字完全相同（学生写对了）→ 不算污染', () => {
  const result = aiParseSelfCheck({
    answer: 'y = 3x² - 6x + 5, 77',
    student_answer: 'y = 3x² - 6x + 5, 77',
    analysis: '...',
  })
  // aNums=[3,5,77], sNums=[3,5,77] → jaccard=1, aOnly=[], sOnly=[] → 不触发
  assert.equal(result.pass, true, `期望 pass，实际 ${JSON.stringify(result.issues)}`)
})

test('弱串行污染：answer 数字与 student 数字有重叠但有独立数字 → 不触发', () => {
  const result = aiParseSelfCheck({
    answer: 'x = 5, 12',
    student_answer: '12',
    analysis: '...',
  })
  // aNums = [5, 12], sNums = [12] → jaccard = 1/2 = 0.5, aOnly = [5] 非空 → 不触发
  assert.equal(result.pass, true, `期望 pass，实际 ${JSON.stringify(result.issues)}`)
})

test('self_check_skipped：analysis 末尾显式【未自检】', () => {
  const result = aiParseSelfCheck({
    answer: 'x = 5',
    student_answer: '5',
    analysis: '解析...【未自检】',
  })
  assert.equal(result.pass, false)
  assert.ok(result.issues.includes('self_check_skipped'))
})

test('多 issue：同时串行污染 + 算术不一致', () => {
  const result = aiParseSelfCheck({
    answer: 'y = 77, 83',  // 数字都被学生串了 + 末尾 83 又和算式不符
    student_answer: 'y = 77, 83, 99',  // student 多写了 99（AI 漏抄，符合真污染特征）
    analysis: '... 代入 x=6: y=3×6²-6×6+5 = 3*36-36+5 = 77。最终答案为 83。',
  })
  // serial_pollution: aNums=[77,83], sNums=[77,83,99] → jaccard=2/3=0.67, aOnly=[], sOnly=[99] → 触发
  // arithmetic_mismatch: finalAns=83, 算式 3*36-36+5=77 → 触发
  assert.ok(result.issues.includes('serial_pollution'))
  assert.ok(result.issues.includes('arithmetic_mismatch'))
})

test('extractFinalAnswerFromAnalysis：标准形态', () => {
  const text = '解析过程... 最终答案为: 77。'
  assert.equal(extractFinalAnswerFromAnalysis(text), '77')
})

test('extractFinalAnswerFromAnalysis：带函数 + 逗号分隔', () => {
  const text = '解析... 最终答案为: y=3x²-6x+5, 83。'
  assert.equal(extractFinalAnswerFromAnalysis(text), 'y=3x²-6x+5, 83')
})

test('extractFinalAnswerFromAnalysis：长 analysis 截断到 tail(800)', () => {
  const padding = '废话'.repeat(500)  // 1000 字符
  const text = padding + ' 最终答案为: 42。'
  assert.equal(extractFinalAnswerFromAnalysis(text), '42')
})

test('extractFinalAnswerFromAnalysis：无标记时返回 null', () => {
  assert.equal(extractFinalAnswerFromAnalysis('随便一段解析'), null)
  assert.equal(extractFinalAnswerFromAnalysis(''), null)
  assert.equal(extractFinalAnswerFromAnalysis(null), null)
})

test('extractNumericTokens：去重保序', () => {
  // "6x" 里的 6 也是数字串（正确捕捉）
  assert.deepEqual(extractNumericTokens('y=3x²-6x+5, 83'), ['3', '6', '5', '83'])
  assert.deepEqual(extractNumericTokens('3.14 3.14 3.15'), ['3.14', '3.15'])
  assert.deepEqual(extractNumericTokens(''), [])
  assert.deepEqual(extractNumericTokens(null), [])
})

test('numericJaccard：边界', () => {
  assert.equal(numericJaccard([], []), 0)
  assert.equal(numericJaccard(['1'], []), 0)
  assert.equal(numericJaccard(['1', '2'], ['1', '2']), 1)
  assert.equal(numericJaccard(['1'], ['2']), 0)
  assert.equal(numericJaccard(['1', '2', '3'], ['2', '3', '4']), 0.5)
})

test('extractExprCandidates：83 案例应抽出 3*36-36+5 等算式', () => {
  const candidates = extractExprCandidates(ScreenshotAnalysis)
  // 归一化后必须包含 3*36-36+5, 108-36+5, 77+5
  assert.ok(candidates.includes('3*36-36+5'), `实际候选: ${JSON.stringify(candidates)}`)
  assert.ok(candidates.includes('108-36+5'))
  assert.ok(candidates.includes('77+5'))
})

test('extractExprCandidates：含 ² 的算式归一化为 n*n', () => {
  const candidates = extractExprCandidates('代入 x=6: y=3×6²-6×6+5 = 3*36-36+5')
  // 3×6²-6×6+5 → 3*6*6-6*6+5
  assert.ok(candidates.includes('3*6*6-6*6+5'), `实际候选: ${JSON.stringify(candidates)}`)
})

test('extractExprCandidates：空 / null / 无算式', () => {
  assert.deepEqual(extractExprCandidates(''), [])
  assert.deepEqual(extractExprCandidates(null), [])
  assert.deepEqual(extractExprCandidates('纯文字，没有算式'), [])
})

test('无效输入', () => {
  assert.equal(aiParseSelfCheck(null).pass, false)
  assert.equal(aiParseSelfCheck(undefined).pass, false)
  assert.deepEqual(aiParseSelfCheck(null).issues, ['invalid_input'])
})
