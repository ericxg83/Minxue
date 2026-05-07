const CACHE_VERSION = 'v3.1'
const CACHE_PREFIX = `minxue_${CACHE_VERSION}_`

const DEFAULT_MAX_AGE = {
  students: 15 * 60 * 1000,
  tasks: 10 * 60 * 1000,
  questions: 5 * 60 * 1000,
  wrongQuestions: 5 * 60 * 1000,
  exams: 10 * 60 * 1000,
  generatedExams: 10 * 60 * 1000,
  pendingQuestions: 5 * 60 * 1000
}

const memoryCache = new Map()

const getFullKey = (key) => `${CACHE_PREFIX}${key}`

const isExpired = (timestamp, maxAge) => {
  if (!timestamp || !maxAge) return true
  return Date.now() - timestamp > maxAge
}

export const cacheManager = {
  get: (key, options = {}) => {
    const { maxAge, fallback = true } = options
    const fullKey = getFullKey(key)
    const effectiveMaxAge = maxAge || DEFAULT_MAX_AGE[key.split('_')[0]] || 5 * 60 * 1000

    // 1. 内存缓存优先
    const memoryHit = memoryCache.get(fullKey)
    if (memoryHit && !isExpired(memoryHit.timestamp, effectiveMaxAge)) {
      return { data: memoryHit.data, from: 'memory', stale: false }
    }

    // 2. localStorage
    try {
      const raw = localStorage.getItem(fullKey)
      const ts = localStorage.getItem(`${fullKey}_ts`)
      const ver = localStorage.getItem(`${fullKey}_ver`)

      if (raw && ts && ver === CACHE_VERSION) {
        const timestamp = parseInt(ts)
        const data = JSON.parse(raw)

        // 同步到内存
        memoryCache.set(fullKey, { data, timestamp })

        const expired = isExpired(timestamp, effectiveMaxAge)
        return { data, from: 'localStorage', stale: expired }
      }
    } catch (e) {
      console.warn('Cache read error:', e)
    }

    // 3. fallback 模式：返回过期缓存
    if (fallback) {
      try {
        const raw = localStorage.getItem(fullKey)
        if (raw) {
          const data = JSON.parse(raw)
          return { data, from: 'fallback', stale: true }
        }
      } catch (e) {}
    }

    return { data: null, from: null, stale: true }
  },

  set: (key, data) => {
    const fullKey = getFullKey(key)
    const timestamp = Date.now()

    // 写入内存
    memoryCache.set(fullKey, { data, timestamp })

    // 写入 localStorage
    try {
      localStorage.setItem(fullKey, JSON.stringify(data))
      localStorage.setItem(`${fullKey}_ts`, String(timestamp))
      localStorage.setItem(`${fullKey}_ver`, CACHE_VERSION)
    } catch (e) {
      // 存储空间不足时清理旧缓存
      if (e.name === 'QuotaExceededError') {
        cacheManager.cleanup()
        try {
          localStorage.setItem(fullKey, JSON.stringify(data))
          localStorage.setItem(`${fullKey}_ts`, String(timestamp))
          localStorage.setItem(`${fullKey}_ver`, CACHE_VERSION)
        } catch (e2) {
          console.warn('Cache write failed after cleanup:', e2)
        }
      }
    }
  },

  remove: (key) => {
    const fullKey = getFullKey(key)
    memoryCache.delete(fullKey)
    try {
      localStorage.removeItem(fullKey)
      localStorage.removeItem(`${fullKey}_ts`)
      localStorage.removeItem(`${fullKey}_ver`)
    } catch (e) {}
  },

  invalidate: (pattern) => {
    const fullPattern = getFullKey(pattern)
    try {
      const keys = Object.keys(localStorage)
      for (const key of keys) {
        if (key.startsWith(fullPattern) || key.startsWith(`${fullPattern}_`)) {
          localStorage.removeItem(key)
        }
      }
    } catch (e) {}

    // 清理内存缓存
    for (const key of memoryCache.keys()) {
      if (key.startsWith(fullPattern)) {
        memoryCache.delete(key)
      }
    }
  },

  invalidateAll: () => {
    try {
      const keys = Object.keys(localStorage)
      for (const key of keys) {
        if (key.startsWith(CACHE_PREFIX)) {
          localStorage.removeItem(key)
        }
      }
    } catch (e) {}
    memoryCache.clear()
  },

  cleanup: () => {
    try {
      const keys = Object.keys(localStorage)
      const entries = []

      for (const key of keys) {
        if (key.startsWith(CACHE_PREFIX) && !key.endsWith('_ts') && !key.endsWith('_ver')) {
          const ts = localStorage.getItem(`${key}_ts`)
          entries.push({ key, timestamp: ts ? parseInt(ts) : 0 })
        }
      }

      // 按时间排序，删除最旧的50%
      entries.sort((a, b) => a.timestamp - b.timestamp)
      const toDelete = entries.slice(0, Math.floor(entries.length / 2))

      for (const entry of toDelete) {
        localStorage.removeItem(entry.key)
        localStorage.removeItem(`${entry.key}_ts`)
        localStorage.removeItem(`${entry.key}_ver`)
        memoryCache.delete(entry.key)
      }
    } catch (e) {}
  },

  // 会话级缓存（页面状态）
  session: {
    get: (key) => {
      try {
        const raw = sessionStorage.getItem(getFullKey(key))
        return raw ? JSON.parse(raw) : null
      } catch (e) {
        return null
      }
    },
    set: (key, data) => {
      try {
        sessionStorage.setItem(getFullKey(key), JSON.stringify(data))
      } catch (e) {}
    },
    remove: (key) => {
      try {
        sessionStorage.removeItem(getFullKey(key))
      } catch (e) {}
    }
  },

  // 获取缓存统计
  getStats: () => {
    let total = 0
    let memorySize = 0
    try {
      const keys = Object.keys(localStorage)
      for (const key of keys) {
        if (key.startsWith(CACHE_PREFIX) && !key.endsWith('_ts') && !key.endsWith('_ver')) {
          total++
          memorySize += localStorage.getItem(key)?.length || 0
        }
      }
    } catch (e) {}
    return { totalKeys: total, memorySize, memoryEntries: memoryCache.size }
  }
}

export default cacheManager
