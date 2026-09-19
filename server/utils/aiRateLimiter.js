/**
 * 按通道的令牌桶限流器 —— 把低频免费通道压在其 RPM 上限之下。
 *
 * ── 为什么必须在通道侧限速（2026-09-19 实测）────────────────────────────────
 * Google Gemini 免费档：flash 系列 **5 RPM**、lite 系列 **15 RPM**（按 project、按模型计）。
 * 几何 DSL 闭环需 ~2.5 次视觉/图 × ~9.6s ≈ **6 次/分 > 5 RPM**。
 * 不加节流实测：29 次调用里 **21 次 429（72%）**，7 张图里 4 张直接失败。
 * 而 429 退避**必须跨整个分钟窗**（短退避 2.5/5/7.5s 全部撞墙，等满 65s 才过）。
 *
 * 结论：与其"撞了再等 65s"，不如**主动压到 4 次/分**（留 20% 余量），让 429 基本不出现。
 * 注意这是"通道侧"限速，不是队列侧 —— 几何队列本来就 concurrency=1，
 * 再降并发只会让整条链路停摆，限不住突发。
 *
 * 配额按 project+model 计，所以**所有**使用该通道的调用（几何/OCR/文本）共用同一个实例，
 * 由 env `GEMINI_DIRECT_RPM` 统一调节。
 */

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * @param {object} o
 * @param {number} o.perMinute 每分钟允许的请求数
 * @param {number} [o.burst]   允许的突发额度（默认 1，最保守）
 * @param {() => number} [o.now]   时钟（测试注入）
 * @param {(ms:number)=>Promise<void>} [o.sleep] 等待（测试注入）
 */
export function createRateLimiter({ perMinute, burst = 1, now = Date.now, sleep = defaultSleep }) {
  const rpm = Number(perMinute)
  if (!Number.isFinite(rpm) || rpm <= 0) throw new Error(`perMinute 必须为正数，收到 ${perMinute}`)
  const intervalMs = 60000 / rpm
  const cap = Math.max(1, Number(burst) || 1)
  let tokens = cap
  let last = now()

  return {
    intervalMs,
    /** 取一个令牌；不足则等到有为止。永远 resolve（不抛错）。 */
    async acquire() {
      for (;;) {
        const t = now()
        const elapsed = t - last
        if (elapsed > 0) {
          tokens = Math.min(cap, tokens + elapsed / intervalMs)
          last = t
        }
        if (tokens >= 1) {
          tokens -= 1
          return
        }
        const waitMs = Math.ceil((1 - tokens) * intervalMs)
        await sleep(Math.max(1, waitMs))
      }
    },
    /** 仅供诊断/测试观察当前令牌数 */
    _tokens: () => tokens,
  }
}
