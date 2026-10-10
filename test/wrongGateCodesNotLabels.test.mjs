/**
 * 源码级回归锁：门禁分层的入参必须是**机器 code**，不是中文文案（2026-10-10）
 *
 * 背景（真实 bug）：
 *   reviewStore.rawUnresolvedWrongQuestions 把 checkQuestionCompleteness().issues
 *   （中文，如「题干引用几何图但缺少配图」）当判据传给 classifyWrongGateItem，
 *   而 wrongGateTier.js 里比较的是 code（missing_figure / low_confidence …），
 *   两者永不相等 ⇒ autoIssues 恒空、unknownIssues 恒非空，分层结论整体反向：
 *     · 真缺元素的题 → 被当「未知 code」拦卷（与「系统侧缺项自动放行」相反）；
 *     · 完整但低置信的题 → issues=[] → 走「系统性漏入」自动放行
 *       （与「low_confidence 永不自动放行」的红线相反）。
 *
 * 本锁盯住「别再退回去传中文文案」。行为级判据在 test/wrongGateTier.test.mjs。
 *
 * 另锁：欠账留痕（gate_auto_skipped / 待补清单）的 SQL LATERAL 必须只认「带 skipReason
 * 的 judgement」—— 否则任何后续重判流水都会把欠账顶掉（2026-10-10 同批修复）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { anchoredSlice } from './sourceLockKit.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STORE = 'src/workbench/stores/reviewStore.js'
const TOPBAR = 'src/workbench/components/review/ReviewTopBar.vue'

const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')

test('★ store 把 code 喂给门禁分层，不再传中文 issues', () => {
  const src = read(STORE)
  const fails = []
  const seg = anchoredSlice(
    src,
    'const rawUnresolvedWrongQuestions = computed(',
    1600,
    STORE,
    fails
  )
  assert.deepEqual(fails, [], fails.join('\n'))
  assert.ok(seg, '未切到 rawUnresolvedWrongQuestions 片段')

  // 必须把机器码放进清单项
  assert.match(seg, /\bcodes\b/, '门禁清单项必须带 codes 字段（机器码）')
  // 必须优先用后端算好的 wrong_book_risks（含 low_confidence）
  assert.match(seg, /wrong_book_risks/, '必须优先用后端 wrong_book_risks 作为 codes')
  // ⛔ 不得再把 checkQuestionCompleteness().issues（中文）当判据传进去
  assert.ok(
    !/const\s*\{\s*isComplete\s*,\s*issues\s*\}\s*=\s*checkQuestionCompleteness/.test(seg),
    '不得再把中文 issues 传进门禁清单 —— 这正是 2026-10-10 的 bug'
  )
})

test('★ 顶栏徽标标签走共享的 code→中文口径（含低置信）', () => {
  const src = read(TOPBAR)
  const fails = []
  const seg = anchoredSlice(src, 'const gateIssueLabels = (q) =>', 600, TOPBAR, fails)
  assert.deepEqual(fails, [], fails.join('\n'))
  assert.ok(seg, '未切到 gateIssueLabels 片段')
  assert.match(seg, /WRONG_GATE_CODE_LABELS/, '标签必须复用 wrongGateTier.js 的共享口径')
  // 徽标可能含低置信（历史误放行存量），标签必须覆盖它 —— 共享表里有，这里只锁「用了共享表」
})

test('★ 顶栏徽标文案不再无条件写「缺元素」', () => {
  const src = read(TOPBAR)
  const fails = []
  const seg = anchoredSlice(src, 'const gateSkipBadgeLabel = computed(', 700, TOPBAR, fails)
  assert.deepEqual(fails, [], fails.join('\n'))
  assert.ok(seg, '未切到 gateSkipBadgeLabel 片段')
  assert.match(seg, /未入册/, '非缺元素时应写中性的「未入册」')
})

test('★ 欠账留痕只认「带 skipReason 的 judgement」，不被后续重判流水顶掉', () => {
  // 2026-10-10 修复：LATERAL 原先取「最新一条 judgement」，任何后续 pc_rejudge /
  // pc_recompute_answer 都会把自动放行留痕顶掉 → 题仍欠账却从徽标/待补清单消失。
  // 现在四处查询都必须过滤 `metadata ? 'skipReason'`（只认错题跳过决定）。
  const SITES = {
    'server/index.js': 2,                       // GET /questions/task/:id + gate-pending
    'server/services/wrongGateRequeue.js': 2,   // fetchLatestSkipMeta + SWEEP_SELECT
  }
  for (const [f, min] of Object.entries(SITES)) {
    const n = (read(f).match(/metadata\s*\?\s*'skipReason'/g) || []).length
    assert.ok(n >= min, `${f} 的欠账 LATERAL 必须过滤 metadata ? 'skipReason'（期望 ≥${min} 处，实际 ${n} 处）`)
  }
})
