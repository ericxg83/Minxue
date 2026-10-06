/**
 * 巡查冒烟 — 移动端首页 + 工作台 8 导航（Playwright）
 * ─────────────────────────────────────────────────────────────
 * 前置：vite dev 已起（npm run dev → :5173，工作台经 /workbench.html 提供）。
 * 跑法：node scripts/patrol/smoke.mjs [BASE 默认 http://127.0.0.1:5173]
 *
 * 断言：
 *  - 移动端首页 #root 挂载、innerText 有真实文字、0 console error、0 4xx/5xx
 *  - 工作台 #workbench-app 挂载、0 console error
 *  - 侧栏 8 个导航项逐个点击，路由可达（hash 变化、页面出现骨架/挂载），0 4xx/5xx
 *  - 每页收集 console error，全流程汇总
 */
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'

const BASE = process.argv[2] || 'http://127.0.0.1:5173'

const NAV = [
  { label: '批改中心', path: '#/grade', landing: ['#/grade'] },
  { label: '学习诊断', path: '#/growth', landing: ['#/weekly-report', '#/growth'] },
  { label: '错题本', path: '#/wrongbook', landing: ['#/students', '#/wrongbook'] },
  { label: '练习册管理', path: '#/worksheets', landing: ['#/worksheets'] },
  { label: '试卷答案库', path: '#/paper', landing: ['#/paper'] },
  { label: '我的考法库', path: '#/question-bank', landing: ['#/question-bank'] },
  { label: '周末班课件', path: '#/weekend-ppt', landing: ['#/weekend-ppt'] },
  { label: '名册', path: '#/students', landing: ['#/students'] },
]

const browser = await chromium.launch({ headless: true })
const consoleErrors = []
const badResponses = []
const results = []
const ok = (n, c, extra = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '  — ' + extra : ''}`) }
const page = await browser.newPage()
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[console] ${m.text()}`) })
page.on('response', r => { if (r.status() >= 400) badResponses.push(`[${r.status()}] ${r.url()}`) })

// ── 移动端首页 ──
try {
  await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(2000)
  const info = await page.evaluate(() => {
    const el = document.querySelector('#root')
    const t = (document.body.innerText || '').trim()
    return { children: el ? el.children.length : -1, len: t.length, head: t.slice(0, 60) }
  })
  ok('移动端首页挂载', info.children > 0, `children=${info.children}`)
  ok('移动端首页有文字', info.len >= 20, `len=${info.len}`)
} catch (e) { ok('移动端首页', false, e.message) }

// ── 工作台 8 导航 ──
await page.goto(`${BASE}/workbench.html#/`, { waitUntil: 'load', timeout: 30000 }).catch(() => {})
await page.waitForTimeout(2500)
for (const { label, path, landing } of NAV) {
  try {
    const link = page.locator(`aside a[href="${path}"], aside .el-menu-item, aside .nav-item, aside a`).filter({ hasText: label }).first()
    const links = await page.locator('aside a, aside .el-menu-item').all()
    let clicked = false
    for (const el of links) {
      const t = (await el.innerText().catch(() => '')).trim()
      if (t.includes(label)) { await el.click(); clicked = true; break }
    }
    if (!clicked) { const direct = await page.goto(`${BASE}/workbench.html${path}`); void direct }
    await page.waitForTimeout(1800)
    const state = await page.evaluate(() => {
      const el = document.querySelector('#workbench-app')
      return {
        children: el ? el.children.length : 0,
        url: location.hash,
        textLen: (document.body.innerText || '').length,
        head: (document.body.innerText || '').trim().slice(0, 60),
      }
    })
    const routeOk = landing.some(h => state.url === h || state.url.startsWith(h))
    ok(`导航「${label}」可达`, routeOk && state.children > 0, `hash=${state.url} children=${state.children} head=${JSON.stringify(state.head)}`)
  } catch (e) { ok(`导航「${label}」`, false, e.message) }
}

ok('0 console error', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '))
ok('0 个 4xx/5xx', badResponses.length === 0, badResponses.slice(0, 5).join(' | '))

const pass = results.filter(Boolean).length
console.log(`\n===== patrol smoke @ ${BASE} : ${pass}/${results.length} =====`)
if (consoleErrors.length) console.log('console errors:\n  ' + consoleErrors.join('\n  '))
await browser.close()
process.exit(pass === results.length ? 0 : 1)