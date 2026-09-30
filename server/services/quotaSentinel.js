import fs from 'node:fs'
import path from 'node:path'

// 配额哨兵（提案 1 被动版核心，2026-09-30 立项）
// 职责：记录「供应商降级事件」（429/53000/配额类错误），供工作台顶栏横幅与夜间巡检报告读取。
//
// 设计约束（改本文件前必读）：
//  1. 本模块会在别人的错误处理路径里被调用——任何自身失败都绝不能向调用方抛出，
//     只允许 console.warn 后吞掉；持久化失败也不丢弃内存态。
//  2. 只记录、不改变任何重试/降级行为——重试语义仍完全由既有分类器与 worker 决定。
//  3. 降级事件带 6 小时 TTL（惰性过期）：即使上游忘了调 clearDegraded，横幅也会自动消失。
//
// 接线状态（2026-09-30）：模块 + 查询路由已入库；ai.js/worker.js/neonService/redis
// 各捕获点的 recordDegraded 调用由 10-01 档接入（接线点清单见 docs/auto/backlog.md 提案区）。

const DEGRADED_TTL_MS = 6 * 60 * 60 * 1000
// 状态文件落在 server/_* 下（已被 .gitignore 覆盖，不会入库）
const STATE_FILE = process.env.QUOTA_SENTINEL_STATE_FILE || path.join(import.meta.dirname, '_quota_state.json')

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return parsed && typeof parsed === 'object' && parsed.events ? parsed : { events: {} }
  } catch {
    return { events: {} }
  }
}

let state = loadState()

function persist() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8')
  } catch (e) {
    console.warn('[quotaSentinel] 状态持久化失败（不影响主流程）:', e?.message)
  }
}

function normalize(supplier) {
  return String(supplier || '').trim().toLowerCase() || 'unknown'
}

/** 记录/刷新某供应商的降级事件。同一供应商重复记录保留最初 since（不刷新计时）。 */
export function recordDegraded(supplier, { kind = 'quota', detail = '' } = {}) {
  try {
    const key = normalize(supplier)
    const prev = state.events[key]
    state.events[key] = {
      kind,
      detail: String(detail).slice(0, 300),
      since: prev?.since || Date.now(),
      updatedAt: Date.now()
    }
    persist()
  } catch (e) {
    console.warn('[quotaSentinel] 记录降级事件失败（不影响主流程）:', e?.message)
  }
  return snapshot()
}

/** 供应商恢复时显式清除（可选——TTL 兜底保证横幅终会消失）。 */
export function clearDegraded(supplier) {
  try {
    delete state.events[normalize(supplier)]
    persist()
  } catch (e) {
    console.warn('[quotaSentinel] 清除降级事件失败（不影响主流程）:', e?.message)
  }
  return snapshot()
}

/** 当前水位快照：{ ok, degraded: [{supplier,kind,detail,since,minutes}], checkedAt }。内部全兜底，绝不抛出。 */
export function snapshot({ now = Date.now() } = {}) {
  try {
    const degraded = []
    let expired = false
    for (const [supplier, ev] of Object.entries(state.events || {})) {
      if (now - (ev.updatedAt || ev.since || 0) > DEGRADED_TTL_MS) {
        delete state.events[supplier]
        expired = true
        continue
      }
      degraded.push({
        supplier,
        kind: ev.kind,
        detail: ev.detail,
        since: ev.since,
        minutes: Math.round((now - ev.since) / 60000)
      })
    }
    if (expired) persist()
    degraded.sort((a, b) => a.since - b.since)
    return { ok: degraded.length === 0, degraded, checkedAt: now }
  } catch (e) {
    console.warn('[quotaSentinel] 快照生成失败:', e?.message)
    return { ok: true, degraded: [], checkedAt: now, error: 'sentinel_error' }
  }
}
