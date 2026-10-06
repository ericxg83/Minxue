/**
 * 回归锁：周报的「周期用词」必须随 mode 走（r212，2026-10-06）
 *
 * 起因（实测，非推理）：周报的两处消费方各自抄了一份同样的文案函数，写法都是
 *     const periodWord = mode === 'month' ? '本月' : '本周'
 * 第三个分支把 **'all'（全部时间，跨数月/数年）也当成了周** ——
 * 于是选「全部」时，同一份材料自相矛盾：
 *   · 周报 PDF：封面印「学习周期：全部记录」，正文却写「本周学习概览 / 本周记录题量 /
 *     本周暂无薄弱知识点 / 学生 - 本周错题再测」；
 *   · 移动端周报页：顶部选择器写着「全部时间」，卡片标题却写「本周学习概览 / 本周高频薄弱点」。
 * 而周报 PDF 是老师**转发给家长**的输出物。（家长分享卡的同款缺陷已由 r211 在服务端修掉，
 * 这里是它的另一半。）
 *
 * 判据分两层：
 *   1) **口径本身**：`src/utils/reportPeriodWord.js` 是纯函数 ⇒ 直接 import 真跑，不是源码 grep；
 *   2) **接线**：两个消费方必须 import 这个共享口径、且代码里不得再硬编码那批旧文案。
 *      （r167 教训：注释里会引用旧写法当反面教材 ⇒ 匹配前先剔掉整行注释。）
 *
 * 反向自检内联合成坏样本（不依赖 git），保证这把锁不是「空转永远绿」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const { periodWord } = await import('../src/utils/reportPeriodWord.js')

// ── 1. 口径本身（纯函数，真跑）──────────────────────────────────────────
test('周期词：周模式 →「本周」', () => {
  assert.equal(periodWord('week'), '本周')
})

test('周期词：月模式 →「本月」', () => {
  assert.equal(periodWord('month'), '本月')
})

test('周期词：全部时间 →「这段时间」（⛔ 不许退回「本周」）', () => {
  assert.equal(periodWord('all'), '这段时间')
})

test('周期词：未知/缺失 mode 兜底「本周」而不是空串（偏窄不说错）', () => {
  assert.equal(periodWord('weird怪'), '本周')
  assert.equal(periodWord(undefined), '本周')
  assert.equal(periodWord(''), '本周')
})

// ── 2. 接线：消费方必须走共享口径，且不得再硬编码旧文案 ─────────────────
const CONSUMERS = [
  { file: 'src/utils/weeklyReportGenerator.js', importFrom: "'./reportPeriodWord'", minCalls: 4 },
  { file: 'src/pages/WeeklyReport/index.jsx', importFrom: "'../../utils/reportPeriodWord'", minCalls: 3 }
]

/** 旧写法在长周期上说错的那批文案：出现在**代码**里即判红 */
const BANNED = [
  '本周学习概览', '本周记录题量', '本周暂无薄弱知识点', '本周暂无明确薄弱知识点',
  '本周错题再测', '本周学习态度', '本周作业完成', '本周高频薄弱点', '本周暂无学习数据'
]

/** 剔掉整行注释（行首 `*` / `//` / `/*` / `{/*`），避免把反面教材当违规代码 */
function codeLines(src) {
  return src
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim()
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('{/*'))
    })
    .join('\n')
}

/** 返回违规清单（空数组 = 通过）。抽成纯函数，便于喂合成坏样本做反向自检。 */
function wiringViolations(src, importFrom) {
  const fails = []
  const code = codeLines(src)
  if (!src.includes(`from ${importFrom}`)) fails.push(`未从 ${importFrom} 引入周期词口径`)
  const calls = (code.match(/periodWord\s*\(/g) || []).length
  if (calls < 1) fails.push('代码里没有任何 periodWord(...) 调用')
  for (const b of BANNED) if (code.includes(b)) fails.push(`仍在硬编码「${b}」`)
  return { fails, calls }
}

for (const c of CONSUMERS) {
  test(`接线：${c.file} 走共享周期词、无硬编码旧文案`, () => {
    const { fails, calls } = wiringViolations(read(c.file), c.importFrom)
    assert.deepEqual(fails, [], fails.join('；'))
    // 槽位数下限：防止「改回去一半」——只留一处调用、其余槽位又硬编码
    assert.ok(
      calls >= c.minCalls,
      `${c.file} 只有 ${calls} 处 periodWord 调用，少于本轮改造的 ${c.minCalls} 个槽位`
    )
  })
}

// ── 3. 反向自检（内联合成样本，不依赖 git）────────────────────────────
test('反向自检：旧写法样本必须被判红（否则这把锁是空转）', () => {
  const oldSample = `
import x from './x'
function buildTeacherComment(stats) {
  return '本周学习态度认真，作业完成情况良好'
}
const title = '<div class="sec-title">本周学习概览</div>'
const kpi = '<div class="kpi-l">本周记录题量</div>'
const empty = '本周暂无薄弱知识点'
const exam = studentName + ' - 本周错题再测'
`
  const { fails } = wiringViolations(oldSample, "'./reportPeriodWord'")
  assert.ok(fails.length >= 4, `坏样本只报了 ${fails.length} 条：${fails.join('；')}`)
})

test('反向自检：注释里的旧文案不算违规（否则锁会把反面教材判红）', () => {
  const commented = `
import { periodWord } from './reportPeriodWord'
// 旧写法是 '本周学习概览'，已于 r212 废弃
/** 不要再写 本周记录题量 / 本周暂无薄弱知识点 */
const t = periodWord(mode) + '学习概览'
const u = periodWord(mode) + '记录题量'
const v = periodWord(mode) + '暂无薄弱知识点'
const w = periodWord(mode) + '错题再测'
`
  const { fails } = wiringViolations(commented, "'./reportPeriodWord'")
  assert.deepEqual(fails, [], fails.join('；'))
})
