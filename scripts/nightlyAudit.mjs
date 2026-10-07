#!/usr/bin/env node
/**
 * 夜间只读巡检引擎（A 层）
 * ─────────────────────────────────────────────────────────────────────────
 * 职责边界（硬约束，改本文件前必读）：
 *   1. 只读：本脚本只运行检查、只写 docs/auto/ 下的报告与基线，绝不修改任何
 *      业务源码、测试断言或门禁配置。
 *   2. 只加闸不放宽：棘轮（ratchet）只允许收紧。任何规则的 error 数高于基线
 *      即为「当晚失败」，脚本会自动把基线收紧到更低值，但永远不会自动抬高。
 *      这条对应 AGENTS.md 第 11 条答案质量闸原则的全局化。
 *   3. 不覆盖线上产物：构建校验一律走 BUILD_OUTDIR 输出到独立目录，
 *      绝不写 dist/（dist 是发布生效链路）。
 *
 * 产出：
 *   docs/auto/baseline.json          棘轮基线（error 数按规则记账）
 *   docs/auto/reports/YYYY-MM-DD.md  当晚报告
 *   docs/auto/backlog.md             疑似缺陷与候选事项池（只追加，不删除）
 *
 * 用法：
 *   node scripts/nightlyAudit.mjs              跑全量巡检并写报告
 *   node scripts/nightlyAudit.mjs --json       只输出机器可读结果
 *   node scripts/nightlyAudit.mjs --no-build   跳过构建校验（更快）
 *
 * ⛔ 退出码（r240 起，供定时任务判定当晚成败；改动时与 nightlyAuditVerdict.mjs 同步）：
 *   0 = 当晚通过；1 = lint 棘轮回退（不得合并）；2 = 巡检中止（lint 报告都拿不到）；
 *   3 = 单元测试失败，或一条测试都没跑（不许报成功）。
 * r240 修正了「单测整晚挂掉退出码仍是 0」这个假绿，详见 nightlyAuditVerdict.mjs 头部。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { toLocalYmd } from '../server/utils/period.js'
import { resolveNightlyVerdict, readTestsRun } from './nightlyAuditVerdict.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const AUTO_DIR = path.join(ROOT, 'docs', 'auto')
const REPORT_DIR = path.join(AUTO_DIR, 'reports')
const BASELINE_FILE = path.join(AUTO_DIR, 'baseline.json')
const BACKLOG_FILE = path.join(AUTO_DIR, 'backlog.md')
const LINT_JSON = path.join(ROOT, '__nightly_lint.json')

const args = process.argv.slice(2)
const jsonOnly = args.includes('--json')
const skipBuild = args.includes('--no-build')

// ── 工具 ──────────────────────────────────────────────────────────────────
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')

/**
 * Windows 上 npx / npm 是 .cmd，execFileSync 不走 shell 会直接 ENOENT。
 * 因此巡检一律用当前 node 二进制直调 CLI 入口，不经过包管理器：
 * 既避免平台差异，也省掉 npx 的解析开销。
 */
function runNode(entry, argv, opts = {}) {
  // entry 为 null 表示直接把 argv 交给 node（如 node --test）
  const bin = entry == null ? [] : [path.isAbsolute(entry) ? entry : path.join(ROOT, entry)]
  try {
    const out = execFileSync(process.execPath, [...bin, ...argv], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts
    })
    return { code: 0, out }
  } catch (err) {
    // eslint 与 node --test 都以非 0 退出表达「发现问题」，不是执行失败，
    // 因此这里必须把 stdout/stderr 原样带回，否则信号会丢失。
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` }
  }
}

function run(cmd, argv, opts = {}) {
  try {
    const out = execFileSync(cmd, argv, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts
    })
    return { code: 0, out }
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` }
  }
}

// ⛔ r240：`toISOString().slice(0,10)` 印的是 UTC 日。这份脚本叫「夜间巡检」，
//   凌晨跑的时候本地已经是新的一天、UTC 还停在昨天 ⇒ 报告会写进昨天的文件、
//   baseline 的 updatedAt / history 也记昨天，backlog 标记同样对不上。
//   复用 r157 收敛的本地日历日唯一实现（与 dailyBackup / backupKit 同一口径）。
const today = toLocalYmd(new Date())

// ── 1. ESLint ─────────────────────────────────────────────────────────────
function collectLint() {
  runNode('node_modules/eslint/bin/eslint.js', ['.', '-f', 'json', '--output-file', path.basename(LINT_JSON)])
  const reportPath = LINT_JSON
  if (!fs.existsSync(reportPath)) return { ok: false, total: 0, byRule: new Map(), items: [], fatal: 'eslint 未产出 JSON 报告' }

  let report
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  } catch (e) {
    return { ok: false, total: 0, byRule: new Map(), items: [], fatal: `eslint JSON 报告无法解析：${e.message}` }
  } finally {
    fs.rmSync(reportPath, { force: true })
  }

  const byRule = new Map()
  const items = []
  let total = 0
  let parseErrors = 0

  for (const f of report) {
    const r = rel(f.filePath)
    for (const m of f.messages) {
      if (m.severity !== 2) continue
      total++
      const rule = m.ruleId || '(parse-error)'
      byRule.set(rule, (byRule.get(rule) || 0) + 1)
      if (rule === '(parse-error)') parseErrors++
      items.push({ file: r, line: m.line, rule, message: m.message })
    }
  }
  return { ok: total === 0 && parseErrors === 0, total, byRule, items, parseErrors }
}

// ── 2. 单元测试 ────────────────────────────────────────────────────────────
function collectTests() {
  const { code, out } = runNode(null, ['--test', 'test/*.test.mjs'])
  const counters = {}
  const failed = []
  for (const line of out.split(/\r?\n/)) {
    const c = line.match(/^\s*\D{0,3}\s*(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/)
    if (c) counters[c[1]] = Number(c[2])
    const f = line.match(/^test at\s+(\S+):(\d+):(\d+)/)
    if (f) failed.push({ file: f[1].split('\\').join('/'), line: Number(f[2]) })
  }
  // 失败用例的 test 名称行紧随其后，缩进的「✖/not ok」形态在不同 reporter 下不稳定，
  // 这里保留文件与行号即可定位，不强行解析标题。
  return { ok: code === 0, exitCode: code, counters, failed, raw: out }
}

// ── 3. 构建（产物落独立目录，绝不写 dist/）────────────────────────────────
function collectBuild() {
  const outDir = `dist_nightly_${today}`
  const { code, out } = runNode('node_modules/vite/bin/vite.js', ['build'], {
    env: { ...process.env, BUILD_OUTDIR: outDir }
  })
  const dir = path.join(ROOT, outDir)
  const bytes = fs.existsSync(dir)
    ? fs.readdirSync(dir, { recursive: true }).reduce((acc, entry) => {
        const p = path.join(dir, entry)
        try {
          return acc + (fs.statSync(p).isFile() ? fs.statSync(p).size : 0)
        } catch {
          return acc
        }
      }, 0)
    : 0
  const tail = out.split(/\r?\n/).slice(-25).join('\n')
  // 产物只用于验证构建能过与体积对比，读完就删，不在磁盘上积夜。
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  return { ok: code === 0, outDir, bytes, tail }
}

// ── 4. 工作区与仓库状态 ────────────────────────────────────────────────────
function collectRepo() {
  const { out: status } = run('git', ['status', '--porcelain'])
  const dirty = status.split(/\r?\n/).filter(Boolean)
  const { out: branch } = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  const { out: head } = run('git', ['rev-parse', '--short', 'HEAD'])
  const { out: lastAuthors } = run('git', ['log', '-20', '--format=%an'])
  const committers = [...new Set(lastAuthors.split(/\r?\n/).filter(Boolean))]
  return { dirty, branch: branch.trim(), head: head.trim(), committers }
}

// ── 5. 棘轮 ────────────────────────────────────────────────────────────────
function applyRatchet(lint) {
  let baseline = null
  if (fs.existsSync(BASELINE_FILE)) {
    try {
      baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
    } catch {
      baseline = null
    }
  }

  const current = Object.fromEntries(lint.byRule)
  if (!baseline) {
    const next = { createdAt: today, updatedAt: today, lintErrors: current, lintTotal: lint.total, history: [] }
    fs.mkdirSync(AUTO_DIR, { recursive: true })
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2), 'utf8')
    return { status: 'initialized', regressions: [], improvements: Object.entries(current) }
  }

  const regressions = []
  const improvements = []
  for (const [rule, count] of Object.entries(current)) {
    const prev = baseline.lintErrors?.[rule] ?? 0
    if (count > prev) regressions.push({ rule, from: prev, to: count })
    else if (count < prev) improvements.push({ rule, from: prev, to: count })
  }
  for (const rule of Object.keys(baseline.lintErrors || {})) {
    if (!(rule in current)) improvements.push({ rule, from: baseline.lintErrors[rule], to: 0 })
  }

  // 只在下调时收紧基线；上升一律保留旧值并判失败，不给自动放宽的机会。
  const merged = {}
  for (const [rule, count] of Object.entries(current)) {
    merged[rule] = Math.min(count, baseline.lintErrors?.[rule] ?? count)
  }
  const next = {
    ...baseline,
    updatedAt: today,
    lintErrors: merged,
    lintTotal: Object.values(merged).reduce((a, b) => a + b, 0),
    history: [...(baseline.history || []), { date: today, total: lint.total, regressions: regressions.length }].slice(-60)
  }
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2), 'utf8')
  return { status: regressions.length ? 'REGRESSED' : 'ok', regressions, improvements }
}

// ── 6. 规则 → 分级（保守：不确定就压低，绝不当成绿灯）─────────────────────
const SEVERITY = {
  '(parse-error)': 'P0',
  'no-undef': 'P0',
  'no-dupe-keys': 'P0',
  'no-dupe-args': 'P0',
  'no-dupe-class-members': 'P0',
  'no-unreachable': 'P1',
  'no-empty': 'P1',
  'no-async-promise-executor': 'P1',
  'no-unused-expressions': 'P2',
  'no-case-declarations': 'P2',
  'no-regex-spaces': 'P2',
  'no-control-regex': 'P2',
  'no-var': 'P2'
}
const tierOf = (rule) => SEVERITY[rule] || 'P2'

// ── 7. 报告 ────────────────────────────────────────────────────────────────
/** 单元测试那一行的三态人话（r240）：真跑过且全绿 / 真跑过但有失败 / 压根没验过。 */
function testSummary(tests) {
  const counts = `（pass ${tests.counters.pass ?? '?'} / fail ${tests.counters.fail ?? '?'} / 共 ${tests.counters.tests ?? '?'}）`
  const check = readTestsRun(tests.counters)
  if (!check.ok) return `没验过：${check.reason} ${counts}`
  return tests.ok ? `全绿 ${counts}` : `有失败 ${counts}`
}

function writeReport({ lint, tests, build, repo, ratchet }) {
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  const grouped = new Map()
  for (const it of lint.items) {
    const t = tierOf(it.rule)
    if (!grouped.has(t)) grouped.set(t, [])
    grouped.get(t).push(it)
  }

  const L = []
  L.push(`# 夜间巡检报告 ${today}`, '')
  L.push('| 项 | 结果 |', '|---|---|')
  L.push(`| Git 基线 | \`${repo.branch}\` @ \`${repo.head}\` |`)
  L.push(`| ESLint error | ${lint.total}（P0 ${grouped.get('P0')?.length || 0} / P1 ${grouped.get('P1')?.length || 0} / P2 ${grouped.get('P2')?.length || 0}） |`)
  L.push(`| 棘轮 | ${ratchet.status}${ratchet.regressions?.length ? ` — 回退 ${ratchet.regressions.length} 项` : ''} |`)
  // ⛔ r240：一条测试都没跑（或压根没读到条数）也是有结论的 —— 那就是「这一轮没验过」，
  //    不许印「全绿」。与体检脚本 r221 的口径一致（字段没真读到必须明说）。
  L.push(`| 单元测试 | ${testSummary(tests)} |`)
  L.push(`| 构建 | ${build ? (build.ok ? `通过 → ${rel(build.outDir)}（${(build.bytes / 1048576).toFixed(1)} MB）` : '失败') : '跳过'} |`)
  L.push(`| 工作区 | ${repo.dirty.length ? `脏 ${repo.dirty.length} 项` : '干净'} |`)
  L.push('')

  if (ratchet.regressions?.length) {
    L.push('## ⛔ 棘轮回退（本晚不得合并任何改动）', '')
    L.push('规则 error 数高于基线，说明有新增缺陷或门禁被削弱：', '')
    for (const r of ratchet.regressions) L.push(`- \`${r.rule}\`：${r.from} → ${r.to}`)
    L.push('')
  }

  for (const tier of ['P0', 'P1', 'P2']) {
    const items = grouped.get(tier)
    if (!items?.length) continue
    L.push(`## ${tier} — ${tier === 'P0' ? '疑似真实缺陷，需人工判定' : tier === 'P1' ? '结构性风险' : '待清理'}`, '')
    if (tier === 'P2') L.push('（P2 多为可读性/历史写法，不阻塞，但计入棘轮只准降不准升）', '')
    for (const it of tier === 'P2' ? items.slice(0, 40) : items) {
      L.push(`- \`${it.file}:${it.line}\` — **${it.rule}**：${it.message}`)
    }
    if (tier === 'P2' && items.length > 40) L.push(`- …另有 ${items.length - 40} 条同类`)
    L.push('')
  }

  if (!tests.ok && tests.failed.length) {
    L.push('## 单元测试失败', '')
    for (const f of tests.failed) L.push(`- \`${f.file}:${f.line}\``)
    L.push('', '> 巡检为只读，不修改断言。需负责人判定：是实现错，还是断言口径过时。', '')
  }

  if (build && !build.ok) {
    L.push('## 构建失败', '', '```', build.tail, '```', '')
  }

  if (repo.dirty.length) {
    L.push('## 工作区未提交项（本晚为只读模式，未触碰）', '')
    for (const d of repo.dirty.slice(0, 20)) L.push(`- \`${d}\``)
    L.push('')
  }

  L.push('## 建议补的回归测试（只提名，本脚本不创建文件）', '')
  const suggestions = []
  for (const it of [...(grouped.get('P0') || []), ...(grouped.get('P1') || [])]) {
    if (it.rule === 'no-undef') suggestions.push(`锁定 ${it.file} 中未定义符号 \`${it.message}\` 的调用路径`)
    if (it.rule === 'no-dupe-keys') suggestions.push(`锁定 ${it.file}:${it.line} 重复键的生效值语义`)
    if (it.rule === '(parse-error)') suggestions.push(`${it.file} 无法解析，需先修复语法`)
  }
  for (const f of tests.failed) suggestions.push(`修复 \`test/${path.basename(f.file)}\` 的失败断言（口径需负责人确认）`)
  if (!suggestions.length) L.push('- 本轮无新增提名。')
  else for (const s of [...new Set(suggestions)].slice(0, 25)) L.push(`- ${s}`)
  L.push('')

  L.push('## 提案与人工核实', '')
  L.push(`本文件每次重写，不存放人工判断。逐条分析与核心链路提案见 \`${today}-提案.md\`。`, '')

  L.push('## 已知盲区（不得当作「已检查」）', '')
  L.push('- `.vue` 模板层与 `.ts/.tsx` 未进 lint：仓库缺 `eslint-plugin-vue` / `typescript-eslint`。', '  因此「模板引用了 script 中未定义符号」这类缺陷**本轮抓不到**（2026-07-21 事故同形态）。')
  L.push('- 生产日志与 worker 失败任务未接入：需要 `server/.logs` 与 Render 日志的可读通道。')
  L.push('- 数据库实际结构与静态 Schema 的差异未校验。')
  L.push('')

  const text = L.join('\n')
  // 机器结果与人工判断分文件：本文件每晚重写，绝不能覆盖已写好的分析。
  // 当晚重跑不会丢「日期-提案.md」里的内容。
  const file = path.join(REPORT_DIR, `${today}-机器.md`)
  fs.writeFileSync(file, text, 'utf8')

  const proposalFile = path.join(REPORT_DIR, `${today}-提案.md`)
  if (!fs.existsSync(proposalFile)) {
    fs.writeFileSync(
      proposalFile,
      [
        `# 巡检分析与提案 ${today}`,
        '',
        '> 本文件由巡检代理/负责人撰写，脚本永不覆写。逐条对应 `-机器.md` 的发现。',
        '> 每条必须写：用户可见后果、影响范围、历史数据兼容策略、验证方式、是否属核心链路。',
        '',
        '## P0 人工核实结论',
        '',
        '待补写。',
        '',
        '## 核心链路提案（只提案，不动手）',
        '',
        '待补写。',
        '',
        '## 回归测试提名',
        '',
        '待补写。',
        ''
      ].join('\n'),
      'utf8'
    )
  }
  return { file, proposalFile, text }
}

// ── 8. backlog 只追加 ──────────────────────────────────────────────────────
function appendBacklog(lint) {
  fs.mkdirSync(AUTO_DIR, { recursive: true })
  const p0 = lint.items.filter((i) => tierOf(i.rule) === 'P0')
  if (!p0.length) return null
  const marker = `## ${today} 新增 P0`
  // 同一晚重跑（或一晚多轮）不能把同一条缺陷刷成重复项。
  if (fs.existsSync(BACKLOG_FILE) && fs.readFileSync(BACKLOG_FILE, 'utf8').includes(marker)) return null
  const head = fs.existsSync(BACKLOG_FILE) ? '' : '# 疑似缺陷与候选事项池\n\n> 只追加、只由人工关闭。巡检不会删除或降级任何条目。\n\n'
  const lines = [`${marker}（疑似真实缺陷，待人工判定）`, '']
  for (const it of p0) lines.push(`- [ ] \`${it.file}:${it.line}\` **${it.rule}** — ${it.message}`)
  lines.push('')
  fs.appendFileSync(BACKLOG_FILE, head + lines.join('\n'), 'utf8')
  return BACKLOG_FILE
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
const lint = collectLint()
if (lint.fatal) {
  console.error(`巡检中止：${lint.fatal}`)
  process.exit(2)
}
const tests = collectTests()
const build = skipBuild ? null : collectBuild()
const repo = collectRepo()
const ratchet = applyRatchet(lint)
const report = writeReport({ lint, tests, build, repo, ratchet })
const backlog = appendBacklog(lint)

// ⛔ r240：当晚结论统一由 nightlyAuditVerdict 判，主流程不再自己算退出码。
//   修复前这里对「单测挂掉 / 一条测试都没跑」都返回 0 ⇒ 定时任务挂上去会永远报成功。
const runCheck = readTestsRun(tests.counters)
const verdict = resolveNightlyVerdict({
  testsExitCode: tests.exitCode,
  testsRun: runCheck.ok ? Number(tests.counters.tests) : null,
  ratchetStatus: ratchet.status
})

if (jsonOnly) {
  console.log(JSON.stringify({
    date: today,
    lintTotal: lint.total,
    byRule: Object.fromEntries(lint.byRule),
    ratchet,
    tests: { ok: tests.ok, pass: tests.counters.pass, fail: tests.counters.fail, run: runCheck.ok ? Number(tests.counters.tests) : null },
    verdict: { status: verdict.status, exitCode: verdict.exitCode, reason: verdict.reason },
    build: build && { ok: build.ok, bytes: build.bytes },
    report: rel(report.file)
  }, null, 2))
} else {
  console.log(report.text)
}
console.log(`\n机器结果：${rel(report.file)}\n分析提案：${rel(report.proposalFile)}${backlog ? `\n待办池：${rel(backlog)}` : ''}`)
// ⛔ r240：退出码由 resolveNightlyVerdict 统一给（0 过 / 1 棘轮回退 / 2 巡检中止 / 3 单测没验过），
//   供上层定时任务判定当晚成败 —— 修复前「单测整晚挂掉」这里会返回 0。
if (verdict.reason) console.log(`${verdict.exitCode === 0 ? '' : '⛔ '}${verdict.reason}`)
process.exit(verdict.exitCode)
