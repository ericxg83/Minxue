/**
 * peakWindows.mjs — 高峰窗口判定（纯函数，唯一实现，禁止另写一份）
 *
 * 共用方（铁律「同一件事只准一个实现」）：
 *   - scripts/dev/keep_local_services.mjs（本地看门狗拉起节奏，经 watchdogCadence.mjs re-export）
 *   - server/redisManager.js（Redis 心跳高峰分化：高峰每 tick / 低峰稀疏抽检）
 *
 * 背景（2026-10-19 负责人两次指示）：
 *   ① 看门狗「只要高峰的时候我随时能拉起就可以」→ 高峰快探 / 低峰稀疏；
 *   ② Redis 心跳「每条 PING 都烧 Upstash 额度 ⇒ 高峰密集一点，低峰可以不用」→ 同一窗口复用。
 * 高峰窗口默认值来自生产库 tasks.created_at 60 天分布实测（257 任务 / 29 活跃日，2026-10-19 探针）：
 *   周一~周五 15:00-21:30 覆盖 90%（231/257），18-19 点为绝对峰值（63+68）。
 *
 * ⚠️ 时区无关性（2026-10-19）：Render（rootDir=server）机器时区是 UTC，而窗口语义是北京时间。
 *    isPeak 一律用「UTC 毫秒 + 固定偏移（默认 +480 = UTC+8）」换算钟面，不读本机 getHours()。
 *    北京机器上结果与本机钟面判定完全等价；UTC 机器（生产）上不再错位 8 小时。
 *    env PEAK_TZ_OFFSET_MIN 可改偏移（分钟）。
 *
 * 窗口规格格式（看门狗用 env WATCHDOG_PEAK_WINDOWS，redisManager 用 env REDIS_PEAK_WINDOWS）：
 *   多窗口用 `;` 分隔；每个窗口 = `DAYS HH:MM-HH:MM`；
 *   DAYS = 逗号分隔的 `N` 或 `A-B`（0=周日 … 6=周六），例：`1-5 15:00-21:30;0,6 09:00-12:00`
 *   约束：起始 < 结束（不支持跨零点窗口；需要的话拆成两段）。
 */

export const DEFAULT_PEAK_WINDOWS_SPEC = '1-5 15:00-21:30'
export const DEFAULT_PEAK_INTERVAL_MS = 15_000
export const DEFAULT_OFFPEAK_INTERVAL_MS = 600_000
// ⚠️ 必须用 `typeof process` 守卫：本文件同时被 Cloudflare Worker（workers/keepalive）
// 引用，Workers 运行时没有 `process` 全局 —— 直接 `process.env` 会在模块求值阶段抛
// ReferenceError，整个 cron 静默失效。Node 侧行为与原来完全一致。
export const DEFAULT_TZ_OFFSET_MIN = (() => {
  if (typeof process === 'undefined' || !process?.env) return 480
  const n = parseInt(process.env.PEAK_TZ_OFFSET_MIN, 10)
  return Number.isFinite(n) ? n : 480 // 默认北京时间 UTC+8
})()

/** 解析窗口规格；任何不合法 ⇒ 返回 null（调用方回退默认值，不抛异常） */
export function parseWindows(spec) {
  if (typeof spec !== 'string') return null
  const parts = spec.split(';').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const windows = []
  for (const part of parts) {
    const m = part.match(/^(\d{1,2}(?:-\d{1,2})?(?:,\d{1,2}(?:-\d{1,2})?)*)\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const days = new Set()
    for (const tok of m[1].split(',')) {
      const range = tok.match(/^(\d{1,2})-(\d{1,2})$/)
      if (range) {
        const a = Number(range[1])
        const b = Number(range[2])
        if (a > 6 || b > 6 || a > b) return null
        for (let d = a; d <= b; d++) days.add(d)
      } else {
        const d = Number(tok)
        if (d > 6) return null
        days.add(d)
      }
    }
    const hh = [Number(m[2]), Number(m[4])]
    const mm = [Number(m[3]), Number(m[5])]
    if (hh[0] > 23 || hh[1] > 23 || mm[0] > 59 || mm[1] > 59) return null
    const startMin = hh[0] * 60 + mm[0]
    const endMin = hh[1] * 60 + mm[1]
    if (startMin >= endMin) return null
    if (days.size === 0) return null
    windows.push({ days, startMin, endMin })
  }
  return windows
}

/**
 * 当前时刻是否处于任一高峰窗口（结束分钟为开区间：21:30:00 整不算高峰）。
 * 时区无关：按「UTC 毫秒 + tzOffsetMin」换算出的钟面判定，与本机时区无关。
 * @param {Date} date 任意时区机器上的同一绝对时刻
 * @param {Array<{days:Set<number>,startMin:number,endMin:number}>|null} windows
 * @param {number} [tzOffsetMin=DEFAULT_TZ_OFFSET_MIN]
 */
export function isPeak(date, windows, tzOffsetMin = DEFAULT_TZ_OFFSET_MIN) {
  if (!Array.isArray(windows) || windows.length === 0) return false
  const shifted = new Date(date.getTime() + tzOffsetMin * 60000)
  const dow = shifted.getUTCDay()
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  return windows.some((w) => w.days.has(dow) && minutes >= w.startMin && minutes < w.endMin)
}

/**
 * 计算下一轮探测间隔。
 * - 高峰窗口内 → peakMs（保证随时拉起）
 * - 低峰 → offPeakMs
 * - 刚发生过拉起（accelerateUntil 在未来）→ 即使在低峰也先用 peakMs 快速确认恢复
 */
export function pickIntervalMs({ now, windows, peakMs, offPeakMs, accelerateUntil, tzOffsetMin }) {
  if (Number.isFinite(accelerateUntil) && accelerateUntil > now.getTime()) return peakMs
  return isPeak(now, windows, tzOffsetMin) ? peakMs : offPeakMs
}

// ────────────────────────────────────────────────────────────────────────────
// 本地看门狗三缺陷判据（2026-10-20，负责人授权修 r292-P-A；纯函数，唯一实现）
//
// 为什么在这里：keep_local_services.mjs 的 tick() 直接耦合 spawn/netstat/fetch，无法单测；
// 把「该不该杀/该不该拉」三个判据下沉成纯函数，既有唯一实现又可被test/watchdogOwnership.test.mjs
// 锁定（含反向自检）。守护运行时调用这三个函数，不再内联判断。
// ────────────────────────────────────────────────────────────────────────────

/** 前端启动参数（含 --strictPort）—— 缺陷①：缺它时端口被占会静默顺延，孤儿永不被回收 */
export function frontendDevArgs(port = 3000) {
  return ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host']
}

/**
 * 端口「被占」且探活失败时，是否该 taskkill —— 缺陷②（kill 侧）。
 * 只杀本守护自己拉起的进程；外部（开机任务 / 手动）拉起的进程不归本守护杀，
 * 否则会误杀健康服务（r309 实测开机冷启动窗口三次误杀 vite，3 分钟自愈）。
 * @param {{spawnedAt:number, spawnedByUs:boolean}} svc
 * @param {number} now Date.now()
 * @param {number} cooldownMs
 * @returns {'cooldown'|'external'|'kill'} 动作决策
 */
export function decideOccupiedPort(svc, now, cooldownMs) {
  if (now - svc.spawnedAt < cooldownMs) return 'cooldown' // 刚拉起，等它起
  if (!svc.spawnedByUs) return 'external' // 外部进程，不杀，仅观察
  return 'kill' // 本守护拉起的、已过冷却、仍不健康 → 杀
}

/**
 * 端口「空闲」且探活失败时，是否该拉起 —— 缺陷②（spawn 侧）。
 * 开机自启链先拉进程但尚未 listen 时端口瞬时空闲，此时抢拉会双份抢端口；
 * 冷却期（守护启动/上次拉起后 cooldownMs）内只等待，冷却后仍空闲才由守护接管拉起。
 * @returns {'cooldown'|'spawn'}
 */
export function decideIdlePort(svc, now, cooldownMs) {
  return now - svc.spawnedAt < cooldownMs ? 'cooldown' : 'spawn'
}
