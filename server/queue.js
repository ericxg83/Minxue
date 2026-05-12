import { processTask } from './worker.js'

let taskQueue = null
let taskWorker = null
let queueInitialized = false
let initPromise = null
let redisConfig = null

const getRedisConfig = () => {
  if (!redisConfig) {
    redisConfig = process.env.REDIS_URL
      ? {
          url: process.env.REDIS_URL.trim(),
          maxRetriesPerRequest: null,
          tls: { rejectUnauthorized: false }
        }
      : {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          tls: {}
        }

    console.log(`🔧 [Queue] Redis 配置: ${redisConfig.url ? 'URL 模式' : 'HOST 模式'}`)
    if (redisConfig.url) {
      console.log(`   Redis URL: ${redisConfig.url.substring(0, 30)}...`)
    }
  }
  return redisConfig
}

const initQueue = async () => {
  if (initPromise) return initPromise
  if (queueInitialized) return

  initPromise = (async () => {
    try {
      console.log('🔄 [Queue] 开始初始化 Redis 队列...')
      const { Queue, Worker } = await import('bullmq')
      
      const connection = getRedisConfig()

      taskQueue = new Queue('task-processing', {
        connection,
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

      taskWorker.on('completed', (job, result) => {
        console.log(`✅ [Worker] 任务完成: jobId=${job.id}, taskId=${job.data.taskId}, result=${JSON.stringify(result)}`)
      })

      taskWorker.on('failed', (job, err) => {
        console.error(`❌ [Worker] 任务失败: jobId=${job?.id}, taskId=${job?.data?.taskId}, error=${err.message}`)
      })

      taskWorker.on('error', (err) => {
        if (err.message.includes('WRONGPASS') || err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT')) {
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
      console.log('✅ [Queue] Redis 队列已连接并就绪')
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

export { taskQueue, taskWorker }

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
