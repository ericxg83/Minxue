import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { detectReferenceMismatch, isProofLikeReference, UNJUDGED_REASONS } from '../server/services/judgeService.js'

const ROOT = resolve(import.meta.dirname, '..')
const WORKER_SRC = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')
const JUDGE_SRC = readFileSync(resolve(ROOT, 'server/services/judgeService.js'), 'utf8')

/**
 * 练习册参考答案安全带（P1/P2，2026-09-16 事故沉淀）
 *
 * 事故：老师随机组题（成长·桥第03周）走了练习册批改路线，系统按题号取到
 * 《九上上海作业答案》28.1(2) 的行 —— 卷面第 4 题是填空（CE/AC=1/3），
 * 取到的参考答案却是另一道解答题「解：由题知，∵EG//BC，GF//DC，」。
 * 参考答案有内容、置信度 0.95，老师看不出异常，还把答对的判成了错。
 *
 * 设计约束：**只在"一眼可判"的硬冲突时拦，判不出就放行**——
 * 拿不准就退化成改动前的行为，不拓宽任何判定口径。
 */

test('选择题的参考答案必须是选项字母，否则判定不匹配', () => {
  assert.equal(detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: 'A' }), null)
  assert.equal(detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: 'D' }), null)
  // 实测事故：卷面是「下列结论中不正确的是」，答案库同题号给的是数值
  assert.equal(detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: '4' }), 'reference_mismatch')
  // 实测事故：答案库同题号给的是「①②④」这种填序号的题
  assert.equal(detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: '①②④' }), 'reference_mismatch')
  assert.equal(detectReferenceMismatch({ sheetType: 'choice', referenceAnswer: '3√5-3' }), 'reference_mismatch')
})

test('填空题的参考答案不能是一整段解答/证明', () => {
  assert.equal(detectReferenceMismatch({ sheetType: 'fill', referenceAnswer: '1/3' }), null)
  assert.equal(detectReferenceMismatch({ sheetType: 'fill', referenceAnswer: '√6' }), null)
  assert.equal(detectReferenceMismatch({ sheetType: 'fill', referenceAnswer: '(3√5-3)/2' }), null)
  // 实测事故：卷面第4题是填空，答案库给的是另一道解答题的开头
  assert.equal(
    detectReferenceMismatch({ sheetType: 'fill', referenceAnswer: '解：由题知，∵EG//BC，GF//DC，' }),
    'reference_mismatch'
  )
})

test('解答题不参与形态校验（答案本来就长）', () => {
  assert.equal(
    detectReferenceMismatch({ sheetType: 'answer', referenceAnswer: '解：由题知，∵EG//BC，GF//DC，∴AE/EB=AG/GC…' }),
    null
  )
  assert.equal(detectReferenceMismatch({ sheetType: 'fill', referenceAnswer: '' }), null)
})

test('判断题参考答案必须是 √/×/对/错 之类', () => {
  assert.equal(detectReferenceMismatch({ sheetType: 'judge', referenceAnswer: '√' }), null)
  assert.equal(detectReferenceMismatch({ sheetType: 'judge', referenceAnswer: '错' }), null)
  assert.equal(detectReferenceMismatch({ sheetType: 'judge', referenceAnswer: '2' }), 'reference_mismatch')
})

test('isProofLikeReference：长答案或"解：/证明："开头都算解答体', () => {
  assert.equal(isProofLikeReference('证明：延长EC交AB于点G，如图'), true)
  assert.equal(isProofLikeReference('解：设BD=x，则AB=2x，由勾股定理得AD=√5x。'), true)
  assert.equal(isProofLikeReference('1/3'), false)
})

test('UNJUDGED_REASONS 必须含 reference_mismatch（否则老师看不到原因）', () => {
  assert.equal(
    UNJUDGED_REASONS.reference_mismatch,
    '参考答案与本题不匹配，已转为人工判定'
  )
})

// ── 源码级防复发：锁住调用点，避免以后重构把闸门摘掉 ──────────────────

test('worker.js 的练习册批改链路必须调用 detectReferenceMismatch', () => {
  assert.match(WORKER_SRC, /import \{[^}]*detectReferenceMismatch[^}]*\} from '\.\/services\/judgeService\.js'/)
  assert.match(WORKER_SRC, /detectReferenceMismatch\(\{ sheetType, referenceAnswer: answerRow\.answer \}\)/)
})

test('worker.js 必须做单元答案池题号缺口体检（P2）', () => {
  assert.match(WORKER_SRC, /unitGapStart/)
  assert.match(WORKER_SRC, /答案池题号不连续/)
})

test('丢弃参考答案必须同时清空答案并给出原因（不能只清一半）', () => {
  const seg = WORKER_SRC.slice(
    WORKER_SRC.indexOf('P1 参考答案安全阀'),
    WORKER_SRC.indexOf('P1 参考答案安全阀') + 2200
  )
  assert.match(seg, /q\.answer = null/)
  assert.match(seg, /q\.is_correct = null/)
  assert.match(seg, /q\._unjudged_reason = mismatchReason/)
})

test('丢弃率过半必须整卷丢弃并重算计数器（不能留"看起来正常"的错答案）', () => {
  const seg = WORKER_SRC.slice(
    WORKER_SRC.indexOf('P2 入口预检结论'),
    WORKER_SRC.indexOf('P2 入口预检结论') + 3200
  )
  assert.match(seg, /ratio >= 0\.5/)
  assert.match(seg, /q\.answer = null/)
  assert.match(seg, /wrongCount = 0/)
  assert.match(seg, /matchedCount = 0/)
})

test('judgeService.js 导出 detectReferenceMismatch 与 isProofLikeReference', () => {
  assert.match(JUDGE_SRC, /export function detectReferenceMismatch/)
  assert.match(JUDGE_SRC, /export function isProofLikeReference/)
})
