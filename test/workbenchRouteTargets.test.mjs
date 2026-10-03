/**
 * 工作台「入口可达性」锁（2026-10-04 第 92 轮）
 *
 * 起因：第 91 轮下线了 /growth 与 /wrongbook 两个页面（留 redirect 兜底），
 * 这类改动最容易留下「点了没反应 / 落到空页」的死入口。审计时抓到第一个真家伙：
 *
 *   `StudentDetailWorkbench.vue` 的「下一步建议」在没有作业记录时给了一个
 *   `to: '/upload'` 的 CTA —— 工作台**根本没有上传页**（上传只在手机 App 里做）。
 *   点下去 vue-router 匹配不到路由，只打一条
 *   `[Vue Router warn]: No match found for location with path "/upload"` ——
 *   **warning 不是 error**，所以「0 控制台错误」这类断言永远抓不到它；
 *   表现是**内容区整片空白**（只剩侧栏），而新学生档案页上最大的那个主按钮
 *   恰好就是老师加完学生后第一个会点的地方。
 *
 * ⛔ 所以本锁的价值不在这一条，而在**这类死入口以后不可能再溜进来**：
 *    它把工作台里所有导航目标抠出来，逐个对着 router/index.js 的真实路由表验。
 *    path 字面量 / path 模板字面量 / 具名路由 三种写法都覆盖。
 *
 * 只读源码，不起浏览器（快、可在任何环境跑）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROUTER_SRC = readFileSync(join(ROOT, 'src/workbench/router/index.js'), 'utf8')

// ── 路由表 ──
const ROUTE_PATHS = [...new Set([...ROUTER_SRC.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]))]
const ROUTE_NAMES = [...new Set([...ROUTER_SRC.matchAll(/\bname:\s*'([^']+)'/g)].map((m) => m[1]))]
const STATIC_PATHS = ROUTE_PATHS.filter((p) => !p.includes(':'))
const DYNAMIC_PATHS = ROUTE_PATHS.filter((p) => p.includes(':'))

/** 一个目标路径能不能被路由表接住 */
function resolvable(raw) {
  let p = String(raw).split('#')[0].split('?')[0]
  p = p.replace(/\$\{[^}]*\}/g, ':x') // 模板字面量插值 → :param
  if (!p.startsWith('/')) return { ok: false, why: '不是绝对路径' }
  if (STATIC_PATHS.includes(p)) return { ok: true, hit: p }
  for (const d of DYNAMIC_PATHS) {
    const re = new RegExp('^' + d.replace(/:[^/]+/g, '[^/]+').replace(/\(\.\*\)/g, '.*') + '$')
    if (re.test(p)) return { ok: true, hit: d }
  }
  for (const d of DYNAMIC_PATHS) {
    const base = d.split('/:')[0]
    if (base && p.startsWith(base + '/')) return { ok: true, hit: d }
  }
  return { ok: false, why: '路由表里没有这条路径' }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|js|jsx)$/.test(name)) out.push(full)
  }
  return out
}

const PATH_EXTRACTORS = [
  [/router\.(?:push|replace)\(\s*'([^']+)'/g, 'router.push(字面量)'],
  [/router\.(?:push|replace)\(\s*\{\s*path:\s*'([^']+)'/g, 'router.push({path})'],
  [/router\.(?:push|replace)\(\s*\{\s*path:\s*`([^`]+)`/g, 'router.push({path:模板})'],
  [/\bgo\(\s*'([^']+)'/g, 'go(字面量)'],
  [/\bgo\(\s*`([^`]+)`/g, 'go(模板)'],
  [/<router-link[^>]*\bto="([^"]+)"/g, 'router-link to'],
  [/\bto:\s*'(\/[^']*)'/g, '动作对象 to'],
  [/\bto:\s*`([^`]+)`/g, '动作对象 to(模板)'],
]
const NAME_EXTRACTOR = /router\.(?:push|replace)\(\s*\{[^}]*\bname:\s*'([^']+)'/g

/**
 * 去掉注释再抠目标 —— ⛔ 必须去：第 92 轮的修复注释里就写着
 * 「这里原本给了一个 `to: '/upload'` 的 CTA」，不去注释会把说明文字当成真入口。
 * 用空格替换（保留换行与列偏移），这样报出来的行号仍然是真实行号。
 */
function stripComments(src) {
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([ \t]*)\/\/.*$/gm, (_m, indent) => indent)
}

/** 抠出工作台里所有导航目标（含所在文件与行号） */
function collectTargets() {
  const out = []
  for (const file of walk(join(ROOT, 'src/workbench'))) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
    const src = stripComments(readFileSync(file, 'utf8'))
    const lineOf = (idx) => src.slice(0, idx).split('\n').length
    for (const [re, kind] of PATH_EXTRACTORS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(src)) !== null) {
        if (!m[1].startsWith('/')) continue
        const r = resolvable(m[1])
        out.push({ file: rel, line: lineOf(m.index), kind, target: m[1], ok: r.ok, why: r.why })
      }
    }
    NAME_EXTRACTOR.lastIndex = 0
    let n
    while ((n = NAME_EXTRACTOR.exec(src)) !== null) {
      out.push({
        file: rel, line: lineOf(n.index), kind: 'router.push({name})', target: n[1],
        ok: ROUTE_NAMES.includes(n[1]), why: '路由表里没有这个名字'
      })
    }
  }
  return out
}

test('⛔ 工作台里每个导航目标都必须能被路由表接住（防「点了白屏」的死入口）', () => {
  const targets = collectTargets()
  assert.ok(targets.length > 25, `只抠出 ${targets.length} 个导航目标，提取器疑似失效`)
  const bad = targets.filter((t) => !t.ok)
  assert.deepEqual(
    bad.map((b) => `${b.file}:${b.line} [${b.kind}] ${b.target} → ${b.why}`),
    [],
    '存在路由表接不住的导航目标：点下去内容区会整片空白（vue-router 只打 warning，不报错）'
  )
})

test('⛔ 工作台不存在上传页，所以任何指向 /upload 的跳转都是错的', () => {
  // 上传只在手机 App 里做；工作台侧没有 /upload 路由。
  // 这条单列出来，是因为它已经真实发生过一次（第 92 轮修）。
  assert.ok(!ROUTE_PATHS.includes('/upload'), '工作台竟然有了上传页？那这条锁要跟着改')
  const offenders = collectTargets().filter((t) => t.target === '/upload' || t.target.startsWith('/upload/'))
  assert.deepEqual(offenders.map((o) => `${o.file}:${o.line}`), [],
    '有入口跳 /upload —— 工作台没有这个页面，点下去会白屏')
})

test('学生档案页「还没有作业记录」时不再给会白屏的按钮，而是说清去哪儿上传', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/workbench/views/StudentDetailWorkbench.vue'), 'utf8'))
  // 空档案分支：不许再有 to: '/upload'
  const at = src.indexOf('if (!tasks.value.length)')
  assert.ok(at > 0, '找不到空档案分支，判据要跟着改')
  const branch = src.slice(at, at + 700)
  assert.ok(!/to:\s*'\/upload'/.test(branch), '空档案分支又把 CTA 指回 /upload 了')
  assert.match(branch, /手机\s*App/, '空档案分支要说清「作业在手机 App 里上传」，否则老师不知道去哪儿传')
  // 没有 cta 的动作不能渲染按钮（否则会渲染出一个文案为空、点了没反应的按钮）
  assert.match(src, /<div v-if="nextAction\.cta" class="next-action__cta">/,
    'CTA 容器要按 nextAction.cta 有无来渲染：空 cta 会渲染出一个空白按钮')
})
