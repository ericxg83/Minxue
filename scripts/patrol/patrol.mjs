/**
 * 敏学 Bug 巡查器 — 单轮引擎（agent 驱动）
 * ─────────────────────────────────────────────────────────────
 * 用途：给 agent 每 ~10 分钟一轮的「巡查」提供确定性信号。引擎只做**只读体检**，
 *     不修代码、不改文件（修复由 agent 根据体检结论动手）。
 *
 * 本轮扫描：
 *  A. 进程/端口健康（后端 :4000、移动端 dev :5173、旧 backend :3000）
 *  B. git 工作区状态（脏文件 / 未提交 WIP / 最近提交时间）
 *  C. 单元测试（npm test，锁 1973 基线 + 新增用例文件自动纳入）
 *  D. 移动端 + 工作台构建（vite build，仅当 src/** 有改动时建议跑——agent 决定）
 *  E. lint 错误计数 + 死声明扫描（复用 pruneDeadDeclarations.mjs 的 eslint 产物）
 *  F. Playwright 冒烟（8 个导航 + 移动端首页）——见同目录 smoke.mjs
 *
 * 轮次状态写入 _patrol_state.json（round 递增），机器事实追加到 docs/auto/patrol.md#timeline。
 * 人类可读报告由 agent 在每轮末尾撰写，追加到 docs/auto/patrol.md。
 *
 * 跑法：node scripts/patrol/patrol.mjs [--build]
 *   --build：本轮强制跑 vite build（默认只在 src/** 有改动或显式要求时跑）
 */
import { spawnLocal } from '../../server/utils/localSpawn.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectLintReport, lintReportReasonText } from './lintReportKit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const STATE = path.join(ROOT, '_patrol_state.json')
const TIMELINE = path.join(ROOT, 'docs', 'auto', 'patrol.md')
const FORCE_BUILD = process.argv.includes('--build')

// ⛔ 走共享入口：本机 spawnSync 默认 stdio（stdin 是管道）必 EBUSY ⇒ 非 silent 分支的巡检引擎
//    会「起不来但 status=null」，看着像跑完没输出。原因与对照实验见 server/utils/localSpawn.js
const run = (cmd, args, opts = {}) => spawnLocal(cmd, args, {
  cwd: ROOT, timeout: opts.timeout ?? 300000,
  env: { ...process.env, ...(opts.env || {}) },
  ...(opts.silent ? { stdio: ['ignore', 'pipe', 'pipe'] } : {}),
})

const now = () => new Date().toISOString()
const state = (() => {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return { state: 'started', round: 0, startedAt: now() } }
})()

const round = (state.round || 0) + 1
const started = now()

function section(title) { console.log(`\n▉ ${title}`) }

// ── A. 进程健康（Node 原生 fetch，避免 Windows curl -o /dev/null 陷阱）──
section('A. 进程健康')
const health = {}
for (const [name, path] of [['server', '/api/health'], ['mobile-dev', '/']]) {
  const port = name === 'server' ? 4000 : 5173
  const url = `http://127.0.0.1:${port}${path}`
  let status = '?'
  try { status = (await fetch(url, { signal: AbortSignal.timeout(4000) })).status } catch (e) { status = 'DOWN(' + (e.cause?.code || e.name) + ')' }
  health[name] = status === 200 ? 'ok' : status
  console.log(`  ${name} :${port}${path} → ${health[name]}`)
}

/* ── B. git 工作区 ── */
section('B. git 工作区')
const st = run('git', ['status', '--short'])
const dirty = st.stdout.split('\n').filter(Boolean)
console.log(`  脏文件 ${dirty.length} 个${dirty.length ? '：' + dirty.slice(0, 8).map(l => ' ' + l).join('\n') : '（干净）'}`)
const lastCommit = run('git', ['log', '-1', '--format=%h %ci %s'])
console.log(`  最近提交：${lastCommit.stdout.trim()}`)

/* ── C. 单元测试（展开文件列表后直跑 node，回避 Windows npx/.cmd 陷阱）── */
section('C. 单元测试')
const testFiles = []
try {
  for (const f of fs.readdirSync(path.join(ROOT, 'test')).filter(f => f.endsWith('.test.mjs'))) testFiles.push('test/' + f)
} catch {}
for (const f of [
  'server/tests/aiParseSelfCheck.test.mjs', 'server/tests/figureBboxSemantics.test.mjs',
  'server/tests/judgeChoiceAnswer.test.mjs', 'server/tests/normalizeBlockBoxSemantics.test.mjs',
  'server/tests/repairAIJson.test.mjs', 'server/tests/uploadValidatorHeic.test.mjs',
  'server/utils/aiParseSelfCheck.test.js', 'server/utils/answerConsensus.test.js',
]) testFiles.push(f)
const t = run(process.execPath, ['--env-file=.env', '--test', ...testFiles], { timeout: 300000, silent: true })
const passMatch = (t.stdout || '').match(/^ℹ pass (\d+)/m) || (t.stdout || '').match(/# pass (\d+)/m)
const failMatch = (t.stdout || '').match(/^ℹ fail (\d+)/m) || (t.stdout || '').match(/# fail (\d+)/m)
const pass = passMatch ? +passMatch[1] : 0
const fail = failMatch ? +failMatch[1] : null
console.log(`  pass=${pass} fail=${fail ?? '?'}${t.status !== 0 ? '  ⚠️ exit:' + t.status : ''}${t.error ? '  ❌ ' + t.error.message : ''}`)

/* ── D. 构建（条件）── */
section('D. 构建')
const srcChanged = dirty.some(l => / src\//.test(l))
let buildOk = 'skipped'
if (FORCE_BUILD || srcChanged) {
  const b = run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { timeout: 240000, silent: true })
  buildOk = b.status === 0 ? 'ok' : (b.error ? 'FAIL(kill)' : 'FAIL')
  const tailStr = ((b.stderr || b.stdout) || '').split('\n').filter(Boolean).slice(-8).join('\n  ')
  console.log(`  vite build（${FORCE_BUILD ? '--build 强制' : 'src 有改动'}）→ ${buildOk}`)
  if (buildOk !== 'ok') console.log('  tail:\n  ' + tailStr + (b.error ? `\n  [${b.error.code}: ${b.error.message}]` : ''))
} else {
  console.log('  vite build 跳过（src 无改动 + 未强制）')
}

/* ── D2. 冒烟（构建通过且 src 有改动时自动跑，让 daemon 轮自足）── */
let smoke = null
if ((FORCE_BUILD || srcChanged) && buildOk === 'ok') {
  const s = run(process.execPath, [path.join(ROOT, 'scripts', 'patrol', 'smoke.mjs'), 'http://127.0.0.1:5173'], { timeout: 200000, silent: true })
  const m = (s.stdout || '').match(/patrol smoke[^\n]*: (\d+)\/(\d+)/)
  smoke = m ? { pass: +m[1], total: +m[2], ok: s.status === 0 } : { pass: 0, total: 0, ok: false }
  console.log(`  冒烟 ${smoke.pass}/${smoke.total}${smoke.ok ? '' : '  ⚠️ 有失败或解析不了'}`)
  if (!smoke.ok) console.log('  ' + ((s.stdout || s.stderr || '').split('\n').filter(Boolean).slice(-10).join('\n  ')))
}

/* ── E. lint + 死声明 ── */
section('E. lint + 死声明')
// ⛔ r236（落地提案㊽）：旧写法把 eslint 的退出码/超时整个丢掉，唯一兜底是「parse 失败 ⇒ -1」，
//    而 tmp/prune-lint.json **跨 tick 持久**（实测 mtime 随每次成功 tick 覆盖）⇒
//    一旦本 tick eslint 没写出报告（180s 超时被 kill / 配置错 exit 2 / 二进制缺失），
//    上一 tick 的陈旧报告还在原地 ⇒ 本 tick 照读 ⇒ 报 lint=0 判「全绿」（r198/r218/r220/r221 同族）。
//    修法两道闸：① 跑前先删旧报告；② 只认 mtime ≥ 本轮 started 的那份（见 lintReportKit.mjs）。
const LINT_REPORT = path.join(ROOT, 'tmp', 'prune-lint.json')
fs.rmSync(LINT_REPORT, { force: true }) // ① 跑前删：旧报告不许冒充本轮结果（fail-closed 主闸）
const lintRun = run('node', [path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'), '.', '-f', 'json', '-o', 'tmp/prune-lint.json'], { timeout: 180000, silent: true })
const lint = collectLintReport(LINT_REPORT, Date.parse(started)) // ② 只认本轮写出的报告
const errCount = lint.errCount
const unusedVars = lint.unusedVars
if (lint.reason !== 'ok') {
  const cause = lintRun.error
    ? `，eslint 自身：${lintRun.error.code || lintRun.error.message}`
    : `（eslint exit=${lintRun.status}）`
  console.log(`  eslint errors=无法读取报告（${lintReportReasonText(lint.reason)}${cause}）—— 别拿旧报告充数  no-unused-vars=${unusedVars}`)
} else {
  console.log(`  eslint errors=${errCount}  no-unused-vars=${unusedVars}`)
}

/* ── 汇总写入 ── */
const entry = {
  round, startedAt: started, finishedAt: now(),
  health, dirtyCount: dirty.length, dirty,
  tests: { pass, fail }, build: buildOk, lintErrors: errCount >= 0 ? errCount : null,
  smoke: smoke ? `${smoke.pass}/${smoke.total}` : 'n/a',
}
const lines = []
for (const l of dirty) lines.push('    ' + l)
fs.writeFileSync(STATE, JSON.stringify({
  ...state, state: 'finished', round,
  startedAt: state.startedAt || started, finishedAt: now(), last: entry,
}))
if (!fs.existsSync(TIMELINE)) fs.writeFileSync(TIMELINE, '## 巡查轮次时间线（机器事实)\n\n')
fs.appendFileSync(TIMELINE, `| ${round} | ${entry.finishedAt.slice(0,19)} | tests=${pass}/${fail ?? '?'} | lint=${errCount} | build=${buildOk} | server=${entry.health.server} | dirty=${dirty.length} |\n`)

console.log(`\n===== 巡查 #${round} 完成 =====\n`)
console.log(JSON.stringify(entry, null, 2))