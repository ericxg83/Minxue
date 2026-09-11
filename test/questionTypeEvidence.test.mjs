import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkQuestionCompleteness,
  resolveEffectiveQuestionType,
  hasExplicitOptionMarkers,
  COMPLETENESS_CODES
} from '../server/utils/questionCompleteness.js'
import * as feMirror from '../src/utils/questionCompleteness.js'

/**
 * 2026-09-11 用户报「这是一道填空题，没有选项」：
 * 复核时第 6 题（练习册 27.5，填空题）被报「题目元素不完整：选择题缺少选项」，
 * 标错不入册、编辑页又没有题型可改（选项区块只在 choice 下渲染）→ 死锁。
 *
 * 根因：question_type 是模型/答案库的猜测字段。这道题的库内真实数据是
 *   question_type='choice'  options=[]  answer='A'
 * 而题干是「6. 如图,要在夹角为30°的两条小路OA与OB形成的角状空地上建一个三角形
 * 花坛,…,则当OP=______米时,该花坛POQ的面积最大.」——纯填空题。
 * 练习册答案库同题号那条记录是 answer_type='choice'/answer='A'，批改管线
 * （worker.js 练习册答案匹配）直接 `q.question_type = answerRow.answer_type || …`
 * 覆盖了 OCR 题型，于是「选择题 + 零选项」这个自相矛盾的行被落库。
 *
 * 下面这条用例就是那次事故的原始数据快照。
 */
const REPORTED_FILL_Q = {
  question_type: 'choice',
  options: [],
  content: '6. 如图,要在夹角为30°的两条小路OA与OB形成的角状空地上建一个三角形花坛,分别在边OA和OB上取点P和点Q,并扎起篱笆将花坛保护起来(篱笆的厚度忽略不计).若OP和OQ两段篱笆的总长为8米,则当OP=______米时,该花坛POQ的面积最大.',
  answer: 'A',
  geometry_image_url: 'https://oss/fig.png'
}

test('填空题被存成 choice + 零选项时，不再报「选择题缺少选项」', () => {
  const r = checkQuestionCompleteness(REPORTED_FILL_Q)
  assert.ok(!r.codes.includes(COMPLETENESS_CODES.missing_options), `不该报缺选项，实际 codes=${JSON.stringify(r.codes)}`)
  assert.equal(r.isComplete, true, `该题配图/答案都在，应判完整，实际 issues=${JSON.stringify(r.issues)}`)
})

test('resolveEffectiveQuestionType 把矛盾行纠偏为 fill，并给出稳定 reason', () => {
  const r = resolveEffectiveQuestionType(REPORTED_FILL_Q)
  assert.equal(r.type, 'fill')
  assert.equal(r.corrected, true)
  assert.equal(r.reason, 'choice_declared_but_stem_is_fill')
})

// ── 反面：真·选择题漏抓选项时必须继续拦。以下是同日全库普查命中的 5 道真实
//    「choice + options=[]」题（题干在同一行，选项在下一行没被 OCR 抓进 content）。
//    它们的共同形态是：题干无填空线、以空括号或判断句式收尾。绝不能被纠偏放过。
const REAL_CHOICE_MISSING_OPTIONS = [
  '7.如图,抛物线y=-x²+mx的对称轴为直线x=2.若关于x的一元二次方程-x²+mx-t=0(t为实数)在1<x<3的范围内有解,则t的取值范围是',
  '1.抛物线 y=x²+2x-3 与 x 轴的交点有',
  '6. 函数 y=a/x 与 y=-ax²-a(a≠0) 在同一平面直角坐标系中的大致图像可能是',
  '5. 已知点 (x₁,y₁)、(x₂,y₂) 均在抛物线 y=x²-1 上，则下列说法正确的是',
  '7. 如图，抛物线 y=ax²+c(a≠0) 经过正方形 OABC 的三个顶点 A、B、C，若点 B 在 y 轴上，则 ac 的值为'
]

test('真·选择题漏抓选项时仍然报 missing_options（不被证据纠偏放过）', () => {
  for (const content of REAL_CHOICE_MISSING_OPTIONS) {
    const r = checkQuestionCompleteness({
      question_type: 'choice', options: [], content, answer: 'B', geometry_image_url: 'https://oss/x.png'
    })
    assert.ok(
      r.codes.includes(COMPLETENESS_CODES.missing_options),
      `应继续拦「缺选项」：${content.slice(0, 24)}… 实际 codes=${JSON.stringify(r.codes)}`
    )
  }
})

// 最危险的误伤形态：题干既含填空线、又以选择题答题括号收尾。
// 这是「选择题把答案框印在题干末尾」的常见排版，OCR 又把下一行的选项漏了，
// 必须靠尾部空括号把它判回选择题，否则会被当成填空题放进错题本。
test('题干以空括号收尾 = 选择题答题框，即便含填空线也不纠偏', () => {
  for (const content of [
    '若 OP=______ 米，则该花坛面积最大，下列判断正确的是（　）',
    '已知 x = ______ 时函数值最大，则下列说法正确的是(  )',
    '抛物线 y=ax²+c 与 x 轴的交点个数是（　）。'
  ]) {
    const r = resolveEffectiveQuestionType({ question_type: 'choice', options: [], content })
    assert.equal(r.corrected, false, `不该纠偏：${content}`)
    assert.equal(r.type, 'choice')
  }
})

test('题干内联了 A/B/C/D 标号 = 选择题铁证，不纠偏', () => {
  const r = resolveEffectiveQuestionType({
    question_type: 'choice',
    options: [],
    content: '若 x = ______，则下列结论正确的是 A. x>0 B. x<0 C. x=0 D. 无法确定'
  })
  assert.equal(r.corrected, false)
  assert.equal(r.type, 'choice')
})

test('options 非空时一律不动题型', () => {
  const r = resolveEffectiveQuestionType({
    question_type: 'choice',
    options: ['3', '6'],
    content: '边长是 ______ 时面积最大'
  })
  assert.equal(r.corrected, false)
})

test('非 choice 题型一律不动（哪怕题干有填空线）', () => {
  for (const t of ['fill', 'answer', 'judge', '', null, 'choise']) {
    const r = resolveEffectiveQuestionType({ question_type: t, options: [], content: 'h = -5/2 t²+30t+1，需要 ______ s' })
    assert.equal(r.corrected, false, `type=${t} 不该被纠偏`)
  }
})

test('options 传 JSON 字符串也能识别为空/非空', () => {
  const base = { question_type: 'choice', content: '当 OP=______ 米时面积最大' }
  assert.equal(resolveEffectiveQuestionType({ ...base, options: '[]' }).type, 'fill')
  assert.equal(resolveEffectiveQuestionType({ ...base, options: '["3","6"]' }).type, 'choice')
  assert.equal(resolveEffectiveQuestionType({ ...base, options: null }).type, 'fill')
})

test('hasExplicitOptionMarkers 需要 ≥2 个不同标号', () => {
  assert.equal(hasExplicitOptionMarkers('A. 1'), false)
  assert.equal(hasExplicitOptionMarkers('A. 1 B. 2'), true)
  assert.equal(hasExplicitOptionMarkers('结论是 A 和 B'), false)
})

test('前端镜像 checkQuestionCompleteness 与服务端行为一致', () => {
  const cases = [
    REPORTED_FILL_Q,
    ...REAL_CHOICE_MISSING_OPTIONS.map(content => ({ question_type: 'choice', options: [], content, answer: 'B' })),
    { question_type: 'fill', options: [], content: '12 的正因数有___。', answer: '1,2,3,4,6,12' },
    { question_type: null, options: [], content: '解方程 x+1=2', answer: 'x=1' }
  ]
  for (const q of cases) {
    const a = checkQuestionCompleteness(q)
    const b = feMirror.checkQuestionCompleteness(q)
    assert.deepEqual(b.issues, a.issues, `镜像 issues 不一致：${JSON.stringify(q.content).slice(0, 30)}`)
    assert.equal(b.isComplete, a.isComplete)
  }
  assert.equal(feMirror.resolveEffectiveQuestionType(REPORTED_FILL_Q).type, 'fill')
})
