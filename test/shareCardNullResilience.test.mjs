// 家长分享卡：数据缺失时必须优雅降级，不能整体崩掉（第 19 轮）
//
// 真实故障链（2026-10-04 实测确认，非推测）：
//   1. `server/routes/weeklyReport.js` 的 catch 分支返回 `{ student, stats: null, error }`
//      ——取数失败时**不抛错**，而是把 stats 置空；
//   2. `buildShareCardHTML` 原先写的是解构默认值 `stats = {}`，
//      但 **JS 的解构默认值只对 undefined 生效，对 null 不生效**（`{a = 1} = {a: null}` 得 null）；
//   3. 于是 `num(stats.totalTasks)` 抛
//      「Cannot read properties of null (reading 'totalTasks')」；
//   4. 分享卡接口整体 500 —— 老师点"生成分享卡"直接报错，看起来像功能坏了，
//      其实只是那一次数据库查询失败。
//
// 本锁把"取数失败"钉死为「显示暂无数据」而不是「整体 500」，同时禁止
// 退回到写 `stats = {}` 这种只挡 undefined 的写法。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildShareCardHTML } from '../server/services/shareCardTemplate.js'

const OK_DATA = {
  student: { name: '测试', grade: '初二' },
  period: { mode: 'week' },
  stats: {
    totalTasks: 2, completedTasks: 2, totalQuestions: 10, correctCount: 8,
    wrongCount: 2, accuracy: 80, newWrongCount: 1, masteredCount: 1, pendingCount: 2,
  },
}

/** 渲染并返回 { html, 崩了没, 有没有脏文案 } */
function render(data) {
  try {
    const html = buildShareCardHTML(data, { maskName: false })
    const dirty = ['undefined', 'NaN', '[object'].filter((w) => html.includes(w))
    return { html, threw: null, dirty }
  } catch (e) {
    return { html: '', threw: e.message, dirty: [] }
  }
}

test('正常数据必须正常渲染（别把好路径改坏）', () => {
  const r = render(OK_DATA)
  assert.equal(r.threw, null, `正常数据竟崩了：${r.threw}`)
  assert.deepEqual(r.dirty, [], `正常数据渲染出脏文案：${r.dirty.join(' / ')}`)
})

test('stats 为 null（取数失败的真实形态）不得崩，且要显示"暂无数据"语义', () => {
  const r = render({ student: { name: '测试' }, period: { mode: 'week' }, stats: null, error: 'DB 炸了' })
  assert.equal(r.threw, null, `stats=null 仍然崩了：${r.threw}（这是本锁要修的那个 bug）`)
  assert.deepEqual(r.dirty, [], `降级输出里出现脏文案：${r.dirty.join(' / ')}`)
  // 必须真的给出"没数据"的提示，而不是画一张全是 0 的卡让家长误以为孩子没做题
  assert.ok(/起步|暂无|先完成|还没有/.test(r.html),
    '降级后既没崩也没提示，等于把"取数失败"伪装成"孩子没数据"，家长会被误导')
})

test('period / student / 两个数组为 null 都要兜住', () => {
  for (const [label, data] of [
    ['period=null', { student: { name: 'x' }, period: null, stats: OK_DATA.stats }],
    ['student=null', { student: null, period: { mode: 'week' }, stats: OK_DATA.stats }],
    ['两数组=null', { ...OK_DATA, subjectDiagnosis: null, dailyTrend: null }],
  ]) {
    const r = render(data)
    assert.equal(r.threw, null, `${label} 崩了：${r.threw}`)
    assert.deepEqual(r.dirty, [], `${label} 出现脏文案：${r.dirty.join(' / ')}`)
  }
})

test('整体传 undefined / 空对象也要兜住', () => {
  for (const [label, data] of [['undefined', undefined], ['空对象', {}]]) {
    const r = render(data)
    assert.equal(r.threw, null, `${label} 崩了：${r.threw}`)
    assert.deepEqual(r.dirty, [], `${label} 出现脏文案：${r.dirty.join(' / ')}`)
  }
})

test('源码不得退回「只挡 undefined」的解构默认值写法', () => {
  // 这是本 bug 的根因形态：解构默认值对 null 无效，必须显式 `|| {}` 兜底
  const src = readFileSync(new URL('../server/services/shareCardTemplate.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /stats\s*=\s*\{\}/,
    '又写回 `stats = {}` 了 —— 它挡不住 null，正是本 bug 的根因')
  assert.doesNotMatch(src, /period\s*=\s*\{\}/, '`period = {}` 同样挡不住 null')
  assert.doesNotMatch(src, /student\s*=\s*\{\}/, '`student = {}` 同样挡不住 null')
  assert.match(src, /rawStats\s*\|\|\s*\{\}/, '缺 `|| {}` 兜底，取数失败会再次 500')
})

test('weeklyReport 的异常分支确实会返回 stats:null（本锁守的就是这条链路）', () => {
  const src = readFileSync(new URL('../server/routes/weeklyReport.js', import.meta.url), 'utf8')
  assert.match(src, /stats:\s*null/,
    'weeklyReport 已不再返回 stats:null ⇒ 本锁的前提变了，请重新评估是否还需要，并同步更新本测试')
})
