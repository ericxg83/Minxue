#!/usr/bin/env node
/**
 * 技能引用体检（scripts/check-skill-refs.mjs）
 *
 * 背景：Agent 技能（~/.workbuddy-ai/skills/）是「未来会话照抄执行的作业指导书」。
 * 里面的路径写错、引用了已删除的临时脚本、或行号漂移，都会让下一个会话白干。
 * 2026-10-04 手工审计 6 轮才把这类问题清干净 ⇒ 固化成一条命令，以后随代码演进随时体检。
 *
 * 检查项：
 *   ① 路径前缀写错   —— 写成 `scripts/x.mjs` 而实际在 `server/scripts/x.mjs`（照抄会 Cannot find module）
 *   ② 引用了不存在的文件 —— 且该行没有「已不在仓库 / 临时件」的标注（未标注 ⇒ 报错）
 *   ③ 行号越界       —— `file:NNN` 超过该文件总行数
 *   ④ 同名歧义       —— 裸文件名在仓库里有多份（读者可能打开错的那个）
 *
 * 用法：
 *   node scripts/check-skill-refs.mjs            # 报告 + 有问题时退出码 1
 *   SKILLS_DIR=<path> node scripts/check-skill-refs.mjs
 *
 * ⚠️ 本机存在**两份**技能库（2026-10-04 核实）：
 *   - `~/.workbuddy-ai/skills/` —— WorkBuddy AI 会话实际加载的那份（`<available_skills>` 指向它）
 *   - `~/.workbuddy/skills/`    —— 另一套（含大量本文库没有的 minxue-* 技能，部分与本文库重名但内容不同）
 *   两者**部分重名、内容不同**，极易混淆。默认两份都扫；`SKILLS_DIR` 只扫指定的那一份。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const HOME = process.env.USERPROFILE || process.env.HOME || ''
const DEFAULT_DIRS = [
  path.join(HOME, '.workbuddy-ai', 'skills'),
  path.join(HOME, '.workbuddy', 'skills'),
]
const SKILLS_DIRS = process.env.SKILLS_DIR ? [process.env.SKILLS_DIR] : DEFAULT_DIRS

// 占位符 / 刻意示例，不算失效引用（例：0NN_xxx.js、useXxx.js、_diag_xxx.mjs、xxx.test.mjs）
const PLACEHOLDER = /xxx|0nn|placeholder|example/i
// 行内出现这些词 ⇒ 该引用已被显式交代（不存在 / 是临时件 / 是要你新建的），不算未标注的失效引用
const MARKED = /已不在仓库|临时件|需重写|已下线|要你新建|待新建|运行时生成/

const EXTS = ['js', 'jsx', 'vue', 'mjs', 'json', 'md', 'py', 'sql', 'css', 'sh']
const TOKEN_RE = new RegExp(`\`([A-Za-z0-9_][A-Za-z0-9_./-]*\\.(${EXTS.join('|')}))\``, 'g')
const LINE_REF_RE = /`([A-Za-z0-9_./-]+\.(?:js|jsx|vue|mjs)):(\d+)/g
const SCRIPT_RE = /\b[A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:mjs|js)\b/g

// 归档/临时目录不算「活代码」：历史快照会让「同名歧义」误报成灾
const SKIP_DIR = /^(node_modules|\.git|tmp|dist.*|_r\d+q?_old|_.*_old)$/

const walk = (dir, out = []) => {
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    if (SKIP_DIR.test(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const repoFiles = walk(REPO)
const byBase = new Map() // basename(lower) -> [相对路径…]
for (const f of repoFiles) {
  const b = path.basename(f).toLowerCase()
  if (!byBase.has(b)) byBase.set(b, [])
  byBase.get(b).push(path.relative(REPO, f).replace(/\\/g, '/'))
}
const relSet = new Set([...byBase.values()].flat())

const problems = { prefix: [], missing: [], oob: [], ambiguous: [] }
const scanned = []

for (const SKILLS_DIR of SKILLS_DIRS) {
  if (!fs.existsSync(SKILLS_DIR)) continue
  // 目录标签带上父目录名，否则两份技能库里的同名技能（如 minxue-product-review）无法区分
  const dirLabel = path.basename(path.dirname(SKILLS_DIR)) + '/' + path.basename(SKILLS_DIR)
  const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  scanned.push(`${dirLabel}(${skillDirs.length})`)

for (const skill of skillDirs) {
  const file = path.join(SKILLS_DIR, skill, 'SKILL.md')
  if (!fs.existsSync(file)) continue
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)

  // 「已标注」按**文件级**判断：只要本技能在任意一行说明过某脚本「已不在仓库 / 是临时件」，
  // 其它地方再提到它就算已交代过（否则注释块与正文列表分居两处，正文会被误报）。
  const markedBase = new Set()
  for (const l of lines) {
    if (!MARKED.test(l)) continue
    for (const m of l.matchAll(SCRIPT_RE)) markedBase.add(path.basename(m[0]).toLowerCase())
  }

  lines.forEach((line, i) => {
    const where = `${dirLabel}/${skill}/SKILL.md:${i + 1}`
    const marked = MARKED.test(line)

    for (const m of line.matchAll(TOKEN_RE)) {
      const tok = m[1]
      if (PLACEHOLDER.test(tok)) continue
      const norm = tok.replace(/^\.\//, '')
      // 技能自带的脚本（随技能分发，不在仓库里）—— 相对技能目录、或技能内的 scripts/ 子目录存在即算有效
      if (fs.existsSync(path.join(SKILLS_DIR, skill, norm))
        || fs.existsSync(path.join(SKILLS_DIR, skill, 'scripts', path.basename(norm)))) continue
      if (relSet.has(norm)) continue
      // 含目录的「路径型」引用写错前缀 ⇒ 照抄命令必失败，报出来。
      // 裸文件名（如散文里的 `worker.js`）是简写，上下文已足够，不报（否则噪声淹没真问题）。
      if (norm.includes('/') && relSet.has('server/' + norm)) {
        problems.prefix.push(`${where}  \`${tok}\` → 实际在 server/${norm}`)
        continue
      }
      const base = path.basename(norm).toLowerCase()
      const hits = byBase.get(base)
      if (!hits) {
        if (!marked && !markedBase.has(base)) {
          problems.missing.push(`${where}  \`${tok}\` 仓库中不存在（且全文未标注「已不在仓库/临时件」）`)
        }
        continue
      }
      if (hits.length > 1 && !norm.includes('/')) {
        problems.ambiguous.push(`${where}  \`${tok}\` 裸名有 ${hits.length} 份：${hits.slice(0, 3).join(' , ')}`)
      }
    }

    for (const m of line.matchAll(LINE_REF_RE)) {
      const [, f, ln] = m
      const cands = [f, 'server/' + f].filter(p => relSet.has(p))
      if (!cands.length) continue
      const total = fs.readFileSync(path.join(REPO, cands[0]), 'utf8').split(/\r?\n/).length
      if (Number(ln) > total) problems.oob.push(`${where}  \`${f}:${ln}\` 越界（该文件仅 ${total} 行）`)
    }
  })
}
}

const sections = [
  ['① 路径前缀写错（提示：补 server/ 前缀即可）', problems.prefix],
  ['② 引用了不存在的文件（错误：未标注「已不在仓库/临时件」）', problems.missing],
  ['③ 行号越界（错误）', problems.oob],
  ['④ 同名歧义（提示：裸名有多份，建议写全路径）', problems.ambiguous],
]

console.log(`技能引用体检  扫描目录: ${scanned.join(' ｜ ') || '（无）'}\n`)
for (const [title, list] of sections) {
  console.log(`${title}：${list.length} 处`)
  for (const l of list) console.log('   - ' + l)
}

// 退出码只看「真错误」：② 未标注的失效引用、③ 行号越界。
// ① 与 ④ 是提示 —— 散文里的简写与风格问题不该把闸判红（否则噪声淹没真问题）。
const errors = problems.missing.length + problems.oob.length
console.log(`\n提示 ${problems.prefix.length + problems.ambiguous.length} 处 ｜ 错误 ${errors} 处`)
process.exit(errors === 0 ? 0 : 1)
