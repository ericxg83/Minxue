/**
 * 回归测试：「补全即补入」判据（2026-09-24）
 *
 * 锁定的事故：
 *   P2 门禁分层（2026-09-23）把系统侧缺项的错题自动记 review_status='wrong_no_book'
 *   换取不拦卷，但 wrong_no_book 在 src/utils/reviewDecision.js 里是**终态**
 *   （needsWrongBookDecision 直接排除），且后端没有「补全后自动补入」的机制
 *   ⇒ 老师补完配图/答案，题永远进不了错题本，还一直被提示「补全后可重新加入」。
 *   实测近 14 天 8 道（探针 server/_diag_wrongnobook.mjs）：8/8 元素已完整、
 *   8/8 仍未入册。
 *
 * 不许放宽的部分（红线）：
 *   · **老师手动点的「本次不加入」永远不得被自动拉回。**
 *     ⚠️ 只认 skipReason 是不够的：手动弹窗的「不加入原因」下拉
 *     （src/utils/reviewDecision.js 的 WRONG_BOOK_SKIP_REASONS）里同样有
 *     `recognition_error`（label 'OCR 或题目识别错误'），老师选它写出的 judgement
 *     与自动放行完全同形 ⇒ 必须靠 gateAuto 显式标记区分。本文件的
 *     「gateAuto 缺失即视为手动否决」用例就是这条红线的守卫。
 *   · 元素不完整 → 不补；已判对 → 不补；已在册 → 不补。
 *   · 置信度闸不在此处（仍在 addWrongQuestions 内生效，另有测试），
 *     所以判据通过 ≠ 一定会入册：低置信题由老师拍板。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const {
  decideGateRequeue,
  isAutoGateSkip,
  isJudgedWrongForWrongBook,
  GATE_REQUEUE_CODES
} = await import('../server/utils/wrongGateRequeue.js')

const {
  WRONG_GATE_AUTO_SKIP_REASON,
  WRONG_GATE_AUTO_FLAG
} = await import('../src/domain/wrongGateTier.js')

/** 一份「元素完整、判错、曾被系统自动放行」的基线题目 */
const baseQuestion = (extra = {}) => ({
  id: 'q-0001',
  student_id: 's-0001',
  review_status: 'wrong_no_book',
  is_correct: false,
  answer_source: 'recognized',
  answer: 'x=3',
  content: '解方程 2x=6',
  parent_stem: null,
  options: [],
  question_type: 'fill',
  geometry_image_url: null,
  confidence: 0.95,
  ...extra
})

/** 自动放行写入的 judgement metadata（含显式来源标记） */
const autoSkipMeta = (extra = {}) => ({
  skipReason: WRONG_GATE_AUTO_SKIP_REASON,
  [WRONG_GATE_AUTO_FLAG]: true,
  ...extra
})

// ── 正向：机制必须生效 ────────────────────────────────────────────────

test('曾因系统缺项自动放行 + 元素已补全 + 仍判错 + 不在册 → 应自动补入', () => {
  const r = decideGateRequeue({
    question: baseQuestion(),
    skipMeta: autoSkipMeta(),
    inWrongBook: false
  })
  assert.equal(r.requeue, true, '这正是「补全即补入」要救的场景')
  assert.equal(r.code, GATE_REQUEUE_CODES.OK)
})

test('补全的判定是「现算完整性」：补上配图后立刻从不可补变可补', () => {
  const before = baseQuestion({ content: '如图，求∠A 的度数' }) // 引图无配图
  assert.equal(
    decideGateRequeue({ question: before, skipMeta: autoSkipMeta() }).code,
    GATE_REQUEUE_CODES.INCOMPLETE
  )
  const after = baseQuestion({
    content: '如图，求∠A 的度数',
    geometry_image_url: 'https://oss.example.com/fig.png'
  })
  assert.equal(
    decideGateRequeue({ question: after, skipMeta: autoSkipMeta() }).requeue,
    true,
    '★ 老师补上配图后必须能自动补入'
  )
})

test('补全参考答案同理：answer 从空到有 → 可补', () => {
  assert.equal(
    decideGateRequeue({ question: baseQuestion({ answer: '' }), skipMeta: autoSkipMeta() }).code,
    GATE_REQUEUE_CODES.INCOMPLETE
  )
  assert.equal(
    decideGateRequeue({ question: baseQuestion({ answer: 'x=3' }), skipMeta: autoSkipMeta() }).requeue,
    true
  )
})

// ── 反向：红线与边界，一条都不许放宽 ──────────────────────────────────

test('★ 红线：手动「本次不加入」即使 skipReason 恰好也是 recognition_error，也绝不补入', () => {
  // 手动弹窗下拉里就有这个码（'OCR 或题目识别错误'），所以只看 skipReason 会误判
  const manualMeta = { skipReason: WRONG_GATE_AUTO_SKIP_REASON } // 没有 gateAuto 标记
  const r = decideGateRequeue({
    question: baseQuestion(),
    skipMeta: manualMeta,
    inWrongBook: false
  })
  assert.equal(r.requeue, false, '★ 老师明确否决过的题，补全元素也不得自动拉回')
  assert.equal(r.code, GATE_REQUEUE_CODES.MANUAL_SKIP)
})

test('★ 红线：gateAuto 必须是布尔 true，字符串 "true" 不算（防脏数据放开红线）', () => {
  for (const bad of ['true', 1, 'yes', null, undefined, false]) {
    const r = decideGateRequeue({
      question: baseQuestion(),
      skipMeta: { skipReason: WRONG_GATE_AUTO_SKIP_REASON, [WRONG_GATE_AUTO_FLAG]: bad },
      inWrongBook: false
    })
    assert.equal(r.requeue, false, `gateAuto=${JSON.stringify(bad)} 不得判为自动放行`)
    assert.equal(r.code, GATE_REQUEUE_CODES.MANUAL_SKIP)
  }
})

test('手动其他原因（other / image_polluted / low_training_value）一律不补', () => {
  for (const reason of ['other', 'image_polluted', 'duplicate', 'low_training_value', null]) {
    const r = decideGateRequeue({
      question: baseQuestion(),
      skipMeta: { skipReason: reason, [WRONG_GATE_AUTO_FLAG]: true },
      inWrongBook: false
    })
    assert.equal(r.requeue, false, `skipReason=${reason} 不是自动放行码`)
    assert.equal(r.code, GATE_REQUEUE_CODES.MANUAL_SKIP)
  }
})

test('元素仍不完整 → 不补（四种缺项各验一遍）', () => {
  const cases = [
    ['缺配图', { content: '如图，求∠A', geometry_image_url: null }],
    ['缺选项', { question_type: 'choice', options: [] }],
    ['缺答案', { answer: null }],
    ['题型非法', { question_type: 'essay' }]
  ]
  for (const [name, extra] of cases) {
    const r = decideGateRequeue({ question: baseQuestion(extra), skipMeta: autoSkipMeta() })
    assert.equal(r.requeue, false, `${name} 不应补入`)
    assert.equal(r.code, GATE_REQUEUE_CODES.INCOMPLETE)
    assert.ok(r.issues.length > 0, `${name} 应回传缺项文案`)
  }
})

test('已判对（is_correct=true）→ 不补，防止把对题塞进错题本', () => {
  const r = decideGateRequeue({
    question: baseQuestion({ is_correct: true }),
    skipMeta: autoSkipMeta()
  })
  assert.equal(r.requeue, false)
  assert.equal(r.code, GATE_REQUEUE_CODES.NOT_JUDGED_WRONG)
})

test('已在错题本 → 不重复补（幂等）', () => {
  const r = decideGateRequeue({
    question: baseQuestion(),
    skipMeta: autoSkipMeta(),
    inWrongBook: true
  })
  assert.equal(r.requeue, false)
  assert.equal(r.code, GATE_REQUEUE_CODES.ALREADY_IN_BOOK)
})

test('不是 wrong_no_book 状态 → 一律不动（correct / exclude / wrong / null）', () => {
  for (const status of ['correct', 'exclude', 'wrong', null]) {
    const r = decideGateRequeue({
      question: baseQuestion({ review_status: status }),
      skipMeta: autoSkipMeta()
    })
    assert.equal(r.requeue, false, `review_status=${status} 不在本机制职责内`)
    assert.equal(r.code, GATE_REQUEUE_CODES.NOT_WRONG_NO_BOOK)
  }
})

// ── 存量兼容模式（只给回填脚本用）──────────────────────────────────────

test('allowLegacySkip=true：存量记录（无 gateAuto）凭 skipReason 判定可补', () => {
  const legacyMeta = { skipReason: WRONG_GATE_AUTO_SKIP_REASON } // 2026-09-24 前落库，无标记
  assert.equal(isAutoGateSkip(legacyMeta), false, '线上判据不认')
  assert.equal(isAutoGateSkip(legacyMeta, { allowLegacy: true }), true, '回填脚本认')
  const r = decideGateRequeue({
    question: baseQuestion(),
    skipMeta: legacyMeta,
    allowLegacySkip: true
  })
  assert.equal(r.requeue, true)
})

test('allowLegacySkip 也不能放宽「不是自动放行码」的题', () => {
  const r = decideGateRequeue({
    question: baseQuestion(),
    skipMeta: { skipReason: 'other' },
    allowLegacySkip: true
  })
  assert.equal(r.requeue, false)
  assert.equal(r.code, GATE_REQUEUE_CODES.MANUAL_SKIP)
})

// ── 判错口径与「仍判错」的边界 ────────────────────────────────────────

test('判错口径与 wrongBookCompensation / wrongBookRisks 同源：is_correct=false 或 blank', () => {
  assert.equal(isJudgedWrongForWrongBook({ is_correct: false }), true)
  assert.equal(isJudgedWrongForWrongBook({ is_correct: true }), false)
  assert.equal(isJudgedWrongForWrongBook({ is_correct: null }), false)
  assert.equal(isJudgedWrongForWrongBook({ is_correct: null, answer_source: 'blank' }), true)
  assert.equal(isJudgedWrongForWrongBook({}), false)
})

test('blank 未作答题：仍需参考答案才完整（缺答案时不补）', () => {
  const noAnswer = baseQuestion({ answer_source: 'blank', answer: null, is_correct: null })
  assert.equal(
    decideGateRequeue({ question: noAnswer, skipMeta: autoSkipMeta() }).code,
    GATE_REQUEUE_CODES.INCOMPLETE,
    'blank 结构上没有学生作答，但参考答案仍是入册必需项'
  )
  const withAnswer = baseQuestion({ answer_source: 'blank', answer: 'x=3', is_correct: null })
  assert.equal(
    decideGateRequeue({ question: withAnswer, skipMeta: autoSkipMeta() }).requeue,
    true
  )
})

// ── 前后端线上契约 + 机制接线 ─────────────────────────────────────────

test('前后端线协议：自动放行码与来源标记取值固定', () => {
  assert.equal(WRONG_GATE_AUTO_SKIP_REASON, 'recognition_error', '改这个值要同步前端 markWrongNoBook')
  assert.equal(WRONG_GATE_AUTO_FLAG, 'gateAuto', 'judgements.metadata 里的键名，改了两端一起改')
})

test('★ 机制接线：PUT /api/questions/:id 必须调用补全即补入执行器', () => {
  const src = readFileSync(join(repoRoot, 'server/index.js'), 'utf8')
  assert.match(
    src,
    /requeueGateSkippedQuestion\s*\(/,
    'PUT 端点若不调用它，「补全即补入」机制等于没修（老师补完元素仍进不了错题本）'
  )
  assert.match(
    src,
    /from '\.\/services\/wrongGateRequeue\.js'/,
    '执行器必须从 services/wrongGateRequeue.js 引入'
  )
})
