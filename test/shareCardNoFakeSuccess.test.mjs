/**
 * 分享卡：取数失败时必须明确失败，绝不能渲染出一张「孩子这周什么都没做」的假卡
 *
 * 缺陷来源（2026-10-04 实测确认，非推测）：
 *   server/routes/weeklyReport.js 的异常分支返回 `{ student, stats: null, error }`，
 *   **不抛错**。server/routes/shareCard.js 原先只try/catch 抛错路径，
 *   于是取数失败时 reportData.error 存在却继续往下渲染，
 *   最终返回 **HTTP 200 + 一张 PNG**。
 *   后果链：老师看到「生成成功」→ 转发给家长 → 家长看到「孩子这周什么都没做」。
 *   报错老师会重试，**错误数据会被当真**——后者严重得多。
 *
 * 修法：后端在渲染前检查 reportData.error 并返回 503。
 * 前端 GrowthCardButton.vue 已有 `!resp.ok → throw + ElMessage.error` 分支，
 * 因此**前端无需改动**。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHARE_CARD = readFileSync(path.join(ROOT, 'server/routes/shareCard.js'), 'utf8')
const WEEKLY = readFileSync(path.join(ROOT, 'server/routes/weeklyReport.js'), 'utf8')
const TEMPLATE = readFileSync(path.join(ROOT, 'server/services/shareCardTemplate.js'), 'utf8')

test('分享卡：取数失败时必须返回错误，不得渲染出图片', () => {
  // 渲染之前必须先判error，这是本锁的核心
  const errIdx = SHARE_CARD.indexOf('reportData.error')
  // ⚠️ 必须用 `await generateShareCardPNG(` 定位真正的**调用**；
  // 只搜函数名会命中文件顶部的 import 语句（位置远在前面），那是假判据。
  //    2026-10-04 我第一次就写成了 indexOf('generateShareCardPNG')，判红后一查代码才发现是锁错了。
  const renderIdx = SHARE_CARD.indexOf('await generateShareCardPNG(')
  assert.ok(errIdx > -1, 'shareCard.js 必须检查 reportData.error —— 取数失败时不得继续渲染')
  assert.ok(renderIdx > -1, '找不到 `await generateShareCardPNG(` 渲染调用（是否被误改了？）')
  assert.ok(errIdx < renderIdx,
    `检查 reportData.error（位置 ${errIdx}）必须在渲染调用（位置 ${renderIdx}）之前，`
    + '否则拦截形同虚设')

  // 且必须真的中断（return res.status(...)），不能只是打个日志继续走
  const guard = SHARE_CARD.slice(errIdx, errIdx + 600)
  assert.match(guard, /return\s+res\.status\(\s*5\d\d\s*\)/,
    '拦截后必须 return 一个 5xx，不能只 console.error 就继续渲染')
})

test('拦截时给的是人话提示，且不把内部错误原文当主文案', () => {
  const errIdx = SHARE_CARD.indexOf('reportData.error')
  const guard = SHARE_CARD.slice(errIdx, errIdx + 600)
  assert.match(guard, /error:\s*'[^']*请稍后重试/,
    '必须给老师一句能照做的提示（含「稍后重试」），而不是只丢一个技术错误码')
  assert.match(guard, /detail:/,
    '内部错误原文应放在 detail 里供排障，不应占据主文案')
})

test('上游确实仍以 error 字段表达取数失败（本锁的前提）', () => {
  // 若上游改成抛错而不是返回 error，本拦截就成了永不触发的死代码，需要重新评估
  assert.match(WEEKLY, /stats:\s*null/,
    'weeklyReport.js 已不再返回 stats:null —— 若它改成抛错，请重新评估本锁是否还有效')
  assert.match(WEEKLY, /error:\s*e\.message/,
    'weeklyReport.js 不再把错误放进 error 字段，请重新评估 shareCard 的拦截条件')
})

test('模板仍保留「暂无数据」降级（双保险：万一将来有别的调用方漏判 error）', () => {
  // shareCard.js 拦住了主路径，但模板的兜底不能被顺手删掉：
  // 万一将来新增第二个渲染入口忘了判 error，至少不会崩、且会显示「暂无数据」。
  assert.match(TEMPLATE, /暂无数据/,
    '模板的「暂无数据」降级提示被删了 —— 它是第二道防线')
})

test('成功路径未被破坏：仍需正常渲染并返回 PNG', () => {
  assert.match(SHARE_CARD, /generateShareCardPNG\(reportData/,
    '正常渲染调用被误改了')
  assert.match(SHARE_CARD, /Content-Type',\s*'image\/png'/,
    '成功时仍应返回 PNG —— 本修复不得把分享卡整体弄坏')
  // 404 分支（学生不存在）必须保留在原位
  assert.match(SHARE_CARD, /statusCode === 404[\s\S]{0,120}学生不存在/,
    '「学生不存在」的 404 分支被破坏了')
})