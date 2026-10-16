/**
 * serverModuleReachabilityKit.mjs —— server 侧模块「零引用」判据（唯一实现，r299）
 *
 * 为什么要有这个（r299，2026-10-16）：
 *   `src/` 早有模块可达性闸（test/moduleReachability.test.mjs，r94 起：双入口 BFS，
 *   不可达模块即红），**server 侧却只有路由级门禁**（test/apiDeadEndpoint.test.mjs，
 *   r219：新路由必须有调用方或登记）。模块级缺口真实存在过：r297 用一次性探针扫出
 *   两个自出生起零导入方的死模块（pageRuler / figureCompleteness，已删）——
 *   探针用完即删，同类缺陷可以原样复发（r216「门禁看着在其实没在」同型）。
 *   本 kit 把 r297 探针的判据固化为常驻门禁。
 *
 * 判据语义（刻意与 r297 探针一致，先证后锁）：
 *   server 范围内每个模块，必须在「代码语料」里至少被一处引用（剔除自引用），
 *   否则必须登记在 HAND_RUN（含理由）。引用 = 可解析的路径字符串：
 *     · import ... from '...' / import '...' / require('...') / import('...')
 *     · spawn/CLI 形态：'node server/xxx.js'（package.json scripts、.cmd/.vbs）
 *   语料 = 全仓代码/配置文件（js/mjs/cjs/jsx/vue/ts/tsx/json/cmd/vbs），
 *   **注释与 .md 文档不算引用**（r234 教训：散文里提到路径不算「有人调」）。
 *
 * ⚠️ 已知边界（写进来自律，不假装完备）：
 *   ① 「测试/存档脚本引用也算数」——比 BFS 松：只被 test/ 或 server/scripts/
 *      存档件引用的模块不算死。收紧成生产 BFS 是后续可选项（会更严、误报更多）。
 *   ② 计算拼接的动态路径不可解析（import(`./x/${f}`)）——所以 server/migrations/
 *      整体不在扫描范围（迁移 lineage 属 C 级领地，由 migrate 体系管）。
 *   ③ 语料掩码是字符串感知的注释剥离，正则字面量可能造成掩码偏移；r297 探针在
 *      真实树上验证过结论稳定（10 个零引用全部可解释）。
 *
 * ⛔ 自引用排除：本门禁自己的两个文件（SELF_FILES）不算引用方——HAND_RUN 的
 *   理由文本里含着模块路径字符串，不排除的话「登记项已被接线」的 stale 检查
 *   永远为真，登记永远判红。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 算「模块」的扩展名 */
export const CODE_EXT = new Set(['.js', '.mjs', '.cjs'])

/** 算「语料」的扩展名（引用可能出现在任何代码/配置/启动脚本里） */
export const CORPUS_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.vue', '.ts', '.tsx', '.json', '.cmd', '.vbs'])

/** 测试文件不是「被导入的模块」（由 node --test 驱动，不进可达性范围） */
export const TEST_FILE_RE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/

/** 语料单文件大小上限：round 产物/数据转存（_lint_all.json 4MB 级）不进语料 */
export const MAX_CORPUS_BYTES = 512 * 1024

/**
 * 零字节文件不是可导入模块（server/routes/tasks.js 是 .gitignore:86 显式忽略的
 * 0 字节本机占位件，r297 已回验）⇒ 扫描范围直接排除，无需登记。
 */
export const MIN_MODULE_BYTES = 1

/** 本门禁自己的文件——其中的路径字符串是登记簿，不是引用（见文件头⛔） */
export const SELF_FILES = ['test/serverModuleReachabilityKit.mjs', 'test/serverModuleReachability.test.mjs']

/**
 * server/ 下不进可达性范围的子树（每条都有理由，不许随手加）：
 *   - scripts/    刻意存档区（~150 个一次性件，HANDOFF:903「存档不动」）；
 *                 它们**进语料**（存档件引用服务模块算使用），但不作为候选。
 *   - migrations/ DB 迁移 lineage（C 级领地；旧 .js 迁移由 migrate 体系灌入，
 *                 现无执行入口，计算拼接路径不可解析）。
 *   - tests/      测试目录（其中的 .test.* 已按 TEST_FILE_RE 剔除；目录整体排除）。
 */
export const SERVER_SCOPE_EXCLUDE = ['scripts/', 'migrations/', 'tests/']

/**
 * 登记簿：零引用但**有意为之**的手跑件（r299 在真实树上逐个回验）。
 * ⚠️ 纪律（仿 testSuiteCoverageKit.EXCLUDED）：一条一由、理由非空、不含 '|'；
 *   登记项凭空消失或已被接线都会判红——登记簿必须保持诚实。
 */
export const HAND_RUN = [
  { path: 'server/migrate.js', reason: '手跑迁移件：头部自述 console 跑内联 SQL 清单后 process.exit，无调用方是设计形态' },
  { path: 'server/init-db.mjs', reason: '手跑建库件：一次性初始化（dotenv + 建表），终端执行' },
  { path: 'server/analyze_env.js', reason: '手跑环境检查件：终端跑的环境变量/连通性体检' },
  { path: 'server/check_env.js', reason: '手跑环境检查件：终端跑的环境变量体检（与 analyze_env 同族）' },
  { path: 'server/test_oss.js', reason: '手跑 OSS 直连测试件：头部自述「在 server 目录运行」' },
  { path: 'server/auto_debug.js', reason: '手跑调试件：自带 test() runner 的临时调试脚本' },
  { path: 'server/retryPendingTasks.js', reason: '手跑任务重试件：终端执行的重试 pending 任务一次性工具' },
  { path: 'server/fixExistingAnswers.js', reason: '一次性修复件：头部自述使用方式 node server/fixExistingAnswers.js（补历史空答案）' },
  { path: 'server/simple-server.js', reason: '2024 早期 mock 原型 express（mock 练习册数据演示件），零引用；去留另案（r299 报告留痕，勿当活服务）' }
]

// ────────────────────────────────────────────────────────────────────────────
// 注释掩码（引用必须来自活代码；散文/注释里提到路径不算「有人调」，r234 教训）
// ────────────────────────────────────────────────────────────────────────────

/** JS/JSON：剥离块注释与行注释，字符串原样保留（字符串感知，避免把 URL 的 // 当注释） */
export function maskComments(src, ext = '.js') {
  if (ext === '.cmd' || ext === '.vbs') return maskCmdOrVbs(src, ext === '.vbs')
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      out += ' '
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i)
      i = end === -1 ? n : end
      out += ' '
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      out += c
      i++
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue }
        if (src[i] === q) { out += src[i]; i++; break }
        out += src[i]
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

function maskCmdOrVbs(src, isVbs) {
  return src
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (isVbs ? t.startsWith("'") : (/^rem(\s|$)/i.test(t) || t.startsWith('::'))) return ''
      return line
    })
    .join('\n')
}

const STR_RE = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g

/** 抽出全部引号字符串（单引号/双引号/模板 literal） */
export function extractQuotedStrings(src) {
  const strs = []
  STR_RE.lastIndex = 0
  let m
  while ((m = STR_RE.exec(src))) strs.push(m[1] ?? m[2] ?? m[3] ?? '')
  return strs
}

// ────────────────────────────────────────────────────────────────────────────
// 路径解析（相对/仓库根相对/无扩展名/目录 index/spawn 前缀，五种形态）
// ────────────────────────────────────────────────────────────────────────────

function tryFile(p) {
  try { return fs.statSync(p).isFile() ? p : null } catch { return null }
}

/**
 * 把「可能是模块路径」的字符串解析成仓库根相对 POSIX 路径；不是路径返回 null。
 * 形态：'./x.js' / '../s/x.js' / 'server/x.js'（仓库根相对）/
 *       './x'（无扩展名，CJS require）/ './dir'（目录 → index）/
 *       'node server/x.js' 或 'node server\x.js'（package.json scripts / .cmd / .vbs）
 */
export function resolveSpecifier(spec, fromDir, root) {
  if (typeof spec !== 'string') return null
  let s = spec.trim()
  if (!s || s.includes('\n')) return null
  s = s.replace(/\\/g, '/')
  s = s.replace(/^node(?:\.exe)?\s+/, '')
  if (!s.startsWith('.') && !/^(server|scripts|test|src|database)\//.test(s)) return null
  const base = s.startsWith('.') ? path.resolve(fromDir, s) : path.resolve(root, s)
  const direct = tryFile(base)
  if (direct) return direct
  for (const ext of ['.js', '.mjs', '.cjs', '.jsx', '.ts']) {
    const f = tryFile(base + ext)
    if (f) return f
  }
  for (const idx of ['index.js', 'index.mjs', 'index.cjs']) {
    const f = tryFile(path.join(base, idx))
    if (f) return f
  }
  return null
}

// ────────────────────────────────────────────────────────────────────────────
// 扫描
// ────────────────────────────────────────────────────────────────────────────

const SKIP_DIR = (name) =>
  name === 'node_modules' ||
  name === 'tmp' ||
  name === 'external' ||
  name === 'dist' ||
  name === 'backups' ||
  name === 'logs' ||
  name.startsWith('dist_nightly') ||
  name.startsWith('.') ||
  name.startsWith('_')

function walkDir(dir, out = []) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const ent of ents) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (SKIP_DIR(ent.name)) continue
      walkDir(p, out)
    } else if (!ent.name.startsWith('_')) out.push(p)
  }
  return out
}

const toPosix = (p) => String(p).replace(/\\/g, '/')

/** server 范围内候选模块（仓库根相对 POSIX 路径，已排序） */
export function collectInScopeModules(root) {
  const serverDir = path.join(root, 'server')
  const out = []
  for (const f of walkDir(serverDir)) {
    if (!CODE_EXT.has(path.extname(f))) continue
    if (TEST_FILE_RE.test(path.basename(f))) continue
    try { if (fs.statSync(f).size < MIN_MODULE_BYTES) continue } catch { continue }
    const sub = toPosix(path.relative(serverDir, f))
    if (SERVER_SCOPE_EXCLUDE.some((p) => sub.startsWith(p))) continue
    out.push(toPosix(path.relative(root, f)))
  }
  return out.sort()
}

/** 引用语料文件（仓库根相对 POSIX 路径，已排序；含 server/scripts 存档区） */
export function collectCorpusFiles(root) {
  const out = []
  for (const f of walkDir(root)) {
    if (!CORPUS_EXT.has(path.extname(f))) continue
    try { if (fs.statSync(f).size > MAX_CORPUS_BYTES) continue } catch { continue }
    out.push(toPosix(path.relative(root, f)))
  }
  return out.sort()
}

/**
 * 扫全仓：返回 { modules, usage, stats }。
 * usage: Map<模块路径, Set<引用方路径>>（已剔除自引用）。
 */
export function scanModuleUsage(root) {
  const modules = collectInScopeModules(root)
  const corpus = collectCorpusFiles(root)
  const usage = new Map(modules.map((m) => [m, new Set()]))
  const stats = { modules: modules.length, corpusFiles: corpus.length, resolvedSpecifiers: 0 }
  for (const f of corpus) {
    let src
    try { src = fs.readFileSync(f, 'utf8') } catch { continue }
    const ext = path.extname(f)
    const masked = maskComments(src, ext)
    const fromDir = path.dirname(f)
    const relF = toPosix(path.relative(root, f))
    for (const s of extractQuotedStrings(masked)) {
      const resolved = resolveSpecifier(s, fromDir, root)
      if (!resolved) continue
      const key = toPosix(path.relative(root, resolved))
      stats.resolvedSpecifiers++
      const importers = usage.get(key)
      if (importers && relF !== key) importers.add(relF)
    }
  }
  return { modules, usage, stats }
}

// ────────────────────────────────────────────────────────────────────────────
// 审计（判据只有这一份；测试与反向自检共用，防两边漂移成假绿）
// ────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {string[]} input.modules   扫描出的候选模块
 * @param {Map<string, Set<string>>} input.usage  模块 → 引用方集合
 * @param {Array<{path:string, reason:string}>} input.handRun 登记簿
 * @param {string[]} input.selfFiles 门禁自己的文件（不算引用方）
 * @returns {string[]} 失败原因（空数组 = 通过）；每条都点名到具体模块
 */
export function auditModuleUsage({ modules, usage, handRun, selfFiles = [] }) {
  const fails = []
  // 元判据 0：扫不出模块时不许判绿（扫描一坏，整把锁变永真）
  if (!Array.isArray(modules) || modules.length === 0) {
    fails.push('候选模块清单为空（扫描本身失效）—— 扫描失效时必须判红，不能静默判绿')
    return fails
  }
  const modSet = new Set(modules)
  const self = new Set(selfFiles)
  const handMap = new Map()
  for (const entry of handRun) {
    if (!entry || typeof entry.path !== 'string' || !entry.path) {
      fails.push('HAND_RUN 条目必须含非空 path 字符串')
      continue
    }
    if (handMap.has(entry.path)) fails.push(`HAND_RUN 重复登记：${entry.path}`)
    handMap.set(entry.path, entry)
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      fails.push(`HAND_RUN 条目理由为空：${entry.path}（登记必须写清为什么零引用也没关系）`)
    } else if (entry.reason.includes('|')) {
      fails.push(`HAND_RUN 理由含 '|'（${entry.path}）—— 一条一由，别把多个决定塞进一个字符串`)
    }
    if (!modSet.has(entry.path)) {
      fails.push(`HAND_RUN 登记的 ${entry.path} 不在扫描范围里（文件不存在/被改名/被 0 字节规则剔除）—— 登记项失效，请同步`)
    }
  }
  for (const mod of modules) {
    const importers = [...(usage.get(mod) || [])].filter((f) => f !== mod && !self.has(f))
    if (importers.length === 0 && !handMap.has(mod)) {
      fails.push(`${mod} 零引用且未登记 HAND_RUN —— 接线它，或按流程登记理由（新死模块即红）`)
    }
    if (importers.length > 0 && handMap.has(mod)) {
      fails.push(`${mod} 已登记 HAND_RUN 但现在有引用了（${importers.slice(0, 3).join(', ')}${importers.length > 3 ? ' 等' : ''}）—— 请把该条从 HAND_RUN 移除`)
    }
  }
  return fails
}
