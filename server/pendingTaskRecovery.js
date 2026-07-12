import { getTaskQueue } from './queue.js'
import { query, TABLES } from './config/neon.js'

const PENDING_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

class PendingTaskRecovery {
  constructor() {
    this.scanInterval = null
    this.scanIntervalMs = parseInt(process.env.PENDING_TASK_SCAN_INTERVAL) || 5 * 60 * 1000 // 5 minutes
    this.isRunning = false
  }

  start() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval)
    }

    console.log(`[PendingTaskRecovery] 已启动 (扫描间隔: ${this.scanIntervalMs / 1000 / 60}分钟)`)

    this.scanInterval = setInterval(async () => {
      if (this.isRunning) return // Prevent overlapping scans
      await this.scanAndRecover()
    }, this.scanIntervalMs)

    // Run initial scan after 30 seconds
    setTimeout(() => this.scanAndRecover(), 30000)
  }

  stop() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval)
      this.scanInterval = null
      console.log('[PendingTaskRecovery] 已停止')
    }
  }

  async scanAndRecover() {
    this.isRunning = true

    try {
      console.log('[PendingTaskRecovery]  开始扫描超时 pending 任务...')

      // Find tasks that have been pending for too long
      const { rows } = await query(
        `SELECT id, student_id, image_url, original_name, status, created_at, result
         FROM ${TABLES.TASKS}
         WHERE status = 'pending'
         AND created_at < NOW() - INTERVAL '${PENDING_TIMEOUT_MS / 1000 / 60} minutes'
         ORDER BY created_at ASC`,
        []
      )

      if (rows.length === 0) {
        console.log('[PendingTaskRecovery] ✅ 没有超时 pending 任务')
        return
      }

      console.log(`[PendingTaskRecovery] 📋 找到 ${rows.length} 个超时任务:`)
      rows.forEach((task, i) => {
        const pendingMinutes = Math.round((Date.now() - new Date(task.created_at).getTime()) / 60000)
        console.log(`   ${i + 1}. ${task.original_name} (已等待 ${pendingMinutes} 分钟)`)
      })

      // Reuse the shared queue connection instead of creating a fresh Queue per scan.
      const queue = await getTaskQueue()
      if (!queue) {
        console.error('[PendingTaskRecovery] ❌ 队列不可用，跳过恢复')
        return
      }

      // Single Redis call to fetch all in-flight jobs (was one getJobs() per task = N+1).
      const inFlightJobs = await queue.getJobs(['waiting', 'active', 'delayed'])
      const inFlightTaskIds = new Set(inFlightJobs.map(j => j.data?.taskId).filter(Boolean))

      let recoveredCount = 0
      for (const task of rows) {
        try {
          if (inFlightTaskIds.has(task.id)) {
            console.log(`[PendingTaskRecovery] ⏭️  ${task.original_name} 已在队列中`)
            continue
          }

          // Add task back to queue
          const retryCount = (task.result?.retryCount || 0) + 1
          await queue.add('process-task', {
            taskId: task.id,
            studentId: task.student_id,
            imageUrl: task.image_url,
            originalName: task.original_name,
            retryCount,
            recovered: true
          }, {
            attempts: parseInt(process.env.MAX_RETRIES) || 3,
            backoff: { type: 'exponential', delay: 5000 }
          })

          console.log(`[PendingTaskRecovery] ✅ 已恢复: ${task.original_name}`)
          recoveredCount++
        } catch (err) {
          console.error(`[PendingTaskRecovery]  恢复失败 ${task.original_name}:`, err.message)
        }
      }

      console.log(`[PendingTaskRecovery] ✅ 恢复完成: ${recoveredCount}/${rows.length} 个任务`)

    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ 扫描失败:', err)
    } finally {
      this.isRunning = false
    }
  }
}

export const pendingTaskRecovery = new PendingTaskRecovery()
