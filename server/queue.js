import { processTask } from './worker.js'
import { redisManager } from './redisManager.js'

let taskQueue = null
let taskWorker = null
let tikzQueue = null
let tikzWorker = null
let geometryQueue = null
let geometryWorker = null
let queueInitialized = false
let initPromise = null
let currentConnection = null

// ⭐ BullMQ Worker 错误关键词（命中后触发 Redis 实例切换 / 配额熔断）
// - 'WRONGPASS' / 'ECONNRESET' / 'ETIMEDOUT'：连接级错误，触发整池切换
// - 'max requests limit'：Upstash 业务级错误（仅真实命令触发），触发配额熔断 + 切到 backup
const WORKER_RECOVERY_KEYWORDS = [
  'WRONGPASS',
  'ECONNRESET',
  'ETIMEDOUT',
  'max requests limit', // Upstash monthly quota
  'max daily requests',  // 防御性：未来可能改成日配额
  'quota exceeded'
]
const shouldTriggerRedisSwitch = (message) => {
  if (!message) return false
  return WORKER_RECOVERY_KEYWORDS.some(k => message.includes(k))
}

/**
 * 关闭所有 BullMQ Worker/Queue，释放旧 connection。
 * 必须在 rebuildQueue 之前调用。
 */
async function teardownQueues() {
  console.log('[Queue] 拆解旧 BullMQ Worker/Queue...')
  const closers = []
  if (taskWorker) closers.push(taskWorker.close().catch(() => {}))
  if (tikzWorker) closers.push(tikzWorker.close().catch(() => {}))
  if (geometryWorker) closers.push(geometryWorker.close().catch(() => {}))
  if (taskQueue) closers.push(taskQueue.close().catch(() => {}))
  if (tikzQueue) closers.push(tikzQueue.close().catch(() => {}))
  if (geometryQueue) closers.push(geometryQueue.close().catch(() => {}))
  await Promise.all(closers)
  taskQueue = null
  taskWorker = null
  tikzQueue = null
  tikzWorker = null
  geometryQueue = null
  geometryWorker = null
  currentConnection = null
  console.log('[Queue] 旧 Worker/Queue 已拆解完成')
}

/**
 * 当 Redis 实例被配额熔断 / 切到 backup 时，关闭旧 BullMQ Worker 并用新 connection 重建。
 * 由 redisManager.onQuotaExhausted 回调触发。
 */
let rebuildInProgress = false
async function rebuildQueue(reason) {
  if (rebuildInProgress) {
    console.log(`[Queue] rebuildQueue 已在进行中，跳过本次触发 (reason=${reason})`)
    return
  }
  rebuildInProgress = true
  try {
    console.log(`[Queue] 🔄 触发 BullMQ 重建 (reason: ${reason || 'n/a'})`)
    await teardownQueues()
    // 重置初始化标志让 initQueue 可以重入
    queueInitialized = false
    initPromise = null
    await initQueue()
    console.log(`[Queue] ✅ 重建完成 (当前实例: ${redisManager.getStats().current})`)
  } catch (err) {
    console.error(`[Queue] ❌ 重建失败: ${err.message}`)
    console.error(err.stack)
  } finally {
    rebuildInProgress = false
  }
}

const initQueue = async () => {
  if (initPromise) return initPromise
  if (queueInitialized) return

  initPromise = (async () => {
    try {
      console.log('🔄 [Queue] 开始初始化 Redis 连接池...')
      await redisManager.init()

      // ⭐ 注册配额熔断回调：当 redisManager 标记某实例为 quota exhausted 时，
      // 关闭旧 BullMQ Worker 并用新 connection 重建，让队列自动切到 backup 实例
      if (typeof redisManager.onQuotaExhausted !== 'function') {
        redisManager.onQuotaExhausted = (id, reason) => {
          console.log(`[Queue] 📡 收到配额熔断通知: instance=${id}, reason=${reason}`)
          // 异步重建，不阻塞 redisManager 内部流程
          rebuildQueue(`quota_exhausted:${id}`).catch((e) =>
            console.error('[Queue] 配额熔断触发的 rebuildQueue 失败:', e.message)
          )
        }
      }

      const connection = await redisManager.getAvailableClient()
      if (!connection) {
        throw new Error('无法连接到任何 Redis 实例')
      }

      currentConnection = connection

      console.log('🔄 [Queue] 开始初始化 BullMQ 队列...')
      const { Queue, Worker } = await import('bullmq')

      const queueConfig = {
        connection
      }

      taskQueue = new Queue('task-processing', {
        ...queueConfig,
        defaultJobOptions: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
          attempts: parseInt(process.env.MAX_RETRIES) || 3,
          backoff: { type: 'exponential', delay: 5000 }
        }
      })

      // ⚡ 优化：Worker 并发从 1 提升到 2。AI_CONCURRENCY=2 已全局限制 AI 请求数，
      // 2 个并行 Worker 可同时处理不同阶段（一个在 OCR，另一个在答案生成），充分利用等待时间。
      const concurrency = parseInt(process.env.CONCURRENCY) || 2

      // Polling tuning: BullMQ idle-workers poll Redis on `drainDelay` (seconds).
      // Default 5s => ~12 req/min/worker. 60s => ~1 req/min/worker => ~12x fewer.
      const drainDelay = parseInt(process.env.REDIS_DRAIN_DELAY) || 60
      const stalledInterval = parseInt(process.env.REDIS_STALLED_INTERVAL) || 300000 // 5 min

      console.log(`🔄 [Queue] 创建 Worker (concurrency=${concurrency}, drainDelay=${drainDelay}s)...`)
      taskWorker = new Worker('task-processing', async (job) => {
        console.log(`🔥 [Worker] 收到任务: jobId=${job.id}, taskId=${job.data.taskId}`)
        return processTask(job)
      }, {
        connection,
        concurrency,
        drainDelay,
        stalledInterval,
        lockDuration: parseInt(process.env.TASK_TIMEOUT_MS) || 1800000
      })

      // ── TikZ 生成队列 ──
      tikzQueue = new Queue('tikz-generation', {
        ...queueConfig,
        defaultJobOptions: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
          attempts: 2,
          backoff: { type: 'exponential', delay: 10000 }
        }
      })

      tikzWorker = new Worker('tikz-generation', async (job) => {
        console.log(`[TikZ Worker] 收到任务: questionId=${job.data.questionId}`)
        const { processTikzGeneration } = await import('./tikzWorker.js')
        return processTikzGeneration(job)
      }, {
        connection,
        concurrency: 2,
        drainDelay,
        stalledInterval,
        lockDuration: 600000
      })

      tikzWorker.on('completed', (job) => {
        console.log(`✅ [TikZ Worker] 完成: questionId=${job.data.questionId}`)
      })
      tikzWorker.on('failed', (job, err) => {
        console.error(`❌ [TikZ Worker] 失败: questionId=${job?.data?.questionId}, error=${err.message}`)
      })
      tikzWorker.on('error', (err) => {
        const msg = err?.message || ''
        if (!shouldTriggerRedisSwitch(msg)) {
          console.error('⚠️ [TikZ Worker] 错误:', msg)
          return
        }
        const isQuota = /max requests limit|max daily requests|quota exceeded/i.test(msg)
        if (isQuota) {
          const currentId = redisManager.getStats().current
          console.warn(`[Queue] 🚫 TikZ Worker 检测到 Redis 配额耗尽 (instance=${currentId}): ${msg}`)
          redisManager.markQuotaExhausted(currentId, msg)
          return
        }
        // 连接级错误：忽略，由 taskWorker 的 error 处理器统一切换连接
      })

      // ── 几何图重建队列 ──
      geometryQueue = new Queue('geometry-reconstruction', {
        ...queueConfig,
        defaultJobOptions: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
          attempts: 1, // 重试由 Worker 内部逻辑控制（5min/30min/2h），不走 BullMQ backoff
          backoff: null
        }
      })

      geometryWorker = new Worker('geometry-reconstruction', async (job) => {
        console.log(`[几何Worker] 收到任务: assetId=${job.data?.assetId}, batch=${job.data?.batch}`)
        const { processGeometryReconstruction } = await import('./geometryWorker.js')
        return processGeometryReconstruction(job)
      }, {
        connection,
        concurrency: 1, // 几何重建单并发（Vision API 限流友好）
        drainDelay,
        stalledInterval,
        lockDuration: 600000 // 10 min
      })

      geometryWorker.on('completed', (job) => {
        const result = job.returnvalue
        if (result?.success) {
          console.log(`✅ [几何Worker] 完成: ${result.questionId || result.assetId || ''}`)
        }
      })
      geometryWorker.on('failed', (job, err) => {
        console.error(`❌ [几何Worker] 失败: ${job?.data?.assetId || ''}, error=${err.message}`)
      })
      geometryWorker.on('error', (err) => {
        const msg = err?.message || ''
        if (!shouldTriggerRedisSwitch(msg)) {
          console.error('⚠️ [几何Worker] 错误:', msg)
          return
        }
        const isQuota = /max requests limit|max daily requests|quota exceeded/i.test(msg)
        if (isQuota) {
          const currentId = redisManager.getStats().current
          console.warn(`[Queue] 🚫 几何Worker 检测到 Redis 配额耗尽 (instance=${currentId}): ${msg}`)
          redisManager.markQuotaExhausted(currentId, msg)
          return
        }
        // 连接级错误：忽略，由 taskWorker 的 error 处理器统一切换连接
      })

      taskWorker.on('completed', (job, result) => {
        console.log(`✅ [Worker] 任务完成: jobId=${job.id}, taskId=${job.data.taskId}, result=${JSON.stringify(result)}`)
      })

      taskWorker.on('failed', (job, err) => {
        console.error(`❌ [Worker] 任务失败: jobId=${job?.id}, taskId=${job?.data?.taskId}, error=${err.message}`)
      })

      taskWorker.on('error', async (err) => {
        const msg = err?.message || ''
        if (!shouldTriggerRedisSwitch(msg)) {
          console.error('⚠️ [Worker] 错误:', msg)
          return
        }
        // 命中 WORKER_RECOVERY_KEYWORDS：
        // - 连接级错误（WRONGPASS/ECONNRESET/ETIMEDOUT）：立即尝试切换到下一个 pool 实例
        // - 配额级错误（max requests limit / quota exceeded）：标记熔断 + 触发 rebuildQueue 切到 backup
        const isQuota = /max requests limit|max daily requests|quota exceeded/i.test(msg)
        if (isQuota) {
          // 找到当前 connection 对应的 pool item id，标记熔断
          const currentId = redisManager.getStats().current
          console.warn(`[Queue] 🚫 检测到 Redis 配额耗尽 (instance=${currentId}): ${msg}`)
          redisManager.markQuotaExhausted(currentId, msg)
          // markQuotaExhausted 已通过 onQuotaExhausted 回调触发 rebuildQueue
          return
        }
        // 连接级错误：尝试切换到下一个 pool 实例
        console.warn(`[Queue] 连接异常，尝试切换到下一个 Redis 实例: ${msg}`)
        const newConnection = await redisManager.getAvailableClient()
        if (newConnection && newConnection !== currentConnection) {
          console.log(`[Queue] 已切换到新的 Redis 连接`)
          currentConnection = newConnection
        }
        return
      })

      taskWorker.on('stalled', (jobId) => {
        console.warn(`⏰ [Worker] 任务超时停滞: jobId=${jobId}`)
      })

      taskWorker.on('active', (job) => {
        console.log(`▶️ [Worker] 任务开始处理: jobId=${job.id}, taskId=${job.data.taskId}`)
      })

      queueInitialized = true
      console.log(`✅ [Queue] Redis 队列已连接并就绪 (实例: ${redisManager.getStats().current})`)
      console.log(`[Queue] 连接池状态: ${JSON.stringify(redisManager.getStats())}`)
    } catch (err) {
      console.error(`❌ [Queue] Redis 队列初始化失败: ${err.message}`)
      console.error(`   错误堆栈: ${err.stack}`)
      console.warn('⚠️ 任务将使用同步处理模式')
      taskQueue = null
      taskWorker = null
      // 注意：这里不要把 queueInitialized 设为 true，否则 rebuildQueue 无法重入。
      // 留 false 让下次 initQueue() 调用可以重新尝试（被 initPromise 防重入保护）。
    }
  })()

  return initPromise
}

export { taskQueue, taskWorker, tikzQueue, tikzWorker, geometryQueue, geometryWorker }

export const TASK_EVENTS = {
  STARTED: 'started',
  PROGRESS: 'progress',
  COMPLETED: 'completed',
  FAILED: 'failed'
}

export const getQueueStats = async () => {
  if (!taskQueue) {
    return {
      waiting: 0, active: 0, completed: 0,
      failed: 0, delayed: 0, total: 0,
      available: false
    }
  }

  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      taskQueue.getWaitingCount(),
      taskQueue.getActiveCount(),
      taskQueue.getCompletedCount(),
      taskQueue.getFailedCount(),
      taskQueue.getDelayedCount()
    ])

    return {
      waiting, active, completed, failed, delayed,
      total: waiting + active + delayed,
      available: true
    }
  } catch (err) {
    return {
      waiting: 0, active: 0, completed: 0,
      failed: 0, delayed: 0, total: 0,
      available: false, error: err.message
    }
  }
}

export const getTaskQueue = async () => {
  if (!queueInitialized) {
    await initQueue()
  }
  return taskQueue
}

export const getTaskWorker = async () => {
  if (!queueInitialized) {
    await initQueue()
  }
  return taskWorker
}

export const getTikzQueue = async () => {
  if (!queueInitialized) {
    await initQueue()
  }
  return tikzQueue
}

export const getTikzWorker = async () => {
  if (!queueInitialized) {
    await initQueue()
  }
  return tikzWorker
}

export const getGeometryQueue = async () => {
  if (!queueInitialized) {
    await initQueue()
  }
  return geometryQueue
}

export const getGeometryWorker = async () => {
  if (!queueInitialized) {
    await initQueue()
  }
  return geometryWorker
}
