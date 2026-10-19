import Redis from 'ioredis'
import { recordDegraded } from './services/quotaSentinel.js'
import { parseWindows, isPeak, DEFAULT_PEAK_WINDOWS_SPEC } from './lib/peakWindows.mjs'

// Upstash 业务级错误关键字（ping 不会触发，只在实际命令时返回）
const QUOTA_EXHAUSTED_PATTERNS = [
  'max requests limit exceeded',
  'max daily requests exceeded',
  'monthly request limit exceeded',
  'quota exceeded'
]
const isQuotaExhaustedError = (message) => {
  if (!message) return false
  const lower = String(message).toLowerCase()
  return QUOTA_EXHAUSTED_PATTERNS.some(p => lower.includes(p.toLowerCase()))
}

// 熔断自愈回探用的 key：GET 一个不存在的 key ⇒ 返回 null，不写入、不改任何状态，
// 但它是「计入配额的真实数据命令」——实例仍在超额 ⇒ 原样报配额错；额度已恢复 ⇒ 成功返回。
// （PING 不行：Upstash 超额后 PING 仍 PONG，连接级探活对配额天然失明。）
const REDIS_BREAKER_PROBE_KEY = '__redis_breaker_selfheal_probe__'

class RedisManager {
  constructor() {
    this.clients = new Map()
    this.currentIndex = 0
    this.pool = []
    this.initialized = false
    this.healthCheckInterval = null
    // 心跳节奏（2026-10-19 负责人 14:24 指令：每条 PING 都烧 Upstash 额度 ⇒ 高峰密集、低峰基本不用）：
    // tick 固定 REDIS_HEALTH_CHECK_PEAK_MS（默认 60s，本地定时器不烧 Redis），tick 内由
    // shouldRunHealthCheck 门控——高峰窗内每 tick 必查；低峰每 REDIS_HEALTH_CHECK_MS（默认 30 分钟）抽检。
    // 高峰窗与看门狗共用 server/lib/peakWindows.mjs 唯一实现（⛔ 不能 import scripts/dev/watchdogCadence.mjs：
    // Render rootDir=server，scripts/ 不在生产镜像，生产会 ERR_MODULE_NOT_FOUND）。
    // ⚠️ REDIS_HEALTH_CHECK_MS 语义已从「全天固定间隔」（曾默认 300000）改为「低峰间隔」。
    this.healthTickMs = parseInt(process.env.REDIS_HEALTH_CHECK_PEAK_MS, 10) || 60000
    this.healthOffPeakIntervalMs = parseInt(process.env.REDIS_HEALTH_CHECK_MS, 10) || 1800000
    this.healthTickCount = 0
    this.healthPeakWindows = parseWindows(process.env.REDIS_PEAK_WINDOWS) ?? parseWindows(DEFAULT_PEAK_WINDOWS_SPEC)
    this.reconnectDelayMs = 5000 // 5 seconds
    // 熔断自愈回探间隔：默认 15 分钟（REDIS_BREAKER_PROBE_MS 可覆盖）。
    // 只在「存在被熔断实例」时才真正发命令，正常运行零开销。
    this.breakerProbeIntervalMs = parseInt(process.env.REDIS_BREAKER_PROBE_MS, 10) || 900000
    this.breakerProbeInterval = null
    this.breakerProbing = false
    this.breakerProbeCursor = 0
    // 熔断解除回调（由 queue.js 注册：实例恢复归队后，队列坏死态则重建）
    this.onQuotaRecovered = null
    this.isShuttingDown = false
    // 配额熔断追踪：被熔断的实例 id 集合
    this.quotaExhaustedSet = new Set()
    // 配额熔断通知回调（由 queue.js 注册，触发 BullMQ Worker 重建）
    this.onQuotaExhausted = null
  }

  /**
   * 将一个实例标记为「额度耗尽」，从可用池中临时剔除。
   * 下一个 getAvailableClient() 会跳过它，强制走 backup。
   * 下次 resetQuotaExhausted()（默认每月 1 号）会解除熔断。
   */
  markQuotaExhausted(id, reason) {
    if (!id) return
    if (this.quotaExhaustedSet.has(id)) return
    this.quotaExhaustedSet.add(id)
    console.warn(`[Redis:${id}] 🚫 额度熔断: ${reason || 'quota exhausted'}`)
    // 关闭该 client 释放连接（不删除 pool 成员，保留配置以便后续 reset 后重用）
    const client = this.clients.get(id)
    if (client) {
      try { client.disconnect() } catch (e) { /* ignore */ }
      this.clients.delete(id)
    }
    // 通知 queue 重建 Worker 连接
    if (typeof this.onQuotaExhausted === 'function') {
      try {
        this.onQuotaExhausted(id, reason)
      } catch (e) {
        console.error('[Redis] onQuotaExhausted 回调执行失败:', e.message)
      }
    }
  }

  /**
   * 解除一个实例的熔断标记（每月 1 号 Upstash 额度刷新时调用）。
   */
  resetQuotaExhausted(id) {
    if (!id) {
      // 不传 id → 清空所有熔断
      if (this.quotaExhaustedSet.size > 0) {
        console.log(`[Redis] 🔓 解除所有配额熔断 (${this.quotaExhaustedSet.size} 个实例): ${Array.from(this.quotaExhaustedSet).join(', ')}`)
        this.quotaExhaustedSet.clear()
      }
      return
    }
    if (this.quotaExhaustedSet.delete(id)) {
      console.log(`[Redis:${id}] 🔓 解除配额熔断`)
    }
  }

  /**
   * ⭐ 熔断自愈回探（2026-10-19，负责人批准的「修熔断卡死」）：
   * markQuotaExhausted 一旦标记就只等每月 1 号解除——但 Upstash 免费额度并非只在月初恢复
   * （2026-10-19 实测：backup_1 上午被标熔断，2.5 小时后实际已恢复可用），
   * 而健康检查只 ping「未熔断」实例、绝不回探被熔断实例 ⇒ 额度恢复了也无法归队，
   * 队列可能带病停摆到月底。本回探对被熔断实例发「真实数据命令」（GET）：
   * 成功 ⇒ 解除熔断归队 + 触发 onQuotaRecovered（queue 侧坏死态则重建队列）。
   */
  startBreakerProbe() {
    if (this.breakerProbeInterval) {
      clearInterval(this.breakerProbeInterval)
    }
    this.breakerProbeCursor = 0
    this.breakerProbing = false
    this.breakerProbeInterval = setInterval(async () => {
      if (this.isShuttingDown || this.breakerProbing) return
      this.breakerProbing = true
      try {
        await this.probeMarkedInstances()
      } catch {
        // 回探自身失败不影响主流程，下个周期再试
      } finally {
        this.breakerProbing = false
      }
    }, this.breakerProbeIntervalMs)
    console.log(`[Redis:BreakerProbe] 已启动 (间隔: ${Math.round(this.breakerProbeIntervalMs / 1000)}s)`)
  }

  stopBreakerProbe() {
    if (this.breakerProbeInterval) {
      clearInterval(this.breakerProbeInterval)
      this.breakerProbeInterval = null
      console.log('[Redis:BreakerProbe] 已停止')
    }
  }

  /**
   * 对被熔断实例做一轮回探（每轮只探一个，按池顺序轮转，避免同刻多实例并发试探）。
   * @returns {Promise<string|null>} 本轮被解除熔断的实例 id（无则 null）
   */
  async probeMarkedInstances() {
    const marked = this.pool.filter(item => this.quotaExhaustedSet.has(item.id))
    if (marked.length === 0) return null
    const item = marked[this.breakerProbeCursor % marked.length]
    this.breakerProbeCursor = (this.breakerProbeCursor + 1) % marked.length
    const recovered = await this.probeInstance(item)
    if (recovered) {
      console.log(`[Redis:${item.id}] 🔄 自愈回探成功（真实数据命令通过），解除配额熔断归队`)
      this.resetQuotaExhausted(item.id)
      if (typeof this.onQuotaRecovered === 'function') {
        try {
          this.onQuotaRecovered(item.id)
        } catch (e) {
          console.error('[Redis] onQuotaRecovered 回调执行失败:', e.message)
        }
      }
      return item.id
    }
    return null
  }

  /**
   * 对单个实例发一次真实数据命令试探（临时连接，用完即断，不复用进连接池）。
   * @returns {Promise<boolean>} true = 数据命令成功（额度已恢复）
   */
  async probeInstance(item) {
    let client = null
    try {
      if (item.type === 'URL') {
        client = new Redis(item.url, {
          connectTimeout: 8000,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null,
          tls: { rejectUnauthorized: false }
        })
      } else {
        client = new Redis({
          ...(item.config || {}),
          connectTimeout: 8000,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null
        })
      }
      // 探针 client 同样必须挂 error 监听（2026-10-19 r308 实测补）：
      // ioredis 对没有 error 监听的实例只会打印 "[ioredis] Unhandled error event"
      // （built/Redis.js silentEmit 兜底：有监听才 emit，无监听仅 console.error，
      // 不抛异常、不崩进程——本轮对真实超额主库/恢复备库/不存在域名三种路径实测
      // uncaughtException 计数均为 0）。但不挂的代价是：被熔断实例每次回探失败
      // 都会往日志堆一条「看似未处理崩溃」的噪音，真事故时反而干扰判读。
      // 失败语义由本函数返回值承载（false = 额度未恢复/不可达），此处静默即可；
      // 实例状态的可观测面是 getStats().quotaExhausted 与 /api/diagnostics/worker-status。
      client.on('error', () => { /* 失败由返回值表达，禁 ioredis 默认噪音行 */ })
      await client.get(REDIS_BREAKER_PROBE_KEY)
      return true
    } catch {
      return false
    } finally {
      try { client?.disconnect() } catch { /* ignore */ }
    }
  }

  /**
   * 安排每月 1 号 00:01（本地时区）自动解除所有熔断。
   * 与 Upstash 免费额度「每月重置」周期对齐。
   *
   * 注意：Render 免费层会 sleep 实例，setTimeout 在 sleep 期间不会触发。
   * 所以 init() 里同时会调用 ensureResetAfterMonthlyBoundary() 做兜底。
   */
  scheduleMonthlyReset() {
    // Node 的 setTimeout 最大安全 timeout 是 2^31-1 ms（约 24.8 天）。
    // 距下个月 1 号 00:01 最多可达 31+ 天，必须裁剪，否则会触发
    // TimeoutOverflowWarning 并被强制设为 1ms（导致月初立刻误触发）。
    const MAX_TIMEOUT_MS = 0x7fffffff
    const tick = () => {
      const now = new Date()
      // 下个月 1 号 00:01
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 1, 0, 0)
      const ms = Math.min(next.getTime() - now.getTime(), MAX_TIMEOUT_MS)
      setTimeout(() => {
        this.resetQuotaExhausted()
        tick() // 排定下一个月
      }, ms)
    }
    tick()
    console.log('[Redis] ⏰ 已安排每月 1 号自动解除配额熔断')
  }

  /**
   * 兜底：进程冷启动时如果已经过了"本月 1 号 00:01"，
   * 立即清空所有熔断标记，让主实例重新可用。
   * 解决 Render 免费层 sleep 后 setTimeout 不会触发的场景。
   */
  ensureResetAfterMonthlyBoundary() {
    if (this.quotaExhaustedSet.size === 0) return
    const now = new Date()
    const thisMonthBoundary = new Date(now.getFullYear(), now.getMonth(), 1, 0, 1, 0, 0)
    if (now.getTime() >= thisMonthBoundary.getTime()) {
      console.log(`[Redis] 🔓 冷启动兜底：本月 1 号已过，解除 ${this.quotaExhaustedSet.size} 个熔断标记`)
      this.quotaExhaustedSet.clear()
    }
  }

  buildPool() {
    const pool = []

    // Highest priority: Local Redis (only when explicitly enabled)
    if (process.env.REDIS_LOCAL === 'true') {
      pool.push({
        id: 'local',
        config: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_LOCAL_PASSWORD || undefined,
          enableReadyCheck: true,
          maxRetriesPerRequest: null,
          reconnectOnError: () => true, // Always try to reconnect on error
          retryStrategy: (times) => {
            const delay = Math.min(times * 1000, 10000) // Max 10s delay
            console.log(`[Redis:local] 第 ${times} 次重试，${delay}ms 后重连...`)
            return delay
          }
        },
        type: 'CONFIG',
        priority: 0 // Highest priority
      })
    }

    // Collect every Upstash instance into a failover-ordered list.
    // REDIS_URL            -> primary (preferred)
    // REDIS_POOL_URLS      -> comma-separated backups (e.g. the old quota-exhausted account)
    const urlEntries = []
    if (process.env.REDIS_URL) {
      urlEntries.push({ url: process.env.REDIS_URL.trim(), label: 'upstash_primary' })
    }
    if (process.env.REDIS_POOL_URLS) {
      process.env.REDIS_POOL_URLS
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .forEach((u, i) => urlEntries.push({ url: u, label: `upstash_backup_${i + 1}` }))
    }

    urlEntries.forEach((entry, idx) => {
      pool.push({
        id: entry.label,
        url: entry.url,
        type: 'URL',
        priority: idx + 1, // lower number = higher priority; primary first
        maxRetriesPerRequest: null,
        retryStrategy: (times) => {
          if (times > 5) return null // Stop after 5 retries
          return Math.min(times * 2000, 10000)
        }
      })
    })

    // Sort by priority (lower number = higher priority)
    pool.sort((a, b) => (a.priority || 99) - (b.priority || 99))

    return pool
  }

  async createClient(poolItem) {
    if (this.clients.has(poolItem.id)) {
      return this.clients.get(poolItem.id)
    }

    try {
      let client
      if (poolItem.type === 'URL') {
        client = new Redis(poolItem.url, {
          maxRetriesPerRequest: poolItem.maxRetriesPerRequest || null,
          tls: { rejectUnauthorized: false },
          retryStrategy: poolItem.retryStrategy
        })
      } else {
        client = new Redis({
          ...poolItem.config,
          retryStrategy: poolItem.config?.retryStrategy || undefined
        })
      }

      client.on('error', (err) => {
        const msg = err?.message || ''
        console.error(`[Redis:${poolItem.id}] 连接错误: ${msg}`)
        // ⭐ 配额熔断：Upstash 业务级错误（ping 不会触发，只有真实命令会触发）
        // 命中后立即标记该实例为不可用，下次 getAvailableClient 跳过它走 backup
        if (isQuotaExhaustedError(msg)) {
          this.markQuotaExhausted(poolItem.id, msg)
          // 配额哨兵（提案 1）：复用既有熔断判断上报水位，只记录、不改熔断语义
          recordDegraded('redis', { kind: 'quota', detail: `[${poolItem.id}] ${String(msg).slice(0, 200)}` })
        }
        // Auto-reconnect is handled by ioredis retryStrategy
      })

      client.on('connect', () => {
        console.log(`[Redis:${poolItem.id}] 已连接`)
      })

      client.on('reconnecting', () => {
        console.log(`[Redis:${poolItem.id}] 正在重连...`)
      })

      client.on('ready', () => {
        console.log(`[Redis:${poolItem.id}] 准备就绪`)
      })

      client.on('end', () => {
        console.warn(`[Redis:${poolItem.id}] 连接断开`)
        // Remove from cache so next getAvailableClient will recreate
        this.clients.delete(poolItem.id)
      })

      await client.ping()
      this.clients.set(poolItem.id, client)
      console.log(`[Redis:${poolItem.id}] ✅ 连接成功`)
      return client
    } catch (err) {
      console.error(`[Redis:${poolItem.id}] ❌ 连接失败: ${err.message}`)
      return null
    }
  }

  async init() {
    if (this.initialized) return

    // Build pool now that env vars are loaded
    this.pool = this.buildPool()

    // Try to connect to all Redis instances
    for (const item of this.pool) {
      await this.createClient(item)
    }

    this.initialized = true
    console.log(`[Redis] 连接池初始化完成: ${this.clients.size}/${this.pool.length} 个实例`)

    // 冷启动兜底：解决 Render sleep 后 setTimeout 失效问题
    this.ensureResetAfterMonthlyBoundary()

    // Start health check
    this.startHealthCheck()

    // 熔断自愈回探：被熔断实例定期用真实数据命令试探，额度恢复即归队
    this.startBreakerProbe()

    // 每月 1 号 00:01 自动解除所有配额熔断（与 Upstash 免费额度重置周期对齐）
    this.scheduleMonthlyReset()
  }

  async getAvailableClient() {
    if (this.pool.length === 0) {
      console.error('[Redis] 没有可用的 Redis 实例')
      return null
    }

    // Try each Redis instance in priority order
    for (let i = 0; i < this.pool.length; i++) {
      const idx = (this.currentIndex + i) % this.pool.length
      const item = this.pool[idx]

      // ⭐ 配额熔断：跳过已被标记为额度耗尽的实例
      if (this.quotaExhaustedSet.has(item.id)) {
        continue
      }

      let client = this.clients.get(item.id)

      // Try to reconnect if client doesn't exist
      if (!client) {
        console.log(`[Redis] 尝试重连: ${item.id}`)
        client = await this.createClient(item)
        if (client) {
          this.currentIndex = idx
          return client
        }
        continue
      }

      // Check if client is still alive
      try {
        const result = await client.ping()
        if (result === 'PONG') {
          this.currentIndex = idx
          return client
        }
      } catch (err) {
        const msg = err?.message || ''
        console.warn(`[Redis:${item.id}] ping 失败，尝试下一个: ${msg}`)
        // ping 失败时也检测配额（理论上不会，但防御性写法）
        if (isQuotaExhaustedError(msg)) {
          this.markQuotaExhausted(item.id, msg)
        } else {
          this.clients.delete(item.id)
        }
        continue
      }
    }

    console.error('[Redis] ❌ 所有实例均不可用')
    return null
  }

  /**
   * 心跳门控（纯函数便于测试）：高峰窗内每 tick 必查；低峰按 healthOffPeakIntervalMs
   * 换算的 tick 间隔抽检。判据用动作时刻的 now，禁止事后取值。
   */
  shouldRunHealthCheck(now = new Date(), tickCount = this.healthTickCount) {
    if (isPeak(now, this.healthPeakWindows)) return true
    const every = Math.max(1, Math.round(this.healthOffPeakIntervalMs / this.healthTickMs))
    return tickCount % every === 0
  }

  startHealthCheck() {
    // Clear existing interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }

    this.healthCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) return
      this.healthTickCount += 1
      if (!this.shouldRunHealthCheck()) return

      try {
        const client = await this.getAvailableClient()
        if (client) {
          console.log(`[Redis:HealthCheck] ✅ 连接正常 (当前实例: ${this.pool[this.currentIndex]?.id})`)
        } else {
          console.warn('[Redis:HealthCheck] ⚠️ 所有 Redis 实例不可用，将在下次请求时重试')
        }
      } catch (err) {
        console.error('[Redis:HealthCheck] 健康检查失败:', err.message)
      }
    }, this.healthTickMs)

    console.log(`[Redis:HealthCheck] 已启动 (tick: ${this.healthTickMs / 1000}s；高峰每 tick 必查 / 低峰每 ${this.healthOffPeakIntervalMs / 60000} 分钟；窗口: ${process.env.REDIS_PEAK_WINDOWS || DEFAULT_PEAK_WINDOWS_SPEC})`)
  }

  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
      console.log('[Redis:HealthCheck] 已停止')
    }
  }

  async close() {
    this.isShuttingDown = true
    this.stopHealthCheck()
    this.stopBreakerProbe()

    for (const [id, client] of this.clients) {
      try {
        await client.quit()
        console.log(`[Redis:${id}] 已关闭`)
      } catch { /* 关机阶段 quit 失败无意义可救，继续关下一个连接 */ }
    }
    this.clients.clear()
    this.initialized = false
  }

  getStats() {
    return {
      total: this.pool.length,
      connected: this.clients.size,
      current: this.pool[this.currentIndex]?.id || 'none',
      quotaExhausted: Array.from(this.quotaExhaustedSet),
      pool: this.pool.map(item => ({
        id: item.id,
        priority: item.priority,
        connected: this.clients.has(item.id),
        quotaExhausted: this.quotaExhaustedSet.has(item.id)
      }))
    }
  }
}

export const redisManager = new RedisManager()
// 类本体也导出：供回归测试构造隔离实例（不污染单例状态）
export { RedisManager }
