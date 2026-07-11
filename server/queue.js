import { processTask } from './worker.js'
import { redisManager } from './redisManager.js'

let taskQueue = null
let taskWorker = null
let tikzQueue = null
let tikzWorker = null
let queueInitialized = false
let initPromise = null
let currentConnection = null

const initQueue = async () => {
  if (initPromise) return initPromise
  if (queueInitialized) return

  initPromise = (async () => {
    try {
      console.log('🔄 [Queue] 开始初始化 Redis 连接池...')
      await redisManager.init()

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

      const concurrency = parseInt(process.env.CONCURRENCY) || 2

      console.log(`🔄 [Queue] 创建 Worker (concurrency=${concurrency})...`)
      taskWorker = new Worker('task-processing', async (job) => {
        console.log(`🔥 [Worker] 收到任务: jobId=${job.id}, taskId=${job.data.taskId}`)
        return processTask(job)
      }, {
        connection,
        concurrency,
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
        lockDuration: 600000
      })

      tikzWorker.on('completed', (job) => {
        console.log(`✅ [TikZ Worker] 完成: questionId=${job.data.questionId}`)
      })
      tikzWorker.on('failed', (job, err) => {
        console.error(`❌ [TikZ Worker] 失败: questionId=${job?.data?.questionId}, error=${err.message}`)
      })
      tikzWorker.on('error', (err) => {
        // 复用同一 connection 的切换逻辑，不重复处理
        if (err.message.includes('WRONGPASS') || err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT')) return
        console.error('⚠️ [TikZ Worker] 错误:', err.message)
      })

      taskWorker.on('completed', (job, result) => {
        console.log(`✅ [Worker] 任务完成: jobId=${job.id}, taskId=${job.data.taskId}, result=${JSON.stringify(result)}`)
      })

      taskWorker.on('failed', (job, err) => {
        console.error(`❌ [Worker] 任务失败: jobId=${job?.id}, taskId=${job?.data?.taskId}, error=${err.message}`)
      })

      taskWorker.on('error', async (err) => {
        if (err.message.includes('WRONGPASS') || err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT')) {
          console.warn('[Queue] 连接异常，尝试切换到下一个 Redis 实例...')
          const newConnection = await redisManager.getAvailableClient()
          if (newConnection && newConnection !== currentConnection) {
            console.log(`[Queue] 已切换到新的 Redis 连接`)
            currentConnection = newConnection
          }
          return
        }
        console.error('⚠️ [Worker] 错误:', err.message)
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
      queueInitialized = true
    }
  })()

  return initPromise
}

export { taskQueue, taskWorker, tikzQueue, tikzWorker }

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
