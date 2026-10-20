import fs from 'node:fs'
import path from 'node:path'
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

// 熔断标记落盘位置（2026-10-20 r317）。
// 沿用 quotaSentinel 的 server/_* 约定：已被 .gitignore 覆盖，永不入库。
// ⚠️ 每次调用都重新读 env：路径在模块顶层求值的话，测试里临时改 env 就不生效
//    （回归锁 test/redisReconnectStorm.test.mjs 需要按用例隔离状态文件）。
const quotaStateFilePath = () => process.env.REDIS_QUOTA_STATE_FILE
  || path.join(import.meta.dirname, '_redis_quota_exhausted.json')

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
    // 上次「跨月解除熔断」的月份键（YYYY-M），用于 ensureResetAfterMonthlyBoundary
    // 只在跨月时清一次，避免 Render 每次冷启动都清空熔断（2026-10-20 r305-P-C 闭环修复）
    this._lastResetMonth = null
    // 选实例深度计数器（2026-10-20 r317）：>0 表示正在挑可用实例，
    // 此期间检测到的配额耗尽只记录不通知重建（避免 initQueue 重入双建队列）。
    this._inSelection = 0
    // 连接失败退避表（2026-10-20 r318）：id -> { failures, nextAt }
    // ⛔ 为什么必须有：连不上的实例（配额死库 / 网络不可达）此前每个健康检查 tick
    //   都会重新 createClient 一次 —— 高峰 60s 一次、永不停止，且每次失败都留下
    //    一个仍在后台重试的 ioredis 客户端（见 createClient catch 的注释）。
    //    退避后同一实例的失败重试被指数拉长到最长 15 分钟一次。
    this._connectBackoff = new Map()
  }

  /**
   * 将一个实例标记为「额度耗尽」，从可用池中临时剔除。
   * 下一个 getAvailableClient() 会跳过它，强制走 backup。
   * 下次 resetQuotaExhausted()（默认每月 1 号）会解除熔断。
   *
   * @param {string} id 实例 id
   * @param {string} reason 原因（写日志用）
   * @param {object} [opts]
   * @param {boolean} [opts.notify=true] 是否回调 onQuotaExhausted（触发 BullMQ 重建）。
   *   ⛔ 2026-10-20 r317：**选实例阶段必须传 false**。
   *   旧代码用 PING 判活，永远选不中烧穿的库，只能等真实业务命令报错才熔断，
   *   而那次熔断发生在「Worker 已经在用这个连接」的运行期 ⇒ 必须重建队列（合理）。
   *   改用真实数据命令判活后，熔断会发生在**初始化/选实例阶段** ——
   *   此时 Worker 还没建好，若此时回调 onQuotaExhausted ⇒ rebuildQueue 会
   *   teardown+initQueue 重入 ⇒ 双建队列 + 连接泄漏（比原问题更糟）。
   *   所以：选实例阶段只记录熔断（让后续 getAvailableClient 跳过它），
   *   真正需要切库时由运行期的 Worker error 处理器触发（那条路径 notify=true）。
   */
  markQuotaExhausted(id, reason, opts = {}) {
    if (!id) return
    const { notify = true } = opts
    // ⛔ 选实例期间一律不通知重建（2026-10-20 r317）。
    //   探活用的真实数据命令失败时，ioredis 可能同时派发 'error' 事件（携带配额文案），
    //   那条路径也会走到 markQuotaExhausted。若此时 notify=true ⇒ onQuotaExhausted
    //   ⇒ rebuildQueue ⇒ teardown+initQueue 重入 ⇒ 双建队列 + 连接泄漏。
    //   统一在这里兜住：只要还在选实例，就只记录不通知。
    const effectiveNotify = notify && this._inSelection === 0
    if (this.quotaExhaustedSet.has(id)) return
    this.quotaExhaustedSet.add(id)
    this.persistQuotaExhausted()
    console.warn(`[Redis:${id}] 🚫 额度熔断: ${reason || 'quota exhausted'}`)
    // 关闭该 client 释放连接（不删除 pool 成员，保留配置以便后续 reset 后重用）
    const client = this.clients.get(id)
    if (client) {
      try { client.disconnect() } catch (e) { /* ignore */ }
      this.clients.delete(id)
    }
    // 通知 queue 重建 Worker 连接
    if (effectiveNotify && typeof this.onQuotaExhausted === 'function') {
      try {
        this.onQuotaExhausted(id, reason)
      } catch (e) {
        console.error('[Redis] onQuotaExhausted 回调执行失败:', e.message)
      }
    }
  }

  /**
   * 熔断标记落盘（2026-10-20 r317）。
   *
   * ⛔ 为什么必须落盘：Render 免费层 sleep/wake 会重启进程 ⇒ 内存里的
   *    quotaExhaustedSet 归零 ⇒ 新进程完全不知道哪个库烧穿过 ⇒ 又从 primary 开始踩
   *    ⇒ 每轮冷启动都触发一轮 BullMQ 拆建风暴（实测烧穿库节点累计 3050 次连接握手）。
   *    落盘后，冷启动直接跳过已知烧穿的实例 ⇒ 风暴从「每轮 N 次」降到 0。
   *
   * 落点沿用 quotaSentinel 的既有约定：server/_* 已被 .gitignore 覆盖，不入库。
   * 写盘失败绝不影响主流程（熔断在内存里依然有效）。
   */
  persistQuotaExhausted() {
    try {
      fs.writeFileSync(
        quotaStateFilePath(),
        JSON.stringify({
          ids: Array.from(this.quotaExhaustedSet),
          month: this._currentMonthKey(),
          savedAt: Date.now()
        }),
        'utf8'
      )
    } catch (e) {
      console.warn('[Redis] 熔断标记落盘失败（不影响主流程）:', e?.message)
    }
  }

  /** 当前月份键（YYYY-M），用于熔断标记的跨月失效判定 */
  _currentMonthKey() {
    const now = new Date()
    return `${now.getFullYear()}-${now.getMonth()}`
  }

  /**
   * 读回上次进程留下的熔断标记（跨进程记忆）。
   * 只恢复「标记」，不恢复连接 ⇒ 冷启动不会先连废库再报错。
   *
   * ⛔ 跨月守卫：Upstash 额度按自然月重置 ⇒ 上个月的熔断标记在新月份
   *    一定是过期的（额度已恢复）。若照搬 ⇒ 新月里白跳过一个健康实例，
   *    直到 15 分钟后的自愈回探才纠正它。跨月 ⇒ 直接丢弃旧标记。
   */
  loadPersistedQuotaExhausted() {
    try {
      const parsed = JSON.parse(fs.readFileSync(quotaStateFilePath(), 'utf8'))
      const ids = Array.isArray(parsed?.ids) ? parsed.ids : []
      if (ids.length === 0) return
      if (parsed.month && parsed.month !== this._currentMonthKey()) {
        console.log(`[Redis] 忽略跨月的历史熔断标记（${parsed.month} ≠ ${this._currentMonthKey()}，额度已按月重置）`)
        return
      }
      const valid = ids.filter(id => this.pool.some(item => item.id === id))
      if (valid.length > 0) {
        for (const id of valid) this.quotaExhaustedSet.add(id)
        console.log(`[Redis] 📌 从磁盘恢复熔断标记（上次进程留下）: ${valid.join(', ')}`)
      }
    } catch {
      // 首次运行 / 文件不存在 ⇒ 无历史标记，正常路径
    }
  }

  /**
   * 连接层失败退避（2026-10-20 r318）。
   *
   * ⛔ 病因（实测定位）：`createClient()` 失败后返回 null，但调用方
   *   `_selectAvailableClient()` 在下一个 tick 又会调回来 —— 健康检查在高峰
   *   每 60s 一次，于是**每个 tick 都向一个已知连不上的实例发起一次完整 TLS 握手**，
   *   永不停止。更糟的是每次失败的那个 ioredis 客户端既没进 clients map、
   *   也从没 disconnect（见 createClient catch），它会按 retryStrategy 在后台
   *   继续重试 5 次 ⇒ 失败次数线性叠加。
   *   本地复现（server/_diag_leakproof.mjs）：3 次失败调用 ⇒ 后台重连事件 2→5→10，
   *   7 秒后累计 32 次，且随调用次数线性增长。
   *
   * 退避梯度：15s → 30s → 60s → 120s → 240s → 480s，上限 900s（15 分钟）。
   * 首次 15s 是刻意压低：健康实例偶发断连（网络抖动）时要能快速回来，
   * 不能因为一次抖动就让它离线几分钟。
   */
  recordConnectFailure(id) {
    if (!id) return
    const prev = this._connectBackoff.get(id)
    const failures = (prev?.failures || 0) + 1
    const delayMs = Math.min(15000 * Math.pow(2, Math.min(failures - 1, 6)), 900000)
    this._connectBackoff.set(id, { failures, nextAt: Date.now() + delayMs })
    console.warn(`[Redis:${id}] ⏳ 连接失败退避 ${Math.round(delayMs / 1000)}s（连续第 ${failures} 次，期间不再重试该实例）`)
  }

  /** 该实例是否仍在退避窗口内（窗口内一律跳过，不再发起连接） */
  isInConnectBackoff(id, now = Date.now()) {
    const state = this._connectBackoff.get(id)
    return !!state && now < state.nextAt
  }

  /** 连接成功 / 熔断解除时清空退避，让实例立刻可参与选池 */
  clearConnectFailure(id) {
    if (id) this._connectBackoff.delete(id)
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
      // 落盘同步：解除后磁盘上的旧标记必须一起清掉，否则下次冷启动会误恢复
      this.persistQuotaExhausted()
      // 退避表同步清空：解除熔断意味着允许重新尝试这些实例
      this._connectBackoff.clear()
      // 与 ensureResetAfterMonthlyBoundary 同口径：记录已清月份，避免 1 号当天重复清
      this._lastResetMonth = `${new Date().getFullYear()}-${new Date().getMonth()}`
      return
    }
    if (this.quotaExhaustedSet.delete(id)) {
      console.log(`[Redis:${id}] 🔓 解除配额熔断`)
      // 落盘同步（2026-10-20 r317）：单实例解除也要更新磁盘，否则下次冷启动误判为仍熔断
      this.persistQuotaExhausted()
    }
    // 无论此前是否在熔断集合里，解除动作都同时清掉连接退避（自愈回探已证明它可用）
    this.clearConnectFailure(id)
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
   * 用「真实数据命令」判定某个已建立连接的实例是否还有可用额度。
   *
   * ⛔ 为什么不能用 PING（2026-10-20 r317 实测定位「Render 疯狂重连」根因）：
   *   Upstash 超额后 **PING 仍回 PONG**（连接级探活对配额天然失明）。
   *   于是旧代码 `getAvailableClient()` 用 PING 判活 ⇒ 必然选中一个已烧穿的库
   *   ⇒ 真实业务命令报错 ⇒ markQuotaExhausted ⇒ queue.js 触发 rebuildQueue
   *   ⇒ teardown 拆掉 3 个 Queue + 3 个 Worker 再重建（成批连接握手）
   *   ⇒ 下一个库若也烧穿再来一轮 ⇒ **冷启动 = N 轮 BullMQ 拆建风暴**。
   *   实证：烧穿库节点 total_connections_received=3050，健康新库仅 42。
   *
   * 真实数据命令（GET 一个不存在的 key）才会被配额闸拦住
   * ⇒ 能在**选中之前**就识别出烧穿的实例并直接跳过，不触发任何拆建。
   *
   * @returns {Promise<{alive:boolean, quota:boolean}>}
   *   alive=true  → 额度可用；quota=true → 确认是配额耗尽（区别于网络抖动）
   */
  async probeQuotaAlive(client) {
    try {
      await client.get(REDIS_BREAKER_PROBE_KEY)
      return { alive: true, quota: false }
    } catch (err) {
      const msg = err?.message || ''
      if (isQuotaExhaustedError(msg)) {
        return { alive: false, quota: true }
      }
      // 非配额类错误（网络抖动 / 连接被断）：不能当成额度耗尽，
      // 否则一次抖动就会把健康实例永久标记为熔断 ⇒ 误伤。
      return { alive: false, quota: false }
    }
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
   * 兜底：进程冷启动时若正值「每月 1 号」，清空所有熔断标记让实例重新可用。
   * 解决 Render 免费层 sleep 后 setTimeout 不会触发的场景。
   *
   * ⚠️ 2026-10-20 修复（r305-P-C 闭环）：旧判据 `now >= 当月1号` 在 1–31 号整月都为真
   * ⇒ Render 每次冷启动（sleep 唤醒 / 部署）都把熔断标记清空 ⇒ 月度内 failover 保护形同虚设，
   * 要等下一次真实命令报错才重新标记。改为「仅在每月 1 号」解除一次，月度内熔断保持粘性；
   * 已恢复实例由 startBreakerProbe 的真实数据命令回探负责归队，无需冷启动兜底抢跑。
   */
  ensureResetAfterMonthlyBoundary(now = new Date()) {
    if (now.getDate() !== 1) return
    const thisMonthKey = `${now.getFullYear()}-${now.getMonth()}`
    // 同进程同月已清过 ⇒ 幂等跳过（避免 1 号当天多次冷启动反复清空）
    if (this._lastResetMonth === thisMonthKey) return
    if (this.quotaExhaustedSet.size === 0) {
      this._lastResetMonth = thisMonthKey
      return
    }
    console.log(`[Redis] 🔓 冷启动兜底（本月 1 号）：解除 ${this.quotaExhaustedSet.size} 个熔断标记`)
    this.quotaExhaustedSet.clear()
    this._lastResetMonth = thisMonthKey
    // ⛔ 2026-10-20 r320：清完必须落盘 + 清退避，否则磁盘上仍留着一份「本月的」熔断标记
    //   ⇒ 1 号当天再冷启动一次又会把它读回来，白跳过健康实例直到 15 分钟回探才纠正。
    //   （跨月文件本来会被 loadPersistedQuotaExhausted 的月份校验丢弃，但 1 号当天
    //     新写入的标记月份就是本月，校验拦不住，只能靠这里回写。）
    this.persistQuotaExhausted()
    this._connectBackoff.clear()
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

    // ⛔ 必须在 try 之外声明：catch 里要把它 disconnect 掉。
    //   2026-10-20 r318 实测：旧代码把 client 声明在 try 内，catch 只 return null
    //   ⇒ 连接失败的 ioredis 实例既不在 clients map 里、也永远不会被关闭，
    //   却仍按 retryStrategy 在后台继续重试（最多 5 次）⇒ 每失败一次就多一个
    //   「幽灵重连源」，随健康检查 tick 线性叠加。本地复现
    //   （server/_diag_leakproof.mjs）：3 次失败调用 ⇒ 后台重连事件 2→5→10，
    //   7 秒后累计 32 次。这就是「越睡越疯狂重连」的直接成因。
    let client = null

    try {
      if (poolItem.type === 'URL') {
        client = new Redis(poolItem.url, {
          maxRetriesPerRequest: poolItem.maxRetriesPerRequest || null,
          connectTimeout: 6000,
          // 高峰保活（负责人 2026-10-20 要求「高峰期不要断」）：
          // 30s 一次 TCP keepalive 探测，避免长时间空闲被中间设备/服务端掐断后
          // 用户第一下操作吃到重连延迟。keepalive 探测不产生 Redis 命令、不计配额。
          keepAlive: 30000,
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
          // notify 默认 true，但 _inSelection>0 时会被强制降级为「只记录」——
          // 选实例阶段的错误派发不触发重建（防 initQueue 重入）。
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

      // ⛔ 2026-10-20 r317：这里原来只做 `await client.ping()` 当健康校验，
      //    但 Upstash 超额后 PING 仍回 PONG ⇒ 烧穿的库被判定「连接成功」并进池，
      //    随后在真实业务命令上炸 → 熔断 → BullMQ 拆建风暴。
      //    改为「真实数据命令」校验：超额库当场被拒（不进池），
      //    并标记熔断，使后续 getAvailableClient 直接跳过它。
      // ⛔ r318：再加 8s 上限。连不上的实例 maxRetriesPerRequest=null 会让这条
      //    探活命令一直挂在重连队列里（最多 5 次重试 × 10s 超时 ≈ 50s），
      //    冷启动就被一个死库拖住近一分钟 —— 用户「睡醒后第一下特别慢」即此。
      const probe = await this.probeWithTimeout(client, 8000)
      if (!probe.alive) {
        if (probe.quota) {
          console.warn(`[Redis:${poolItem.id}] ⚠️ 连接已建立但额度已耗尽（真实命令失败），不纳入连接池`)
          this.markQuotaExhausted(poolItem.id, 'quota exhausted on data command probe', { notify: false })
        } else {
          console.warn(`[Redis:${poolItem.id}] ⚠️ 真实命令探活失败（非配额原因），不纳入连接池`)
        }
        try { client.disconnect() } catch { /* ignore */ }
        this.recordConnectFailure(poolItem.id)
        return null
      }

      this.clients.set(poolItem.id, client)
      this.clearConnectFailure(poolItem.id)
      console.log(`[Redis:${poolItem.id}] ✅ 连接成功`)
      return client
    } catch (err) {
      console.error(`[Redis:${poolItem.id}] ❌ 连接失败: ${err.message}`)
      // 连接层失败时也要记下熔断：配额耗尽的实例重连会持续失败，
      // 留着它每次 getAvailableClient 都要重试一遍（冷启动风暴的另一半来源）。
      if (isQuotaExhaustedError(err?.message || '')) {
        this.markQuotaExhausted(poolItem.id, err.message, { notify: false })
      }
      // ⛔ 关键修复（r318）：失败连接必须立刻断开，否则它在后台继续重试
      //   ⇒ 每 tick 漏一个幽灵重连源，越积越多。
      try { client?.disconnect() } catch { /* ignore */ }
      this.recordConnectFailure(poolItem.id)
      return null
    }
  }

  /**
   * 带超时的真实命令探活：避免连不上的实例把启动/选池卡在 ioredis 的重连队列里。
   * 超时按「非配额失败」处理（不误标熔断），由调用方决定是否退避。
   */
  async probeWithTimeout(client, timeoutMs) {
    let timer = null
    try {
      return await Promise.race([
        this.probeQuotaAlive(client),
        new Promise(resolve => {
          timer = setTimeout(() => resolve({ alive: false, quota: false, timedOut: true }), timeoutMs)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async init() {
    if (this.initialized) return

    // Build pool now that env vars are loaded
    this.pool = this.buildPool()

    // ⭐ 2026-10-20 r317：先恢复上次进程留下的熔断标记，再建连接。
    //   顺序很重要：先恢复 ⇒ 冷启动直接跳过已知烧穿的实例，
    //   既不浪费一次失败的连接握手，也不会先连废库再报错 → 触发 BullMQ 拆建风暴。
    this.loadPersistedQuotaExhausted()

    // 只连到「第一个可用实例」就停，其余实例惰性连接（r318）。
    // ⛔ 旧行为是给池里每个实例都建连接：3 个实例 = 3 条 TLS 长连接，
    //   其中死库还要各等一轮重试超时，冷启动被拖慢几十秒，也白白占着 Upstash
    //   的连接额度。备份实例只在真正需要 failover 时（getAvailableClient 里）
    //   才建立连接，语义完全不变，连接数与冷启动耗时都降到 1/N。
    //   已被标记熔断的实例直接跳过（它们的额度已耗尽，连了也只会失败）。
    for (const item of this.pool) {
      if (this.quotaExhaustedSet.has(item.id)) {
        console.log(`[Redis] 跳过已熔断实例: ${item.id}`)
        continue
      }
      if (this.isInConnectBackoff(item.id)) {
        console.log(`[Redis] 跳过退避中的实例: ${item.id}`)
        continue
      }
      const client = await this.createClient(item)
      if (client) break
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

    // ⛔ 2026-10-20 r317：整个选实例过程包在 _inSelection 里。
    //   期间任何配额熔断都只记录、不触发 onQuotaExhausted（避免重建队列重入）。
    this._inSelection++
    try {
      return await this._selectAvailableClient()
    } finally {
      this._inSelection--
    }
  }

  async _selectAvailableClient() {
    const total = this.pool.length
    const start = this.currentIndex

    // ── 第一遍：只在「已连接」的实例里挑（r319）──────────────────────────
    // ⛔ 为什么必须分两遍：旧实现是单趟「按优先级，遇到没有连接就当场建连」，
    //   于是一个优先级更高、但已经连不上的库（配额烧穿 / 网络不可达）会让**每一次**
    //   getAvailableClient 都先付一次握手超时（connectTimeout 6s + 探活 8s），
    //   才轮到后排那个本来好好的健康库。高峰期健康检查每 60s 一次、每次业务取连接
    //   也走这里 ⇒ 「明明有可用库，每次取连接都要卡几秒」。
    //   已连接实例的探活只是一条 GET，零握手成本；先把它挑完，再去建新连接。
    for (let i = 0; i < total; i++) {
      const idx = (start + i) % total
      const item = this.pool[idx]

      // ⭐ 配额熔断：跳过已被标记为额度耗尽的实例
      if (this.quotaExhaustedSet.has(item.id)) continue

      const client = this.clients.get(item.id)
      if (!client) continue

      // ⛔ 2026-10-20 r317：原来这里用 PING 判活，但 Upstash 超额后 PING 仍回 PONG
      //    ⇒ 必然选中烧穿的库 ⇒ 真实命令报错 ⇒ 熔断 ⇒ BullMQ 拆建风暴。
      //    改用真实数据命令（GET 不存在的 key）：超额即报错，当场跳过该实例，
      //    不触发任何 teardown/重建。数据命令成功也顺带证明连接真的可用。
      const probe = await this.probeQuotaAlive(client)
      if (probe.alive) {
        this.currentIndex = idx
        return client
      }
      if (probe.quota) {
        // 确认额度耗尽 ⇒ 标记并跳过（notify:false：此刻 Worker 可能还没建好，
        // 触发重建会造成 initQueue 重入 ⇒ 双建队列 + 连接泄漏）
        console.warn(`[Redis:${item.id}] 真实命令探活失败：额度已耗尽，跳过该实例`)
        this.markQuotaExhausted(item.id, 'quota exhausted on data command probe', { notify: false })
      } else {
        // 非配额错误（网络抖动 / 连接被断）⇒ 绝不能标记额度熔断（一次抖动就把
        // 健康实例踢出池子＝误伤）。
        // ⛔ r318：也**不要**在这里直接 clients.delete。删掉 map 条目后，
        //   下一次选池会 createClient 建一条新连接，而旧 client 仍在后台重连
        //   ⇒ 又是一条幽灵重连源。让它自己重连：真正断死（status==='end'）
        //   时 'end' 处理器会移除，并在这里补记退避。
        console.warn(`[Redis:${item.id}] 真实命令探活失败（非配额原因），交给 ioredis 自愈重连`)
        if (client.status === 'end') {
          this.clients.delete(item.id)
          this.recordConnectFailure(item.id)
        }
      }
    }

    // ── 第二遍：确实一个可用连接都没有，才按优先级建连（r319）───────────
    // ⛔ 退避是「有别的路可走时别死磕」的优化，绝不能变成「全部退避 ⇒ 谁也不试」。
    //   若一次都没尝试（所有实例都在退避窗口内），必须 fail-open 强试优先级最高的那个，
    //   否则一次网络抖动就把整个队列层锁死最长 15 分钟——比疯狂重连严重得多。
    let attempted = 0
    let lastResort = null
    let lastResortIdx = -1
    for (let i = 0; i < total; i++) {
      const idx = (start + i) % total
      const item = this.pool[idx]

      if (this.quotaExhaustedSet.has(item.id)) continue
      if (this.clients.has(item.id)) continue

      // ⛔ r318：退避期内绝不再发起连接。
      //   旧行为是每个健康检查 tick 都重连一次死库（高峰 60s/次、永不停止），
      //   这是「疯狂重连」最直接的来源。退避后最长 15 分钟才试一次。
      if (this.isInConnectBackoff(item.id)) {
        if (!lastResort) { lastResort = item; lastResortIdx = idx }
        continue
      }

      attempted++
      console.log(`[Redis] 尝试重连: ${item.id}`)
      const client = await this.createClient(item)
      if (client) {
        this.currentIndex = idx
        return client
      }
    }

    if (attempted === 0 && lastResort) {
      console.warn(`[Redis:${lastResort.id}] 池内实例全在退避窗口，兜底强试一次（fail-open，绝不锁死）`)
      const client = await this.createClient(lastResort)
      if (client) {
        this.currentIndex = lastResortIdx
        return client
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
        quotaExhausted: this.quotaExhaustedSet.has(item.id),
        // 连接失败退避（r318）：让诊断端点能看出「这个实例正在被冷落多久」
        // —— 修复前无法从外部区分「连不上但每隔 60s 被重试」和「连不上且已退避」。
        connectBackoffSec: this._connectBackoff.has(item.id)
          ? Math.max(0, Math.round((this._connectBackoff.get(item.id).nextAt - Date.now()) / 1000))
          : 0,
        connectFailures: this._connectBackoff.get(item.id)?.failures || 0
      }))
    }
  }
}

export const redisManager = new RedisManager()
// 类本体也导出：供回归测试构造隔离实例（不污染单例状态）
export { RedisManager }
