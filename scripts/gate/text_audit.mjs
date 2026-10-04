/**
 * r107 专业度审计：全路由运行时检查
 *   ① 用户可见文本出现开发痕迹（undefined / NaN / [object / JSON 字符串）
 *   ② 破图（img 加载失败 naturalWidth===0）
 *   ③ 空文本可点按钮
 * 跑法：node text_audit.mjs [BASE]   （默认 http://127.0.0.1:5235）
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:5235'
const ROUTES = [
  ['mobile:/', '/'],
  ['mobile:任务', '/tasks'],
  ['mobile:错题本', '/wrongbook'],
  ['mobile:组卷历史', '/exams'],
  ['wb:工作台', '/workbench.html#/'],
  ['wb:批改中心', '/workbench.html#/grade'],
  ['wb:学习诊断', '/workbench.html#/weekly-report'],
  ['wb:学生列表', '/workbench.html#/students'],
  ['wb:学生档案', '/workbench.html#/students/bd31776e-6673-474c-ae1f-8a22d69cbd46'],
  ['wb:练习册管理', '/workbench.html#/worksheets'],
  ['wb:试卷答案库', '/workbench.html#/paper'],
  ['wb:我的讲义', '/workbench.html#/handouts'],
  ['wb:周末班课件', '/workbench.html#/weekend-ppt'],
  ['wb:我的题型库', '/workbench.html#/question-bank'],
]

const SUSPECT = /\bundefined\b|\bNaN\b|\[object\s+\w+|\bnull\b(?!-)|\{"\w+":/g

const browser = await chromium.launch({ headless: true })
let dirty = 0
for (const [name, route] of ROUTES) {
  const page = await browser.newPage()
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 30000 })
    await page.waitForTimeout(3500)
    const audit = await page.evaluate((suspectSrc) => {
      const text = document.body.innerText || ''
      const suspects = [...new Set((text.match(new RegExp(suspectSrc, 'g')) || []).map((s) => s.trim()))]
      const ctx = suspects.map((s) => {
        const i = text.indexOf(s)
        return JSON.stringify(text.slice(Math.max(0, i - 30), i + 30))
      })
      const brokenImgs = [...document.querySelectorAll('img')]
        .filter((img) => img.complete && img.naturalWidth === 0 && img.src && !img.src.startsWith('data:'))
        .map((img) => img.src.slice(-60))
      const emptyBtns = [...document.querySelectorAll('button')]
        .filter((b) => !b.disabled && !(b.innerText || '').trim() && !b.querySelector('svg,i,span[class*="icon"],.el-icon'))
        .length
      return { suspects, ctx, brokenImgs, emptyBtns }
    }, SUSPECT.source)
    const bad = audit.suspects.length || audit.brokenImgs.length || audit.emptyBtns
    if (bad) {
      dirty++
      console.log(`🔴 ${name}`)
      if (audit.suspects.length) console.log(`     文本痕迹: ${audit.suspects.join(' | ')}\n       上下文: ${audit.ctx.slice(0, 3).join('\n                ')}`)
      if (audit.brokenImgs.length) console.log(`     破图: ${audit.brokenImgs.slice(0, 3).join(' | ')}`)
      if (audit.emptyBtns) console.log(`     空按钮: ${audit.emptyBtns} 个`)
    } else {
      console.log(`🟢 ${name}`)
    }
  } catch (e) {
    dirty++
    console.log(`🔴 ${name} — 探测失败: ${e.message.split('\n')[0]}`)
  }
  await page.close()
}
await browser.close()
console.log(`\n════ ${dirty}/${ROUTES.length} 路由有专业度问题 ════`)
