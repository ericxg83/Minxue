/**
 * 端到端遍历（第 14 步）：遍历 30 题逐个打开原卷弹窗，找空白/异常题
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000/workbench.html'
const OUT = 'D:/Minxue_App_V3/server/scripts/logs/dsl-demo/'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const EXAM = 'd6e95822-2313-4467-82f3-89e30a65484f'
const STU = '24f3df8b-9679-4295-8de5-b62ce53c7059'

async function main () {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 200)))

  await page.goto(`${BASE}#/grade/task?studentId=${STU}&taskId=${EXAM}&source=retry`, { waitUntil: 'domcontentloaded' })
  await sleep(10000)

  // 题目列表项：div.nav-item
  const results = []
  const total = await page.evaluate(() => document.querySelectorAll('.nav-item').length)
  console.log('题目总数:', total)

  for (let i = 0; i < Math.min(total, 30); i++) {
    // 点击第 i 题
    await page.evaluate((idx) => {
      const items = document.querySelectorAll('.nav-item')
      if (items[idx]) items[idx].click()
    }, i)
    await sleep(600)
    // 检查是否有原卷按钮
    const hasOrig = await page.evaluate(() => {
      return [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === '原卷')
    })
    if (!hasOrig) {
      results.push({ i: i + 1, hasOrig: false })
      continue
    }
    // 点开原卷
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '原卷')
      b?.click()
    })
    await sleep(2500)
    const st = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('.el-dialog img')]
      const failed = document.querySelector('.orig-src__failed')
      return {
        nImgs: imgs.length,
        img: imgs[0] ? { nw: imgs[0].naturalWidth, nh: imgs[0].naturalHeight, complete: imgs[0].complete, style: (imgs[0].getAttribute('style') || '').slice(0, 100) } : null,
        failed: failed ? failed.textContent : null,
        title: document.querySelector('.el-dialog__title')?.textContent || ''
      }
    })
    results.push({ i: i + 1, hasOrig: true, ...st })
    // 关闭弹窗
    await page.evaluate(() => {
      document.querySelector('.el-dialog__headerbtn')?.click()
    })
    await sleep(400)
    console.log(`#${i + 1}:`, JSON.stringify(results[results.length - 1]))
  }

  console.log('=== 汇总 ===')
  const bads = results.filter(r => !r.hasOrig || r.nImgs === 0 || r.failed || !r.img?.complete)
  console.log('异常题:', JSON.stringify(bads, null, 1))
  await browser.close()
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })