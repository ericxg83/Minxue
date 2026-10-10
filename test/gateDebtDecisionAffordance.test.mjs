/**
 * 回归锁：闸1「待补入」欠账必须有**可操作的拍板出口**（2026-10-10）
 *
 * ── 事故（负责人实测截图）──
 * 顶栏「⚠ 待补入 2」→ 弹窗里两条「低置信 0.70/0.60 · 需拍板」→ 点「去定位」→
 * 跳到那道题，右侧**只有**「本卷 19 题已全部确认 / 完成复核 / 下一份」，
 * 老师原话：「只有复核？你让我做什么？」「他的元素都合格啊，为什么要补入？」
 *
 * 两个独立缺陷叠在一起：
 *   ① 分层判据喂了中文文案而不是机器 code ⇒ 元素完整但低置信的题 codes=[] ⇒
 *      被判「系统性漏入」自动放行（应拦卷让老师拍板）。修在 wrongGateTier.js /
 *      reviewStore.js，由 test/wrongGateCodesNotLabels.test.mjs 盯。
 *   ② **本锁盯的**：欠账清单把老师送到题前，却没给出口 —— 全卷已确认时
 *      QuestionDetailPanel 的判定区被换成完成态，标对/标错按钮消失，
 *      这道题的欠账永远清不掉（它不在「待处理」里，needsHumanAttention 对它为 false）。
 *
 * 本锁守的红线：**「全卷已确认」不得吞掉「还欠一次拍板」的题的判定区。**
 * 判据必须挂在闸1 欠账的唯一口径上（store.gateSkippedQuestions ← 后端
 * gate_auto_skipped ← server/utils/wrongGateRequeue.js#isGateAutoSkippedRow），
 * 不得另立一套「哪些题还欠账」的算法。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { anchoredSlice, anchoredRange, includesLit } from './sourceLockKit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PANEL = resolve(HERE, '../src/workbench/components/review/QuestionDetailPanel.vue')
const LABEL = '闸1 欠账拍板出口'

/** 把「完成态不得吞掉判定区」这条判据套在任意一份 QuestionDetailPanel 源码上 */
const auditPanel = (src) => {
  const fails = []

  // ① 完成态的条件里必须带上「当前题不欠账」
  const completeBlock = anchoredRange(
    src,
    '<!-- [P0-1 完成引导 2026-09-27]',
    'class="ops-buttons-primary ops-complete-state"',
    LABEL,
    fails
  )
  if (completeBlock !== null && !completeBlock.includes('!currentQIsGateDebt')) {
    fails.push(`${LABEL}：完成态没有排除「当前题还欠一次拍板」⇒ 老师点「去定位」跳过来无事可做`)
  }

  // ② 欠账判据必须来自闸1 的唯一口径（store.gateSkippedQuestions），不得另算一套
  const debtComputed = anchoredRange(
    src,
    'const currentQIsGateDebt = computed(',
    'watch(() => q.value?.review_status',
    LABEL,
    fails
  )
  if (debtComputed !== null && !debtComputed.includes('store.gateSkippedQuestions')) {
    fails.push(`${LABEL}：currentQIsGateDebt 没挂在 store.gateSkippedQuestions（闸1 欠账唯一口径）上`)
  }

  // ③ 必须在页面上把「该做什么」用人话写出来（只给按钮、不说原因，等于没修）
  const hint = anchoredSlice(src, '这题被系统按「本次不加入」放行了', 160, LABEL, fails)
  if (hint !== null && !(hint.includes('标错') && hint.includes('标对'))) {
    fails.push(`${LABEL}：提示语没有说清「标错＝加入错题本 / 标对＝本题翻篇」`)
  }

  // ④ 拍板后本地要即时摘掉欠账（否则徽标仍显示 2，老师以为没生效）
  const watcher = anchoredSlice(src, 'watch(() => q.value?.review_status', 520, LABEL, fails)
  if (watcher !== null) {
    if (!watcher.includes('gate_auto_skipped')) {
      fails.push(`${LABEL}：拍板后没清 gate_auto_skipped ⇒ 卷内 ⚠ 标识不会消失`)
    }
    if (!watcher.includes('removeGatePendingItem')) {
      fails.push(`${LABEL}：拍板后没从待补入清单摘掉 ⇒ 顶栏「待补入 N」不会减`)
    }
  }

  return fails
}

test('★ QuestionDetailPanel：全卷已确认时，仍欠账的题必须保留标对/标错出口', () => {
  const src = readFileSync(PANEL, 'utf8')
  assert.deepEqual(auditPanel(src), [], '闸1 欠账拍板出口的判据被破坏')
})

test('★ 反向自检：修复前的形态（完成态无条件吞掉判定区）必须判红', () => {
  // 合成「修复前」的最小样本：只有完成态、没有 currentQIsGateDebt 这一层
  const before = [
    '<template>',
    '  <!-- [P0-1 完成引导 2026-09-27] 全卷已确认时判定区切换为完成态 -->',
    '  <div v-if="allConfirmed" class="ops-buttons-primary ops-complete-state">',
    '    <span>本卷 19 题已全部确认</span>',
    '  </div>',
    '</template>',
    '<script setup>',
    'const currentQIsGateDebt = computed(() => true)',
    'watch(() => q.value?.review_status, () => {})',
    '</script>'
  ].join('\n')
  const fails = auditPanel(before)
  assert.ok(fails.length > 0, '旧形态居然通过了 —— 这把锁是空锁')
  assert.ok(
    fails.some(f => f.includes('完成态没有排除')),
    `旧形态应命中「完成态没有排除」，实际：${JSON.stringify(fails)}`
  )
})

test('★ 反向自检：欠账判据另算一套（不挂 gateSkippedQuestions）必须判红', () => {
  const src = readFileSync(PANEL, 'utf8')
  const tampered = src.replace(
    'return store.gateSkippedQuestions.some(({ q: gq }) => gq.id === id)',
    'return (q.value?.review_status === "wrong_no_book")'
  )
  assert.notEqual(tampered, src, '篡改没生效，样本已过期')
  const fails = auditPanel(tampered)
  assert.ok(
    fails.some(f => f.includes('唯一口径')),
    `另立一套欠账算法应被判红，实际：${JSON.stringify(fails)}`
  )
})

test('★ 反向自检：提示语缺「标错/标对」说明必须判红', () => {
  const src = readFileSync(PANEL, 'utf8')
  // 只抹掉「该做什么」的那半句，保留锚点 —— 否则判红的是「锚点不在」，
  // 就证不到「提示语退化」这条判据本身（锁的靶心会偏）。
  const tampered = src.replace('标错＝加入错题本，标对＝本题翻篇', '请处理')
  assert.notEqual(tampered, src, '篡改没生效，样本已过期')
  const fails = auditPanel(tampered)
  assert.ok(
    fails.some(f => f.includes('没有说清')),
    `提示语退化应被判红，实际：${JSON.stringify(fails)}`
  )
})

test('★ 闸1 欠账判据仍是后端唯一口径（gate_auto_skipped ← isGateAutoSkippedRow）', () => {
  const store = readFileSync(resolve(HERE, '../src/workbench/stores/reviewStore.js'), 'utf8')
  assert.ok(
    includesLit(store, 'q.gate_auto_skipped === true'),
    'gateSkippedQuestions 不再认 gate_auto_skipped —— 本锁盯的口径已漂移，请同步'
  )
})
