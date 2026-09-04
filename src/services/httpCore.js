/**
 * 统一 HTTP 请求内核。
 *
 * 背景：App（Capacitor WebView）里的 fetch 有两类高频故障，此前前端都没处理：
 *
 * 1) 后端冷启动。生产 API 挂在 Render，实例休眠后首次请求要 30~60s 才响应。
 *    旧逻辑 20s 超时 + 只重试 1 次 + 退避 1s，两次尝试都落在同一个冷启动窗口里，
 *    必然双双失败 —— 用户看到的就是"网络错误，重试也没用"。
 *
 * 2) WebView 连接池失效。切 WiFi/4G、熄屏唤醒、服务端主动断开 keep-alive 之后，
 *    WebView 的 socket 池里会残留死连接，后续 fetch 连续抛 TypeError: Failed to fetch，
 *    且不会自愈，只有重建 WebView（杀掉 App 重开）才恢复。
 *    这正是「重试也不行，必须退出 App 重开才行」的根因。
 *
 * 本模块提供：可配置超时 + 指数退避重试 + 失败分类 + 网络健康追踪，
 * 让"重试"真正生效，并在连接确实失效时给出可执行的恢复动作。
 */

export const API_BASE = import.meta.env.VITE_API_URL || '/api'

// 默认超时。普通请求放宽到 30s（原来是 20s，撑不过 Render 冷启动）。
export const TIMEOUT = {
  DEFAULT: 30_000,
  // 上传/长任务：大图 + 跨境链路，1 分半起步，调用方可通过 options.timeout 再放宽。
  UPLOAD: 180_000,
  // 长解析任务（练习册/答案库解析）调用方显式传 2~10 分钟，这里只作兜底。
  LONG: 120_000
}

// 这些状态码属于"服务端临时不可用"，值得重试；4xx（除 408/425/429）一律不重试，
// 重复提交有副作用（答案盖章、保存修订等）的请求不能被自动重放。
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

// ── 网络健康状态 ──
// consecutiveFailures 达到阈值即判定为"连接池失效"：此时单纯重试没有意义，
// 需要先做一次轻量预热探测，仍失败则提示用户重建页面（等价于重开 App，但不用手动杀进程）。
const STALE_THRESHOLD = 2
let consecutiveFailures = 0
let lastFailureAt = 0

const recoveryHandlers = new Set()

export function getNetworkHealth() {
  return {
    consecutiveFailures,
    lastFailureAt,
    stale: consecutiveFailures >= STALE_THRESHOLD,
    offline: typeof navigator !== 'undefined' && navigator.onLine === false
  }
}

export function resetNetworkHealth() {
  if (consecutiveFailures === 0) return
  consecutiveFailures = 0
  recoveryHandlers.forEach((fn) => {
    try { fn() } catch { /* ignore */ }
  })
}

// 注册"网络恢复"回调（例如清空 GET 请求去重表），由 httpCore 在恢复时统一触发。
export function onNetworkRecover(fn) {
  recoveryHandlers.add(fn)
  return () => recoveryHandlers.delete(fn)
}

const noteFailure = () => {
  consecutiveFailures += 1
  lastFailureAt = Date.now()
}

const noteSuccess = () => {
  consecutiveFailures = 0
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', resetNetworkHealth)
  // App 从后台回到前台后，先重置健康计数再发请求，避免残留的失败计数误判。
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resetNetworkHealth()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 创建带分类信息的错误。
 * code 取值：OFFLINE / TIMEOUT / NETWORK / HTTP_<status> / BAD_RESPONSE / ABORTED
 */
export function createApiError(message, { code, status, cause, retryable = false } = {}) {
  const err = new Error(message)
  err.name = 'ApiError'
  err.code = code
  err.status = status
  err.retryable = retryable
  if (cause) err.cause = cause
  return err
}

// 离线时不要让用户干等一个注定超时的请求。
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

const friendlyOffline = () => '当前设备处于离线状态，请连接网络后重试'

/**
 * 统一 JSON 请求。
 *
 * @param {string} path    相对 API_BASE 的路径（以 / 开头）
 * @param {object} options
 *   - method / headers / body / timeout
 *   - attempts   总尝试次数（含首次），默认 3；超长超时请求自动降为 2
 *   - retryBase  退避基数，默认 1500ms（1.5s → 3s → 6s）
 *   - retryMax   单次退避上限，默认 8s
 *   - signal     外部 AbortSignal
 *   - onRetry    (info) => void，每次重试前回调（用于 UI 提示）
 * @returns {Promise<any>} 已解析的 JSON
 */
export async function requestJson(path, options = {}) {
  const {
    method = 'GET',
    headers,
    body,
    timeout = TIMEOUT.DEFAULT,
    retryBase = 1500,
    retryMax = 8000,
    signal,
    onRetry
  } = options

  const url = `${API_BASE}${path}`
  // 超长超时的请求（解析类，调用方显式放宽到分钟级）最多重试 1 次，
  // 否则一次失败会让用户多等十几分钟。
  const attempts = options.attempts ?? (timeout >= 60_000 ? 2 : 3)

  const fetchHeaders = headers ? { ...headers } : {}
  // body 为普通字符串时默认按 JSON 发送（兼容调用方未显式设置 Content-Type）
  if (body != null && !(body instanceof FormData) && !fetchHeaders['Content-Type']) {
    fetchHeaders['Content-Type'] = 'application/json'
  }

  let lastError = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (isOffline()) {
      throw createApiError(friendlyOffline(), { code: 'OFFLINE', retryable: true })
    }

    if (attempt > 0) {
      const delay = Math.min(retryMax, retryBase * 2 ** (attempt - 1)) + Math.random() * 300
      try { onRetry?.({ attempt: attempt + 1, attempts, delay, error: lastError }) } catch { /* ignore */ }
      await sleep(delay)
    }

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      // 老 WebView 不支持 abort(reason)，失败时按默认 AbortError 处理即可。
      try {
        controller.abort(new DOMException(`请求超时（${Math.round(timeout / 1000)}秒）`, 'TimeoutError'))
      } catch {
        controller.abort()
      }
    }, timeout)

    const onExternalAbort = () => controller.abort()
    if (signal) {
      if (signal.aborted) onExternalAbort()
      else signal.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      const response = await fetch(url, {
        method,
        headers: Object.keys(fetchHeaders).length > 0 ? fetchHeaders : undefined,
        body,
        signal: controller.signal
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        const serverMessage = errorBody?.error || errorBody?.message || response.statusText
        const retryable = RETRYABLE_STATUS.has(response.status)
        const error = createApiError(
          serverMessage || `请求失败: ${response.status}`,
          { code: `HTTP_${response.status}`, status: response.status, retryable }
        )
        // 服务端返回的结构化错误（如 409 EXISTING_FAILED_TASK）要保留给上层识别
        if (errorBody) error.payload = errorBody
        if (!retryable || attempt === attempts - 1) {
          // 失败计数统一由下面的 catch 累加，这里只负责上抛
          throw error
        }
        lastError = error
        noteFailure()
        continue
      }

      const data = await response.json()
      noteSuccess()
      return data
    } catch (rawError) {
      // 服务端明确返回且判定为不可重试（4xx 业务错误）时立即上抛。
      // 否则一次 404/409 会被下面的退避逻辑连撞三次，POST 类写操作被重放。
      if (rawError?.name === 'ApiError' && !rawError.retryable) throw rawError

      const isTimeout = timedOut
        || rawError?.name === 'TimeoutError'
        || (rawError?.name === 'AbortError' && /超时|timeout/i.test(String(rawError?.message || '')))
      const isExternalAbort = !isTimeout && signal?.aborted
      const isNetworkError = rawError?.name === 'TypeError'
        || /failed to fetch|networkerror|network request failed|ERR_/i.test(String(rawError?.message || ''))

      let error
      if (isExternalAbort) {
        // 调用方主动取消，不算失败，也不重试
        clearTimeout(timer)
        throw createApiError('请求已取消', { code: 'ABORTED', cause: rawError })
      } else if (isTimeout) {
        error = createApiError(`请求超时（${Math.round(timeout / 1000)}秒），请检查网络后重试`, {
          code: 'TIMEOUT',
          cause: rawError,
          retryable: true
        })
      } else if (isNetworkError) {
        error = createApiError('网络连接中断，请检查网络后重试', {
          code: 'NETWORK',
          cause: rawError,
          retryable: true
        })
      } else if (rawError?.name === 'ApiError') {
        error = rawError
      } else {
        error = createApiError(rawError?.message || '请求失败', {
          code: 'BAD_RESPONSE',
          cause: rawError,
          retryable: true
        })
      }

      if (attempt === attempts - 1) {
        if (error.retryable) noteFailure()
        throw error
      }
      lastError = error
      noteFailure()
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onExternalAbort)
    }
  }

  throw lastError || createApiError('请求失败', { code: 'UNKNOWN' })
}

/**
 * 预热探测。重试之前先打一次极轻量的健康检查：
 * 既能把冷启动的实例唤醒，也能验证当前 WebView 连接是否真的可用——
 * 避免"盲重试"在死连接上连撞三次，用户只看到转圈。
 */
export async function warmUpConnection(timeout = 15_000) {
  try {
    await requestJson('/health', { timeout, attempts: 1 })
    noteSuccess()
    return true
  } catch (e) {
    if (e?.code === 'TIMEOUT') {
      // 超时说明请求发出去了、实例可能正在冷启动，不算连接失效
      return true
    }
    return false
  }
}
