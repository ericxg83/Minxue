import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveGradingResult } from '../server/worker.js'
import { judgeAnswer, detectUnverifiableReference, describeUnverifiableReference, UNJUDGED_REASONS } from '../server/services/judgeService.js'

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

// ── 「无法自动核对」的原因必须说清是哪一种（2026-09-22）─────────────────
// 背景：原通用文案「参考答案无法自动核对（含略/见解析/答案不唯一）」把三种完全不同的
// 情况糊在一起。老师拿到一道参考答案是整段证明「证明：(1) ∵在△ABC中…」的题，被提示
// "含略"，会以为系统把答案读丢了 —— 而参考答案其实好好地显示着（answer 非空），
// 只是没法逐字比对。用户要求：答案就是「略」时，就明说参考答案是「略」。
test('describeUnverifiableReference：答案册原文就是「略」时，文案照实引用原文', () => {
  const cases = ['略', '略。', '过程略', '证明略', '见解析', '答案不唯一']
  for (const raw of cases) {
    const msg = describeUnverifiableReference(raw)
    assert.ok(msg.includes(`「${raw}」`), `文案必须原样引用答案册原文: ${raw} → ${msg}`)
    assert.ok(msg.includes('请人工核对'), `必须给出动作指引: ${msg}`)
    assert.ok(!msg.includes('无法自动核对（含略'), `不得再用糊在一起的旧文案: ${msg}`)
  }
})

test('describeUnverifiableReference：整段证明/解答不能说成「含略」', () => {
  const proof = '证明：(1) ∵在△ABC中，AD和BG是△ABC的高，∴∠BGC=∠ADC=90°.又∠C=∠C, ∴△ADC∽△BGC.'
  const msg = describeUnverifiableReference(proof)
  assert.ok(msg.includes('证明'), `应说明是证明过程: ${msg}`)
  assert.ok(!msg.includes('含略'), `证明过程不得被说成含「略」: ${msg}`)
  // 长参考答案（无证明前缀）同样归入"整段解答"
  const long = '解：设该抛物线的表达式为y=a(x-1)²+4，将点B(0,3)代入得a=-1，故所求表达式为y=-(x-1)²+4。'
  assert.ok(describeUnverifiableReference(long).includes('整段'))
})

test('describeUnverifiableReference：空答案归到"缺少参考答案"', () => {
  assert.equal(describeUnverifiableReference(''), UNJUDGED_REASONS.no_reference_answer)
  assert.equal(describeUnverifiableReference(null), UNJUDGED_REASONS.no_reference_answer)
})

test('describeUnverifiableReference 与 detectUnverifiableReference 覆盖同一批输入', () => {
  // 判据本身（detectUnverifiableReference 返回的原因码）保持向后兼容不变，
  // 新增的只是"给老师看的中文说明"，两者不能各认一批。
  const cases = [
    '略', '(1)证明略；(2)70°', '(1) 证明见解析；(2) FG = a - b',
    '李师傅工作效率高 比较过程略', '$\\frac{31}{15}$ (答案不唯一)',
    '证明：∠BDC=∠BDE，∠C=∠C，∴△BCD∽△BDE；, 8'
  ]
  for (const answer of cases) {
    assert.equal(detectUnverifiableReference(answer), 'unverifiable_reference', answer)
    const msg = describeUnverifiableReference(answer)
    assert.equal(typeof msg, 'string')
    assert.ok(msg.length > 0 && msg.includes('请人工核对'), answer)
  }
})
