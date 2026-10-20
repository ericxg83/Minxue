/**
 * renderKeepalive.mjs — 高峰窗口内给 Render 后端保活（2026-10-20 r319）
 *
 * ── 为什么放在本地看门狗里 ─────────────────────────────────────────────
 * Render 免费实例 15 分钟无入站请求就睡；唤醒要重跑 48 个迁移，老师第一下操作
 * 要干等半分钟。仓库里原本有两条保活通道，实测都不顶用：
 *   ① GitHub Actions schedule：名义 144 次/天，实测每天只有 3–8 次（间隔 4–6 小时
 *      ≫ 15 分钟阈值）⇒ 从来没真正保活成功过。
 *   ② workers/keepalive（Cloudflare Cron）：机制可靠，但要负责人用浏览器登录
 *      Cloudflare 部署一次，尚未部署。
 * 而负责人干活时电脑是开着的（本地看门狗一直在跑）⇒ 由它顺手每 5 分钟打一次
 * /api/health，是当前唯一「零账号、零额外费用、确实会执行」的保活通道。
 *
 * ── 与「疯狂重连」的关系（别混为一谈）──────────────────────────────────
 * 保活**不碰 Redis**：/api/health 只量磁盘和字体，不查库、不发 Redis 命令，
 * 所以它既不烧 Upstash 额度，也不会制造重连。它治的是「冷启动」，
 * 而冷启动正是过去每一轮 BullMQ 拆建风暴的触发点。
 *
 * ── 只在高峰打（负责人 2026-10-20 指示）────────────────────────────────
 * 窗口口径与 Redis 心跳、Cloudflare Worker 完全同一份（server/lib/peakWindows.mjs），
 * 默认 `1-5 15:00-21:30`。窗口外一个请求都不发，让实例正常睡。
 * env `RENDER_KEEPALIVE=off` 可整体关闭。
 */
import { isPeak } from '../../server/lib/peakWindows.mjs'

export const RENDER_HEALTH_URL = process.env.RENDER_KEEPALIVE_URL || 'https://minxue-api.onrender.com/api/health'
export const PING_EVERY_MS = 5 * 60_000
// 冷启动要等 Render 把容器拉起来，单次超时必须放宽；它不阻塞看门狗主循环。
export const PING_TIMEOUT_MS = 90_000

/** 是否该打这一发（纯函数，便于单测） */
export function shouldPingRender({ now = new Date(), windows, lastPingAt = 0, everyMs = PING_EVERY_MS, enabled = true }) {
  if (!enabled) return false
  if (!isPeak(now, windows)) return false
  return now.getTime() - lastPingAt >= everyMs
}

/**
 * 保活器：自带节流 + 单飞（上一发没回来就不发第二发），只把「冷启动」和「失败」写日志。
 * @param {{windows:any, log?:(line:string)=>any, fetchImpl?:typeof fetch, everyMs?:number,
 *          url?:string, timeoutMs?:number, enabled?:boolean}} opts
 */
export function createRenderKeepalive(opts = {}) {
  const {
    windows,
    log = async () => {},
    fetchImpl = fetch,
    everyMs = PING_EVERY_MS,
    url = RENDER_HEALTH_URL,
    timeoutMs = PING_TIMEOUT_MS,
    enabled = process.env.RENDER_KEEPALIVE !== 'off'
  } = opts

  let lastPingAt = 0
  let inFlight = false
  let lastBootAt = null

  return {
    get lastPingAt() { return lastPingAt },
    get inFlight() { return inFlight },

    /** 由看门狗每个 tick 调用；返回是否真的发出了请求。绝不等待结果。 */
    maybePing(now = new Date()) {
      if (inFlight) return false
      if (!shouldPingRender({ now, windows, lastPingAt, everyMs, enabled })) return false

      lastPingAt = now.getTime()
      inFlight = true
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), timeoutMs)

      fetchImpl(url, { signal: ctl.signal })
        .then(r => r.json())
        .then((d) => {
          // 只在「bootAt 变了」时记一行：这是冷启动的实证，也是保活是否生效的唯一判据
          if (d?.bootAt && d.bootAt !== lastBootAt) {
            const first = lastBootAt === null
            lastBootAt = d.bootAt
            if (!first) return log(`[render] 检测到冷启动（bootAt=${d.bootAt}，uptime=${d.uptimeSec}s）——保活曾断过`)
          }
        })
        .catch(e => log(`[render] 保活失败: ${e.message}`))
        .finally(() => {
          clearTimeout(timer)
          inFlight = false
        })
      return true
    }
  }
}
