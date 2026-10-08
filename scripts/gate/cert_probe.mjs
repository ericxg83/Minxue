/**
 * 闸门④外联探针（常驻版，r96 收编自 r95 轮临时件；r224 外联判据进退出码）。
 *
 * 逐个访问工作台全部路由 + 移动端首页，收集 requestfailed（含失败原因）与访问过的外部 origin。
 * 用途：① 验隔离产物没有烤入生产 API base（出现 minxue-api.onrender.com = 构建没带
 * VITE_API_URL=/api，r95 实证）；② 验「证书噪声」（ERR_CERT_COMMON_NAME_INVALID 等）的元凶请求。
 *
 * ⛔ r224 修的假绿：此前外部 origin 只打印不判，退出码只看 requestfailed —— 烤入生产 base
 * 的产物外联请求会**成功**（生产在线），零 requestfailed ⇒ exit 0 假绿（r152「有脏即非零退出」
 * 漏了这一闸）。现在外联 origin 也算脏，与请求失败一并决定退出码。
 *
 * ⛔ r246 修的假红（r224 口径过宽）：判据曾是「外部 origin 必须为空」，但 r244 起批改中心
 * 用 `<img>` 直拉 OSS 上的学生作业图 ⇒ `#/grade` 一渲染就有外部 origin ⇒ 探针**恒定 exit 1**。
 * 探针的用途是「验产物有没有烤入生产 **API base**」，图片 CDN 不属此列。
 * 现在按资源类型分流：只有图片/字体/媒体算静态资源（不算脏，但仍打印），
 * 出现 fetch/xhr/script… 才算脏；类型读不出来也算脏（fail-closed）。判据在 `certProbeKit.mjs`。
 *
 * 前置：本机后端已起；BASE 指向带 --outDir 的隔离产物预览。
 * 跑法：node scripts/gate/cert_probe.mjs [BASE]   （默认见 base.mjs 的统一默认端口）
 */
import { chromium } from 'playwright'
import { gateBase } from './base.mjs'
import { summarizeExternalRequests } from '../certProbeKit.mjs'

const BASE = gateBase()
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
const requests = [] // { origin, type }：每次响应记一条，交给 certProbeKit 分流

for (const route of ROUTES) {
  const page = await browser.newPage()
  const tag = route.replace('/workbench.html#', 'wb:') || 'mobile:/'
  page.on('requestfailed', (req) => {
    failures.push({ tag, url: req.url(), err: req.failure()?.errorText })
  })
  page.on('response', (r) => {
    try { requests.push({ origin: new URL(r.url()).origin, type: r.request().resourceType() }) } catch { /* 忽略 */ }
  })
  await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 30000 }).catch((e) => {
    failures.push({ tag, url: `${BASE}${route}`, err: `goto: ${e.message.split('\n')[0]}` })
  })
  await page.waitForTimeout(3000)
  await page.close()
}
await browser.close()

// ⛔ 判据用 origin 严格相等而非 startsWith：:54410 会 startsWith(:5441) 假同源（端口边界）。
const BASE_ORIGIN = new URL(BASE).origin
const { all, apiLike, staticOnly } = summarizeExternalRequests(requests, BASE_ORIGIN)

console.log('════ 访问过的外部 origin（判据：数据/脚本外联必须为空；若见 minxue-api.onrender.com = 产物烤入了生产 base）════')
if (!all.length) console.log('  （无）')
for (const o of all) {
  const kind = apiLike.includes(o)
    ? '❌ 数据/脚本外联（算脏）'
    : '🖼 仅图片/字体/媒体（正常业务，不算脏）'
  console.log(`  ${o}   ${kind}`)
}
if (staticOnly.length) {
  console.log(`  （其中 ${staticOnly.length} 个只是静态资源：学生作业图等存 OSS，前端 <img> 直拉是正常业务）`)
}
console.log('\n════ requestfailed 明细 ════')
if (!failures.length) console.log('  （无失败请求）')
for (const f of failures) console.log(`  [${f.tag}] ${f.err}\n      ${f.url.slice(0, 140)}`)
// r152 家族口径：有脏即非零退出。**数据/脚本外联**与请求失败都算脏（图片等静态资源不算，见 certProbeKit）。
process.exit(apiLike.length === 0 && failures.length === 0 ? 0 : 1)
