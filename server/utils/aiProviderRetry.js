/**
 * AI 供应商「瞬态故障」感知的有界重试 —— 限流（429/配额窗口）与过载（503）。
 *
 * ── 为什么需要它（2026-09-19）────────────────────────────────────────────────
 * geometryWorker 的失败路径是：
 *     任何异常 → handleRetry() → retry_count+1 → 第 3 次后 tikz_status='none'
 *     → **永久放弃重绘**，前端静默回退裁剪原图（用户无感）。
 *
 * 限流与过载是**常态噪声**，不是"这张图不可重绘"。一旦让它们消耗那道 3 次预算，
 * 本来能重绘的题会被**永久判死**，且没有任何报错可见 —— 与 2026-09-09
 * 「练习册答案页打爆魔搭 → 静默降级弱模型 → 全本错位」属同一类事故。
 *
 * ── 实测依据 ────────────────────────────────────────────────────────────────
 * Google Gemini 免费档（2026-09-19 实测）：
 *   - flash 系列 **5 RPM**、lite 系列 **15 RPM**（配额按 project、按模型计）。
 *   - DSL 闭环需 ~2.5 次视觉/图 × ~9.6s ≈ **6 次/分 > 5 RPM** → 无节流时
 *     29 次调用里 21 次 429（72%）。
 *   - **429 退避必须跨整个分钟窗**：短退避 2.5 / 5 / 7.5s **全部撞墙**，
 *     等满 65s 才能通过。故默认等待取 65s 而非指数短退避。
 *   - 503（"high demand"）是另一种形态：短暂、重试即通，用短等待即可。
 *
 * ── 边界 ────────────────────────────────────────────────────────────────────
 * 本模块只做「命中瞬态 → 有界等待重试」。非瞬态错误**立即原样上抛**，
 * 不改变 handleRetry 的任何语义；重试次数用尽后同样原样上抛。
 * 因此它是一层**纯安全网**，可独立回滚，不依赖任何新供应商接入。
 */

// 限流类：429 / 配额窗口 / 供应商侧"全部模型不可用"（等价于通道暂时打不通）
const RATE_LIMIT_RE = /(?:\b429\b|RESOURCE_EXHAUSTED|rate[\s_-]*limit|too\s+many\s+requests|frequency\s+limit|quota[^.]{0,32}(?:exceed|exhaust)|exceed[^.]{0,32}quota|insufficient\s+balance|out\s+of\s+quota|所有视觉模型.{0,8}(?:不可用|失败)|所有魔搭视觉模型.{0,12}配额)/i

// 过载类：503 / 上游高负载（Google 原文 "This model is currently experiencing high demand"）
const OVERLOAD_RE = /(?:\b503\b|UNAVAILABLE|high\s+demand|overloaded|service\s+unavailable|temporarily\s+unavailable)/i

function errText(err) {
  const d = err?.response?.data
  return String(
    d?.error?.message || d?.message || (typeof d === 'string' ? d : '') || err?.message || ''
  )
}

/** 限流（429 / 配额窗口）—— 需按**整分钟窗**等待后重试 */
export function isRateLimitError(err) {
  if (!err) return false
  if (err?.response?.status === 429 || err?.status === 429) return true
  return RATE_LIMIT_RE.test(errText(err))
}

/** 过载（503 / 上游高负载）—— 短等待即可重试 */
export function isOverloadError(err) {
  if (!err) return false
  if (err?.response?.status === 503 || err?.status === 503) return true
  // 503 报文可能被包成 UNAVAILABLE 且不带 status
  return OVERLOAD_RE.test(errText(err))
}

function num(envKey, def) {
  const v = Number(process.env[envKey])
  return Number.isFinite(v) && v >= 0 ? v : def
}

/**
 * 有界重试：命中限流/过载时等待后重试；其它错误立即上抛。
 *
 * @param {() => Promise<any>} fn
 * @param {object} [opts]
 * @param {number} [opts.rateLimitRetries] 限流最多重试次数（默认 3，env AI_RATE_LIMIT_RETRIES）
 * @param {number} [opts.rateLimitWaitMs]  限流单次等待（默认 65000，env AI_RATE_LIMIT_WAIT_MS）
 * @param {number} [opts.overloadRetries]  过载最多重试次数（默认 3，env AI_OVERLOAD_RETRIES）
 * @param {number} [opts.overloadWaitMs]   过载单次等待（默认 5000，env AI_OVERLOAD_WAIT_MS）
 * @param {(info:{kind:'rate_limit'|'overload',attempt:number,waitMs:number,error:Error})=>void} [opts.onWait]
 * @param {(ms:number)=>Promise<void>} [opts.sleep] 便于测试注入
 */
export async function withProviderRetry(fn, opts = {}) {
  const rateLimitRetries = opts.rateLimitRetries ?? num('AI_RATE_LIMIT_RETRIES', 3)
  const rateLimitWaitMs = opts.rateLimitWaitMs ?? num('AI_RATE_LIMIT_WAIT_MS', 65000)
  const overloadRetries = opts.overloadRetries ?? num('AI_OVERLOAD_RETRIES', 3)
  const overloadWaitMs = opts.overloadWaitMs ?? num('AI_OVERLOAD_WAIT_MS', 5000)
  const sleep = opts.sleep || ((ms) => new Promise(r => setTimeout(r, ms)))
  const onWait = opts.onWait

  let rl = 0
  let ol = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      if (isRateLimitError(err) && rl < rateLimitRetries) {
        rl += 1
        if (onWait) onWait({ kind: 'rate_limit', attempt: rl, waitMs: rateLimitWaitMs, error: err })
        await sleep(rateLimitWaitMs)
        continue
      }
      if (isOverloadError(err) && ol < overloadRetries) {
        ol += 1
        if (onWait) onWait({ kind: 'overload', attempt: ol, waitMs: overloadWaitMs, error: err })
        await sleep(overloadWaitMs)
        continue
      }
      throw err
    }
  }
}
