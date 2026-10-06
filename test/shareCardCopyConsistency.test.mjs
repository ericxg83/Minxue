/**
 * 回归锁：家长分享卡「同一个数字不许有两个叫法」（r217，2026-10-06）
 *
 * 起因（实测，非推理）：`shareCardTemplate.js` 对比块（「较上一周期」）里这一项
 *   compareItem('完成题量', s.totalQuestions, ...)
 * 读的是 **`s.totalQuestions`，和顶部 KPI「批改题量」完全同一个字段**
 * （顶部 :502 是 `<div class="kpi-l">批改题量</div>`）——
 * 于是同一张卡上会出现「批改题量 176 题」（顶部）和「完成题量 +12 题」（对比块）。
 * 家长看到两个词、一个数字，分不清是同一个数还是两个数；老师自己也说不清哪个是准的。
 * 这是**家长可见产出物的文案自相矛盾**（第 3 层优先级：说人话），不涉及任何取值口径变化。
 *
 * 判据分层（避免「只数判据条数」的假绿，见 r198/r215/r216 教训）：
 *   1) **行为锁（真跑渲染）**：有 prev 数据时对比块必须出现「批改题量」。
 *   2) **反向行为锁**：同一张卡的 HTML 里「完成题量」这个别名必须 **0 次**出现
 *      —— 别名哪怕从别处复活（比如以后又写死进模板串）也能抓到。
 *   3) **同源锁**：源码里「顶部 KPI 标签」与「对比块标签」必须**逐字相同**。
 *      这条不依赖渲染：哪天有人把顶部改成别的词、或把对比块换成第三个词，都会红。
 *      两处同时被改成同一个新词时判据 1/2 会红，形成两层互补。
 *   4) **自证钩子**：本文件必须真的写着被检查的那几个字面量
 *      （r213/r198 踩过「判据写错一个字 ⇒ 假通过」的坑，元判据本身也要能被验）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = resolve(ROOT, 'server/services/shareCardTemplate.js')
const src = readFileSync(SRC, 'utf8')

const { buildShareCardHTML } = await import('../server/services/shareCardTemplate.js')

/** 本文件自证用的字面量（改动时与下面判据必须同时可见） */
const ALIAS = '完成题量'
const CANON = '批改题量'

/**
 * 有「上一周期」数据的样本 —— 对比块才会渲染（hasCompare 要求 prev.stats.totalQuestions > 0）
 */
function sampleWithPrev() {
  return {
    student: { name: '陆晨曦', grade: '六年级' },
    period: { start: '2026-10-05', end: '2026-10-11', offset: 0, mode: 'week' },
    stats: {
      totalTasks: 4, completedTasks: 3,
      totalQuestions: 176, correctCount: 108, wrongCount: 68,
      accuracy: 61.4, newWrongCount: 41,
      masteredCount: 40, basicMasteredCount: 18, notStartedCount: 15,
      practicedCount: 3, repeatWrongCount: 0, pendingCount: 0
    },
    subjectDiagnosis: [
      { subject: '数学', accuracy: 63, topTags: [{ tag: '一元二次方程', wrongCount: 9, totalCount: 20, masteryLabel: '待加强' }] }
    ],
    dailyTrend: [],
    prev: {
      period: { start: '2026-09-28', end: '2026-10-04', offset: 1, mode: 'week' },
      // ⚠️ 上一周期必须真有题，否则 hasCompare 为假、对比块根本不渲染 ⇒ 锁会变空锁
      stats: {
        totalTasks: 3, completedTasks: 2,
        totalQuestions: 150, correctCount: 82, wrongCount: 68,
        accuracy: 54.7, newWrongCount: 38,
        masteredCount: 30, basicMasteredCount: 12, notStartedCount: 19,
        practicedCount: 2, repeatWrongCount: 0, pendingCount: 0
      }
    },
    retryProgress: null,
    hasEverGraded: true
  }
}

/** 抽「较上一周期」那一段（对比块）的文本 */
function compareBlockOf(html) {
  const i = html.indexOf('较上一周期')
  if (i < 0) return ''
  // ⚠️ 切片要够长：对比块有 4 项（正确率/新增错题/还在攻克/题量），短了会把后面的项截掉
  return html.slice(i, i + 5000)
}

test('⛔ 同一张卡不许出现「完成题量」这个别名（r217 实测统一）', () => {
  const html = buildShareCardHTML(sampleWithPrev(), {})
  assert.ok(html.includes('较上一周期'), '对比块没渲染 —— prev 样本不成立，锁会变空锁')
  assert.equal(
    html.includes(ALIAS),
    false,
    `卡上又出现别名「${ALIAS}」→ 同一个字段（totalQuestions）被起了两个名字`
  )
})

test('✅ 对比块里的题量标签是「批改题量」，与顶部 KPI 同词', () => {
  const block = compareBlockOf(buildShareCardHTML(sampleWithPrev(), {}))
  assert.ok(block.includes(CANON), `对比块里没有「${CANON}」：${block.slice(0, 300)}`)
})

test('✅ 顶部 KPI 的题量标签也是「批改题量」（两处同源）', () => {
  const html = buildShareCardHTML(sampleWithPrev(), {})
  assert.ok(html.includes(`class="kpi-l">${CANON}<`), '顶部 KPI 标签不是「批改题量」')
})

test('✅ 同源锁：源码里两个题量标签必须逐字相同', () => {
  // KPI 区全部小标题：`<div class="kpi-l">完成作业</div><div class="kpi-l">批改题量</div>...`
  // ⚠️ 别写 `class="kpi-l">([^<]*)题量<`：贪婪回退会把「批改题量」截成「批改」⇒ 假红
  const kpiLabels = [...src.matchAll(/class="kpi-l">([^<]+)<\/div>/g)].map((m) => m[1])
  assert.ok(kpiLabels.length >= 5, `KPI 标签抽不出来（${kpiLabels.length} 个），锁会变空锁`)
  // 「题量」这个量纲在 KPI 区**只能有一个叫法** —— 出现第二个别名就是同一个数字两个名字
  const kpiQty = kpiLabels.filter((t) => t.includes('题量'))
  assert.equal(kpiQty.length, 1, `KPI 区里「题量」叫法有 ${kpiQty.length} 种：${kpiQty.join(' / ')}`)
  // 对比项：`compareItem('批改题量', ...`
  const cmpM = src.match(/compareItem\(\s*'([^']*题量)'\s*,/)
  assert.ok(cmpM, '模板对比块没找到「compareItem(…题量…)」调用')
  assert.equal(
    kpiQty[0], cmpM[1],
    `同一个数字起了两个名字：KPI 叫「${kpiQty[0]}」，对比块叫「${cmpM[1]}」`
  )
  assert.equal(kpiQty[0], CANON, `题量标签改成了「${kpiQty[0]}」，请同步更新本锁的字面量`)
})

test('⛔ 自证钩子：本锁确实在查那两个名字（防止判据被改成永不触发）', () => {
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  assert.ok(self.includes(`'${ALIAS}'`), '本锁已不含别名检查，判据 1 会永远判绿')
  assert.ok(self.includes(`'${CANON}'`), '本锁已不含正名检查，判据 2/3 会永远判绿')
  assert.ok(/html\.includes\(ALIAS\)/.test(self), '别名检查没走真实渲染断言（退化为源码 grep 就会漏）')
})

test('✅ 行为保持：对比块的数字/涨跌/口径一行没动（只换了词）', () => {
  const block = compareBlockOf(buildShareCardHTML(sampleWithPrev(), {}))
  // 本期 176 vs 上期 150 ⇒ +26；正确率 61.4 vs 54.7 ⇒ +6.7
  assert.ok(block.includes('+26 题'), `对比块题量差值不对：${block.slice(0, 300)}`)
  assert.ok(block.includes('+6.7%'), `对比块正确率差值不对：${block.slice(0, 300)}`)
  // 新增错题 41 vs 38 ⇒ +3（**涨是坏事**，goodWhenUp=false ⇒ 判 bad/红）
  assert.ok(block.includes('+3 题'), `对比块新增错题差值不对：${block.slice(0, 300)}`)
  assert.ok(/新增错题[\s\S]{0,120}cmp-d bad/.test(block), '新增错题涨了却没标红（goodWhenUp 口径被动了）')
  // 还在攻克 15 vs 19 ⇒ -4（**降是好事** ⇒ good/绿）
  assert.ok(block.includes('-4 题'), `对比块还在攻克差值不对：${block.slice(0, 300)}`)
  assert.ok(block.includes('上周 150'), '对比块没带上周期原值，家长无从对照')
})
