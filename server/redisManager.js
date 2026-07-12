import Redis from 'ioredis'

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
        console.error(`[Redis:${poolItem.id}] 连接错误: ${err.message}`)
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

    // Start health check
    this.startHealthCheck()
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
        console.warn(`[Redis:${item.id}] ping 失败，尝试下一个: ${err.message}`)
        this.clients.delete(item.id)
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
      pool: this.pool.map(item => ({
        id: item.id,
        priority: item.priority,
        connected: this.clients.has(item.id)
      }))
    }
  }
}

export const redisManager = new RedisManager()
