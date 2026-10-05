/** r108 布局溢出审计：横向滚动 / 元素出视口。跑法：node overflow_audit.mjs [BASE] */
import { chromium } from 'playwright'
import { gateBase } from './base.mjs'
// r158：本行原为 `process.argv[2] || 'http://127.0.0.1:5235'` —— 漏了 process.env.BASE，
// 用 `BASE=... node overflow_audit.mjs` 跑会静默审计 5235（实测设 5999 仍请求 5235）⇒ 假绿。
const BASE = gateBase()
const ROUTES = [
  ['mobile:/', '/'], ['mobile:任务', '/tasks'], ['mobile:错题本', '/wrongbook'], ['mobile:组卷历史', '/exams'],
  ['wb:工作台', '/workbench.html#/'], ['wb:批改中心', '/workbench.html#/grade'],
  ['wb:学习诊断', '/workbench.html#/weekly-report'], ['wb:学生列表', '/workbench.html#/students'],
  ['wb:学生档案', '/workbench.html#/students/bd31776e-6673-474c-ae1f-8a22d69cbd46'],
  ['wb:练习册管理', '/workbench.html#/worksheets'], ['wb:试卷答案库', '/workbench.html#/paper'],
  ['wb:老书签/handouts', '/workbench.html#/handouts'], ['wb:周末班课件', '/workbench.html#/weekend-ppt'],
  ['wb:我的题型库', '/workbench.html#/question-bank'],
]
const browser = await chromium.launch({ headless: true })
let dirty = 0
for (const [name, route] of ROUTES) {
  const page = await browser.newPage()
  const isMobile = !route.startsWith('/workbench')
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 })
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 30000 })
    await page.waitForTimeout(3500)
    const audit = await page.evaluate(() => {
      const doc = document.documentElement
      const hOver = doc.scrollWidth - doc.clientWidth
      const offenders = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.right > doc.clientWidth + 8 && getComputedStyle(el).position !== 'fixed') {
          const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')
          if (!offenders.some(o => o.tag === tag)) offenders.push({ tag, right: Math.round(r.right), w: Math.round(r.width) })
          if (offenders.length >= 4) break
        }
      }
      return { hOver, offenders }
    })
    if (audit.hOver > 2 || audit.offenders.length) {
      dirty++
      console.log(`🔴 ${name} — 横向溢出 ${audit.hOver}px`)
      for (const o of audit.offenders) console.log(`     出界: ${o.tag} right=${o.right}px w=${o.w}px`)
    } else {
      console.log(`🟢 ${name}`)
    }
  } catch (e) { dirty++; console.log(`🔴 ${name} — ${e.message.split('\n')[0]}`) }
  await page.close()
}
await browser.close()
console.log(`\n════ ${dirty}/${ROUTES.length} 路由有布局问题 ════`)
// r152：闸门必须「有脏即非零退出」。旧版只打印计数、恒退 0 ⇒ 串进 `&&` / 自动化即假绿。
process.exit(dirty === 0 ? 0 : 1)
