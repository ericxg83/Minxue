/**
 * watchdogCadence.mjs — 看门狗探测节奏（纯函数，供 keep_local_services.mjs 与回归测试共用）
 *
 * 背景（2026-10-19 负责人指示）：保活不必全天候 15s 高频探测，「只要高峰的时候我随时能拉起就可以」。
 * 高峰窗口默认值来自生产库 tasks.created_at 60 天分布实测（257 任务 / 29 活跃日，2026-10-19 探针）：
 *   周一~周五 15:00-21:30 覆盖 90%（231/257），18-19 点为绝对峰值（63+68）；
 *   周末与白天仅零星（合计 ~26）⇒ 低峰 10 分钟一探足够，任何拉起后自动加速 2 分钟确认恢复。
 *
 * 窗口规格格式（env WATCHDOG_PEAK_WINDOWS 可覆盖默认值）：
 *   多窗口用 `;` 分隔；每个窗口 = `DAYS HH:MM-HH:MM`；
 *   DAYS = 逗号分隔的 `N` 或 `A-B`（0=周日 … 6=周六），例：`1-5 15:00-21:30;0,6 09:00-12:00`
 *   约束：起始 < 结束（不支持跨零点窗口；需要的话拆成两段）。
 */

export const DEFAULT_PEAK_WINDOWS_SPEC = '1-5 15:00-21:30'
export const DEFAULT_PEAK_INTERVAL_MS = 15_000
export const DEFAULT_OFFPEAK_INTERVAL_MS = 600_000

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

/** 当前时刻（本机本地时间）是否处于任一高峰窗口（结束分钟为开区间：21:30:00 整不算高峰） */
export function isPeak(date, windows) {
  if (!Array.isArray(windows) || windows.length === 0) return false
  const dow = date.getDay()
  const minutes = date.getHours() * 60 + date.getMinutes()
  return windows.some((w) => w.days.has(dow) && minutes >= w.startMin && minutes < w.endMin)
}

/**
 * 计算下一轮探测间隔。
 * - 高峰窗口内 → peakMs（保证随时拉起）
 * - 低峰 → offPeakMs
 * - 刚发生过拉起（accelerateUntil 在未来）→ 即使在低峰也先用 peakMs 快速确认恢复
 */
export function pickIntervalMs({ now, windows, peakMs, offPeakMs, accelerateUntil }) {
  if (Number.isFinite(accelerateUntil) && accelerateUntil > now.getTime()) return peakMs
  return isPeak(now, windows) ? peakMs : offPeakMs
}
