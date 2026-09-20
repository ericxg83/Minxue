/**
 * 验证加固效果：① 正常打开弹窗 img src 带 _t 时间戳且正常显示；② 拦截图片请求模拟挂起 → 超时提示
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000/workbench.html'
const OUT = 'D:/Minxue_App_V3/server/scripts/logs/dsl-demo/'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const EXAM = '399650c0-0b8d-4ad3-b290-7764b96caee8'
const STU = '9d8b442b-90dc-4bfa-af6a-74ec4c483fa8'

async function main () {
  const browser = await chromium.launch({ headless: true })

  // ── ① 正常路径 ──
  let page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 160)))
  await page.goto(`${BASE}#/grade/task?studentId=${STU}&taskId=${EXAM}&source=retry`, { waitUntil: 'domcontentloaded' })
  await sleep(10000)
  // 点第 1 题（nav-item）
  await page.evaluate(() => document.querySelectorAll('.nav-item')[0]?.click())
  await sleep(600)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '原卷')
    b?.click()
  })
  await sleep(4000)
  const st = await page.evaluate(() => {
    const img = document.querySelector('.el-dialog img')
    return {
      src: img ? img.src.slice(-60) : null,
      hasTs: img ? /_t=\d{13}/.test(img.src) : false,
      nw: img?.naturalWidth || 0,
      nh: img?.naturalHeight || 0,
      failedShown: !!document.querySelector('.orig-src__failed')
    }
  })
  console.log('① 正常路径:', JSON.stringify(st))
  await page.close()

  // ── ② 超时路径：拦截 OSS 图片请求，让它永远 pending ──
  page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  await page.route(/minxue-app-oss\.oss-cn-shanghai\.aliyuncs\.com/, async (route) => {
    // 挂起不回应 → img 永远 pending
    await new Promise(() => {})
  })
  await page.goto(`${BASE}#/grade/task?studentId=${STU}&taskId=${EXAM}&source=retry`, { waitUntil: 'domcontentloaded' })
  await sleep(10000)
  await page.evaluate(() => document.querySelectorAll('.nav-item')[0]?.click())
  await sleep(600)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '原卷')
    b?.click()
  })
  await sleep(4000)
  const st2a = await page.evaluate(() => ({
    imgPending: !!document.querySelector('.el-dialog img'),
    failedBefore: !!document.querySelector('.orig-src__failed')
  }))
  console.log('② 挂起中(4s):', JSON.stringify(st2a))
  await page.screenshot({ path: OUT + 'fix-pending.png' })
  // 等超时（10s）触发
  await sleep(9000)
  const st2b = await page.evaluate(() => ({
    failedAfter: !!document.querySelector('.orig-src__failed'),
    failedText: document.querySelector('.orig-src__failed span')?.textContent || '',
    hasRetry: [...document.querySelectorAll('.orig-src__failed button')].some(b => b.textContent.includes('重试'))
  }))
  console.log('② 超时后(13s):', JSON.stringify(st2b))
  await page.screenshot({ path: OUT + 'fix-timeout.png' })

  await browser.close()
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })