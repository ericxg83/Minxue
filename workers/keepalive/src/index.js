/**
 * Render 保活 Worker（Cloudflare Workers + Cron Triggers）—— 仅在「高峰窗口」内保活
 *
 * ── 它治的是什么 ────────────────────────────────────────────────────────
 * 后端 minxue-api 跑在 Render 免费实例上，15 分钟无入站 HTTP 请求就 spin down。
 * 冷启动要重新调度容器、串行重跑 48 个迁移，老师「隔一段时间打开 App」要干等
 * 半分钟；更糟的是每次冷启动都会重建整套 BullMQ（Queue/Worker），把 Upstash
 * 命令额度一起烧掉（2026-10-20 实测：烧穿库连接数 3050 vs 健康库 42）。
 *
 * ── 只在高峰保活（2026-10-20 负责人指示）───────────────────────────────
 * 负责人原话：「如果这个疯狂重连是有目的的（倘若是之前我要求的），那你可以在我
 * 使用的高峰期间让他保持不要断。」
 * ⇒ 高峰窗口内每 5 分钟保活，窗口外**主动不打**，让实例正常睡（省 Render 时长，
 *   也让「睡觉」不再是被动触发、而是我们选的策略）。
 * 窗口口径与 Redis 心跳/本地看门狗完全同一份实现（server/lib/peakWindows.mjs），
 * 默认 `1-5 15:00-21:30`（来自生产 tasks.created_at 60 天分布实测：覆盖 90%）。
 *
 * ── 为什么要留 10 分钟预热 ──────────────────────────────────────────────
 * 老师 15:00 一坐下来就要用。若 15:00 才打第一次，那一分钟内正好是冷启动。
 * 因此判定用「当前时刻」或「10 分钟后的时刻」落在窗口内 ⇒ 实际从 14:50 就开始保活。
 *
 * ── 部署 ────────────────────────────────────────────────────────────────
 *   cd workers/keepalive
 *   npx wrangler deploy          # 首次会要求浏览器登录 Cloudflare 账号
 * 部署后访问 Worker 的 URL 可手动探活一次（手动访问不受窗口限制），
 * 返回实例的实际状态（含 bootAt / uptimeSec / 当前是否在高峰窗口）。
 *
 * ── 与 Pages 配置的关系 ─────────────────────────────────────────────────
 * 仓库根目录的 wrangler.toml 是 Cloudflare **Pages** 配置
 * （`pages_build_output_dir = "dist"`），Pages Functions 不支持 cron，
 * 所以 cron 必须挂在这个独立的 Worker 上，两者互不冲突。
 */
import { parseWindows, isPeak, DEFAULT_PEAK_WINDOWS_SPEC, DEFAULT_TZ_OFFSET_MIN } from '../../../server/lib/peakWindows.mjs'

const TARGET = 'https://minxue-api.onrender.com/api/health'

// 每 5 分钟一次：Render 的休眠阈值是 15 分钟，留足重试与调度的余量
const SCHEDULE = '*/5 * * * *'

// 预热提前量：窗口开始前 10 分钟就开始保活，避免 15:00 第一下吃到冷启动
const PREWARM_MIN = 10

const PEAK_WINDOWS = parseWindows(DEFAULT_PEAK_WINDOWS_SPEC)

/**
 * 此刻是否该保活（纯函数，便于单测）。
 * @param {Date} now
 * @param {Array<{days:Set<number>,startMin:number,endMin:number}>|null} windows
 * @param {number} tzOffsetMin
 * @param {number} prewarmMin 向前探的分钟数（预热）
 */
export function shouldPingNow(now = new Date(), windows = PEAK_WINDOWS, tzOffsetMin = DEFAULT_TZ_OFFSET_MIN, prewarmMin = PREWARM_MIN) {
  if (isPeak(now, windows, tzOffsetMin)) return true
  const ahead = new Date(now.getTime() + prewarmMin * 60000)
  return isPeak(ahead, windows, tzOffsetMin)
}

async function ping(trigger, fetchImpl = fetch) {
  const startedAt = Date.now()
  try {
    const res = await fetchImpl(TARGET, { cf: { cacheTtl: 0 } })
    const body = await res.text()
    return {
      ok: res.ok,
      status: res.status,
      trigger,
      elapsedMs: Date.now() - startedAt,
      // 回显实例状态：uptimeSec 很小说明刚刚才被唤醒（此前一直在休眠）
      instance: (() => {
        try { return JSON.parse(body) } catch { return body.slice(0, 200) }
      })()
    }
  } catch (err) {
    return { ok: false, trigger, elapsedMs: Date.now() - startedAt, error: err.message }
  }
}

/**
 * cron 的实际执行体（可注入 now / fetch，便于单测）。窗口外直接跳过，一个请求都不发。
 */
export async function runScheduled({ now = new Date(), cron = SCHEDULE, fetchImpl = fetch, windows = PEAK_WINDOWS } = {}) {
  if (!shouldPingNow(now, windows)) {
    return { skipped: true, reason: 'off-peak', now: now.toISOString(), windows: DEFAULT_PEAK_WINDOWS_SPEC }
  }
  return ping(`cron@${cron}`, fetchImpl)
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runScheduled({ now: new Date(), cron: event.cron }).then((result) => {
        console.log(JSON.stringify(result))
      })
    )
  },

  // 手动访问一次即可探活，方便验证部署是否成功（不受高峰窗口限制）
  async fetch() {
    const result = await ping('manual')
    return new Response(JSON.stringify({
      ...result,
      peakGate: {
        inPeakNow: isPeak(new Date(), PEAK_WINDOWS),
        windows: DEFAULT_PEAK_WINDOWS_SPEC,
        prewarmMin: PREWARM_MIN,
        note: '定时触发只在高峰窗口（含预热 10 分钟）内保活；手动访问始终探活'
      }
    }, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })
  }
}

export { SCHEDULE, PREWARM_MIN, PEAK_WINDOWS }
