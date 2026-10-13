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
 * ⛔ r269 校准（实测 34 处「错误」里 32 处是系统性误报，详见 skillRefsKit.mjs 头部）：
 *   以下四类**不算错误**，但会按类印出豁免计数（豁免不许静默）：
 *     · 约定永不入库的临时/探针文件名（`_diag_*` / `_tmp_*` / `tmp/` / `deliverables/` / `logs/` …）
 *     · 占位符与日期占位符（`xxx` / `0NN` / `YYYYMMDD` …）
 *     · 行内已标注（词表已扩充：删除 / 旧脚本 / 替代品 / 更名 / 不存在 / 不生成 / 别的项目 …）
 *     · 同一行就把文件定位在仓库外（`C:/…` / `~/…`）
 *   真断头路（未标注的真实缺失文件）**照样判错** —— 回归锁见 test/checkSkillRefsScope.test.mjs。
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

// r269：判据（占位符 / 标注词表 / 仓库外定位 / 临时文件约定）收敛到唯一实现，
// 与 test/checkSkillRefsScope.test.mjs 共用 —— 只写在脚本里，测试就得复制一份，
// 两边迟早漂移。原 PLACEHOLDER 注释本就想豁免 `_diag_*`（写着「例：_diag_xxx.mjs」），
// 但正则只匹配字面 `xxx`，实测 25 处真实探针名全部漏罩 ⇒ 长期 34 处假红，详见 kit 头部。
import {
  PLACEHOLDER, MARKED, classifyMissingRef
} from './skillRefsKit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const HOME = process.env.USERPROFILE || process.env.HOME || ''
const DEFAULT_DIRS = [
  path.join(HOME, '.workbuddy-ai', 'skills'),
  path.join(HOME, '.workbuddy', 'skills'),
]
const SKILLS_DIRS = process.env.SKILLS_DIR ? [process.env.SKILLS_DIR] : DEFAULT_DIRS

// 占位符 / 标注词表 / 仓库外定位判据都在 skillRefsKit.mjs（唯一实现，r269）。
// 行内出现 MARKED 里的词 ⇒ 该引用已被显式交代（不存在 / 是临时件 / 已删除 / 在仓库外…）。
const EXTS = ['js', 'jsx', 'vue', 'mjs', 'json', 'md', 'py', 'sql', 'css', 'sh']
const TOKEN_RE = new RegExp(`\`([A-Za-z0-9_][A-Za-z0-9_./-]*\\.(${EXTS.join('|')}))\``, 'g')
const LINE_REF_RE = /`([A-Za-z0-9_./-]+\.(?:js|jsx|vue|mjs)):(\d+)/g
// ⛔ r269：原写法只匹配 mjs|js，与 TOKEN_RE 的 EXTS 不一致 —— 文件级「已标注」
//    （markedBase）因此罩不住 .json/.md/.py：实测 shadcn-ui/SKILL.md 事实表里
//    明写 components.json「不存在」，同一文件第 194 行两处 components.json
//    仍被判「未标注的失效引用」（标注过了却看不见）。改成与 TOKEN_RE 同一份 EXTS。
const SCRIPT_RE = new RegExp(String.raw`\b[A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:${EXTS.join('|')})\b`, 'g')

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
// r269：豁免不许静默。按 kind 记数，报告里印出来 —— 看不见的豁免本身就是新的假绿。
const excused = { placeholder: 0, ephemeral: 0, marked: 0, external: 0 }
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
      // ⛔ r269：占位符的早退也要计数 —— 否则「已按约定豁免 N 处」会少算这一类，
      //    透明的豁免变成不透明（实测漏计 backfill-answer-correction-YYYYMMDD.mjs 这一处）。
      if (PLACEHOLDER.test(tok)) { excused.placeholder++; continue }
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
        // r269：先过豁免判据（skillRefsKit.classifyMissingRef，唯一实现），再决定算不算错误。
        // 修前这里直接 `!marked && !markedBase.has(base)` 就判错 ⇒ 32/34 是系统性误报
        // （临时探针名 / 日期占位符 / 词表外的标注 / 仓库外定位），真信号被淹没。
        const verdict = classifyMissingRef({ tok, norm, line, marked, markedBaseHas: markedBase.has(base) })
        if (verdict.excuse) {
          excused[verdict.kind] = (excused[verdict.kind] || 0) + 1
          continue
        }
        problems.missing.push(`${where}  \`${tok}\` 仓库中不存在（且全文未标注「已不在仓库/临时件」）`)
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

// r269：豁免透明化。因约定/标注/仓库外定位而「不算错误」的引用逐类印出来，
// 免得豁免本身变成看不见的假绿（类别口径见 skillRefsKit.mjs 头部）。
const excuseTotal = excused.placeholder + excused.ephemeral + excused.marked + excused.external
if (excuseTotal) {
  console.log(`\n已按约定豁免 ${excuseTotal} 处（不算错误，仅供核对）：` +
    `临时/探针文件名 ${excused.ephemeral}、占位符 ${excused.placeholder}、` +
    `行内已标注 ${excused.marked}、仓库外定位 ${excused.external}`)
}

// 退出码只看「真错误」：② 未标注的失效引用、③ 行号越界。
// ① 与 ④ 是提示 —— 散文里的简写与风格问题不该把闸判红（否则噪声淹没真问题）。
const errors = problems.missing.length + problems.oob.length
console.log(`\n提示 ${problems.prefix.length + problems.ambiguous.length} 处 ｜ 豁免 ${excuseTotal} 处 ｜ 错误 ${errors} 处`)
process.exit(errors === 0 ? 0 : 1)
