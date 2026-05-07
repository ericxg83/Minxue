import { Queue, Worker } from 'bullmq'
import { processTask } from './worker.js'

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

export const taskQueue = new Queue('task-processing', {
  connection: redisConfig,
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
