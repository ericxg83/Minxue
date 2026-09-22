// 回归测试：练习册参考答案安全带 detectReferenceMismatch（2026-09-21 复核减负根因修复）
//
// 根因：原逻辑只用 OCR 的 sheetType 当形态判据，OCR 题型常误判
// （同一填空/解答题有时被误认成 choice），导致本可对答案被误拒 → 大量 exception 转人工。
// 修复：① 优先信任答案库 answer_type（印刷/人工权威）；② CHOICE_REF_RE 认带圈数字 ①–⑩。
//
// 安全底线（不得放宽）：整段证明/解析仍拒；真·题型冲突仍拒；不传 answerType 时回退旧行为。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectReferenceMismatch } from '../server/services/judgeService.js'

test('带圈数字选项（①或②或③）不再被误拒', () => {
  // 修复前 CHOICE_REF_RE 只认 A–D，会判 reference_mismatch；修复后应放行
  assert.equal(
    detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: '①或②或③', answerType: 'choice' }),
    null
  )
})

test('答案库题型为 choice 且答案是纯选项字母 → 不拒（含 OCR 误判 fill 的场景）', () => {
  // answerType 权威：OCR 误把填空判成 fill，但答案库是 choice+B，不应被 isProofLikeReference 误伤
  assert.equal(
    detectReferenceMismatch({ sheetType: 'fill', referenceAnswer: 'B', answerType: 'choice' }),
    null
  )
  assert.equal(
    detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: 'D', answerType: 'choice' }),
    null
  )
})

test('答案库题型为 answer（解答题）且答案是整段证明 → 不拒（OCR 误判 fill 时不应误伤真解答）', () => {
  assert.equal(
    detectReferenceMismatch({ sheetType: 'fill', referenceAnswer: '证明：如图，作FG⊥BD于点G，设边长为3', answerType: 'answer' }),
    null
  )
})

test('整段证明/解析在 fill 题型下仍拒（安全底线：填空题不该是整段证明）', () => {
  assert.equal(
    detectReferenceMismatch({ sheetType: 'fill', referenceAnswer: '证明：如图，作FG⊥BD于点G', answerType: 'fill' }),
    'reference_mismatch'
  )
})

test('真·题型冲突仍拒（choice 题配整段解答 / 非选项长串）', () => {
  assert.equal(
    detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: '证明：由题知，∵EG//BC…', answerType: 'choice' }),
    'reference_mismatch'
  )
  assert.equal(
    detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: '解：设x=1，则y=2，代入得…', answerType: 'choice' }),
    'reference_mismatch'
  )
})

test('judge 题型只认对错形态', () => {
  assert.equal(detectReferenceMismatch({ sheetType: 'judge', referenceAnswer: '√', answerType: 'judge' }), null)
  assert.equal(detectReferenceMismatch({ sheetType: 'judge', referenceAnswer: '对', answerType: 'judge' }), null)
  assert.equal(
    detectReferenceMismatch({ sheetType: 'judge', referenceAnswer: '解：略', answerType: 'judge' }),
    'reference_mismatch'
  )
})

test('向后兼容：不传 answerType 时回退 sheetType 旧行为', () => {
  // 旧行为：choice + 纯选项 → null；choice + 长串 → 拒
  assert.equal(detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: 'A' }), null)
  assert.equal(
    detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: '证明：由题知' }),
    'reference_mismatch'
  )
  // 带圈数字在正则层面已放开（与是否传 answerType 无关——只有选择题答案才长这样，安全）：
  // 不传 answerType 也不拒
  assert.equal(
    detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: '①或②或③' }),
    null
  )
})
