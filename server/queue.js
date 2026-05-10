import { processTask } from './worker.js'

let taskQueue = null
let taskWorker = null
let queueInitialized = false
let initPromise = null

const redisConfig = process.env.REDIS_URL 
  ? { 
      url: process.env.REDIS_URL.trim(), 
      maxRetriesPerRequest: null,
      tls: {}
    }
  : {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      tls: {}
    }

const initQueue = async () => {
  if (initPromise) return initPromise
  if (queueInitialized) return

  initPromise = (async () => {
    try {
      const { Queue, Worker } = await import('bullmq')

      taskQueue = new Queue('task-processing', {
        connection: redisConfig,
        defaultJobOptions: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
          attempts: parseInt(process.env.MAX_RETRIES) || 3,
          backoff: { type: 'exponential', delay: 5000 }
        }
      })

      const concurrency = parseInt(process.env.CONCURRENCY) || 2

      taskWorker = new Worker('task-processing', async (job) => {
        return processTask(job)
      }, {
        connection: redisConfig,
        concurrency,
        lockDuration: parseInt(process.env.TASK_TIMEOUT_MS) || 1800000
      })

      taskWorker.on('completed', (job, result) => {
        console.log(`✅ 任务完成: ${job.id} (taskId: ${job.data.taskId})`)
      })

      taskWorker.on('failed', (job, err) => {
        console.error(`❌ 任务失败: ${job?.id} (taskId: ${job?.data?.taskId})`, err.message)
      })

      taskWorker.on('error', (err) => {
        if (err.message.includes('WRONGPASS') || err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT')) {
          return
        }
        console.error('️ Worker 错误:', err)
      })

      taskWorker.on('stalled', (jobId) => {
        console.warn(`⏰ 任务超时停滞: ${jobId}`)
      })

      queueInitialized = true
      console.log('✅ Redis 队列已连接')
    } catch (err) {
      console.warn(`️ Redis 队列不可用: ${err.message}`)
      console.warn('   任务将使用同步处理模式')
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
