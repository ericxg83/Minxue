/**
 * 死声明清理器（A 级，行为保持）—— 删除「声明了但全文件从未引用」的顶层/局部声明块。
 *
 * 背景（2026-10-03 负责人裁决⑤「开」）：lint 的 `no-unused-vars` 里还剩一批**多行声明块**
 * （单行完整声明此前几轮已清完）。这类死代码不影响行为，但会持续制造噪声、误导后来者，
 * 也是「系统随时间膨胀」的最小可清理项。
 *
 * 与"看到 warning 就删"的区别：本工具用真 AST（espree）判定，**只在可证明无副作用时才删**：
 *   ① 只处理 `no-unused-vars` 报出的、且声明节点是 VariableDeclarator / FunctionDeclaration /
 *      ClassDeclaration 的项；函数参数、解构模式、import 一律跳过（删它们会改行为或改加载）。
 *   ② VariableDeclaration 必须是「单声明子句」——`const a = 1, b = 2;` 这种多子句不碰。
 *   ③ 初始化表达式必须**无副作用**：字面量 / 标识符 / 成员访问 / 函数与箭头函数 / 对象数组模板
 *      （递归判定）/ 一元二元三元逻辑表达式（递归判定）。出现 CallExpression、NewExpression、
 *      AwaitExpression、YieldExpression、UpdateExpression、AssignmentExpression、`this`、
 *      正则字面量之外的任何调用形态 → 判为有副作用，**保留并报告**（例：`const x = await f()`
 *      删掉就等于删掉那次调用）。
 *   ④ 删除用 AST 给出的精确字符区间（不是按行数配平），并顺带吃掉行首缩进与行尾换行。
 *
 * 用法：
 *   node scripts/pruneDeadDeclarations.mjs                 # 演练：列出可删/保留清单，零改写
 *   node scripts/pruneDeadDeclarations.mjs --apply         # 实际删除（随后必须跑测试+构建）
 *   node scripts/pruneDeadDeclarations.mjs --apply --only src/
 *   node scripts/pruneDeadDeclarations.mjs --apply --limit=8
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'espree'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const onlyIdx = argv.indexOf('--only')
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1] : null
const limitIdx = argv.indexOf('--limit')
const LIMIT = limitIdx >= 0 ? parseInt(argv[limitIdx + 1], 10) || 0 : 0

// ── 1. 取 eslint 的 no-unused-vars 报告（复用现有 eslint.config.js，口径不漂移）──
const JSON_PATH = path.join(ROOT, 'tmp', 'prune-lint.json')
fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true })
try {
  // 不用 `npx`：Windows 下 spawn 不解析 .cmd，会静默不产出报告文件
  fs.rmSync(JSON_PATH, { force: true })
  execFileSync(process.execPath,
    [path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'), '.', '-f', 'json', '-o', 'tmp/prune-lint.json'],
    { cwd: ROOT, stdio: 'pipe' })
} catch {
  // eslint 退出码非 0 只代表有 error（本仓库存量 14 条），报告文件已写出，继续往下读
}
if (!fs.existsSync(JSON_PATH)) {
  console.error('❌ eslint 未产出报告（tmp/prune-lint.json 缺失），中止，不改任何文件')
  process.exit(1)
}
const report = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))

const warnings = []
for (const f of report) {
  for (const m of f.messages || []) {
    if (m.ruleId !== 'no-unused-vars') continue
    warnings.push({ file: path.relative(ROOT, f.filePath).replace(/\\/g, '/'), line: m.line, column: m.column, name: (m.message.match(/^'([^']+)'/) || [])[1], message: m.message })
  }
}

// ── 2. 副作用判定 ──
const IMPURE = new Set(['CallExpression', 'NewExpression', 'AwaitExpression', 'YieldExpression', 'UpdateExpression', 'AssignmentExpression', 'ImportExpression', 'TaggedTemplateExpression', 'MetaProperty', 'ThisExpression', 'Super'])
function isPure(node, depth = 0) {
  if (!node) return true              // 无初始化（如 `let x;`）
  if (depth > 12) return false
  if (IMPURE.has(node.type)) return false
  switch (node.type) {
    case 'Literal': case 'TemplateLiteral': return true
    case 'Identifier': return node.name !== 'undefined' ? true : true
    case 'TemplateElement': return true
    case 'MemberExpression': return isPure(node.object, depth + 1) && (node.computed ? isPure(node.property, depth + 1) : true)
    case 'ObjectExpression': return node.properties.every(p => p.type === 'SpreadElement' ? isPure(p.argument, depth + 1) : isPure(p.value, depth + 1) && (!p.computed || isPure(p.key, depth + 1)))
    case 'ArrayExpression': return node.elements.every(e => isPure(e, depth + 1))
    case 'FunctionExpression': case 'ArrowFunctionExpression': case 'ClassExpression': return true  // 函数体在调用前不执行
    case 'UnaryExpression': case 'BinaryExpression': case 'LogicalExpression': return isPure(node.argument || node.left, depth + 1) && (!node.right || isPure(node.right, depth + 1))
    case 'ConditionalExpression': return isPure(node.test, depth + 1) && isPure(node.consequent, depth + 1) && isPure(node.alternate, depth + 1)
    case 'SequenceExpression': return false  // 逗号表达式常藏副作用
    case 'SpreadElement': return isPure(node.argument, depth + 1)
    case 'ChainExpression': return isPure(node.expression, depth + 1)
    default: return false
  }
}

/** 收集文件里所有候选声明（显式递归，不依赖 parent 指针） */
function collectDeclarations(src, file) {
  let ast
  try {
    ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', loc: true, range: true, jsx: /\.(jsx?|mjs|cjs)$/.test(file) })
  } catch { return null }   // 解析不了（.vue 等）→ 整个文件跳过
  const found = []
  const walkParams = (p) => {
    if (!p) return
    if (p.type === 'Identifier') { found.push({ name: p.name, line: p.loc?.start.line, col: (p.loc?.start.column || 0) + 1, kind: 'param', multiDeclarator: true, pure: false }); return }
    if (p.type === 'AssignmentPattern' && p.left?.type === 'Identifier') { found.push({ name: p.left.name, line: p.left.loc?.start.line, col: (p.left.loc?.start.column || 0) + 1, kind: 'param', multiDeclarator: true, pure: false }); return }
    // 解构参数/剩余参数：不登记，归到「删不得」
  }
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const n of node) walk(n); return }
    if (typeof node.type !== 'string') return
    if (node.type === 'VariableDeclaration') {
      const multi = node.declarations.length > 1
      for (const d of node.declarations || []) {
        if (d.id?.type === 'Identifier') {
          found.push({
            name: d.id.name, line: d.id.loc?.start.line, col: d.id.loc?.start.column + 1,
            kind: 'var', start: node.range[0], end: node.range[1],
            multiDeclarator: multi, pure: isPure(d.init)
          })
        } else {
          // 解构声明（const { a, b } = x）：整条删不得，只记录以便匹配时跳过
          found.push({ name: null, line: d.id?.loc?.start.line, kind: 'pattern', multiDeclarator: true, pure: false })
        }
        walk(d.init)
      }
      return
    }
    if (node.type === 'ImportDeclaration') {
      for (const s of node.specifiers || []) {
        found.push({
          name: s.local?.name, line: s.local?.loc?.start.line, col: (s.local?.loc?.start.column || 0) + 1,
          kind: 'import', start: s.range[0], end: s.range[1],
          // 同模块还有其他说明符时，删本说明符不会改变模块加载（副作用不变）
          multiDeclarator: node.specifiers.length <= 1, pure: true
        })
      }
      return
    }
    if (node.type === 'FunctionDeclaration' && node.id) {
      found.push({ name: node.id.name, line: node.id.loc?.start.line, col: node.id.loc?.start.column + 1, kind: 'function', start: node.range[0], end: node.range[1], multiDeclarator: false, pure: true })
      for (const pp of node.params || []) walkParams(pp)
      walk(node.body)   // 函数体内部的死局部变量也可删；重叠区间在删除前会去重（只保留外层）
      return
    }
    if (node.type === 'ClassDeclaration' && node.id) {
      found.push({ name: node.id.name, line: node.id.loc?.start.line, col: node.id.loc?.start.column + 1, kind: 'class', start: node.range[0], end: node.range[1], multiDeclarator: false, pure: isPure(node.superClass) })
      return
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range' || key === 'parent') continue
      walk(node[key])
    }
  }
  walk(ast)
  return found
}

// ── 3. 匹配 + 决策 ──
const fileCache = new Map()
const deletable = []
const kept = []
for (const w of warnings) {
  if (ONLY && !w.file.startsWith(ONLY)) continue
  if (!/\.(jsx?|mjs|cjs)$/.test(w.file)) { kept.push({ ...w, why: '非 js 文件（.vue 模板层另说）' }); continue }
  let decls = fileCache.get(w.file)
  if (decls === undefined) {
    try { decls = collectDeclarations(fs.readFileSync(path.join(ROOT, w.file), 'utf8'), w.file) } catch { decls = null }
    fileCache.set(w.file, decls)
  }
  if (!decls) { kept.push({ ...w, why: '解析失败' }); continue }
  const hit = decls.find(d => d.name === w.name && d.line === w.line && d.col === w.column)
    || decls.find(d => d.name === w.name && Math.abs((d.line || 0) - w.line) <= 1)
  if (!hit) { kept.push({ ...w, why: '未匹配到声明（函数体内局部变量/闭包变量等）' }); continue }
  if (hit.kind === 'param') { kept.push({ ...w, why: '函数参数（删参数会改调用契约）' }); continue }
  if (hit.kind === 'import') { kept.push({ ...w, why: hit.multiDeclarator ? 'import 说明符（它是该模块唯一导入，删了会改变模块加载副作用）' : 'import 说明符（同模块还有其他导入，下一批可安全删）' }); continue }
  if (hit.kind === 'var' && hit.multiDeclarator) { kept.push({ ...w, why: '多声明子句（只删一个会改语义）' }); continue }
  if (!hit.pure) { kept.push({ ...w, why: '初始化含调用/await 等副作用，删了等于删掉那次执行' }); continue }
  deletable.push({ ...w, kind: hit.kind, start: hit.start, end: hit.end })
}
if (LIMIT) deletable.length = Math.min(deletable.length, LIMIT)

const byFile = new Map()
for (const d of deletable) {
  if (!byFile.has(d.file)) byFile.set(d.file, [])
  byFile.get(d.file).push(d)
}
// 区间去重：外层声明（整个死函数）与它体内的死局部变量会重叠，只保留外层，
// 否则两处 splice 会互相错位把文件写坏。
let droppedNested = 0
for (const [file, list] of byFile.entries()) {
  list.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const keptRanges = []
  const out = []
  for (const d of list) {
    if (keptRanges.some(([s, e]) => d.start >= s && d.end <= e)) { droppedNested++; continue }
    keptRanges.push([d.start, d.end]); out.push(d)
  }
  byFile.set(file, out)
}
const totalDeletable = [...byFile.values()].reduce((n, l) => n + l.length, 0)
console.log(`${APPLY ? '【实际删除】' : '【演练，零改写】'} 可安全删除 ${totalDeletable} 条（分布在 ${byFile.size} 个文件，已去掉 ${droppedNested} 条与外层重叠的内层项）；保留并报告 ${kept.length} 条`)
for (const [file, list] of [...byFile.entries()].sort()) {
  console.log(`\n  ${file}  (${list.length})`)
  for (const d of list.sort((a, b) => a.line - b.line)) console.log(`    L${d.line} ${d.kind} ${d.name}`)
}
const reasonBuckets = {}
for (const k of kept) reasonBuckets[k.why] = (reasonBuckets[k.why] || 0) + 1
console.log('\n保留原因分布：')
for (const [why, n] of Object.entries(reasonBuckets).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${why}`)

if (!APPLY) {
  console.log('\n（演练结束，未改写任何文件。加 --apply 执行删除。）')
  process.exit(0)
}

// ── 4. 按精确区间删除 ──
// 删除范围从「语句字符区间」扩展到「整行 + 紧邻上方的文档注释块 + 同行尾部注释」：
// 只抽走语句会留下孤儿 JSDoc（给一个已经不存在的函数写文档），比死代码更误导人。
// 保守规则：上吞只在注释块**紧贴**声明（中间无空行）且形态完整（// 系列，或 /* … */ 闭合）时生效。
function expandRange(src, start, end) {
  let from = start
  while (from > 0 && (src[from - 1] === ' ' || src[from - 1] === '\t')) from--
  let to = end
  let lineEnd = src.indexOf('\n', to)
  if (lineEnd === -1) lineEnd = src.length
  if (/^\s*(\/\/.*)?$/.test(src.slice(to, lineEnd))) to = lineEnd   // 行尾只有空白或行注释 → 一并吃掉
  if (src[to] === '\n') to++
  else if (src[to] === '\r' && src[to + 1] === '\n') to += 2
  // 上吞紧邻的注释块（中间不得有空行，形态必须完整）
  const prior = src.slice(0, from).split('\n')
  prior.pop()   // from 所在行的前缀（行首对齐后为空）
  const collected = []
  for (let i = prior.length - 1; i >= 0; i--) {
    const t = (prior[i] || '').trim()
    if (!t || !/^(\/\/|\/\*|\*|\*\/)/.test(t)) break
    collected.unshift(prior[i])
  }
  if (collected.length) {
    const isLineComments = collected.every(l => l.trim().startsWith('//'))
    // 允许单行块注释（/** 有界的线 */）：首行以 /* 开、尾行以 */ 闭，同一行也成立
    const isBlockComment = collected[0].trim().startsWith('/*') && collected[collected.length - 1].trim().endsWith('*/')
    if (isLineComments || isBlockComment) {
      const tailText = collected.join('\n') + '\n'
      const cut = from - tailText.length
      if (cut >= 0 && src.slice(cut, from) === tailText) from = cut
    }
  }
  return [from, to]
}

let written = 0
let removedLines = 0
for (const [file, list] of byFile.entries()) {
  const p = path.join(ROOT, file)
  let src = fs.readFileSync(p, 'utf8')
  const expanded = list.map(d => expandRange(src, d.start, d.end)).sort((a, b) => b[0] - a[0])
  for (const [from, to] of expanded) {
    removedLines += (src.slice(from, to).match(/\n/g) || []).length
    src = src.slice(0, from) + src.slice(to)
  }
  fs.writeFileSync(p, src, 'utf8')
  written++
}
console.log(`\n已改写 ${written} 个文件，共移除了 ${removedLines} 行（含紧邻的孤儿文档注释）。`)
console.log('下一步必须：node --check（.js）+ npm test + npx vite build + 冒烟')
process.exit(0)
