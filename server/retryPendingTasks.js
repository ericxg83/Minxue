import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '.env') })

console.log('✅ 环境变量已加载, REDIS_LOCAL:', process.env.REDIS_LOCAL)
console.log('✅ REDIS_HOST:', process.env.REDIS_HOST)

import Redis from 'ioredis'

const createRedisClient = async () => {
  const host = process.env.REDIS_HOST || 'localhost'
  const port = parseInt(process.env.REDIS_PORT) || 6379
  const password = process.env.REDIS_LOCAL_PASSWORD || undefined
  
  console.log(`🔧 正在连接 Redis: ${host}:${port}`)
  
  const client = new Redis({
    host,
    port,
    password,
    enableReadyCheck: true,
    maxRetriesPerRequest: null
  })

  client.on('error', (err) => {
    console.error(`[Redis] 连接错误: ${err.message}`)
  })

  try {
    await client.ping()
    console.log('✅ Redis 连接成功')
    return client
  } catch (err) {
    console.error(`❌ Redis 连接失败: ${err.message}`)
    process.exit(1)
  }
}

const retryPendingTasks = async () => {
  try {
    console.log('\n🔧 开始初始化 Redis...')
    const connection = await createRedisClient()

    const { Pool } = await import('pg')
    const pool = new Pool({
      connectionString: process.env.NEON_DATABASE_URL
    })

    console.log('\n🔍 查询数据库中的 pending 任务...')
    const { rows } = await pool.query(
      `SELECT id, student_id, image_url, original_name, status, result 
       FROM tasks 
       WHERE status = 'pending' 
       ORDER BY created_at ASC`
    )

    if (rows.length === 0) {
      console.log('✅ 没有 pending 任务需要重试')
      await connection.quit()
      await pool.end()
      process.exit(0)
    }

    console.log(`\n📋 找到 ${rows.length} 个 pending 任务:`)
    rows.forEach((t, i) => {
      console.log(`   ${i + 1}. ${t.original_name} (ID: ${t.id})`)
    })

    const { Queue } = await import('bullmq')
    const taskQueue = new Queue('task-processing', { connection })

    console.log('\n🚀 开始将任务加入队列...')
    for (const task of rows) {
      const retryCount = (task.result?.retryCount || 0) + 1
      await taskQueue.add('process-task', {
        taskId: task.id,
        studentId: task.student_id,
        imageUrl: task.image_url,
        originalName: task.original_name,
        retryCount
      }, {
        attempts: parseInt(process.env.MAX_RETRIES) || 3,
        backoff: { type: 'exponential', delay: 5000 }
      })
      console.log(`   ✅ 已加入队列: ${task.original_name}`)
    }

    console.log('\n✅ 所有 pending 任务已加入队列，Worker 将自动处理')
    console.log('📌 请查看 server 日志确认处理进度')
    
    await taskQueue.close()
    await connection.quit()
    await pool.end()
    process.exit(0)
  } catch (err) {
    console.error('❌ 重试失败:', err)
    process.exit(1)
  }
}

retryPendingTasks()
