import Redis from 'ioredis'

class RedisManager {
  constructor() {
    this.clients = new Map()
    this.currentIndex = 0
    this.pool = this.buildPool()
    this.initialized = false
  }

  buildPool() {
    const pool = []

    if (process.env.REDIS_LOCAL === 'true' || process.env.REDIS_HOST === 'localhost') {
      pool.push({
        id: 'local',
        config: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_LOCAL_PASSWORD || undefined,
          enableReadyCheck: true,
          maxRetriesPerRequest: null
        },
        type: 'CONFIG'
      })
    }

    if (process.env.REDIS_POOL_URLS) {
      const urls = process.env.REDIS_POOL_URLS.split(',').map(u => u.trim()).filter(Boolean)
      urls.forEach((url, i) => {
        pool.push({
          id: `pool_${i}`,
          url: url,
          type: 'URL'
        })
      })
    } else if (process.env.REDIS_POOL_CONFIG) {
      try {
        const configs = JSON.parse(process.env.REDIS_POOL_CONFIG)
        configs.forEach((cfg, i) => {
          pool.push({
            id: `pool_${i}`,
            config: cfg,
            type: 'CONFIG'
          })
        })
      } catch (e) {
        console.error('REDIS_POOL_CONFIG 解析失败:', e.message)
      }
    }

    if (process.env.REDIS_URL) {
      pool.push({
        id: 'upstash_main',
        url: process.env.REDIS_URL.trim(),
        type: 'URL'
      })
    }

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
          maxRetriesPerRequest: null,
          tls: { rejectUnauthorized: false }
        })
      } else {
        client = new Redis(poolItem.config)
      }

      client.on('error', (err) => {
        console.error(`[Redis:${poolItem.id}] 连接错误: ${err.message}`)
      })

      client.on('connect', () => {
        console.log(`[Redis:${poolItem.id}] 已连接`)
      })

      await client.ping()
      this.clients.set(poolItem.id, client)
      return client
    } catch (err) {
      console.error(`[Redis:${poolItem.id}] 连接失败: ${err.message}`)
      return null
    }
  }

  async init() {
    if (this.initialized) return

    for (const item of this.pool) {
      await this.createClient(item)
    }

    this.initialized = true
    console.log(`[Redis] 连接池初始化完成: ${this.clients.size}/${this.pool.length} 个实例`)
  }

  async getAvailableClient() {
    if (this.pool.length === 0) {
      console.error('[Redis] 没有可用的 Redis 实例')
      return null
    }

    for (let i = 0; i < this.pool.length; i++) {
      const idx = (this.currentIndex + i) % this.pool.length
      const item = this.pool[idx]
      const client = this.clients.get(item.id)

      if (!client) {
        const newClient = await this.createClient(item)
        if (newClient) {
          this.currentIndex = idx
          return newClient
        }
        continue
      }

      try {
        await client.ping()
        this.currentIndex = idx
        return client
      } catch (err) {
        console.warn(`[Redis:${item.id}] ping 失败，尝试下一个: ${err.message}`)
        this.clients.delete(item.id)
      }
    }

    console.error('[Redis] 所有实例均不可用')
    return null
  }

  async close() {
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
      current: this.pool[this.currentIndex]?.id || 'none'
    }
  }
}

export const redisManager = new RedisManager()
