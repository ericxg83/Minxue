/**
 * 循环优化轮次守卫（2026-10-02 负责人批准：循环锁防并发）
 *
 * 背景：当天真实发生过两个循环实例同时开工——都认领了同一个 round、
 * 互相覆盖 _loop_state.json、并发实例还把对方报告写成「工作区干净」。
 * 本脚本把「认领轮次」这件事从手写 JSON 变成一次带校验的原子动作。
 *
 * 用法：
 *   node scripts/loopGuard.mjs acquire   # 开工认领：忙则退出码 1，被并发抢走则退出码 2
 *   node scripts/loopGuard.mjs release   # 收尾释放（写 finished，保留 round 供下轮递增）
 *   node scripts/loopGuard.mjs status    # 只读查看当前锁状态与远端是否领先
 *
 * 约定：
 *   - 锁文件 _loop_state.json 在仓库根目录，已被 .gitignore 覆盖，不进版本库；
 *   - running 且 startedAt 距今 < 3 小时视为「上一轮仍在进行」；≥3 小时视为崩溃可接管；
 *   - acquire 成功后必须把输出的 round 用作报告章节号「## 第 N 轮」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const LOCK = path.join(ROOT, '_loop_state.json')
const BUSY_WINDOW_MS = 3 * 60 * 60 * 1000

const read = () => {
  try {
    return JSON.parse(fs.readFileSync(LOCK, 'utf8'))
  } catch {
    return {}
  }
}
const write = (obj) => fs.writeFileSync(LOCK, JSON.stringify(obj) + '\n', 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function remoteAhead() {
  try {
    execSync('git fetch origin --quiet', { cwd: ROOT, stdio: 'ignore' })
    const out = execSync('git rev-list --count HEAD..origin/main', { cwd: ROOT, encoding: 'utf8' })
    return Number(out.trim()) || 0
  } catch {
    return -1 // 无网络/无远端时不阻断开工，只报告
  }
}

const cmd = process.argv[2] || 'status'
const state = read()

if (cmd === 'status') {
  console.log(JSON.stringify(state))
  const ahead = remoteAhead()
  console.log(ahead > 0 ? `⚠️ 远端领先本地 ${ahead} 个提交：有别的实例推过东西，先 git pull --ff-only 再开工` : `远端状态：${ahead === 0 ? '与本地一致' : '无法判定（离线或无远端）'}`)
  process.exit(0)
}

if (cmd === 'acquire') {
  const running = state.state === 'running'
  const startedMs = Date.parse(state.startedAt || '') || 0
  const ageMs = Date.now() - startedMs
  if (running && startedMs && ageMs < BUSY_WINDOW_MS) {
    console.log(`BUSY 上一轮仍在进行：round=${state.round} 已跑 ${Math.round(ageMs / 60000)} 分钟（<180 分钟）。本轮静默退出。`)
    process.exit(1)
  }
  if (running) {
    console.log(`接管崩溃轮：round=${state.round} 已跑 ${Math.round(ageMs / 60000)} 分钟，超过 3 小时视为崩溃。`)
  }

  const ahead = remoteAhead()
  if (ahead > 0) {
    console.log(`⚠️ 远端领先本地 ${ahead} 个提交——很可能有并发实例刚推过东西。`)
    console.log('   处置：本轮请转只读巡检，或先 git pull --ff-only 再继续。')
  }

  const round = (Number(state.round) || 0) + 1
  const mine = { state: 'running', round, startedAt: new Date().toISOString() }
  write(mine)
  // 写后回读校验：并发实例会互相覆盖，谁覆盖掉谁就退出
  await sleep(2000)
  const back = read()
  if (back.round !== round || back.startedAt !== mine.startedAt) {
    console.log(`LOST 锁被并发实例抢走（它写入 round=${back.round}）。本轮立即退出，不做任何改动。`)
    process.exit(2)
  }
  console.log(`ACQUIRED round=${round}。报告章节号用「## 第 ${round} 轮」。`)
  process.exit(0)
}

if (cmd === 'release') {
  const cur = read()
  if (cur.state !== 'running') {
    console.log(`锁当前不是 running（state=${cur.state || '缺失'}），无需释放。`)
    process.exit(0)
  }
  write({ state: 'finished', round: cur.round, finishedAt: new Date().toISOString() })
  console.log(`RELEASED round=${cur.round}。`)
  process.exit(0)
}

console.log('未知子命令，可用：acquire | release | status')
process.exit(64)
