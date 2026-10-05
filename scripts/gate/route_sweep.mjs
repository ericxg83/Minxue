/**
 * r106 全路由深扫：移动端 + 工作台全部路由，逐路由收集
 * 控制台错误 / 页面异常 / 失败请求（4xx-5xx）。
 * 跑法：node route_sweep.mjs [BASE]  （默认 http://127.0.0.1:5234）
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:5234'
const ROUTES = [
  // 移动端
  ['mobile:/', '/'],
  ['mobile:任务', '/tasks'],
  ['mobile:错题本', '/wrongbook'],
  ['mobile:组卷历史', '/exams'],
  // 工作台
  ['wb:工作台', '/workbench.html#/'],
  ['wb:批改中心', '/workbench.html#/grade'],
  ['wb:学习诊断', '/workbench.html#/weekly-report'],
  ['wb:学生列表', '/workbench.html#/students'],
  ['wb:学生档案', '/workbench.html#/students/bd31776e-6673-474c-ae1f-8a22d69cbd46'],
  ['wb:练习册管理', '/workbench.html#/worksheets'],
  ['wb:试卷答案库', '/workbench.html#/paper'],
  ['wb:老书签/handouts', '/workbench.html#/handouts'], // r137 「我的讲义」下线，本条改验 redirect 不白屏
  ['wb:周末班课件', '/workbench.html#/weekend-ppt'],
  ['wb:我的题型库', '/workbench.html#/question-bank'],
  ['wb:老书签/growth', '/workbench.html#/growth'],
  ['wb:老书签/wrongbook', '/workbench.html#/wrongbook'],
]

const browser = await chromium.launch({ headless: true })
const report = []

for (const [name, route] of ROUTES) {
  const page = await browser.newPage()
  const errors = []
  const bad = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 140)))
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 30000 })
    await page.waitForTimeout(3500)
  } catch (e) {
    errors.push('GOTO: ' + e.message.split('\n')[0])
  }
  report.push({ name, errors, bad })
  await page.close()
}
await browser.close()

let dirty = 0
for (const r of report) {
  const flag = (r.errors.length || r.bad.length) ? '🔴' : '🟢'
  if (flag === '🔴') dirty++
  console.log(`${flag} ${r.name}`)
  for (const e of [...new Set(r.errors)].slice(0, 3)) console.log(`     err: ${e}`)
  for (const b of [...new Set(r.bad)].slice(0, 3)) console.log(`     http: ${b}`)
}
console.log(`\n════ ${dirty}/${report.length} 路由有异常 ════`)
// r152：闸门必须「有脏即非零退出」。旧版只打印计数、恒退 0 ⇒ 任何人把它串进
// `&&` / 自动化都会被假绿放过（r111 曾出现 route_sweep 4/16 仍算通过的实例）。
process.exit(dirty === 0 ? 0 : 1)
