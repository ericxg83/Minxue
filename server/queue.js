import { Queue, Worker } from 'bullmq'
import Redis from 'ioredis'
import { processTask } from './worker.js'

// 创建 Redis 连接
let redisConnection = null
let isRedisAvailable = false

const createRedisConnection = () => {
  try {
    const redisUrl = process.env.REDIS_URL?.trim() || `redis://${process.env.REDIS_HOST || 'localhost'}:${parseInt(process.env.REDIS_PORT) || 6379}`
    
    console.log(`尝试连接 Redis: ${redisUrl}`)
    redisConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('Redis 重连失败，停止重试')
          isRedisAvailable = false
          return null
        }
        return Math.min(times * 1000, 3000)
      }
    })

    redisConnection.on('connect', () => {
      console.log('✅ Redis 连接成功')
      isRedisAvailable = true
    })

    redisConnection.on('error', (err) => {
      console.error('❌ Redis 连接错误:', err.message)
      isRedisAvailable = false
    })

    redisConnection.on('close', () => {
      console.warn('⚠️ Redis 连接关闭')
      isRedisAvailable = false
    })

    return redisConnection
  } catch (error) {
    console.warn('⚠️ Redis 初始化失败，将使用同步模式:', error.message)
    isRedisAvailable = false
    return null
  }
}

const connection = createRedisConnection()

// 检查 Redis 是否可用
export const isRedisReady = () => isRedisAvailable

// 导出任务队列（如果 Redis 不可用，则返回 null）
export const taskQueue = connection ? new Queue('task-processing', {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    attempts: parseInt(process.env.MAX_RETRIES) || 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    }
  }
}) : null

export const TASK_EVENTS = {
  STARTED: 'started',
  PROGRESS: 'progress',
  COMPLETED: 'completed',
  FAILED: 'failed'
}

// 只有在 Redis 可用时才启动 Worker
let taskWorker = null
if (connection) {
  const concurrency = parseInt(process.env.CONCURRENCY) || 2
  
  taskWorker = new Worker('task-processing', async (job) => {
    return processTask(job)
  }, {
    connection,
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
    console.error('⚠️ Worker 错误:', err)
  })

  taskWorker.on('stalled', (jobId) => {
    console.warn(`⏰ 任务超时停滞: ${jobId}`)
  })
}

export { taskWorker }

export const getQueueStats = async () => {
  if (!taskQueue || !isRedisAvailable) {
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      total: 0,
      mode: 'sync'
    }
  }

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    taskQueue.getWaitingCount(),
    taskQueue.getActiveCount(),
    taskQueue.getCompletedCount(),
    taskQueue.getFailedCount(),
    taskQueue.getDelayedCount()
  ])

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed,
    mode: 'async'
  }
}
