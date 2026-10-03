/**
 * 模块可达性回归锁（2026-10-04 第 94 轮）
 *
 * 背景：`src/components/HomeDashboard.jsx` 被同名顶替后变哑文件 —— App.jsx 里
 * `import HomeDashboard from './components/HomeDashboardV2'`，本地名仍叫 HomeDashboard，
 * 于是旧文件**看起来还在被用**，文本搜索根本发现不了。第 94 轮审计共清出 30 个
 * 这类「无任何路径可达」的死模块（死文件 / 被顶替页 / 死岛：互相引用但整链没人用）。
 *
 * 本锁从两个真实入口（index.html → src/main.jsx、workbench.html → src/workbench/main.js）
 * 做静态 import BFS：**src/ 下不允许存在任何不可达模块**。再出现死文件/死岛即红。
 *
 * 判红了怎么办：该文件要么删掉（小而美，不留「以后可能用」的尸体），
 * 要么把它接回 import 链；若确实是新的独立入口（新 html），把入口加进 ENTRIES。
 *
 * 边界（防误报）：
 *  - 只认字面量 import：静态 `from '...'`、动态 `import('...')`、`require('...')`、
 *    副作用 `import '...'`、`import.meta.glob`。全仓动态 import 均为字面量
 *    （r94 审计已核，无模板拼接盲区）。
 *  - vite 入口就这两个 html（r94 已核 vite.config rollupOptions.input）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRIES = ['src/main.jsx', 'src/workbench/main.js']
const SRC = path.join(ROOT, 'src')
const SRC_FILE = /\.(jsx?|vue|css|json)$/

/**
 * 存量不可达豁免表（与 mobilePageReachability 的 ALLOWED_ORPHANS 同纪律）：
 * 现在是空集。往里加东西 = 承认新增一个没人 import 的文件，必须同时写清
 * 为什么不能直接删也不能归档（先例：负责人未提交 WIP 草稿，fe4f941）。
 */
const ALLOWED_UNREACHABLE = new Set([])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (SRC_FILE.test(e)) out.push(path.relative(ROOT, p).replace(/\\/g, '/'))
  }
  return out
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec)
  for (const cand of [
    base, `${base}.jsx`, `${base}.js`, `${base}.vue`, `${base}.css`, `${base}.json`,
    path.join(base, 'index.jsx'), path.join(base, 'index.js'),
    path.join(base, 'index.vue'), path.join(base, 'index.css'),
  ]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return path.relative(ROOT, cand).replace(/\\/g, '/')
    }
  }
  return null
}

function reachableSet() {
  const all = walk(SRC)
  const allSet = new Set(all)
  const visited = new Set()
  const queue = [...ENTRIES]
  while (queue.length) {
    const f = queue.shift()
    if (visited.has(f) || !allSet.has(f)) continue
    visited.add(f)
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    const specs = []
    for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*|require\(\s*)['"]([^'"]+)['"]/g)) specs.push(m[1])
    for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specs.push(m[1])
    for (const s of specs) {
      const t = resolveSpec(f, s)
      if (t && allSet.has(t)) queue.push(t)
    }
    for (const m of src.matchAll(/import\.meta\.glob\(\s*['"]([^'"]+)['"]/g)) {
      const baseDir = path
        .relative(ROOT, path.resolve(path.dirname(path.join(ROOT, f)), m[1].replace(/^\.\//, '').replace(/\/\*\*\/.*$/, '')))
        .replace(/\\/g, '/')
      for (const c of all) if (c.startsWith(baseDir)) queue.push(c)
    }
  }
  return { all, visited }
}

test('⛔ src/ 下不允许存在不可达模块（死文件 / 被顶替页 / 死岛即红）', () => {
  const { all, visited } = reachableSet()
  const unreachable = all.filter((f) => !visited.has(f) && !ALLOWED_UNREACHABLE.has(f))
  assert.deepEqual(
    unreachable,
    [],
    `\n发现 ${unreachable.length} 个不可达模块（无任何 import 路径可达）：\n`
    + unreachable.map((f) => `  - ${f}`).join('\n')
    + '\n处理：删掉它（小而美），或接回 import 链；新独立入口则登记进本文件 ENTRIES。'
  )
})

test('锁自身健全性：入口存在且 BFS 确实走了一遍大图（防静默失效）', () => {
  for (const e of ENTRIES) {
    assert.ok(fs.existsSync(path.join(ROOT, e)), `入口 ${e} 不存在 —— 构入口变了必须同步改本锁`)
  }
  const { all, visited } = reachableSet()
  assert.ok(visited.size > 100, `BFS 只走到 ${visited.size} 个模块，疑似解析失配（应 >100）`)
  assert.ok(all.length >= visited.size)
})
