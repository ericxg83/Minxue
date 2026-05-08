import { Queue, Worker } from 'bullmq'
import Redis from 'ioredis'
import { processTask } from './worker.js'

// 创建 Redis 连接
const createRedisConnection = () => {
  if (process.env.REDIS_URL) {
    console.log('使用 REDIS_URL 连接 Redis')
    return new Redis(process.env.REDIS_URL.trim(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('Redis 重连失败，停止重试')
          return null
        }
        return Math.min(times * 1000, 3000)
      }
    })
  }

  console.log('使用独立配置连接 Redis')
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => {
      if (times > 3) {
        console.error('Redis 重连失败，停止重试')
        return null
      }
      return Math.min(times * 1000, 3000)
    }
  })
}

const redisConnection = createRedisConnection()

redisConnection.on('connect', () => {
  console.log('✅ Redis 连接成功')
})

redisConnection.on('error', (err) => {
  console.error('❌ Redis 连接错误:', err.message)
})

redisConnection.on('close', () => {
  console.warn('⚠️ Redis 连接关闭')
})

export const taskQueue = new Queue('task-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    attempts: parseInt(process.env.MAX_RETRIES) || 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    }
  }
})

export const TASK_EVENTS = {
  STARTED: 'started',
  PROGRESS: 'progress',
  COMPLETED: 'completed',
  FAILED: 'failed'
}

const concurrency = parseInt(process.env.CONCURRENCY) || 2

export const taskWorker = new Worker('task-processing', async (job) => {
  return processTask(job)
}, {
  connection: redisConnection,
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

export const getQueueStats = async () => {
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
    total: waiting + active + delayed
  }
}
