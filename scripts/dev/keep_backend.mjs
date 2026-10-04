/**
 * keep_backend.mjs — 敏学后端守护进程（r106）
 *
 * 背景：本机 :4000 后端进程会被宿主/系统间歇性回收（2026-10-04 一天内发生 5 次，
 * 每次都让当轮冒烟/验证大面积 500 假红后重来）。本守护以 Windows 分离进程方式
 * 常驻（不挂在 ZCode 任务管理下），每 15s 探活，失败时自动拉起后端：
 *   - 健康检查 GET /api/health（3s 超时）；
 *   - 失败且端口无监听 → detached 重启 node server/index.js；
 *   - 失败但端口有监听（僵尸/挂起）→ taskkill 该 PID 后下轮再拉起。
 *
 * 启动（脱离当前会话，关终端也活着）：
 *   powershell -NoProfile -Command "Start-Process -WindowStyle Hidden node -ArgumentList 'scripts/dev/keep_backend.mjs' -WorkingDirectory 'D:\Minxue_App_V3'"
 *
 * 日志：server/scripts/logs/keep_backend.log（追加，带时间戳）
 * 停止：任务管理器找 node（keep_backend）结束，或 `taskkill /F /IM node.exe`（慎，会连后端一起杀）。
 */
import { spawn, execFileSync } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOG = resolve(ROOT, 'server/scripts/logs/keep_backend.log')
const INTERVAL_MS = 15_000
const HEALTH_URL = 'http://127.0.0.1:4000/api/health'

async function log(line) {
  try {
    await mkdir(dirname(LOG), { recursive: true })
    await appendFile(LOG, `[${new Date().toISOString()}] ${line}\n`, 'utf8')
  } catch { /* 日志失败不影响守护 */ }
}

async function healthy() {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 3000)
    const r = await fetch(HEALTH_URL, { signal: ctl.signal })
    clearTimeout(t)
    return r.ok
  } catch { return false }
}

/** 返回占用 4000 端口的 PID 列表（netstat 解析；无监听返回空数组） */
function listeners() {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
    const pids = new Set()
    for (const line of out.split('\n')) {
      if (!line.includes(':4000') || !/LISTENING/i.test(line)) continue
      const pid = line.trim().split(/\s+/).pop()
      if (/^\d+$/.test(pid)) pids.add(pid)
    }
    return [...pids]
  } catch { return [] }
}

let ticking = false
async function tick() {
  if (ticking) return
  ticking = true
  try {
    if (await healthy()) return
    const pids = listeners()
    if (pids.length) {
      await log(`健康失败且端口被占（PID ${pids.join(',')}）→ taskkill 后下轮拉起`)
      for (const pid of pids) {
        try { execFileSync('taskkill', ['/F', '/PID', pid], { windowsHide: true }) } catch { /* 已死 */ }
      }
      return
    }
    await log('健康失败且端口空闲 → 拉起后端 node server/index.js')
    const child = spawn('node', ['server/index.js'], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
  } catch (e) {
    await log(`tick 异常: ${e.message}`)
  } finally {
    ticking = false
  }
}

// ── 单实例守卫：开机自启（r110）后若手动再启会双跑，用 pid 文件互斥 ──
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
const PID_FILE = resolve(ROOT, 'server/scripts/logs/keep_backend.pid')
try {
  if (existsSync(PID_FILE)) {
    const old = Number(readFileSync(PID_FILE, 'utf8').trim())
    if (old && old !== process.pid) {
      try {
        process.kill(old, 0) // 还活着 → 已有守护在跑，本实例退出
        console.log(`keep_backend 已在运行（PID ${old}），本实例退出`)
        process.exit(0)
      } catch { /* 旧进程已死，残留 pid 文件，接管 */ }
    }
  }
  writeFileSync(PID_FILE, String(process.pid))
  process.on('exit', () => { try { if (readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) unlinkSync(PID_FILE) } catch { /* 忽略 */ } })
} catch { /* pid 守卫失败不阻断守护主职能 */ }

await log(`守护启动（每 ${INTERVAL_MS / 1000}s 探活 ${HEALTH_URL}，PID ${process.pid}）`)
setInterval(tick, INTERVAL_MS)
tick()
