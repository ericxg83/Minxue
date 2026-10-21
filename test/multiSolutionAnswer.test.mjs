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

test('多解题：错一个根 / 漏一个根 → 判错（不许撞上某一个根就放行）', () => {
  // 学生把第一个根算成 6（正确是 1），最后一个根 -2/3 恰好与参考末段相同
  assert.deepEqual(
    judgeAnswer('6x-1=±5 6x=5+1 或 6x=-4 x=6 或 x=-2/3 ∴原方程的根是 x₁=6, x₂=-2/3', 'x = 1 或 x = -2/3', 'answer'),
    { isCorrect: false, unrecognized: false })
  // 漏根
  assert.deepEqual(
    judgeAnswer('x₁=1', 'x=1或x=2', 'answer'),
    { isCorrect: false, unrecognized: false })
})

test('多解题：过程与结论重复写同一组解 → 仍判对（解集去重）', () => {
  assert.deepEqual(
    judgeAnswer('解：x²-x-2x+2=0，x²-3x+2=0，(x-2)(x-1)=0，x₁=2，x₂=1，∴原方程的根为x₁=2，x₂=1', 'x=1或x=2', 'answer'),
    { isCorrect: true, unrecognized: false })
})
