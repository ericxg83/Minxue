import cacheManager from '../utils/cacheManager'

const pendingRequests = new Map()

const dedupeRequest = (key, requestFn) => {
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key)
  }

  const promise = requestFn().finally(() => {
    pendingRequests.delete(key)
  })

  pendingRequests.set(key, promise)
  return promise
}

export const apiService = {
  // SWR 模式：先返回缓存，后台刷新
  swrFetch: async (key, fetchFn, options = {}) => {
    const { maxAge, onUpdate, forceRefresh = false } = options

    // 1. 先读缓存
    const cached = cacheManager.get(key, { maxAge, fallback: true })

    // 2. 如果缓存有效且不强制刷新，直接返回
    if (cached.data && !cached.stale && !forceRefresh) {
      return { data: cached.data, from: cached.from, updated: false }
    }

    // 3. 有缓存但过期，先返回缓存，后台刷新
    if (cached.data && (cached.stale || forceRefresh)) {
      // 后台刷新
      dedupeRequest(key, async () => {
        try {
          const fresh = await fetchFn()
          if (fresh !== null && fresh !== undefined) {
            cacheManager.set(key, fresh)
            onUpdate?.(fresh)
          }
          return fresh
        } catch (error) {
          console.debug(`Background refresh failed for ${key}:`, error)
          throw error
        }
      }).catch(() => {})

      return { data: cached.data, from: cached.from || 'cache', updated: false }
    }

    // 4. 无缓存，必须等待请求
    try {
      const fresh = await dedupeRequest(key, fetchFn)
      if (fresh !== null && fresh !== undefined) {
        cacheManager.set(key, fresh)
      }
      return { data: fresh, from: 'network', updated: true }
    } catch (error) {
      // 请求失败，尝试返回过期缓存
      const fallback = cacheManager.get(key, { fallback: true })
      if (fallback.data) {
        return { data: fallback.data, from: 'fallback', updated: false, error }
      }
      throw error
    }
  },

  // 强制刷新
  refresh: async (key, fetchFn) => {
    try {
      const fresh = await dedupeRequest(key, fetchFn)
      if (fresh !== null && fresh !== undefined) {
        cacheManager.set(key, fresh)
      }
      return { data: fresh, from: 'network', updated: true }
    } catch (error) {
      throw error
    }
  },

  // 并行请求多个数据
  parallelFetch: async (requests) => {
    const entries = Object.entries(requests)
    const results = {}

    const promises = entries.map(async ([key, config]) => {
      const { fetchFn, maxAge, onUpdate } = config
      try {
        const result = await apiService.swrFetch(key, fetchFn, { maxAge, onUpdate })
        results[key] = result
      } catch (error) {
        results[key] = { data: null, error, from: 'error' }
      }
    })

    await Promise.all(promises)
    return results
  },

  // 预加载数据（不等待结果）
  prefetch: (key, fetchFn) => {
    dedupeRequest(key, async () => {
      try {
        const data = await fetchFn()
        if (data !== null && data !== undefined) {
          cacheManager.set(key, data)
        }
        return data
      } catch (error) {
        console.debug(`Prefetch failed for ${key}:`, error)
        throw error
      }
    }).catch(() => {})
  },

  // 清除指定缓存
  invalidate: (pattern) => {
    cacheManager.invalidate(pattern)
  },

  // 获取缓存统计
  getStats: () => {
    return cacheManager.getStats()
  }
}

export default apiService
