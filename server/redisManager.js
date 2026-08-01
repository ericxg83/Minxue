import Redis from 'ioredis'

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

class RedisManager {
  constructor() {
    this.clients = new Map()
    this.currentIndex = 0
    this.pool = []
    this.initialized = false
    this.healthCheckInterval = null
    this.healthCheckIntervalMs = 60000 // 60 seconds (reduced from 30s to cut request volume)
    this.reconnectDelayMs = 5000 // 5 seconds
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

  startHealthCheck() {
    // Clear existing interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }

    this.healthCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) return

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
    }, this.healthCheckIntervalMs)

    console.log(`[Redis:HealthCheck] 已启动 (间隔: ${this.healthCheckIntervalMs / 1000}s)`)
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

    for (const [id, client] of this.clients) {
      try {
        await client.quit()
        console.log(`[Redis:${id}] 已关闭`)
      } catch (e) {}
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
