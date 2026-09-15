/**
 * Render 保活 Worker（Cloudflare Workers + Cron Triggers）
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * 后端 minxue-api 跑在 Render 免费实例上，15 分钟无入站 HTTP 请求就 spin down。
 * 用户「隔一段时间（典型是隔夜）打开 App」正好落在冷启动窗口里，要干等半分钟。
 *
 * 仓库里已配了 .github/workflows/keepalive.yml 做同一件事，但实测该
 * scheduled workflow 在上线后 30+ 分钟内一次都没触发（GitHub 的 schedule
 * 本身有已知的延迟与丢弃行为，尤其对刚添加的 workflow）。
 * 如果 GitHub 侧仍不稳定，就用这个 Worker 作为可靠替代：
 * Cloudflare 的 Cron Triggers 按时精确触发，免费额度每天 10 万次请求。
 *
 * ── 部署 ────────────────────────────────────────────────────────────────
 *   cd workers/keepalive
 *   npx wrangler deploy          # 首次会要求浏览器登录 Cloudflare 账号
 *
 * 部署后访问 Worker 的 URL 可手动探活一次，返回实例的实际状态
 * （含 bootAt / uptimeSec，便于确认实例是否一直醒着）。
 *
 * ── 与 Pages 配置的关系 ─────────────────────────────────────────────────
 * 仓库根目录的 wrangler.toml 是 Cloudflare **Pages** 配置
 * （`pages_build_output_dir = "dist"`），Pages Functions 不支持 cron，
 * 所以 cron 必须挂在这个独立的 Worker 上，两者互不冲突。
 */
const TARGET = 'https://minxue-api.onrender.com/api/health'

// 每 5 分钟一次：Render 的休眠阈值是 15 分钟，留足重试与调度的余量
const SCHEDULE = '*/5 * * * *'

async function ping(trigger) {
  const startedAt = Date.now()
  try {
    const res = await fetch(TARGET, { cf: { cacheTtl: 0 } })
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

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      ping(`cron@${event.cron}`).then((result) => {
        console.log(JSON.stringify(result))
      })
    )
  },

  // 手动访问一次即可探活，方便验证部署是否成功
  async fetch() {
    const result = await ping('manual')
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })
  }
}

export { SCHEDULE }
