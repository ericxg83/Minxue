import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveGradingResult } from '../server/worker.js'
import { judgeAnswer, detectUnverifiableReference, UNJUDGED_REASONS } from '../server/services/judgeService.js'

// 卷面批改痕迹（红笔勾/叉/半对）已不再参与判定：红笔不是教师专属，学生订正同样用
// 红笔；晚托场景要面对各校老师的不同批法，同一个"√"语义不固定。正误只由
// 「学生答案 vs 参考答案」的确定性比较决定，教师结论走复核页的 review_status。
// 这些用例锁定"判定只看答案比对"，防止红笔逻辑以任何形式回流。

test('答案一致判对，与卷面是否有批改痕迹无关', () => {
  assert.deepEqual(resolveGradingResult({
    studentAnswer: 'D',
    answer: 'D',
    questionType: 'choice'
  }), { isCorrect: true, unjudgedReason: null })
})

test('答案不一致判错，不因红勾翻成正确', () => {
  assert.deepEqual(resolveGradingResult({
    studentAnswer: 'D',
    answer: 'C',
    questionType: 'choice'
  }), { isCorrect: false, unjudgedReason: null })
})

test('缺参考答案时判不出，交人工，不因红勾兜底成正确', () => {
  assert.deepEqual(resolveGradingResult({
    studentAnswer: 'D',
    answer: '',
    questionType: 'choice'
  }), { isCorrect: null, unjudgedReason: 'no_reference_answer' })
})

test('学生未作答时判不出，不参与自动结算', () => {
  // 未作答已由 answer_source='blank' 表达，不再叠一条异常原因
  assert.deepEqual(resolveGradingResult({
    studentAnswer: '',
    answer: 'C',
    questionType: 'choice'
  }), { isCorrect: null, unjudgedReason: null })
})

test('判定结果只含 isCorrect 与判不出原因，不再输出批改痕迹派生字段', () => {
  const result = resolveGradingResult({
    studentAnswer: 'D',
    answer: 'D',
    questionType: 'choice'
  })
  assert.deepEqual(Object.keys(result), ['isCorrect', 'unjudgedReason'])
})

// ── 判题域硬规则：判不出来一律 null，绝不写 false ──
// 参考答案本身无法自动核对时，逐串比对的结论没有依据：
// 落 false 会把题送进错题本与掌握度，落 true 会让真错题从复核视野里消失。

test('参考答案含"证明略/见解析/答案不唯一"时判不出，绝不落 false', () => {
  const cases = [
    '(1)证明略；(2)70°',
    '(1) 证明见解析；(2) FG = a - b',
    '略',
    '李师傅工作效率高 比较过程略',
    '$\\frac{31}{15}$ (答案不唯一)',
    '证明：∠BDC=∠BDE，∠C=∠C，∴△BCD∽△BDE；, 8'
  ]
  for (const answer of cases) {
    assert.equal(
      detectUnverifiableReference(answer),
      'unverifiable_reference',
      `应识别为无法核对: ${answer}`
    )
    const result = resolveGradingResult({
      studentAnswer: '70°',
      answer,
      questionType: 'answer'
    })
    assert.equal(result.isCorrect, null, `判定必须为 null: ${answer}`)
    assert.equal(result.unjudgedReason, 'unverifiable_reference')
  }
})

test('正常参考答案不被误判为无法核对', () => {
  const cases = ['70°', 'D', '2/5', 'FG = a - b', '(1) 2；(2) 6', '底角的余弦值等于 3/4 或 1/3']
  for (const answer of cases) {
    assert.equal(detectUnverifiableReference(answer), null, `不应拦下: ${answer}`)
  }
})

test('judgeAnswer 对无法核对的参考答案返回 null 而非 false', () => {
  assert.deepEqual(
    judgeAnswer('70°', '(1)证明略；(2)70°', 'answer'),
    { isCorrect: null, unrecognized: true }
  )
  // 回归：正常答案仍然照常判对/判错
  assert.deepEqual(judgeAnswer('70°', '70°', 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('60°', '70°', 'answer'), { isCorrect: false, unrecognized: false })
})

test('原因码都有可读文案，直接展示给老师', () => {
  for (const code of ['no_reference_answer', 'unverifiable_reference']) {
    assert.equal(typeof UNJUDGED_REASONS[code], 'string')
    assert.ok(UNJUDGED_REASONS[code].length > 0)
  }
})
