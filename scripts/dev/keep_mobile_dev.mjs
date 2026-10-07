/**
 * keep_mobile_dev.mjs — 敏学移动端 dev server 守护（2026-10-08）
 *
 * 背景：:5173 vite dev server 无守护，系统重启/进程回收后挂了没人拉起，
 * 只能靠巡逻器「发现再拉」（R56-R59 连续 4 轮报 mobile-dev DOWN 的根因）。
 * 本守护参照 keep_backend.mjs（r106）同款模式：以 Windows 分离进程方式常驻，
 * 每 15s 探活，失败时自动拉起 vite dev：
 *   - 健康检查 GET http://127.0.0.1:5173（3s 超时，响应即健康，vite 返回 200）；
 *   - 失败且端口无监听 → detached 重启 node node_modules/vite/bin/vite.js --port 5173 --host；
 *   - 失败但端口有监听（僵尸/挂起）→ taskkill 该 PID 后下轮再拉起。
 *
 * 启动（脱离当前会话，关终端也活着）：
 *   powershell -NoProfile -Command "Start-Process -WindowStyle Hidden node -ArgumentList 'scripts/dev/keep_mobile_dev.mjs' -WorkingDirectory 'D:\Minxue_App_V3'"
 *
 * 日志：logs/keep_mobile_dev.log（追加，带时间戳）
 * 停止：任务管理器找 node（keep_mobile_dev）结束。
 */
import { spawn } from 'node:child_process'
import { spawnLocal } from '../../server/utils/localSpawn.js'
import { appendFile, mkdir } from 'node:fs/promises'
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOG = resolve(ROOT, 'logs', 'keep_mobile_dev.log')
const PID_FILE = resolve(ROOT, 'logs', 'keep_mobile_dev.pid')
const INTERVAL_MS = 15_000
const HEALTH_URL = 'http://127.0.0.1:5173'
const VITE_CMD = ['node_modules/vite/bin/vite.js', '--port', '5173', '--host']
// 拉起冷却保护：vite dev 冷启动（尤其首次 optimize deps）可能 20-60s，远超 15s 探测周期。
// 若拉起后一个周期未监听就被判「僵尸」taskkill，会陷入「拉起→杀→拉起→杀」死循环。
// 故拉起后 cooldownMs 内失败只记录不 taskkill，给足启动时间；冷却期后仍失败才清理。
const COOLDOWN_MS = 90_000
let lastSpawnAt = 0

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

/** 返回占用 5173 端口的 PID 列表；⛔ 探测失败返回 null（「不知道」≠「没有」，混起来会拉出双份 vite） */
function listeners() {
  // ⛔ 必须走共享入口：execFileSync 的默认 stdio 在本机必 EBUSY（见 server/utils/localSpawn.js）
  const r = spawnLocal('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true })
  if (r.status !== 0) return null
  const pids = new Set()
  for (const line of String(r.stdout || '').split('\n')) {
    if (!line.includes(':5173') || !/LISTENING/i.test(line)) continue
    const pid = line.trim().split(/\s+/).pop()
    if (/^\d+$/.test(pid)) pids.add(pid)
  }
  return [...pids]
}

// ── 单实例守卫：开机自启 + 手动启动叠加时防双跑 ──
try {
  if (existsSync(PID_FILE)) {
    const old = Number(readFileSync(PID_FILE, 'utf8').trim())
    if (old && old !== process.pid) {
      try {
        process.kill(old, 0) // 还活着 → 已有守护在跑，本实例退出
        console.log(`keep_mobile_dev 已在运行（PID ${old}），本实例退出`)
        process.exit(0)
      } catch { /* 旧进程已死，残留 pid 文件，接管 */ }
    }
  }
  writeFileSync(PID_FILE, String(process.pid))
  process.on('exit', () => { try { if (readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) unlinkSync(PID_FILE) } catch { /* 忽略 */ } })
} catch { /* pid 守卫失败不阻断守护主职能 */ }

let ticking = false
async function tick() {
  if (ticking) return
  ticking = true
  try {
    if (await healthy()) return
    const pids = listeners()
    // ⛔ null = netstat 起不来：既不能清理也不能拉起（与 keep_backend 同一判据语义）
    if (pids === null) { await log('netstat 探测失败 → 本轮不清理也不拉起（避免与在跑的 vite 抢端口）'); return }
    if (pids.length) {
      const inCooldown = Date.now() - lastSpawnAt < COOLDOWN_MS
      if (inCooldown) {
        // 刚拉起还在冷启动，端口可能已被占用但尚未响应健康 → 不清理，下一轮再看
        await log(`端口被占（PID ${pids.join(',')}）但刚拉起（冷却中，${Math.round((COOLDOWN_MS - (Date.now() - lastSpawnAt)) / 1000)}s）→ 不清理，等待启动`)
        return
      }
      await log(`健康失败且端口被占（PID ${pids.join(',')}，已过冷却期）→ taskkill 后下轮拉起`)
      for (const pid of pids) {
        spawnLocal('taskkill', ['/F', '/PID', pid], { windowsHide: true, stdio: 'ignore' })
      }
      return
    }
    await log('健康失败且端口空闲 → 拉起 vite dev')
    lastSpawnAt = Date.now()
    const child = spawn('node', VITE_CMD, {
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

await log(`守护启动（每 ${INTERVAL_MS / 1000}s 探活 ${HEALTH_URL}，PID ${process.pid}）`)
setInterval(tick, INTERVAL_MS)
tick()