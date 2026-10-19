// ============================================================================
// 手动复现 / 回归脚本（非 CI 固定套件，数据相关）
// ============================================================================
// 用途：验证「待处理」页签点击跳页 + focus=todo 默认对准待处理。
// 数据依赖：TASKS 里的 exam id（generated_exam_id）与 student id 是本环境的
//   真实数据，换库后需重跑 server/scripts/ 找新 id（临时脚本已删，按
//   wrong_retry + generated_exam_id 查即可）。paper 模式 taskId = exam.id，
//   不是答卷 task 行 id —— 这是 paper 模式最易踩的坑。
// 运行：node test/e2e_todoJump.cjs（需本地 :3000 前端 + :4000 后端在跑）
//   Playwright chromium 已装在 node_modules。
// 断言策略：
//   1. Fix2 用全新 page 保证 onMounted 重跑（同路由 query-only 切换不 remount，
//      与 ?q= 设计一致：fresh mount only）。
//   2. Fix1a 强断言：focus=todo 进入后点「待处理 1」那条，页指示器必须到 p2
//      （负责人截图 2026-10-15：余晨瑞 19、解答题 第11题(1) AI未判定，实际在 p2，
//      旧 fix 用 hasBox 把 origQ=11(1) 的 position 记录 pgNum=1 拿去定位，错了；
//      新 fix 必须用同 origQ 的 number 匹配借用 p2）。
//   3. Fix1b 弱断言：切「全部」点 boxless 题，至少应能到达 ≥2 个不同页。
// ============================================================================
const { chromium } = require('playwright')

// paper 模式 taskId = exam.id（generated_exam_id），不是答卷 task 行 id
const TASKS = [
  { id: '41c6968f-e7cb-46fc-818f-adba08368d9a', student: 'cd4773e3-71da-4da3-a452-cfb7f9b6c33f', name: '余晨瑞-2d05' },
  { id: '7156ef28-fe52-4229-a259-c9ec61c03554', student: '5c7a5ea1-d46b-40f1-a80b-a424aabe7303', name: '赵安迪-6369' },
  { id: 'f564816c-282e-40d6-9cec-3c6240b0e568', student: 'cd4773e3-71da-4da3-a452-cfb7f9b6c33f', name: '余晨瑞-8e74' },
  { id: '1325a264-994f-4fb5-9e3b-d9c1cc172a49', student: 'cd4773e3-71da-4da3-a452-cfb7f9b6c33f', name: '余晨瑞-ccd4' },
]
const base = (t, focus) => `http://localhost:3000/workbench.html#/grade/task?studentId=${t.student}&taskId=${t.id}&source=retry${focus ? '&focus=todo' : ''}`

function parsePage(text) {
  const m = /第\s*(\d+)\s*\/\s*(\d+)\s*页/.exec(text || '')
  return m ? { page: Number(m[1]), total: Number(m[2]) } : null
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  // ── probe：找一个可复核、≥2 页、有题的卷 ──
  let target = null
  for (const t of TASKS) {
    await page.goto(base(t, false), { waitUntil: 'networkidle' })
    try { await page.waitForSelector('.nav-filter-tab', { timeout: 12000 }) } catch { continue }
    await page.locator('.nav-filter-tab').nth(2).click() // 全部
    await page.waitForTimeout(300)
    const cnt = await page.locator('.nav-list .nav-item').count()
    const ind = await page.textContent('.page-indicator').catch(() => '')
    const pp = parsePage(ind)
    console.log(`[probe] ${t.name} 全部题数=${cnt} 页指示=${JSON.stringify(ind).slice(0,30)} parsed=${JSON.stringify(pp)}`)
    if (cnt > 0 && pp && pp.total >= 2) { target = { ...t, cnt, pp }; break }
  }
  if (!target) {
    console.log('\n无可用复核卷（当前数据下三份待复核卷在批改页均无题/单页），Fix1 无法实测；Fix2 见下。')
  }

  // ── Fix2：focus=todo → 默认对准「待处理」（用全新 page 保证 onMounted 重跑）──
  let fix2
  {
    const t = TASKS[0]
    const p2 = await browser.newPage()
    await p2.goto(base(t, true), { waitUntil: 'networkidle' })
    await p2.waitForSelector('.nav-filter-tab', { timeout: 15000 })
    const active = await p2.textContent('.nav-filter-tab.active')
    fix2 = active && active.includes('待处理')
    console.log(`\n[Fix2] ${t.name} focus=todo → 激活页签=${JSON.stringify(active)} => 待处理? ${fix2}`)
    await p2.close()
  }

  // ── Fix1a 强断言：点「待处理」页签里那条题，页指示器必须到 p2 ──
  // 负责人截图实例：余晨瑞 19、解答题 第11题(1) AI未判定，origQ=11(1)。
  // 该题 retryAlign matchedBy=position pgNum=1（OCR 猜错页），同 origQ 的
  // 38802d84 matchedBy=number pgNum=2 才是真位置。新 fix 应借用到 p2。
  let fix1a = null, fix1c = null
  if (target) {
    const p2 = await browser.newPage() // 全新 page，确保 onMounted 跑过
    await p2.goto(base(target, true), { waitUntil: 'networkidle' })
    await p2.waitForSelector('.nav-list .nav-item', { timeout: 15000 })
    // 当前应在「待处理」页签（Fix2 验证），只点唯一的待处理那条
    const todoCount = await p2.locator('.nav-list .nav-item').count()
    console.log(`\n[Fix1a] ${target.name} focus=todo 待处理条数=${todoCount}`)
    if (todoCount > 0) {
      await p2.locator('.nav-list .nav-item').first().click()
      await p2.waitForTimeout(500)
      const ind = await p2.textContent('.page-indicator')
      const pp = parsePage(ind)
      // 期望：pp.page = 2（用户实测真位置；旧 fix 给 1，新 fix 借同 origQ 给 2）
      fix1a = pp && pp.page === 2
      console.log(`[Fix1a] 点待处理唯一题 → 页指示=${JSON.stringify(ind).slice(0,40)} parsed=${JSON.stringify(pp)} => 期望p2? ${fix1a}`)

      // Fix1c：翻对页但没框 → 必须出现「定位框不在本页」提示（不能静默）
      // 该题(321afd64)的框记在 p1，我们借同 origQ 翻到 p2 ⇒ p2 上没框，必须有提示说明。
      const hintCount = await p2.locator('.review-boxhint-notice').count()
      let hintText = ''
      if (hintCount > 0) hintText = (await p2.locator('.review-boxhint-notice').first().textContent() || '').replace(/\s+/g, ' ').trim()
      fix1c = hintCount > 0 && /定位框|没有识别到作答痕迹|没有对位记录/.test(hintText)
      console.log(`[Fix1c] 框提示条 count=${hintCount} 文案=${JSON.stringify(hintText.slice(0,90))} => 有提示? ${fix1c}`)
    }
    await p2.close()
  }

  // ── Fix1b 弱断言：切「全部」点 boxless 题，至少能到达 ≥2 个不同页 ──
  let fix1b = null, detail = ''
  if (target) {
    await page.goto(base(target, false), { waitUntil: 'networkidle' })
    await page.waitForSelector('.nav-list .nav-item', { timeout: 15000 })
    await page.locator('.nav-filter-tab').nth(2).click() // 全部
    await page.waitForTimeout(400)
    const n = await page.locator('.nav-list .nav-item').count()
    const boxlessIdx = []
    for (let i = 0; i < n; i++) {
      const tag = await page.locator('.nav-list .nav-item').nth(i).locator('.item-paper-tag').count()
      if (tag === 0) boxlessIdx.push(i)
    }
    console.log(`\n[Fix1b] ${target.name} 全部题=${n} 无页标(boxless)=${boxlessIdx.length}`)
    const reached = new Set()
    // 先点一个有页标题把页拨到已知页，再逐个点 boxless，记录到达页
    for (let i = 0; i < n; i++) {
      const tag = await page.locator('.nav-list .nav-item').nth(i).locator('.item-paper-tag').count()
      if (tag > 0) { await page.locator('.nav-list .nav-item').nth(i).click(); await page.waitForTimeout(250); break }
    }
    for (const bi of boxlessIdx) {
      await page.locator('.nav-list .nav-item').nth(bi).click()
      await page.waitForTimeout(350)
      const ind = await page.textContent('.page-indicator')
      const pp = parsePage(ind)
      if (pp) reached.add(pp.page)
      detail += ` #${bi + 1}->p${pp ? pp.page : '?'}`
    }
    // 修复前：boxless 点击一律不翻页 ⇒ reached 只有 1 个页（初始页）。
    // 修复后：能按最近邻翻到不同页 ⇒ reached ≥2（该卷 2 页，boxless 分布在两页上）。
    fix1b = reached.size >= 2
    console.log(`[Fix1b] boxless 点击到达页集合=${[...reached]} ${fix1b ? '(≥2页，翻页生效)' : '(只到1页，疑似未翻页)'}${detail}`)
  }

  await browser.close()
  console.log('\n==== RESULT ====')
  console.log('Fix2 (默认待处理页签):', fix2 ? 'PASS' : 'FAIL')
  console.log('Fix1a (待处理那条点中=真位置 p2):', fix1a === null ? 'N/A' : (fix1a ? 'PASS' : 'FAIL'))
  console.log('Fix1c (翻对页没框→必须有提示条):', fix1c === null ? 'N/A' : (fix1c ? 'PASS' : 'FAIL'))
  console.log('Fix1b (boxless 点击能翻到≥2页):', fix1b === null ? 'N/A(无可用卷)' : (fix1b ? 'PASS' : 'FAIL'))
  const ok = fix2 && (fix1a === null || fix1a) && (fix1b === null || fix1b) && (fix1c === null || fix1c)
  console.log('OVERALL:', ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch(e => { console.error('脚本异常:', e); process.exit(2) })
