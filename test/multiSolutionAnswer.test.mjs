// 回归测试：多解（多根）答案不得被截成单值（2026-10-21）
//
// 事故（用户截图）：解方程 (x+5)²-2(x+5)=8
//   解析写「所以 x = -1 或 x = -7」，参考答案却只有 `-7`。
//   学生写「原方程的根为 x₁=-7, x₂=-1」被判错，同一份答案换个顺序「x₁=-1, x₂=-7」又判对。
//
// 三层根因，本文件逐层锁死：
//   ① 答案提取：`extractFinalAnswerFromAnalysis` 的 fallback「末行 = X 右侧」把
//      「x = -1 或 x = -7」抓成 `-7`（只取最后一个等号右边）；
//   ② 多路投票：`answersEquivalent` 剥不掉 `x₁/x₂` 的下标前缀 ⇒ 同一个解集被当成两个答案，
//      白报「多路求解分歧」，给老师挂上「参考答案存疑」；
//   ③ 判题：参考答案是单值时，学生多值答案的判定结果取决于「哪个根排在最后」——纯运气。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractFinalAnswerFromAnalysis,
  isMultiValueAnswer,
} from '../server/utils/aiParseSelfCheck.js'
import { answersEquivalent, voteAnswers } from '../server/utils/answerConsensus.js'
import { judgeAnswer } from '../server/services/judgeService.js'

const ANALYSIS_MULTI = '令 y = x + 5，则原方程化为 y² - 2y = 8，即 y² - 2y - 8 = 0。因式分解得 (y - 4)(y + 2) = 0，解得 y = 4 或 y = -2。当 y = 4 时，x + 5 = 4，解得 x = -1；当 y = -2 时，x + 5 = -2，解得 x = -7。所以 x = -1 或 x = -7。'

// ── ① 答案提取：多解末句不许截断 ─────────────────────────────────────────────

test('解析末句是多解声明 → 返回 null（保留 answer 字段的完整解集）', () => {
  assert.equal(extractFinalAnswerFromAnalysis(ANALYSIS_MULTI), null)
  assert.equal(extractFinalAnswerFromAnalysis('解得 x=1 或 x=2。'), null)
  assert.equal(extractFinalAnswerFromAnalysis('所以 x₁=2，x₂=1。'), null)
  assert.equal(extractFinalAnswerFromAnalysis('因此 x 的值为 2 或 3。'), null)
})

test('反例：单解末句的 fallback 行为不变', () => {
  assert.equal(extractFinalAnswerFromAnalysis('由题意得方程 x+3=5。所以 x=2。'), '2')
  assert.equal(extractFinalAnswerFromAnalysis('100x - 10x = 312.222… - 31.222…\n= 11/5'), '11/5')
})

test('isMultiValueAnswer：多值答案识别', () => {
  for (const v of ['x = -1 或 x = -7', 'x₁=-1，x₂=-7', '1/2, 3/4', '5;6']) {
    assert.equal(isMultiValueAnswer(v), true, `应识别为多值：${v}`)
  }
  for (const v of ['-7', 'x=2', '√5/2', '']) {
    assert.equal(isMultiValueAnswer(v), false, `不应识别为多值：${v}`)
  }
})

// ── ② 多路投票：x₁/x₂ 与 x=… 是同一个解集 ────────────────────────────────────

test('answersEquivalent：下标写法与「或」写法等价', () => {
  assert.equal(answersEquivalent('x = -1 或 x = -7', 'x₁=-1，x₂=-7'), true)
  assert.equal(answersEquivalent('x=-1,x=-7', 'x₁=-1,x₂=-7'), true)
  // 反例：解不同/数量不同，不许折叠
  assert.equal(answersEquivalent('x=1 或 x=2', 'x₁=1，x₂=3'), false)
  assert.equal(answersEquivalent('-7', 'x = -1 或 x = -7'), false)
})

test('voteAnswers：同题三种写法归为一组，不再白报分歧', () => {
  const v = voteAnswers(['x = -1 或 x = -7', 'x₁=-1，x₂=-7', 'x = -1 或 x = -7'])
  assert.equal(v.verdict, 'unanimous')
  assert.equal(v.total, 3)
  assert.equal(v.groups.length, 1)
})

// ── ③ 判题：多解题的正误必须看完整解集，不能撞最后一个根 ────────────────────

test('多解题：学生两个根都对 → 判对（与书写顺序无关）', () => {
  for (const student of ['原方程的根为 x₁=-7, x₂=-1', 'x₁=-1, x₂=-7']) {
    assert.deepEqual(
      judgeAnswer(student, 'x = -1 或 x = -7', 'answer'),
      { isCorrect: true, unrecognized: false },
      `应判对：${student}`)
  }
})

test('多解题：错一个根 → 判错（不许撞上某一个根就放行）', () => {
  // 学生把第一个根算成 6（正确是 1），最后一个根 -2/3 恰好与参考末段相同。
  // 旧逻辑：解集合配对失败 → 不出声 → 单答案收窄把两侧都收到最后一个 "=" 右侧
  // （都是 -2/3）→ 假判对。现要求参考是解集形态时给出终局判错。
  assert.deepEqual(
    judgeAnswer('6x-1=±5 6x=5+1 或 6x=-4 x=6 或 x=-2/3 ∴原方程的根是 x₁=6, x₂=-2/3', 'x = 1 或 x = -2/3', 'answer'),
    { isCorrect: false, unrecognized: false })
  // 符号写错（-1/2 → 1/2）
  assert.deepEqual(
    judgeAnswer('16x²-8x+1-9=0 16x²-8x-8=0 (-4x+4)(-4x+2)=0 x₁=1 x₂=1/2', 'x₁=1，x₂=-1/2', 'answer'),
    { isCorrect: false, unrecognized: false })
})

test('已知放水（不修）：学生只写一个解时无法与「提取不全」区分 → 仍判对', () => {
  // 全库对比实测：学生用 `x=1，x=-2/3` 这种不带下标的写法时，严格提取只能抓到行尾一个解，
  // 与「真漏根」无法区分；收紧会误伤 3 条正确学生。守恒方向：宁可漏校验，不可误判。
  assert.deepEqual(
    judgeAnswer('x₁=1', 'x=1或x=2', 'answer'),
    { isCorrect: true, unrecognized: false })
})

test('多解题：过程与结论重复写同一组解 → 仍判对（解集去重）', () => {
  assert.deepEqual(
    judgeAnswer('解：x²-x-2x+2=0，x²-3x+2=0，(x-2)(x-1)=0，x₁=2，x₂=1，∴原方程的根为x₁=2，x₂=1', 'x=1或x=2', 'answer'),
    { isCorrect: true, unrecognized: false })
})

// ── ④ 2026-10-22 用户截图：根式共轭根 + LaTeX 下标（#13 / #10）───────────────
//
// 事故：x²-4x+2=0 参考答案只有 `2-√2`，3x(x-2)=10-5x 只有 `-5/3`。
// 参考答案缺根 ⇒ 解集合通道因「数量不等」直接不出声 ⇒ 同一份正确解按不同顺序
// 书写一条判对一条判错（id=383820e1 true / id=d81b6335 false）。
// 另外多路求解本已一致，却因 `x_1=` 这个 LaTeX 下标前缀剥不掉而白报「多数一致 2/3」。

test('多路归一：LaTeX 下标前缀与 √(2)/√2 必须折叠成同一键', () => {
  assert.equal(
    answersEquivalent('x₁=2+√2, x₂=2-√2', 'x_1=2+\\sqrt{2}, x_2=2-\\sqrt{2}'),
    true)
  const v = voteAnswers(['x1=2+√2, x2=2-√2', 'x1=2+√2, x2=2-√2', 'x_1=2+\\sqrt{2}, x_2=2-\\sqrt{2}'])
  assert.equal(v.verdict, 'unanimous')
  assert.equal(v.groups.length, 1)
})

test('多解题：根式共轭根顺序相反 → 判对（解集先于按序符号闸）', () => {
  // 按序比对时 `2-√2` 去对 `2+√2`，会命中「只差一个负号」早退闸直接判错。
  // 方程两根无顺序语义，解集无序配对必须先行。
  for (const student of [
    'x₁=2-√2, x₂=2+√2',
    '原方程的根为 x₁=2-√2, x₂=2+√2',
    'x₂=2-√2, x₁=2+√2',
  ]) {
    assert.deepEqual(
      judgeAnswer(student, 'x₁=2+√2, x₂=2-√2', 'answer'),
      { isCorrect: true, unrecognized: false },
      `应判对：${student}`)
  }
})

test('多解题：根式共轭根错一个 → 仍判错（顺序无关不放水）', () => {
  assert.equal(judgeAnswer('x₁=2+√2, x₂=2+√2', 'x₁=2+√2, x₂=2-√2', 'answer').isCorrect, false)
  assert.equal(judgeAnswer('x₁=2+√2, x₂=-2-√2', 'x₁=2+√2, x₂=2-√2', 'answer').isCorrect, false)
  assert.equal(judgeAnswer('2-√2', '2+√2', 'answer').isCorrect, false)
})

test('多解题：学生用「x=A或x=B」无下标写法 → 判对', () => {
  // 参考答案补全后，这类写法若抓不到第二个根就会因「数量不等」被判错（783308b3 实测）。
  assert.deepEqual(
    judgeAnswer('解：9x²=12，x²=4/3，x=2/3√3或x=-2/3√3', 'x₁=2√3/3, x₂=-2√3/3', 'answer'),
    { isCorrect: true, unrecognized: false })
  assert.equal(
    judgeAnswer('x=2/3√3或x=-2/3√3', 'x₁=2√3/3, x₂=2√3/3', 'answer').isCorrect,
    false)
})

test('多解题：三根/四根也按无序集合比（换元题的 y₁/y₂ 不得混进 x 的解集）', () => {
  const student4 = '设x²+3x=y y²-2y-8=0 (y-4)(y+2)=0 y₁=4, y₂=-2 '
    + '当y=4时 x²+3x-4=0 (x+4)(x-1)=0 x₁=-4, x₂=1 '
    + '当y=-2时 x²+3x+2=0 (x+2)(x+1)=0 x₃=-2, x₄=-1 '
    + '∴原方程的解为x₁=-4, x₂=1, x₃=-2, x₄=-1'
  assert.deepEqual(
    judgeAnswer(student4, 'x₁=1, x₂=-4, x₃=-1, x₄=-2', 'answer'),
    { isCorrect: true, unrecognized: false })
  assert.deepEqual(
    judgeAnswer('x₁=0, x₂=3, x₃=-3', 'x₁=-3, x₂=0, x₃=3', 'answer'),
    { isCorrect: true, unrecognized: false })
  // 四根错一个 → 判错
  assert.equal(
    judgeAnswer(student4, 'x₁=1, x₂=-4, x₃=-1, x₄=-3', 'answer').isCorrect,
    false)
})
