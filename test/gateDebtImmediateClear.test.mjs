/**
 * 回归锁：拍板清欠账后，顶栏「⚠ 待补入 N」必须**当场归零**（2026-10-10）
 *
 * ── 事故（负责人 11:32 实测截图）──
 * 顶栏「⚠ 待补入 2」→ 老师在本卷把这两题标错（欠账其实已清：库里已入册、
 * gate_auto_skipped 已是 false）→ 再点「待补入」进去却是「没有待补入的题」。
 * 老师视角＝「角标说还有 2，点进去说没有，你到底哪句是真的？」
 *
 * ── 根因 ──
 * 摘欠账的 watcher 写在 QuestionDetailPanel 里，且以 `gate_auto_skipped === true`
 * 为**前置**：
 *   watch(() => q.value?.review_status, (status) => {
 *     if (!cur || cur.gate_auto_skipped !== true) return   // ← 拍板后恒成立，永远 return
 *     ...
 *   })
 * 而拍板成功后后端已把 gate_auto_skipped 置为 false（它已不再是「自动放行且未入册」）
 * ⇒ watcher 每一次都在第一行return，角标永不减，直到下次进页面才自然收敛。
 *
 * ── 本锁守的红线 ──
 * ① 摘欠账必须挂在**判定的唯一入口** store.reviewQuestion 上（鼠标点击 / 键盘 Space·X /
 *    误判归因弹窗三条路径都经过它），不得散落在组件里各写一份。
 * ② 必须在**写库成功后**清（.then 内）：写库失败会回滚 review_status，
 *    失败时清账＝界面显示「已清」而库里还在欠账，比不清更坏。
 * ③ 判据必须取**判定前**的 gate_auto_skipped（后置取值恒为 false，正是本bug 的成因）。
 * ④ 组件里不得再出现第二个摘账实现（铁律：同一件事只准一个实现）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { anchoredSlice, anchoredRange } from './sourceLockKit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const STORE = resolve(HERE, '../src/workbench/stores/reviewStore.js')
const PANEL = resolve(HERE, '../src/workbench/components/review/QuestionDetailPanel.vue')
const LABEL = '拍板清欠账后角标即时归零'

const audit = (storeSrc, panelSrc) => {
  const fails = []

  // ① 唯一实现：摘账必须挂在 reviewQuestion 内
  const inJudge = anchoredRange(
    storeSrc,
    'const reviewQuestion = (questionId, result, metadata = {}) => {',
    '// 仅写入 source_type',
    LABEL,
    fails
  )
  if (inJudge !== null) {
    // ③ 前置捕获：判据取判定前的 gate_auto_skipped（注释锚点定在捕获行之前）
    const capture = anchoredSlice(
      storeSrc,
      '[闸1 欠账即时清零',
      340,
      LABEL,
      fails
    )
    if (capture !== null) {
      if (!capture.includes('wasGateDebt = question.gate_auto_skipped === true')) {
        fails.push(`${LABEL}：欠账判据没在判定前捕获 wasGateDebt ⇒ 拍板后取值为 false，角标永不减`)
      }
      if (!capture.includes('判定「前」')) {
        fails.push(`${LABEL}：欠账判据的注释没写明「判定前取值」—— 后置取值恒 false 正是本bug 成因`)
      }
    }
    if (!inJudge.includes('wasGateDebt')) {
      fails.push(`${LABEL}：reviewQuestion 内没用 wasGateDebt⇒ 欠账题的角标不会被清`)
    }
    // ② 必须在写库成功后清：.then 块内
    const afterWrite = anchoredRange(
      storeSrc,
      'updateQuestionReviewStatus(questionId, result, metadata)',
      '.catch(e => {',
      LABEL,
      fails
    )
    if (afterWrite !== null) {
      const clearSeg = anchoredSlice(
        storeSrc,
        'if (wasGateDebt) {',
        320,
        LABEL,
        fails
      )
      if (clearSeg !== null) {
        if (!clearSeg.includes('removeGatePendingItem')) {
          fails.push(`${LABEL}：清账时没调 removeGatePendingItem ⇒ 顶栏「待补入 N」不会减`)
        }
        if (!clearSeg.includes('gate_auto_skipped = false')) {
          fails.push(`${LABEL}：清账时没清 gate_auto_skipped ⇒ 卷内 ⚠ 标识不会消失`)
        }
      }
      // 清账必须在 .then（写库成功）里，不能落在 .catch（写库失败会回滚）
      const clearIdx = storeSrc.indexOf('if (wasGateDebt) {')
      const catchIdx = storeSrc.indexOf('.catch(e => {', storeSrc.indexOf('updateQuestionReviewStatus(questionId'))
      if (clearIdx >= 0 && catchIdx >= 0 && clearIdx > catchIdx) {
        fails.push(`${LABEL}：清账写在写库失败分支之后 ⇒ 写库失败回滚后界面会说「已清」而库里仍欠账`)
      }
    }
  }

  // ④ 组件里不得再有第二个摘账实现
  if (panelSrc.includes('watch(() => q.value?.review_status')) {
    const w = anchoredSlice(panelSrc, 'watch(() => q.value?.review_status', 400, LABEL, fails)
    if (w !== null && w.includes('removeGatePendingItem')) {
      fails.push(`${LABEL}：QuestionDetailPanel 里还有第二个摘账实现 ⇒ 同一件事两个实现，且那个 watcher 因前置条件恒不生效`)
    }
  }

  return fails
}

test('★ reviewQuestion：拍板成功后即时清掉闸1 欠账（顶栏角标当场归零）', () => {
  const fails = audit(readFileSync(STORE, 'utf8'), readFileSync(PANEL, 'utf8'))
  assert.deepEqual(fails, [], '拍板清欠账的判据被破坏')
})

test('★ 反向自检：把捕获移到判定之后（后置取值恒 false）必须判红', () => {
  const src = readFileSync(STORE, 'utf8')
  // 模拟「 reintroduced 的错误写法」：判定前不捕获，改成判定后查
  const tampered = src
    .replace('const wasGateDebt = question.gate_auto_skipped === true', 'const _unused = 0')
    .replace('if (wasGateDebt) {', 'if (question.gate_auto_skipped === true) {')
  assert.notEqual(tampered, src, '篡改没生效，样本已过期')
  const fails = audit(tampered, readFileSync(PANEL, 'utf8'))
  assert.ok(
    fails.length > 0,
    '后置取值（恒 false）竟通过了—— 这把锁是空锁'
  )
})

test('★ 反向自检：把清账挪到写库失败分支之后必须判红', () => {
  const src = readFileSync(STORE, 'utf8')
  const start = src.indexOf('if (wasGateDebt) {')
  assert.ok(start >= 0, '锚点不在，样本已过期')
  const end = src.indexOf('}', src.indexOf('removeGatePendingItem(questionId)', start)) + 1
  const block = src.slice(start, end)
  const tampered = src.slice(0, start) + src.slice(end)
  // 插到 .catch 之后
  const catchAt = tampered.indexOf('.catch(e => {')
  const insertAt = tampered.indexOf('})', catchAt) + 2
  const out = tampered.slice(0, insertAt) + '\n' + block + '\n' + tampered.slice(insertAt)
  const fails = audit(out, readFileSync(PANEL, 'utf8'))
  assert.ok(
    fails.some(f => f.includes('写库失败')),
    `清账落在失败分支应被判红，实际：${JSON.stringify(fails)}`
  )
})

test('★ 反向自检：组件里复活第二个摘账实现必须判红', () => {
  const panel = readFileSync(PANEL, 'utf8')
  const tampered = panel.replace(
    'const currentQIsGateDebt = computed(() => {',
    `watch(() => q.value?.review_status, (status) => {
  const cur = q.value
  if (cur) { cur.gate_auto_skipped = false; store.removeGatePendingItem(cur.id) }
})
const currentQIsGateDebt = computed(() => {`
  )
  assert.notEqual(tampered, panel, '篡改没生效，样本已过期')
  const fails = audit(readFileSync(STORE, 'utf8'), tampered)
  assert.ok(
    fails.some(f => f.includes('第二个摘账实现')),
    `组件里复活第二实现应被判红，实际：${JSON.stringify(fails)}`
  )
})