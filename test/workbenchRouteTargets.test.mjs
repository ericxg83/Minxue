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

// ─────────────────── ③ 「能解析」不等于「跳对地方」（r141） ───────────────────
//
//⛔ 前两条锁查不出 r141 这两个真缺陷，因为它们的路由**都存在**、都能解析：
//   ① `NextActions.vue` 的三条动作 run() 一律 push('/students') —— 那是学生**列表**页，
//      与「发重练卷」毫无关系；老师点完还得自己在列表里再找一遍这个学生。
//   ② knowledge 动作 push('/weekly-report') = 跳本页自己 ⇒ 点了毫无反应，
//      视觉上与「坏掉的按钮」无异，但它不报错、不白屏，前两条锁全部放行。
//
// ⇒本组判据：**动作的跳转目标不得是它自己所在的那一页**（点了等于没点）。
//   反向自检内联在下面，每条都在坏样本上验证过会红。

const NEXT_ACTIONS = 'src/workbench/components/diagnosis/NextActions.vue'

/** 诊断页（/weekly-report）里出现的、指向诊断页自身的跳转目标 */
function selfJumpTargets(src) {
  const code = stripComments(src)
  const out = []
  for (const m of code.matchAll(/router\.(?:push|replace)\(\s*\{?\s*path:\s*'\/weekly-report'/g)) {
    out.push({ at: m.index, text: m[0] })
  }
  return out
}

test('⛔ 动作不得跳回它自己所在的那一页（点了等于没点，但前两条锁查不出来）', () => {
  // 反向自检：坏样本必须被判红，否则本锁在历史修复合入后就成了空锁
  const badSample = `
    // 注释里的 to: '/weekly-report' 不算命中
    function run(action) {
      if (action.id === 'knowledge') {
        router.push({ path: '/weekly-report' })
      }
      router.push({ path: '/students' })
    }`
  assert.equal(selfJumpTargets(badSample).length, 1,
    '反向自检失效：跳本页的样本没被抓住，本锁已退化为空锁')

  const actual = selfJumpTargets(readFileSync(join(ROOT, NEXT_ACTIONS), 'utf8'))
  assert.deepEqual(
    actual.map((a) => a.text), [],
    `${NEXT_ACTIONS} 里有动作跳回本页（/weekly-report）——点了没有任何反应，看着像坏按钮`
  )
})

test('⛔ 带 cta 的动作要么能干活、要么显式禁用，不许「有 CTA 却哪也去不了」', () => {
  const code = stripComments(readFileSync(join(ROOT, NEXT_ACTIONS), 'utf8'))
  // 动作对象里必须出现 to（去某个具体地方）、scope（就地开预览弹窗）或 disabled: true（明说现在点不了）
  // r142：三条组卷动作的落点从 `to`（跳档案页）改成 `scope`（就地弹窗）——
  //      跳档案页不算做完，老师得自己在长列表里重筛一遍 49 道题。
  const actionBlocks = [...code.matchAll(/list\.push\(\{([\s\S]*?)\}\)/g)].map((m) => m[1])
  assert.ok(actionBlocks.length >= 3, `只抠出 ${actionBlocks.length} 个动作，提取器疑似失效`)

  const orphans = actionBlocks.filter(
    (b) => !/\bto:/.test(b) && !/\bscope:/.test(b) && !/disabled:\s*true/.test(b)
  )
  assert.deepEqual(
    orphans.map((b) => (b.match(/id:\s*'([^']+)'/) || [])[1] || b.slice(0, 40)), [],
    '这些动作既没有 to（跳去哪儿）、没有 scope（就地预览）、也没有 disabled: true（明说不可点）—— 属于点了没反应的坏按钮'
  )
})

test('⛔ 诊断动作清单必须接住学生上下文，否则跳过去落不到人身上', () => {
  const code = stripComments(readFileSync(join(ROOT, NEXT_ACTIONS), 'utf8'))
  // r141：三条动作全push('/students')（学生列表页）而不是这名学生的档案页。
  // 判据：组件必须声明 studentId prop，且落点由它拼出（而不是硬编码列表路径）。
  assert.match(code, /studentId:\s*\{\s*type:\s*String/, '组件没有接 studentId，无法定位到具体学生')
  assert.match(code, /\/students\/\$\{/, '落点应由 studentId 拼出（/students/:id），不能硬编码学生列表页')

  // 调用方必须真的把它传下来 —— prop 声明了但父组件没传，等于仍然落不到人身上
  const caller = stripComments(readFileSync(join(ROOT, 'src/workbench/views/WeeklyReportWorkbench.vue'), 'utf8'))
  assert.match(caller, /:student-id="selectedStudentId"/,
    '学习诊断页没把 selectedStudentId 传给动作清单 —— prop 声明了但没传，落点仍会丢学生')
})
