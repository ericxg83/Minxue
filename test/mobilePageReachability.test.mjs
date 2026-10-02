/**
 * 移动端页面可达性锁（2026-10-02）
 *
 * 背景：src/pages/WrongBookPage.jsx（V1 版式）在被 V2 取代后以孤儿身份躺在仓库里数月——
 * 没有任何 import，却持续吃 lint 噪声、误导「改错题本要改哪个文件」的判断。
 * V1/V2 并存的死角靠人肉记忆守不住，改由闸门看守：入口到不了的文件即红。
 *
 * 规则（防误报）：
 *  1. 从 src/main.jsx 出发做 BFS，跟 import / export-from / 动态 import() 的路径说明符；
 *  2. 只解析 .js/.jsx（含目录 index.*），css/图片等资源直接跳过；
 *  3. 第三方包（非 . 开头且非 @/ 别名）不入图；
 *  4. src/workbench 子树另有入口（workbench.html），不参与移动端可达性判定；
 *  5. 判定范围只到 src/pages/**，其余目录（components/services/...）暂不入闸，避免一次性拉高噪声。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')
const PAGES = path.join(SRC, 'pages')
const ENTRY = path.join(SRC, 'main.jsx')
const CODE_EXT = ['.jsx', '.js']

function isCodeFile(p) {
  return CODE_EXT.includes(path.extname(p)) && !/\.bak/.test(p)
}

/** 把说明符解析为磁盘上的代码文件；非代码/第三方包返回 null */
function resolveSpecifier(spec, fromFile) {
  if (!spec) return null
  let base = null
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  if (!base) return null
  const candidates = [base]
  for (const ext of CODE_EXT) {
    candidates.push(base + ext)
    candidates.push(path.join(base, 'index' + ext))
  }
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile() && isCodeFile(c)) return c
    } catch {
      /* 该候选不存在，继续下一个 */
    }
  }
  return null
}

function collectSpecifiers(src) {
  const specs = []
  // import x from '...' / import { a } from '...' / export { a } from '...'
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^\n;]*?\bfrom\s*['"]([^'"]+)['"]/g)) specs.push(m[1])
  // 副作用导入 import '...'
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) specs.push(m[1])
  // 动态导入 import('...')
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1])
  return specs
}

function reachableFrom(entry) {
  const seen = new Set()
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file)) continue
    if (file.startsWith(path.join(SRC, 'workbench') + path.sep)) continue // 工作台另有入口
    seen.add(file)
    let src = ''
    try {
      src = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const spec of collectSpecifiers(src)) {
      const resolved = resolveSpecifier(spec, file)
      if (resolved && !seen.has(resolved)) queue.push(resolved)
    }
  }
  return seen
}

function listPageFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listPageFiles(full))
    else if (isCodeFile(entry.name)) out.push(full)
  }
  return out
}

test('src/pages 下每个代码文件都必须从 main.jsx 可达（孤儿页面即红）', () => {
  const reachable = reachableFrom(ENTRY)
  const orphans = listPageFiles(PAGES)
    .filter((f) => !reachable.has(f))
    .map((f) => path.relative(ROOT, f))
  assert.deepEqual(
    orphans,
    [],
    `\n发现 ${orphans.length} 个不可达的页面文件（入口 import 链到不了）：\n` +
      orphans.map((f) => `  - ${f}`).join('\n') +
      '\n要么接回入口，要么归档移出仓库（cp 到 D:\\Minxue_Archive\\auto-日期\\ 后 git rm），不要留着当死角。'
  )
})

test('锁健壮性：入口与页面清单必须解析到内容（防止闸门空转）', () => {
  assert.ok(fs.existsSync(ENTRY), 'src/main.jsx 应存在')
  const pages = listPageFiles(PAGES)
  assert.ok(pages.length >= 8, `src/pages 应扫出至少 8 个代码文件，实际 ${pages.length}`)
  const reachable = reachableFrom(ENTRY)
  assert.ok(reachable.size >= 20, `入口可达文件应不少于 20 个，实际 ${reachable.size}（解析器可能失效）`)
})
