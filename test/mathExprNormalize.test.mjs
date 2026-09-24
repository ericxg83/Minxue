/**
 * 数学答案「同解异写」归一化回归测试（2026-09-24）
 *
 * 锁定 LaTeX/Unicode/上标字母等常见写法差异必须被判为同一答案 ——
 * 漏掉任一条，就会把「同题两次独立运行」的好答案当幻觉丢弃。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMathExpr, isSameMathAnswer, isSameAnswerSemantic, judgePolarity, isSameUnitVariant, isSameAssignVariant } from '../server/utils/mathExprNormalize.js'

test('LaTeX \\times + \\frac 与 Unicode ·/ⁿ 同解（实测第 1 题原样）', () => {
  assert.equal(isSameMathAnswer('2 \\times (\\frac{5}{3})^n', '2·(5/3)ⁿ'), true)
})

test('上标字母 ⁿ 与 ^n 同解（漏掉会把好答案丢掉）', () => {
  assert.equal(isSameMathAnswer('(5/3)ⁿ', '(5/3)^n'), true)
})

test('上标数字 ² 与 ^2 同解', () => {
  assert.equal(isSameMathAnswer('x²+1', 'x^2+1'), true)
})

test('LaTeX \\frac 与斜杠分数同解', () => {
  assert.equal(isSameMathAnswer('\\frac{\\sqrt{6}}{2}', '√6/2'), true)
})

test('\\sqrt{6}/2 与 √6/2 同解', () => {
  assert.equal(isSameMathAnswer('\\sqrt{6}/2', '√6/2'), true)
})

test('多余括号不影响判同', () => {
  assert.equal(isSameMathAnswer('(5)/(3)', '5/3'), true)
})

test('全角括号与半角同解', () => {
  assert.equal(isSameMathAnswer('（a+b）²', '(a+b)^2'), true)
})

test('中文逗号结尾不影响判同', () => {
  assert.equal(isSameMathAnswer('2a+b-1，', '2a+b-1'), true)
})

test('⛔ 实质不同的答案绝不能被判同（防假一致）', () => {
  const diff = [
    ['2:1', '2:3'],
    ['±2', '2'],
    ['-3', '3'],
    ['①②③④', '①③④'],
    ['4', '5'],
    ['x>1', 'x<1'],
  ]
  for (const [a, b] of diff) {
    assert.equal(isSameMathAnswer(a, b), false, `${a} 与 ${b} 不应判同`)
  }
})

test('空值不判同', () => {
  assert.equal(isSameMathAnswer('', ''), false)
  assert.equal(isSameMathAnswer(null, null), false)
  assert.equal(isSameMathAnswer('', '2'), false)
})

test('归一化不改变语义骨架（抽样快照）', () => {
  assert.equal(normalizeMathExpr('2 \\times (\\frac{5}{3})^n'), '2*((5)/(3))^n')
  assert.equal(normalizeMathExpr('2·(5/3)ⁿ'), '2*(5/3)^n')
})

// ── isSameAnswerSemantic：叙述型答案的包含关系 + 判断题极性（2026-09-24 实测两处误杀） ──

test('叙述型：run1 给完整证明 / run2 只给结论 → 判同（实测第 5 题 576b600f）', () => {
  assert.equal(isSameAnswerSemantic(
    '证明：∵四边形ABCD为菱形，∠D=36°，∴∠ABC=∠D=36°，AB=BC，∴∠BAC=∠BCA=(180°-36°)÷2=72°。∴△ABC∽△AEB。',
    '△ABC∽△AEB'
  ), true)
})

test('叙述型：PM=QM 藏在长证明末尾 → 判同（实测第 9 题 e19aae64）', () => {
  assert.equal(isSameAnswerSemantic(
    '证明：∵矩形ABCD中AD∥BC，又EF∥AD，∴AD∥EF∥BC。∵E是AB的中点，∴AE=EB。由平行线等分线段定理，∴PM=QM。',
    'PM=QM'
  ), true)
})

test('判断题极性：「不正确」与「错误」同义 → 判同（实测第 8 题 21ed36f3）', () => {
  assert.equal(isSameAnswerSemantic('不正确', '错误'), true)
  assert.equal(isSameAnswerSemantic('正确', '对'), true)
  assert.equal(judgePolarity('不正确'), 'N')
  assert.equal(judgePolarity('√'), 'Y')
})

test('⛔ 极性相反绝不判同（防放水）', () => {
  assert.equal(isSameAnswerSemantic('正确', '错误'), false)
  assert.equal(isSameAnswerSemantic('对', '不正确'), false)
})

test('⛔ 混了别的字就不认极性（说理题半句不得当判断题答案）', () => {
  assert.equal(judgePolarity('不正确，因为x²可能是有理数'), null)
  assert.equal(judgePolarity('x'), null) // 字母 x 是变量，绝不能当「错」
})

test('⛔ 纯数值不走包含判据（15 ⊂ 315 不得放水）', () => {
  assert.equal(isSameAnswerSemantic('15', '315'), false)
  assert.equal(isSameAnswerSemantic('2', '12'), false)
})

test('⛔ 叙述型包含判据不放行实质矛盾', () => {
  assert.equal(isSameAnswerSemantic('△ABC∽△AEB', '△ABC∽△ADE'), false)
  assert.equal(isSameAnswerSemantic('PM=QM', 'PM≠QM'), false)
})

// ── isSameUnitVariant：恰好一侧带单位（2026-09-24 实测 4 条被误杀） ──

test('单位词差异判同（实测第 21/22 题：1.608×10^5吨 vs 1.608×10^5）', () => {
  assert.equal(isSameUnitVariant('1.608×10^5吨', '1.608×10^5'), true)
  assert.equal(isSameAnswerSemantic('1.608×10^5吨', '1.608×10^5'), true)
})

test('⛔ 两侧都带单位时绝不判同（5cm vs 5m 不得放水）', () => {
  assert.equal(isSameUnitVariant('5cm', '5m'), false)
  assert.equal(isSameAnswerSemantic('5cm', '5m'), false)
})

test('⛔ 数值不同时，即使一侧带单位也不判同', () => {
  assert.equal(isSameUnitVariant('1.608×10^5吨', '1.609×10^5'), false)
  assert.equal(isSameUnitVariant('98cm', '97cm'), false)
})

// ── isSameAssignVariant：恰好一侧带变量赋值前缀（2026-09-24 实测 1aabc26b） ──

test('赋值前缀差异判同（实测第 38 题：-1 vs k=-1）', () => {
  assert.equal(isSameAssignVariant('-1', 'k=-1'), true)
  assert.equal(isSameAnswerSemantic('-1', 'k=-1'), true)
  assert.equal(isSameAnswerSemantic('y=x²-4x+3', 'x²-4x+3'), true)
})

test('⛔ 两侧都带前缀时不判同（求 a 与求 b 不是同一个答案）', () => {
  assert.equal(isSameAssignVariant('a=1', 'b=1'), false)
  assert.equal(isSameAssignVariant('k=-1', 'm=-1'), false)
})

test('⛔ 前缀外数值不同绝不判同', () => {
  assert.equal(isSameAssignVariant('-1', 'k=-2'), false)
})
