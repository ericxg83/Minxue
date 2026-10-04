/**
 * 回归锁：家长分享卡「空周期」文案必须区分老学生 / 新学生（r133，2026-10-05）
 *
 * 起因（实测，非推理）：2026-10-05 01:1x 拿真实数据出图肉眼验家长分享卡，
 *   - 「本周」（10/04~10/11，周一）21/21 名学生 totalQuestions 全是 0；
 *   - 卡片一律输出老师寄语「学习记录刚起步，先完成一次作业，成长就会被看见！」
 *   - 但陆晨曦累计已批 **298 题、正确率 77.5%**，家长收到的却是"孩子刚起步"。
 * 分享卡是老师**唯一转发给家长**的输出物，一句说反的寄语家长会当真。
 *
 * 判据：
 *   - 模板是纯函数 ⇒ **真跑渲染、断言输出的 HTML**，不是源码 grep。
 *   - 反向自检用**内联合成坏样本**（旧版寄语原文 + 旧版零数据卡片），
 *     不依赖 git（⛔ Windows 上 spawnSync 调 git 会 EBUSY；旧树每轮重导也会误报）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
readFileSync(resolve(ROOT, 'server/services/shareCardTemplate.js'), 'utf8') // 保证文件存在

const { buildShareCardHTML } = await import('../server/services/shareCardTemplate.js')

/** 零数据周样本（照抄真实 payload 形状：本周 0 题 + 上一周期有数据） */
const zeroWeek = (extra = {}) => ({
  student: { name: '陆晨曦', grade: '六年级' },
  period: { mode: 'week', offset: 0, start: '2026-10-04', end: '2026-10-11' },
  stats: {
    totalTasks: 0, completedTasks: 0, totalQuestions: 0, correctCount: 0,
    wrongCount: 0, accuracy: 0, newWrongCount: 0,
    masteredCount: 0, basicMasteredCount: 0, notStartedCount: 0,
    practicedCount: 0, repeatWrongCount: 0, pendingCount: 0
  },
  subjectDiagnosis: [], dailyTrend: [], prev: null, retryProgress: null,
  knowledgeDiagnosis: [],
  ...extra
})

/** 有数据周样本（回归：正常卡片不能被空周期文案污染） */
const activeWeek = {
  student: { name: '陆晨曦', grade: '六年级' },
  period: { mode: 'week', offset: 0, start: '2026-09-27', end: '2026-10-04' },
  stats: {
    totalTasks: 1, completedTasks: 1, totalQuestions: 298, correctCount: 231,
    wrongCount: 67, accuracy: 77.5, newWrongCount: 74,
    masteredCount: 2, basicMasteredCount: 14, notStartedCount: 58,
    practicedCount: 3, repeatWrongCount: 0, pendingCount: 72
  },
  subjectDiagnosis: [], dailyTrend: [], prev: null, retryProgress: null,
  knowledgeDiagnosis: [], hasEverGraded: true
}

/** 从渲染 HTML 里抽出「老师寄语」正文（.comment-d） */
function commentOf(html) {
  const m = html.match(/class="comment-d">([^<]*)<\/div>/)
  return m ? m[1].trim() : ''
}

test('⛔ 老学生的空周期卡片，不许再说「学习记录刚起步」', () => {
  const html = buildShareCardHTML(zeroWeek({ hasEverGraded: true }), {})
  const c = commentOf(html)
  assert.ok(c, '没渲染出老师寄语')
  assert.equal(
    c.includes('学习记录刚起步'), false,
    `老学生（累计已批 298 题）的空周期卡片还在说「刚起步」→「${c}」`
  )
})

test('✅ 老学生的空周期卡片，要说「还没有新的批改记录」', () => {
  const c = commentOf(buildShareCardHTML(zeroWeek({ hasEverGraded: true }), {}))
  assert.ok(c.includes('还没有新的批改记录'), `实际寄语：「${c}」`)
})

test('✅ 往期（offset>0）空卡片，不说「还没有新的」，改说「没有批改记录」', () => {
  const p = { mode: 'week', offset: 1, start: '2026-09-27', end: '2026-10-04' }
  const c = commentOf(buildShareCardHTML(zeroWeek({ period: p, hasEverGraded: true }), {}))
  assert.equal(c.includes('还没有新的'), false, `往期卡片不该说"还没有新的" →「${c}」`)
  assert.ok(c.includes('没有批改记录'), `实际寄语：「${c}」`)
})

test('✅ 真·新学生（从未被批改过）保留新学生话术', () => {
  const c = commentOf(buildShareCardHTML(zeroWeek({ hasEverGraded: false }), {}))
  assert.ok(c.includes('学习记录刚起步'), `新学生应保留鼓励话术 →「${c}」`)
})

test('⛔ 字段缺失时必须按「有历史」处理，宁可少给鼓励也不能把老学生说成刚起步', () => {
  // 老 payload 没有 hasEverGraded（比如前端另造的样本、或老接口缓存）
  const c = commentOf(buildShareCardHTML(zeroWeek(), {}))
  assert.equal(c.includes('学习记录刚起步'), false, `缺省分支说成了新学生话术 →「${c}」`)
})

test('✅ 有数据的卡片不受影响（回归）', () => {
  const c = commentOf(buildShareCardHTML(activeWeek, {}))
  assert.ok(c.includes('77.5'), `正常卡片应该带真实正确率 →「${c}」`)
  assert.equal(c.includes('学习记录刚起步'), false, `正常卡片不该走空周期分支 →「${c}」`)
})

// ─────────────────── 反向自检：旧版样本必须判红 ───────────────────
// 内联合成坏样本，不依赖 git 历史（⛔ spawnSync 调 git 在 Windows 上 EBUSY）。
// 「判据是否真的生效」靠两条独立路径验证：
//   ① 上面 6 条正向断言（旧树喂进去必然红，下面 inline 旧输出实测一次）；
//   ② 下面这条把旧版寄语原文当成渲染结果喂给同一个提取器，确认提取器能抓到它。
test('🔁 反向自检：旧版零数据寄语原文会被本测试判据认出来', () => {
  const legacy = '<div class="comment"><div class="comment-t">老师寄语</div>' +
    '<div class="comment-d">学习记录刚起步，先完成一次作业，成长就会被看见！</div></div>'
  const c = commentOf(legacy)
  assert.ok(c.includes('学习记录刚起步'), '提取器没抓到旧版寄语，判据形同虚设')
  assert.equal(c.includes('还没有新的批改记录'), false, '旧版本就没有这句，判据不该命中')
  // 与正向断言形成闭环：新树的这句话，旧树上必然不存在
  assert.notEqual(
    commentOf(buildShareCardHTML(zeroWeek({ hasEverGraded: true }), {})).includes('还没有新的批改记录'),
    c.includes('还没有新的批改记录')
  )
})
