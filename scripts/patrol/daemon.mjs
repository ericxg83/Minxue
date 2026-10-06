/**
 * 敏学 Bug 巡查器 — 10 分钟常驻循环（agent 驱动）
 * ─────────────────────────────────────────────────────────────
 * 设计：agent 是真正的执行者（读体检、修 bug、写报告）。本守护进程只做两件事：
 *   1. 每 PATROL_INTERVAL_MS（默认 600_000 = 10 分钟）跑一次 scripts/patrol/patrol.mjs（只读体检）
 *   2. 把每次体检结果写到 _patrol_state.json（agent 每轮开工读它确定要做的事），
 *      并在控制台以醒目标志打印——agent 看到输出就知道该开工下一轮。
 *
 * 职责边界：本脚本不修代码、不写报告、不截图（那是 agent 的事）。体检只读，退出码与
 * 体检结果无关（agent 以 _patrol_state.json 的 last 为准）。
 *
 * 跑法：node scripts/patrol/daemon.mjs [间隔毫秒]
 * 停止：Ctrl+C；Windows 下 taskkill /F /PID <pid>（或 taskkill /F /T /PID <pid>）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const STATE = path.join(ROOT, '_patrol_state.json')
const INTERVAL = Number(process.argv[2] || process.env.PATROL_INTERVAL_MS || 600_000)
const ENGINE = path.join(ROOT, 'scripts', 'patrol', 'patrol.mjs')

function log(...a) { console.log(`[${new Date().toISOString()}]`, ...a) }

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

log(`巡查守护进程启动 — 每 ${Math.round(INTERVAL / 1000)}s 一轮，引擎 ${ENGINE}`)
await runRound() // 启动立即跑第一轮

setInterval(runRound, INTERVAL)
// 防止进程静默挂掉：Windows 下 setInterval 无阻塞问题
process.on('SIGINT', () => { log('收到 SIGINT，退出'); process.exit(0) })