/**
 * 回归锁（2026-10-10）：「AI 重解析」离开页面后不能"看着像停了"。
 *
 * ── 负责人反馈 ──
 * 「重解析这个动作，当我离开这个页面的时候，它就自动停止了。」
 *
 * ── 实测结论（两个常见假设先排除，别照着它们修）──
 *   ① 服务端**不会**因客户端断开而停：用最小复现脚本验证（curl -m 2 主动断开，
 *      8s 后 handler 仍执行到底）—— Express 处理器不受客户端断连影响。
 *   ② 页面内 SPA 路由切换**不会**中断在途 fetch：真浏览器实测（Playwright）切走再
 *      回来，按钮仍停在「AI 计算中 Ns…」。
 *   ⇒ 真正丢的是**整页重载 / 关标签页 / WebView 挂起**之后的结果反馈：store 被清空
 *     ⇒ 按钮退回「AI 重解析」，后端算完写库了也没人告诉老师。
 *
 * ── 修法（本锁盯的就是这两半）──
 *   服务端：进程内 `RECOMPUTE_JOBS` 登记表 + 只读状态接口
 *           `GET /api/questions/:id/recompute-answer/status`；
 *   前端：在途标记落 localStorage，回到页面先查状态表 → 续上「计算中」或直接给结论。
 *
 * ── 锁的纪律 ──
 *   · 全部走 `sourceLockKit` 的 anchoredSlice / anchoredRange（fail-closed）：
 *     锚点被改名/挪走 ⇒ 本锁当场判红，不会静默变成"什么都没查"。
 *   · 每条判据都做**反向自检**：把源码改成"修复前"的样子，必须判红。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { anchoredSlice, anchoredRange } from './sourceLockKit.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

/** 剥掉注释：注释里会引用旧写法，不剥会造成假红/假绿 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/^\s*\/\/.*$/, ''))
  .join('\n')

const INDEX = read('server/index.js')
const STORE = read('src/workbench/stores/reviewStore.js')
const API = read('src/services/apiService.js')
const PANEL = read('src/workbench/components/review/QuestionDetailPanel.vue')

const POST_ROUTE = "app.post('/api/questions/:id/recompute-answer'"
const STATUS_ROUTE = "app.get('/api/questions/:id/recompute-answer/status'"

// ── 服务端判据 ─────────────────────────────────────────────────────────────
function checkServer(src, fails) {
  const s = stripComments(src)
  const L = 'server/index.js'

  const reg = anchoredSlice(s, 'const RECOMPUTE_JOBS = new Map()', 120, `${L} 在途登记表`, fails)
  if (reg !== null && !/questionId/.test(reg)) {
    fails.push(`${L}：RECOMPUTE_JOBS 的键语义必须是 questionId（前端按题目 ID 查询）`)
  }

  // 登记表必须挂在 POST 处理器体内，且用 res 'finish' 单点收口
  const postBody = anchoredRange(s, POST_ROUTE, STATUS_ROUTE, `${L} 重解析路由体`, fails)
  if (postBody !== null) {
    if (!/RECOMPUTE_JOBS\.set\(\s*id\s*,\s*\{\s*status:\s*'running'/.test(postBody)) {
      fails.push(`${L}：重解析开始必须把该题登记为 running（否则前端回来查不到「还在算」）`)
    }
    if (!/res\.on\(\s*'finish'/.test(postBody)) {
      fails.push(`${L}：必须用 res 'finish' 单点收口记录下场 —— 8 个 return 分支各写一遍必漏，漏一处就是永远停在 running 的假状态`)
    }
    if (!/status:\s*res\.statusCode\s*>=\s*200\s*&&\s*res\.statusCode\s*<\s*300\s*\?\s*'done'\s*:\s*'failed'/.test(postBody)) {
      fails.push(`${L}：res 'finish' 必须按状态码把下场记成 done / failed`)
    }
  }

  const status = anchoredSlice(s, STATUS_ROUTE, 1400, `${L} 状态接口`, fails)
  if (status !== null) {
    if (!/RECOMPUTE_JOBS\.get\(\s*id\s*\)/.test(status)) {
      fails.push(`${L}：状态接口必须读 RECOMPUTE_JOBS（否则前端只能靠猜）`)
    }
    if (!/job:\s*null/.test(status)) {
      fails.push(`${L}：查不到登记时必须显式返回 job: null（前端据此退回普通按钮，而不是无限转圈）`)
    }
    if (!/result:\s*rows\[0\]/.test(status)) {
      fails.push(`${L}：done 时必须把落库结果一并返回，前端才能不必再拉一次题列表就显示答案`)
    }
  }

  // 路由顺序：状态接口必须在 POST 之后，否则 recomputeAnswerTimeout 的 routeBody 切片会提前截断
  const pi = s.indexOf(POST_ROUTE)
  const si = s.indexOf(STATUS_ROUTE)
  if (pi >= 0 && si >= 0 && si < pi) {
    fails.push(`${L}：状态接口必须定义在重解析 POST 路由之后（否则 test/recomputeAnswerTimeout 的路由体切片会提前截断）`)
  }
}

// ── 前端判据 ───────────────────────────────────────────────────────────────
function checkFrontend({ store, api, panel }, fails) {
  const sStore = stripComments(store)
  const sApi = stripComments(api)
  const sPanel = stripComments(panel)

  const apiFn = anchoredSlice(sApi, 'export const getRecomputeAnswerStatus', 260, 'apiService 状态接口', fails)
  if (apiFn !== null && !/\/recompute-answer\/status/.test(apiFn)) {
    fails.push('apiService.js：getRecomputeAnswerStatus 必须打 /recompute-answer/status')
  }

  const begin = anchoredSlice(sStore, 'const beginRecomputeJob = (questionId) => {', 300, 'store beginRecomputeJob', fails)
  if (begin !== null && !/markRecomputeInflight\(questionId\)/.test(begin)) {
    fails.push('reviewStore.js：beginRecomputeJob 必须落 localStorage 在途标记（否则整页重载后无从续上）')
  }
  const finish = anchoredSlice(sStore, 'const finishRecomputeJob = (questionId, notice', 900, 'store finishRecomputeJob', fails)
  if (finish !== null) {
    if (!/keepInflight\s*=\s*false/.test(finish)) {
      fails.push('reviewStore.js：finishRecomputeJob 必须支持 keepInflight（整页重载会中止在途 fetch，其 rejection 若顺手清标记，续查就白做了）')
    }
    if (!/if\s*\(!keepInflight\)/.test(finish)) {
      fails.push('reviewStore.js：只有非 keepInflight 时才清在途标记')
    }
  }

  // ⚠️ 这条是本轮实测踩出来的：重载时浏览器中止 fetch → 其 rejection 跑进面板 catch →
  //    若 catch 里按默认清标记，标记就在「离开页面」的同一瞬间被清掉（实测重载后变 {}）。
  const catchSeg = anchoredSlice(sPanel, "console.error('AI 重解析失败:', err)", 1200, '面板重解析 catch', fails)
  if (catchSeg !== null && !/keepInflight:\s*true/.test(catchSeg)) {
    fails.push('QuestionDetailPanel.vue：重解析失败（含「离开页面被中止」）必须 keepInflight，否则续查功能等于没做')
  }

  const resume = anchoredSlice(sStore, 'const resumeRecomputeJobs = async () => {', 2600, 'store resumeRecomputeJobs', fails)
  if (resume !== null) {
    if (!/getRecomputeAnswerStatus\(questionId\)/.test(resume)) {
      fails.push('reviewStore.js：resumeRecomputeJobs 必须查服务端状态接口（不能只看本地）')
    }
    if (!/status\.status === 'running'/.test(resume)) {
      fails.push("reviewStore.js：resumeRecomputeJobs 必须处理 running（续上「计算中」并轮询）")
    }
    if (!/status\.status === 'done'/.test(resume)) {
      fails.push('reviewStore.js：resumeRecomputeJobs 必须处理 done（落答案 + 结论横幅）')
    }
    if (!/applyRecomputeAnswer\(questionId/.test(resume)) {
      fails.push('reviewStore.js：done 时必须把答案写回题目列表，否则老师看到的还是空答案')
    }
    if (!/status\.status === 'failed'|failedResult/.test(resume)) {
      fails.push('reviewStore.js：resumeRecomputeJobs 必须处理 failed（且老师已手填答案时保持安静）')
    }
  }
  if (!/^\s*resumeRecomputeJobs,\s*$/m.test(sStore)) {
    fails.push('reviewStore.js：resumeRecomputeJobs 必须从 store 导出（面板要调用）')
  }

  if (!/store\.resumeRecomputeJobs\(\)/.test(sPanel)) {
    fails.push('QuestionDetailPanel.vue：面板挂载时必须续一次在途重解析')
  }
}

// ── ① 真源码：必须全绿 ────────────────────────────────────────────────────
{
  const fails = []
  checkServer(INDEX, fails)
  checkFrontend({ store: STORE, api: API, panel: PANEL }, fails)
  assert.deepEqual(fails, [], '真源码应通过：\n' + fails.join('\n'))
}

// ── ② 反向自检：改回"修复前"的样子，每条判据都必须判红 ────────────────────
{
  // 服务端：删掉 res 'finish' 收口 + 删掉状态接口
  const brokenServer = INDEX
    .replace(/res\.on\('finish',[\s\S]*?\n {4}\}\)\n/, '')
    .replace(/result: rows\[0\] \|\| null/, 'result: null')
  const f1 = []
  checkServer(brokenServer, f1)
  assert.ok(f1.length > 0, '反向自检失败：服务端收口被删掉时本锁没判红')

  // 前端：退回组件级状态（不落 localStorage、不续查、无 keepInflight 保护）
  const brokenStore = STORE
    .replace(/markRecomputeInflight\(questionId\)/, '')
    .replace(/clearRecomputeInflight\(questionId\)/, '')
    .replace(/keepInflight = false/, 'legacyUnused = false')
    .replace(/^\s*resumeRecomputeJobs,\s*$/m, '')
  const brokenPanel = PANEL.replace(/store\.resumeRecomputeJobs\(\)/, '').replace(/keepInflight: true/, '')
  const f2 = []
  checkFrontend({ store: brokenStore, api: API, panel: brokenPanel }, f2)
  assert.ok(f2.length >= 4, `反向自检失败：前端退回旧写法时本锁只判红 ${f2.length} 条（应 ≥4）`)

  // 单独反向自检「keepInflight」这条（本轮实测踩到的坑，最容易被"顺手改回去"）
  const f3 = []
  checkFrontend({ store: STORE, api: API, panel: PANEL.replace(/keepInflight: true/, '') }, f3)
  assert.ok(
    f3.some((m) => m.includes('keepInflight')),
    '反向自检失败：面板 catch 去掉 keepInflight 时本锁没判红'
  )
}

console.log('✅ recomputeSurvivesPageLeave: 全部通过（服务端在途登记表 + 只读状态接口 + 前端 localStorage 续查）')
