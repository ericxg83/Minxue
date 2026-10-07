/**
 * 敏学 Bug 巡查器 — 10 分钟常驻循环（自足版）
 * ─────────────────────────────────────────────────────────────
 * 职责（每 PATROL_INTERVAL_MS，默认 600_000 = 10 分钟）：
 *   1. 跑一次 scripts/patrol/patrol.mjs（只读体检：健康/lint/tests/build/冒烟）
 *   2. 把体检结果写到 _patrol_state.json（agent 开工读它）
 *   3. **自足产出**：把本轮体检自动转成人类可读报告，追加到 docs/auto/patrol.md
 *      （agent 缺席也不断档——2026-10-06 R6–R16 教训：缺报告 = 像停了）
 *   4. 自动 git commit（只 add docs/auto/patrol.md，不碰其他文件，避免抢并行会话）
 *
 * 职责边界：不修代码（那是 agent 的事）；但报告/提交/时间线全自足。
 * 体检只读，退出码与体检结果无关（agent 以 _patrol_state.json 的 last 为准）。
 *
 * 跑法：node scripts/patrol/daemon.mjs [间隔毫秒]
 * 停止：Ctrl+C；Windows 下 taskkill /F /PID <pid>（或 taskkill /F /T /PID <pid>）
 */
import { spawn } from 'node:child_process'
import { spawnLocal } from '../../server/utils/localSpawn.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const STATE = path.join(ROOT, '_patrol_state.json')
const TIMELINE = path.join(ROOT, 'docs', 'auto', 'patrol.md')
const INTERVAL = Number(process.argv[2] || process.env.PATROL_INTERVAL_MS || 600_000)
const ENGINE = path.join(ROOT, 'scripts', 'patrol', 'patrol.mjs')

function log(...a) { console.log(`[${new Date().toISOString()}]`, ...a) }

// ── 单实例锁：防止开机自启 + 手动启动叠加成双 daemon（双写 patrol.md 会互相覆盖/冲突）──
const LOCK = path.join(ROOT, 'logs', 'patrol_daemon.pid')
function acquireLock() {
  try {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true })
    if (fs.existsSync(LOCK)) {
      const pid = Number(fs.readFileSync(LOCK, 'utf8').trim())
      if (pid && Number.isFinite(pid)) {
        try { process.kill(pid, 0); return false } // 已有存活实例，拒绝启动
        catch { /* PID 已死，锁过期，可以接管 */ }
      }
    }
    fs.writeFileSync(LOCK, String(process.pid))
    return true
  } catch (e) {
    log('⚠ 单实例锁检查失败（继续启动）：' + e.message)
    return true
  }
}
function releaseLock() {
  try {
    if (fs.existsSync(LOCK) && fs.readFileSync(LOCK, 'utf8').trim() === String(process.pid)) fs.unlinkSync(LOCK)
  } catch { /* 忽略 */ }
}

// ── 从本轮体检 entry 生成人类可读报告段落（agent 缺席也能产出）──
function renderReport(round, l) {
  const zh = (t) => new Date(t).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  const healthLine = `server=${l.health?.server ?? '?'}  mobile-dev=${l.health?.['mobile-dev'] ?? '?'}`
  const issues = []
  if (l.health?.server && l.health.server !== 'ok') issues.push('server 非 ok')
  if (l.health?.['mobile-dev'] && l.health['mobile-dev'] !== 'ok') issues.push('mobile-dev 非 ok')
  if (l.tests?.fail) issues.push(`测试 fail=${l.tests.fail}`)
  if (l.lintErrors) issues.push(`lint errors=${l.lintErrors}`)
  if (l.build && l.build !== 'ok' && l.build !== 'skipped') issues.push(`build=${l.build}`)
  if (l.smoke && l.smoke !== 'n/a' && !/^\d+\/\d+$/.test(String(l.smoke))) issues.push(`smoke=${l.smoke}`)
  if (l.dirtyCount) {
    // 过滤自指：docs/auto/patrol.md 本身是巡逻产物，不应算“脏”（agent 缺席时 daemon 自己写它）
    const real = (l.dirty || []).filter(f => !/patrol\.md$/.test(f) && !/_patrol_state\.json$/.test(f))
    if (real.length) issues.push(`脏文件 ${real.length} 个（${real.slice(0, 3).join(', ')}…）`)
  }
  const verdict = issues.length === 0
    ? '✅ 全绿：无异常，无需人工介入'
    : `⚠️ 发现异常：${issues.join('；')}（需 agent 深修时下轮处理）`
  const dirtyDetail = (l.dirty || []).length ? '\n    - ' + (l.dirty || []).slice(0, 10).join('\n    - ') : ''
  return `\n### R${round} — ${zh(l.finishedAt)}（daemon 自动报告）\n\n**体检**：tests **${l.tests?.pass ?? '?'}/${l.tests?.fail ?? '?'}** | lint ${l.lintErrors ?? '?'} | build ${l.build ?? 'skipped'} | ${healthLine} | 冒烟 ${l.smoke ?? 'n/a'} | 脏 ${l.dirtyCount ?? 0}\n\n${verdict}${dirtyDetail}\n`
}

let running = false
async function runRound() {
  if (running) return
  running = true
  try {
    log('▶ 开始巡查一轮（patrol.mjs）…')
    const res = await new Promise((resolve) => {
      const p = spawn(process.execPath, [ENGINE], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = '', err = ''
      p.stdout.on('data', d => out += d)
      p.stderr.on('data', d => err += d)
      p.on('close', () => resolve({ code: p.exitCode, out, err }))
    })
    // 把体检结果刷到 state（patrol.mjs 已写，这里再读回打印摘要）
    let state
    try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { state = null }
    if (state?.last) {
      const l = state.last
      log(`✔ 巡查 #${state.round} 完成 — tests ${l.tests.pass}/${l.tests.fail ?? '?'} | lint ${l.lintErrors} | build ${l.build} | server ${l.health?.server} | dirty ${l.dirtyCount}`)
      // 自动追加人类可读报告（agent 缺席也保证 patrol.md 每轮有可读段落）
      try {
        const report = renderReport(state.round, l)
        fs.appendFileSync(TIMELINE, report)
        log('  已追加自动报告到 docs/auto/patrol.md')
        // 自动提交（只 add patrol.md，不抢并行会话的文件）
        // ⛔ 走共享入口：默认 stdio 在本机必 EBUSY ⇒ git.status 恒为 null，自动提交会**静默不执行**
        //    （日志还会说成「跳过（无新内容或冲突）」，把环境故障伪装成正常跳过）
        const git = spawnLocal('git', ['add', 'docs/auto/patrol.md'], { cwd: ROOT })
        if (git.status === 0) {
          const cm = spawnLocal('git', ['commit', '-m', `docs(patrol): R${state.round} 自动报告（daemon 自足轮次）`], { cwd: ROOT })
          if (cm.status === 0) log(`  已提交 R${state.round} 报告`)
          else log('  ⚠ 自动提交跳过（无新内容或冲突：' + (cm.stderr || '').trim().slice(0, 120) + '）')
        }
      } catch (e) { log('  ⚠ 自动报告追加失败：' + e.message) }
    } else {
      log('⚠ 巡查完成但 _patrol_state.json 未更新（见上方完整输出）')
    }
    // 引擎输出（健康细节）打印出来，agent 可见
    const tail = (res.out || res.err || '').split('\n').filter(Boolean).slice(-40).join('\n')
    if (tail) log('巡检细节:\n' + tail)
    if (res.code !== 0) log('⚠ patrol.mjs 退出码 ' + res.code + '（只读体检，退出码不代表系统故障）')
  } catch (e) {
    log('✘ 本轮巡查异常：' + e.message)
  } finally {
    running = false
  }
}

if (!acquireLock()) {
  console.log(`[${new Date().toISOString()}] ⛔ 已有 daemon 实例在运行（锁 ${LOCK}），本进程退出`)
  process.exit(0)
}
process.on('exit', releaseLock)

log(`巡查守护进程启动 — 每 ${Math.round(INTERVAL / 1000)}s 一轮，引擎 ${ENGINE}`)
await runRound() // 启动立即跑第一轮

setInterval(runRound, INTERVAL)
// 防止进程静默挂掉：Windows 下 setInterval 无阻塞问题
process.on('SIGINT', () => { log('收到 SIGINT，退出'); process.exit(0) })
process.on('SIGTERM', () => { log('收到 SIGTERM，退出'); process.exit(0) })