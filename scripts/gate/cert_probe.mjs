/**
 * 闸门④外联探针（常驻版，r96 收编自 r95 轮临时件）。
 *
 * 逐个访问工作台全部路由 + 移动端首页，收集 requestfailed（含失败原因）与访问过的外部 origin。
 * 用途：① 验隔离产物没有烤入生产 API base（出现 minxue-api.onrender.com = 构建没带
 * VITE_API_URL=/api，r95 实证）；② 验「证书噪声」（ERR_CERT_COMMON_NAME_INVALID 等）的元凶请求。
 *
 * 前置：本机后端已起；BASE 指向带 --outDir 的隔离产物预览。
 * 跑法：node scripts/gate/cert_probe.mjs [BASE]   （默认 http://127.0.0.1:5227）
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:5227'
const ROUTES = [
  '/workbench.html#/',
  '/workbench.html#/grade',
  '/workbench.html#/weekly-report',
  '/workbench.html#/students',
  '/workbench.html#/weekend-ppt',
  '/workbench.html#/weekend-board',
  '/workbench.html#/growth',
  '/workbench.html#/wrongbook',
  '/',
]

const browser = await chromium.launch({ headless: true })
const failures = []
const origins = new Set()

for (const route of ROUTES) {
  const page = await browser.newPage()
  const tag = route.replace('/workbench.html#', 'wb:') || 'mobile:/'
  page.on('requestfailed', (req) => {
    failures.push({ tag, url: req.url(), err: req.failure()?.errorText })
  })
  page.on('response', (r) => {
    try { origins.add(new URL(r.url()).origin) } catch { /* 忽略 */ }
  })
  await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 30000 }).catch((e) => {
    failures.push({ tag, url: `${BASE}${route}`, err: `goto: ${e.message.split('\n')[0]}` })
  })
  await page.waitForTimeout(3000)
  await page.close()
}
await browser.close()

console.log('════ 访问过的外部 origin（期望为空；若见 minxue-api.onrender.com = 产物烤入了生产 base）════')
for (const o of origins) if (!o.startsWith(BASE)) console.log('  ' + o)
console.log('\n════ requestfailed 明细 ════')
if (!failures.length) console.log('  （无失败请求）')
for (const f of failures) console.log(`  [${f.tag}] ${f.err}\n      ${f.url.slice(0, 140)}`)
process.exit(failures.length === 0 ? 0 : 1)
