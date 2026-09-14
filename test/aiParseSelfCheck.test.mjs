// 回归测试：答案解析「最终答案」提取口径 + 参考答案叙述型闸门
//
// 事故背景（2026-09-14 错题再测-0911，学生 赵安迪）：
//   答案引擎（deepseek-v4-pro）在解析里自我纠错/自言自语：
//     `……所以正确答案应包含10。……最终答案：2,3,5,6,7,8,10。`
//   旧实现 `extractFinalAnswerFromAnalysis` 按 pattern 列表顺序返回**第一个**命中 →
//   抓到中间那句残句 `应包含10`，写进 `questions.answer` 并缓存进 question_cache，
//   经题干指纹复用传染给所有同题干学生（全库 586 条缓存里 45 条答案不是文末答案）。
//   判等层拿 `应包含10` 去比对必然判错 —— 学生写 `10、8、7、6、5、3、2` 完全正确却报 AI错误。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  extractFinalAnswerFromAnalysis,
  isNarrativeAnswer,
} from '../server/utils/aiParseSelfCheck.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

// ── 1. 取「文末」答案标记，而不是列表里先命中的那个 ────────────────────────

test('文中出现「应包含10」式自语时，取文末的最终答案', () => {
  const analysis = [
    'a 是不大于10的正整数，即 a ∈ {1,2,3,4,5,6,7,8,9,10}。',
    '在 1 到 10 中，完全平方数有：1=1²，4=2²，9=3²。',
    '√10 确实是无理数，所以 10 也应该包括在内。',
    '所以正确答案应包含10。',
    '因此，所有使 √a 为无理数的 a 是：2,3,5,6,7,8,10。',
    '最终答案：2,3,5,6,7,8,10。',
  ].join('\n')
  assert.equal(
    extractFinalAnswerFromAnalysis(analysis),
    '2,3,5,6,7,8,10',
    '旧实现会返回文中先命中的 `应包含10`，这正是错题再测-0911 判错的根因'
  )
})

test('回归：残留的叙述前缀被剥掉（`应为①、④、⑤` → `①、④、⑤`）', () => {
  assert.equal(extractFinalAnswerFromAnalysis('解法略。最终答案为：应为①、④、⑤。'), '①、④、⑤')
  assert.equal(extractFinalAnswerFromAnalysis('……所以答案为 应为 C。'), 'C')
})

test('全部候选都是解析口吻时返回 null，不用半截句子覆盖 answer 字段', () => {
  assert.equal(
    extractFinalAnswerFromAnalysis('已知点 A(1,y₁)……最终答案为 -2的右侧，因此y₂ > y₁。'),
    null,
    '宁可让调用方保留原 answer，也不要返回 `-2的右侧，因此y₂ > y₁` 这种残句'
  )
})

test('反例：正常解析照旧取值（不许把好答案改坏）', () => {
  assert.equal(extractFinalAnswerFromAnalysis('解析过程…… 最终答案为: 77。'), '77')
  assert.equal(extractFinalAnswerFromAnalysis('解析…… 最终答案为: y=3x²-6x+5, 83。'), 'y=3x²-6x+5, 83')
  assert.equal(extractFinalAnswerFromAnalysis('随便一段解析'), null)
  assert.equal(extractFinalAnswerFromAnalysis(''), null)
  assert.equal(extractFinalAnswerFromAnalysis(null), null)
})

test('反例：fallback（末行 = X）仍然生效', () => {
  assert.equal(extractFinalAnswerFromAnalysis('100x - 10x = 312.222… - 31.222…\n= 11/5'), '11/5')
})

// ── 2. 叙述型答案判据（客观题才用） ────────────────────────────────────────

test('isNarrativeAnswer：命中元话语答案', () => {
  for (const bad of [
    '应包含10',
    '应为 C',
    '应为①、④、⑤',
    '写作0.31818...（或标准循环小数记法0.3\\overline{18}），但按题目要求只需写出小数形式',
    '125，所以 125 的立方根是 5',
  ]) {
    assert.equal(isNarrativeAnswer(bad), true, `应判定为叙述型：${bad}`)
  }
})

test('isNarrativeAnswer：合法的短答案/多空答案不受长度影响', () => {
  for (const ok of [
    '√6+2',
    '2,3,5,6,7,8,10',
    '281/90',
    '>',
    '正确',
    'C',
    // 多空答案天然很长，绝不能因为长度被打成叙述型（这是刻意不做长度阈值的原因）
    '(1)a⁶；(2)-x¹²；(3)x¹⁰；(4)x⁶；(5)x¹²；(6)-a¹²',
    '18的因数有1,2,3,6,9,18，其中是素数但不是奇数的是2',
    '',
    null,
  ]) {
    assert.equal(isNarrativeAnswer(ok), false, `不应判定为叙述型：${ok}`)
  }
})

// ── 3. 源码守卫：闸门必须真的接在答案入库路径上 ─────────────────────────────

test('worker 的答案入库路径必须过叙述型闸，且缓存命中也要检查', () => {
  const src = read('server/worker.js')
  assert.ok(src.includes('isNarrativeAnswer'), 'worker.js 必须引入 isNarrativeAnswer')
  assert.ok(src.includes('rejectNarrativeAnswer'), '必须存在拒写 + 转人工的落库分支')
  assert.ok(src.includes('rescueReferenceAnswer'), '必须先用 rescueReferenceAnswer 尝试救回')
  assert.ok(
    /isObjectiveForAnswerGate\(q\) && isNarrativeAnswer\(finalAnswer\)/.test(src),
    '答案引擎返回后、写库前必须做叙述型检查'
  )
  assert.ok(
    /缓存答案疑似叙述残句/.test(src),
    '缓存命中路径必须检查叙述型（历史缓存里就沉了这类答案，不能直接复用）'
  )
  assert.ok(
    /isNarrativeAnswer\(extractedRaw\)/.test(src),
    '从解析文本提取答案的分支同样要过闸'
  )
})

test('主观题不适用叙述型闸（叙述本身就是答案）', () => {
  const src = read('server/worker.js')
  const gate = src.match(/const isObjectiveForAnswerGate = [^\n]*/)
  assert.ok(gate, '必须存在 isObjectiveForAnswerGate')
  assert.ok(/SUBJECTIVE_TYPES/.test(gate[0]), '判定必须排除 SUBJECTIVE_TYPES（answer/essay/proof/…）')
})
