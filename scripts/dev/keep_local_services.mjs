/**
 * keep_local_services.mjs — 敏学本地服务守护（后端 :4000 + 前端 :3000）
 *
 * 背景（2026-10-15）：
 *   原有的开机自启（计划任务 MinxueLocalServices → start-local-hidden.vbs → start-local.cmd）
 *   只用 `start /min cmd /c ...` 各拉一次，**没有任何保活**。实测 2026-10-15 08:19 登录触发后，
 *   后端 08:21:41 才报「服务已启动」、约 08:22 就被 Ctrl+C（日志末尾 `^C`）收走，前端同样消失，
 *   到 08:25 时 :3000 / :4000 都不在监听 —— 自启"跑过了"但服务没留下。
 *   本守护沿用仓内已验证过的 keep_backend.mjs(r106)/keep_mobile_dev.mjs(2026-10-08) 模式：
 *   以分离进程常驻；2026-10-19 起按使用高峰动态调频——高峰（默认周一~五 15:00-21:30，
 *   生产库 tasks 60 天分布实测覆盖 90%）15s 探活保证随时拉起，低峰 600s 一探，
 *   拉起后自动加速 2 分钟确认恢复（纯函数见 watchdogCadence.mjs，回归锁见 test/watchdogCadence.test.mjs）。
 *
 * 覆盖对象：
 *   - 后端 :4000  健康检查 GET /api/health（3s 超时）
 *   - 前端 :3000  vite dev，健康检查 GET /（3s 超时）
 *
 * 判据（与 keep_backend / keep_mobile_dev 完全一致，别改单边）：
 *   探活失败 + 端口空闲        → detached 拉起
 *   探活失败 + 端口被占        → 过了冷却期才 taskkill（冷启动可能 20~60s，误杀会死循环）
 *   探活失败 + netstat 探测失败 → null，**本轮既不清也不拉**（「不知道」≠「没有」，
 *                                混起来会拉出双份抢端口；见 server/utils/localSpawn.js）
 *
 * 开机自启链：计划任务 MinxueLocalServices(AtLogOn) → scripts/start-local-hidden.vbs
 *            → 本脚本（隐藏窗口）。Startup 文件夹另放一份同款 vbs 做兜底。
 *            两份 vbs 均 set MINXUE_AUTOSTART=1 ⇒ 首跳端口空闲立即拉起（跳过 90s 防双拉冷却，
 *            该冷却只对「外部先拉起」场景有意义，自启链里守护自己是唯一拉起者）。
 * 单实例：logs/keep_local_services.pid 互斥，重复启动直接退出。
 * 浏览器：带 --open 时，首次探到两端都健康后打开一次 PC 工作台
 *        http://127.0.0.1:3000/workbench（每次守护生命周期仅一次；2026-10-28 起直开工作台）。
 * 日志：logs/keep_local_services.log（追加，带时间戳）
 * 停止：任务管理器结束 node（keep_local_services）即可（不会连带杀服务）。
 */
import { spawn } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import { writeFileSync, readFileSync, existsSync, unlinkSync, openSync, closeSync, statSync, renameSync, appendFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnLocal } from '../../server/utils/localSpawn.js'
import {
  DEFAULT_OFFPEAK_INTERVAL_MS,
  DEFAULT_PEAK_INTERVAL_MS,
  DEFAULT_PEAK_WINDOWS_SPEC,
  isPeak,
  parseWindows,
  pickIntervalMs,
  frontendDevArgs,
  decideOccupiedPort,
  decideIdlePort,
} from './watchdogCadence.mjs'
import { createRenderKeepalive } from './renderKeepalive.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOG = resolve(ROOT, 'logs', 'keep_local_services.log')
const PID_FILE = resolve(ROOT, 'logs', 'keep_local_services.pid')
// ⭐ 探测节奏（2026-10-19 负责人指示）：不必全天候 15s 高频——高峰（默认周一~五 15:00-21:30，
//    来自生产库 tasks 60 天分布，覆盖 90%）保持 15s 保证随时拉起；低峰 600s 一探；
//    任何一次拉起后自动加速 2 分钟确认恢复。可用 env 覆盖：
//    WATCHDOG_PEAK_WINDOWS（格式见 watchdogCadence.mjs 头注）/ WATCHDOG_PEAK_INTERVAL_MS /
//    WATCHDOG_OFFPEAK_INTERVAL_MS
const PEAK_INTERVAL_MS = parseInt(process.env.WATCHDOG_PEAK_INTERVAL_MS, 10) || DEFAULT_PEAK_INTERVAL_MS
const OFFPEAK_INTERVAL_MS = parseInt(process.env.WATCHDOG_OFFPEAK_INTERVAL_MS, 10) || DEFAULT_OFFPEAK_INTERVAL_MS
const PEAK_WINDOWS = parseWindows(process.env.WATCHDOG_PEAK_WINDOWS) ?? parseWindows(DEFAULT_PEAK_WINDOWS_SPEC)
const ACCELERATE_MS = 2 * 60_000 // 拉起后用高峰节奏确认恢复的时长
const COOLDOWN_MS = 90_000 // 拉起后给足冷启动时间，期间探活失败也不 taskkill

// ⭐ 开机自启链跳过首跳冷却（2026-10-28）：
//    自启 vbs（计划任务 + Startup 兜底）会 set MINXUE_AUTOSTART=1。该链路里守护自己就是
//    唯一拉起者（start-local.cmd 只是手动工具），「防开机双拉」的 90s 首跳冷却纯属白等——
//    2026-10-28 实测：08:29:42 首跳冷却等待 → 下一跳按低峰睡了 600s → 08:39:42 才拉起。
//    自启时把初始 spawnedAt 前移一个冷却期 ⇒ 首跳端口空闲立即拉起。
//    被占端口不受影响：spawnedByUs=false → decideOccupiedPort 返回 external → 只观察不杀，
//    绝无误杀外部健康服务的风险（r309 教训保持有效）。
const AUTOSTART = process.env.MINXUE_AUTOSTART === '1'
const initialSpawnedAt = () => Date.now() - (AUTOSTART ? COOLDOWN_MS : 0)

// ⭐ Render 保活（2026-10-20 r319，负责人「高峰期间不要断」）：
//   每个 tick 顺手看一眼，只在高峰窗口内每 5 分钟打一次 /api/health（不阻塞主循环）。
//   窗口判据与 Redis 心跳 / Cloudflare Worker 同一份（server/lib/peakWindows.mjs）。
//   窗口外一个请求都不发——让 Render 正常睡，睡觉是我们的策略而不是被动事故。
//   env RENDER_KEEPALIVE=off 可关闭；RENDER_KEEPALIVE_URL 可改目标。
const renderKeepalive = createRenderKeepalive({ windows: PEAK_WINDOWS, log })
// ⭐ 探活超时 3s → 8s（2026-10-20，r292-P-A 缺陷③）：vite 首次按需编译常 >3s，3s 会把
//    「健康但正忙」误判成失败 → 触发无谓 kill/spawn 抖动。开机冷启动窗口实测三次误杀
//    健康 vite（r309：PID 17352/8472/19848，00:54–00:57Z，3 分钟自愈）即此因。
//    8s 远小于最短探活间隔（低峰 600s / 高峰 15s），不会拖慢故障发现。
const HEALTH_TIMEOUT_MS = 8000
const OPEN_BROWSER = process.argv.includes('--open')
// ⭐ 直开 PC 工作台（2026-10-28 负责人反馈：弹出来的是移动端首页，还得手动切工作台）。
//    dev server 的 configureServer 中间件（vite.config.js）会把 /workbench 直接 serve 成
//    workbench.html，落点即 PC 工作台，无需经过移动端首页。
const OPEN_URL = 'http://127.0.0.1:3000/workbench'

// 仓库外的 esbuild 二进制（见 .workbuddy-ai/memory/topics/build-and-dev.md §4）
const ESBUILD_PATH = 'C:/Users/Administrator/.workbuddy-ai/binaries/esbuild/esbuild.exe'

const SERVICES = [
  {
    name: 'backend',
    port: 4000,
    healthUrl: 'http://127.0.0.1:4000/api/health',
    args: ['server/index.js'],
    // ⭐ spawnedAt 以守护启动时刻起算（而非 0）：给启动宽限 90s——守护冷启动首跳若恰逢
    //    服务健康检查瞬时失败（如 vite 按需编译 >3s），没有宽限会立即 taskkill 健康服务
    //    （2026-10-19 13:57 实测一例）。90s 后行为与旧版完全一致。
    // ⭐ spawnedByUs（2026-10-20，r292-P-A 缺陷②）：开机自启链（计划任务 MinxueLocalServices
    //    → start-local.cmd）会**先于**本守护拉起两端。守护启动首跳若探活瞬时失败 + 端口恰空闲
    //    （开机任务进程刚起、尚未 listen），旧版无条件再拉 ⇒ 双份抢端口（r292/r309 实测）。
    //    该标记区分「本守护拉起的」与「外部拉起的」：只有本守护拉起过的，端口空闲才负责拉起；
    //    外部的端口空闲仅观察等待，给它启动时间，不抢拉。
    spawnedAt: initialSpawnedAt(),
    spawnedByUs: false,
  },
  {
    name: 'frontend',
    port: 3000,
    healthUrl: 'http://127.0.0.1:3000/',
    // ⭐ --strictPort（2026-10-20，负责人授权修 r292-P-A缺陷①）：缺它时 :3000 被占vite
    //    会静默顺延 :3001/:3002，而本守护只探 :3000 ⇒ 顺延出来的孤儿永不被回收
    //    （r292 实测 3 实例 :3000/:3001/:3002、633MB，两孤儿零连接）。参数由纯函数
    //    frontendDevArgs() 统一提供（唯一实现，test/watchdogOwnership.test.mjs 锁定）。
    args: frontendDevArgs(3000),
    spawnedAt: initialSpawnedAt(), // 同上：启动宽限（自启链前移一个冷却期，首跳即可拉起）
    spawnedByUs: false, // 同上：开机任务先拉起时不抢拉
  },
]

async function log(line) {
  try {
    await mkdir(dirname(LOG), { recursive: true })
    await appendFile(LOG, `[${new Date().toISOString()}] ${line}\n`, 'utf8')
  } catch {
    /* 日志失败不影响守护 */
  }
}

async function healthy(svc) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), HEALTH_TIMEOUT_MS)
    const r = await fetch(svc.healthUrl, { signal: ctl.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

/** 返回占用端口的 PID 列表；⛔ 探测失败返回 null（「不知道」≠「没有」） */
function listeners(port) {
  const r = spawnLocal('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true })
  if (r.status !== 0) return null
  const pids = new Set()
  for (const line of String(r.stdout || '').split('\n')) {
    if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue
    const pid = line.trim().split(/\s+/).pop()
    if (/^\d+$/.test(pid)) pids.add(pid)
  }
  return [...pids]
}

// ── 服务日志落盘（2026-10-22）──────────────────────────────────────────────
// 历史 spawn 用 stdio:'ignore'，把后端 stdout/stderr **全部丢弃**。代价在 2026-10-22 暴露：
// 「6 个批改任务卡一整天」排查时后端反复重启，可日志里既没有崩溃堆栈、也没有
// index.js 早就埋好的「[生命周期] 进程退出 code=…」面包屑——只能靠重启时间反推，
// 排障最大的黑洞就是没证据。改为追加写 logs/<服务>-live.log（后端崩溃原因一眼可读）。
// 只留一代 .1（>5MB 轮转），避免日志无限增长。
const LOG_MAX_BYTES = 5 * 1024 * 1024
function openServiceLog(name) {
  const file = resolve(ROOT, 'logs', `${name}-live.log`)
  try {
    if (existsSync(file) && statSync(file).size > LOG_MAX_BYTES) {
      const bak = `${file}.1`
      if (existsSync(bak)) unlinkSync(bak)
      renameSync(file, bak)
    }
    appendFileSync(file, `\n===== ${new Date().toISOString()} 守护拉起 ${name} =====\n`)
    return openSync(file, 'a')
  } catch {
    return 'ignore' // 落盘失败不能连累拉起服务
  }
}

function spawnService(svc) {
  const env = { ...process.env }
  if (existsSync(ESBUILD_PATH)) env.ESBUILD_BINARY_PATH = ESBUILD_PATH
  const logFd = openServiceLog(svc.name)
  const child = spawn(process.execPath, svc.args, {
    cwd: ROOT,
    detached: true,
    // 子进程继承 fd 写日志；父进程随即关闭自己的句柄，不留泄漏
    stdio: logFd === 'ignore' ? 'ignore' : ['ignore', logFd, logFd],
    windowsHide: true,
    env,
  })
  if (typeof logFd === 'number') {
    try { closeSync(logFd) } catch { /* 已继承，关父句柄失败不影响子进程 */ }
  }
  child.unref()
}

// ── 单实例守卫（开机自启 + 手动启动叠加时防双跑）──
try {
  if (existsSync(PID_FILE)) {
    const old = Number(readFileSync(PID_FILE, 'utf8').trim())
    if (old && old !== process.pid) {
      try {
        process.kill(old, 0) // 还活着 → 已有守护在跑
        console.log(`keep_local_services 已在运行（PID ${old}），本实例退出`)
        process.exit(0)
      } catch {
        /* 旧进程已死，残留 pid 文件，接管 */
      }
    }
  }
  writeFileSync(PID_FILE, String(process.pid))
  process.on('exit', () => {
    try {
      if (readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) unlinkSync(PID_FILE)
    } catch {
      /* 忽略 */
    }
  })
} catch {
  /* pid 守卫失败不阻断守护主职能 */
}

let ticking = false
let browserOpened = false
let everSpawned = false
let accelerateUntil = 0 // 拉起后的加速确认期截止时刻（期间用高峰节奏 15s 探活）
let lastMode = null // 'peak' | 'offpeak'，仅用于节奏切换时记一行日志

async function tick() {
  if (ticking) return false // 并发保护触发 → 视为「未确认健康」，下一跳快探（保守方向）
  ticking = true
  let allHealthy = true
  try {
    for (const svc of SERVICES) {
      const ok = await healthy(svc)
      if (!ok) allHealthy = false
      if (ok) continue

      const pids = listeners(svc.port)
      if (pids === null) {
        await log(`[${svc.name}] netstat 探测失败 → 本轮不清也不拉（避免抢端口）`)
        continue
      }
      if (pids.length) {
        // 判据下沉纯函数 decideOccupiedPort（唯一实现，测试锁定）：
        //   cooldown → 刚拉起等它起/ external → 外部进程不杀仅观察 / kill → 本守护拉起的才杀
        const action = decideOccupiedPort(svc, Date.now(), COOLDOWN_MS)
        if (action === 'cooldown') {
          const left = Math.round((COOLDOWN_MS - (Date.now() - svc.spawnedAt)) / 1000)
          await log(`[${svc.name}] :${svc.port} 被占（PID ${pids.join(',')}）但刚拉起（冷却 ${left}s）→ 等待启动`)
          continue
        }
        if (action === 'external') {
          await log(`[${svc.name}] 健康失败且 :${svc.port} 被占（PID ${pids.join(',')}）但该进程非本守护拉起 → 不 taskkill，仅观察`)
          continue
        }
        await log(`[${svc.name}] 健康失败且 :${svc.port} 被占（PID ${pids.join(',')}，已过冷却，本守护拉起）→ taskkill 后下轮拉起`)
        for (const pid of pids) {
          spawnLocal('taskkill', ['/F', '/PID', pid], { windowsHide: true, stdio: 'ignore' })
        }
        continue
      }
      // 端口空闲：判据下沉纯函数 decideIdlePort（冷却内等待，防开机双拉）
      if (decideIdlePort(svc, Date.now(), COOLDOWN_MS) === 'cooldown') {
        const left = Math.round((COOLDOWN_MS - (Date.now() - svc.spawnedAt)) / 1000)
        await log(`[${svc.name}] 健康失败且 :${svc.port} 空闲但处于启动冷却（剩余 ${left}s）→ 等待（防开机双拉）`)
        continue
      }
      await log(`[${svc.name}] 健康失败且 :${svc.port} 空闲 → 拉起`)
      svc.spawnedAt = Date.now()
      svc.spawnedByUs = true
      everSpawned = true
      accelerateUntil = Date.now() + ACCELERATE_MS
      spawnService(svc)
    }

    // Render 保活（高峰窗口内，节流 5 分钟；fire-and-forget，绝不拖慢 15s 的探活节奏）
    renderKeepalive.maybePing()

    if (allHealthy && !browserOpened && everSpawned && OPEN_BROWSER) {
      browserOpened = true
      await log(`两端健康 → 打开浏览器 ${OPEN_URL}`)
      try {
        spawn('cmd', ['/c', 'start', '', OPEN_URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      } catch (e) {
        await log(`打开浏览器失败: ${e.message}`)
      }
    }
  } catch (e) {
    await log(`tick 异常: ${e.message}`)
    return false // 异常轮按「未恢复」处理
  } finally {
    ticking = false
  }
  return allHealthy
}

await log(
  `守护启动（高峰每 ${PEAK_INTERVAL_MS / 1000}s / 低峰每 ${OFFPEAK_INTERVAL_MS / 1000}s 探活 :4000 + :3000，` +
  `窗口 ${process.env.WATCHDOG_PEAK_WINDOWS || DEFAULT_PEAK_WINDOWS_SPEC}，PID ${process.pid}${OPEN_BROWSER ? '，--open' : ''}）`
)

// 自排程主循环：每轮按「高峰/低峰/拉起加速期」动态决定下一轮间隔（替代旧版固定 15s setInterval）
async function loop() {
  const now = new Date()
  const mode = isPeak(now, PEAK_WINDOWS) ? 'peak' : 'offpeak'
  if (mode !== lastMode) {
    await log(`节奏切换 → ${mode === 'peak' ? `高峰（每 ${PEAK_INTERVAL_MS / 1000}s 探活）` : `低峰（每 ${OFFPEAK_INTERVAL_MS / 1000}s 探活）`}`)
    lastMode = mode
  }
  const allHealthy = await tick()
  const nextMs = pickIntervalMs({
    now,
    windows: PEAK_WINDOWS,
    peakMs: PEAK_INTERVAL_MS,
    offPeakMs: OFFPEAK_INTERVAL_MS,
    accelerateUntil,
    // ⭐ 服务未全健康（冷启动/冷却等待/故障）→ 低峰也用快探节奏：
    //    600s 稀疏的设计前提是「两端都在跑」的稳态；2026-10-28 实测冷启动
    //    在冷却等待轮后睡满 600s、登录到弹浏览器 12 分钟，即此因。
    pendingRecovery: !allHealthy,
  })
  setTimeout(() => { loop().catch(() => {}) }, nextMs)
}

loop().catch(async (e) => {
  await log(`主循环异常退出: ${e.message}，5s 后重启主循环`)
  setTimeout(() => { loop().catch(() => {}) }, 5000)
})
