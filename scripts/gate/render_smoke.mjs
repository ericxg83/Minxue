/**
 * 闸门④真机级渲染冒烟（常驻版，r96 收编自 r94 轮临时件）。
 *
 * 隔离产物上「移动端首页 + 工作台首页」必须真渲染：挂载点有子节点、innerText 有真实文字、
 * 全程 0 控制台错误、0 个 4xx/5xx。
 *
 * ⛔ 前置纪律（r94/r95 实证，详见 docs/auto/HANDOFF.md 第二-1 条）：
 *  - preview 必带 `--outDir <隔离目录>`：不带服务的是陈旧 dist/；
 *  - 隔离产物构建必须 `MSYS_NO_PATHCONV=1 VITE_API_URL=/api`：不带会烤入生产 API base
 *    （冒烟直连生产）或被 Git Bash 把 /api 改写成 C:/Program Files/Git/api；
 *  - 起预览后先 `node scripts/gate/cert_probe.mjs <BASE>` 验服务对象与零外联，再跑本冒烟。
 *
 * 前置：本机后端已起（`node server/index.js` → :4000）；preview 已带 --outDir 起好。
 * 跑法：node scripts/gate/render_smoke.mjs [BASE]   （默认见 base.mjs 的统一默认端口）
 */
import { chromium } from 'playwright'
import { gateBase } from './base.mjs'

const BASE = gateBase()
const PAGES = [
  { name: '移动端首页', url: '/', mount: '#root', expect: ['敏学', '上传', '作业', '任务'] },
  { name: '工作台首页', url: '/workbench.html#/', mount: '#workbench-app', expect: ['工作台', '批改中心', '学习诊断'] },
]

const browser = await chromium.launch({ headless: true })
const results = []
const ok = (n, c, extra = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '  — ' + extra : ''}`) }

const consoleErrors = []
const badResponses = []

for (const { name, url, mount, expect } of PAGES) {
  const page = await browser.newPage()
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${name}] ${m.text()}`) })
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`[${name}] ${r.status()} ${r.url()}`) })
  await page.goto(`${BASE}${url}`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(2500)
  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    const text = (document.body.innerText || '').trim()
    return { children: el ? el.children.length : -1, textLen: text.length, head: text.slice(0, 80) }
  }, mount).catch((e) => ({ err: e.message }))
  if (info.err) { ok(`${name} 渲染探针`, false, info.err); await page.close(); continue }
  ok(`${name} 挂载点有子节点`, info.children > 0, `children=${info.children}`)
  ok(`${name} innerText 真实文字`, info.textLen >= 30, `len=${info.textLen}`)
  ok(`${name} 出现预期文字`, expect.some((w) => info.head.includes(w)), `head=${JSON.stringify(info.head)}`)
  await page.close()
}

ok('0 控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
ok('0 个 4xx/5xx', badResponses.length === 0, badResponses.slice(0, 3).join(' | '))

const pass = results.filter(Boolean).length
console.log(`\n===== gate render_smoke @ ${BASE} : ${pass}/${results.length} =====`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
