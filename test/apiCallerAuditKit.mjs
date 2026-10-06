/**
 * test/apiCallerAuditKit.mjs —— 「后端暴露的 API 有没有人在调」的**唯一判定实现**（r219）
 *
 * 为什么单独成 kit：判据要被两处同时使用 —— ① 回归锁 `test/apiDeadEndpoint.test.mjs`；
 * ② 反向自检探针（喂「没登记的新死端点」必须判红）。判据写两份迟早漂移成假绿。
 *
 * ⛔ 为什么这件事值得门禁化（r219 实测的第三枚「没人用就永不报错」）：
 *  - 提案 19（2026-10-05）：`scripts/dailyBackup.mjs` 注释写着「每晚 21:30 自动」，全仓零调用方 ⇒
 *    三天零备份无人知晓。
 *  - r217：lanes.md 把 `scripts/nightlyAudit.mjs` 标成「🟢 常驻」，实测零调用方 + 近 7 天 0 次。
 *  - r219（本轮）：`POST /api/wrong-questions/export-retry-pdf`（服务端重练卷 PDF + 二维码）
 *    零调用方 —— 学生扫的二维码其实是手机端 `src/pages/PrintPreview` 现算的
 *    （`src/utils/retryTaskUrl.js`）。这条链路**跑一次错一次也永远不会报错**，因为压根没人跑。
 *  ⇒ 这类缺口读代码看不出来，只有「扫端点 + 扫调用方」才看得见。
 *
 * ⛔ 精度纪律（本轮自己踩）：调用方语料**只收 src/ + scripts/ + test/ + server/scripts/**，
 * **不收 server/**（否则端点声明行本身就成了「调用方」，整仓假绿）。
 * 前端 `apiService.js` 的 `API_BASE = '/api'`，调用时写的是去前缀的相对路径
 * （`apiRequest('/upload')`），所以匹配必须同时试四种字面形态：
 * 完整路径 / 首个 `:param` 前的路径 / 去掉 `/api` 前缀 / 去掉前缀后到首个 `:param`。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 路由只在这些**声明文件**里找：`server/index.js`、`server/simple-server.js`、`server/routes/**` */
const DECL_RE = /(?:^|\/)index\.js$|(?:^|\/)simple-server\.js$|(?:^|\/)routes\//

/** 路由声明的形状：`app.get('/x')` / `router.post('/x')` */
const ROUTE_RE = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*'(\/[^']*)'/g

/** `app.use('/api/xxx', someRouterVar)` —— 前缀式挂载（r219 补：11 条这类，不补就整块漏扫） */
const USE_RE = /\bapp\.use\(\s*'(\/api\/[^']+)'\s*,\s*(\w+)\s*\)/g

/** `import someRouterVar from './routes/y.js'` —— 上面那个变量名指向哪个文件 */
const IMPORT_RE = /\bimport\s+(\w+)\s+from\s+'([^']+?)\.js'/g

/**
 * 运维 / 一次性端点前缀：它们是给手工脚本与后台运维用的，允许零调用方（不强制登记决定）。
 * ⛔ 收窄这份名单 = 让门禁更严；放宽它等于把新死端点悄悄放过去。
 */
export const OPS_PREFIXES = [
  '/api/admin/',
  '/api/diagnostics/',
  '/api/knowledge/',
  '/api/worksheets/',
  '/api/paper'
]

const toPosix = (p) => String(p).replace(/\\/g, '/')
const rel = (root, p) => toPosix(path.relative(root, p))

function collect(dir, root, accept) {
  let out = []
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('_r') || e.name === '.git') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out = out.concat(collect(p, root, accept))
    else if (accept(e.name)) out.push(rel(root, p))
  }
  return out
}

/**
 * ⛔ 自己不能当自己的调用方（r219 当场踩到）：`test/apiDeadEndpoint.test.mjs` 里列了
 * 「本轮实测的死端点」清单，而它自己也在 `test/**` 语料里 ⇒ 那几条端点的路径被自己的测试
 * 字符串命中，扫描立刻把它们判成「有人调」，**整把锁自己变成假绿**。
 * 门禁文件的文件名写死在这份名单里，别顺手删。
 */
const GATE_SELF_FILES = new Set(['apiDeadEndpoint.test.mjs', 'apiCallerAuditKit.mjs'])

const CORPUS_ACCEPT = (n) => {
  if (GATE_SELF_FILES.has(n)) return false
  return /\.(?:js|mjs|jsx|vue)$/.test(n)
}
const DECL_ACCEPT = (n) => /\.(?:js|mjs)$/.test(n)

/**
 * 扫出后端暴露的 API 端点，返回 `['POST /api/x', …]`。
 * 返回的是**相对路径**形态，便于比对 registry。
 */
export function scanServerEndpoints(root) {
  const out = []
  const files = collect(path.join(root, 'server'), root, DECL_ACCEPT)
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

  for (const f of files) {
    if (!DECL_RE.test(f)) continue
    const text = read(f)

    // ① 全路径声明：`router.post('/api/x')` / `app.get('/api/x')`
    ROUTE_RE.lastIndex = 0
    let m
    while ((m = ROUTE_RE.exec(text))) {
      const raw = m[2]
      if (!raw.startsWith('/api/')) continue
      out.push(`${m[1].toUpperCase()} ${raw}`)
    }

    // ② 前缀式挂载：`app.use('/api/xxx', v)` + `v` 指向 `routes/xxx.js` ⇒ 拼上 router 内的相对路径
    const varToFile = new Map()
    IMPORT_RE.lastIndex = 0
    let im
    while ((im = IMPORT_RE.exec(text))) {
      const base = path.posix.basename(im[2].replace(/^\.\//, ''))
      if (base) varToFile.set(im[1], `server/routes/${base}.js`)
    }
    USE_RE.lastIndex = 0
    let um
    while ((um = USE_RE.exec(text))) {
      const target = varToFile.get(um[2])
      if (!target) continue
      const inner = files.includes(toPosix(target)) ? read(target) : ''
      ROUTE_RE.lastIndex = 0
      let im2
      while ((im2 = ROUTE_RE.exec(inner))) {
        const rel = im2[2]
        if (rel === '/') out.push(`${im2[1].toUpperCase()} ${um[1]}`)
        else out.push(`${im2[1].toUpperCase()} ${um[1]}${rel.startsWith('/') ? rel : '/' + rel}`)
      }
    }
  }
  return [...new Set(out)]
}

/** 调用方语料：`src/**` + `scripts/**` + `test/**` + `server/scripts/**` 的可匹配源码全文。 */
export function buildCallerCorpus(root) {
  const dirs = ['src', 'scripts', 'test', 'server/scripts']
  const files = dirs.flatMap((d) => collect(path.join(root, d), root, CORPUS_ACCEPT))
  return files.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n')
}

/** 一个端点是否「有人调」——四种字面形态任一命中即算。 */
export function isReferenced(corpus, route) {
  const full = route.slice(route.indexOf(' ') + 1).trim()
  const cut = (s) => (s.indexOf(':') < 0 ? s : s.slice(0, s.indexOf(':')))
  const stripped = full.replace(/^\/api/, '')
  const keys = [full, cut(full), stripped, cut(stripped)]
  return keys.some((k) => k && corpus.includes(k))
}

/** 后端暴露、但全仓找不到调用方的端点。 */
export function findUnreferencedEndpoints(root) {
  const corpus = buildCallerCorpus(root)
  return scanServerEndpoints(root).filter((r) => !isReferenced(corpus, r))
}

/** 死端点分类：运维类（不强制登记决定） / 业务类（必须登记决定）。 */
export function classifyDead(unreferenced) {
  const isOps = (r) => OPS_PREFIXES.some((p) => r.slice(r.indexOf(' ') + 1).startsWith(p))
  return { ops: unreferenced.filter(isOps), business: unreferenced.filter((r) => !isOps(r)) }
}

/**
 * 审计「业务死端点有没有登记决定」。
 *
 * ⛔ 为什么判据必须对着**磁盘真实扫描**，而不是对着写死的清单（r216 同款教训）：
 * 显式清单只能证明「清单里的死端点在清单里」，**看不见新冒出来的死端点** ——
 * 谁加了一条后端路由忘了登记，它就永远没人调用，也永远没人发现。
 *
 * @param {string[]} businessDead 扫描出来的业务死端点
 * @param {Object} registry `{ endpoints: { 'GET /api/x': { reason } } }`
 * @returns {{missing: string[], stale: string[], badReason: string[]}} 失败原因（空 = 通过）
 */
export function auditRegistry(businessDead, registry) {
  const endpoints = (registry && registry.endpoints) || {}
  const registered = Object.keys(endpoints)
  return {
    missing: businessDead.filter((r) => !registered.includes(r)),
    stale: registered.filter((r) => !businessDead.includes(r)),
    badReason: registered.filter((r) => {
      const e = endpoints[r]
      return !e || typeof e.reason !== 'string' || e.reason.trim().length < 8
    })
  }
}
