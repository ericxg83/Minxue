import { getTaskQueue, getGeometryQueue } from './queue.js'
import { query, TABLES } from './config/neon.js'

const PENDING_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

// 几何重建重试延迟（与服务端 handleRetry 保持一致）
const GEOMETRY_RETRY_DELAYS = [
  5 * 60 * 1000,   // 第 1 次失败 → 5 分钟
  30 * 60 * 1000,  // 第 2 次失败 → 30 分钟
  2 * 60 * 60 * 1000 // 第 3 次失败 → 2 小时
]
const GEOMETRY_MAX_RETRIES = GEOMETRY_RETRY_DELAYS.length

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
      // ⚡ 并行执行 5 个独立扫描，替代串行
      await Promise.allSettled([
        this.scanPendingTasks(),
        this.scanFailedTasks(),
        this.scanProcessingStuck(),
        this.scanGeometryAssets(),
        this.scanStuckWorksheetParsing()
      ])
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ 扫描失败:', err)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * 扫描 failed 主任务并自动重试（此前任务系统只恢复 pending）。
   * 限制：同一任务最多自动重试 MAX_AUTO_RETRIES 次（含 worker 内部 + 此处），
   * 超出后保持 failed，避免对注定失败的图片无限重试。
   */
  async scanFailedTasks() {
    try {
      const MAX_AUTO_RETRIES = 3
      console.log('[PendingTaskRecovery]  开始扫描 failed 任务...')

      const { rows } = await query(
        `SELECT id, student_id, image_url, images, original_name, status, created_at, result, retry_count, last_error,
                task_type, worksheet_id, generated_exam_id, subject
         FROM ${TABLES.TASKS}
         WHERE status = 'failed'
           AND COALESCE(retry_count, 0) < $1
           AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY updated_at ASC`,
        [MAX_AUTO_RETRIES]
      )

      if (rows.length === 0) {
        console.log('[PendingTaskRecovery] ✅ 没有可自动重试的 failed 任务')
        return
      }

      console.log(`[PendingTaskRecovery] 📋 找到 ${rows.length} 个可自动重试的 failed 任务:`)
      rows.forEach((t, i) => {
        console.log(`   ${i + 1}. ${t.original_name} (retry_count=${t.retry_count || 0}, ${String(t.last_error || '').substring(0, 60)})`)
      })

      const queue = await getTaskQueue()
      if (!queue) {
        console.error('[PendingTaskRecovery] ❌ 队列不可用，跳过恢复')
        return
      }

      // 去重：已在队列中的任务不再重复入队。
      const inFlightJobs = await queue.getJobs(['waiting', 'active', 'delayed'])
      const inFlightTaskIds = new Set(inFlightJobs.map(j => j.data?.taskId).filter(Boolean))

      let recoveredCount = 0
      for (const task of rows) {
        try {
          if (inFlightTaskIds.has(task.id)) {
            console.log(`[PendingTaskRecovery] ⏭️ ${task.original_name} 已在队列中`)
            continue
          }
          await query(
            `UPDATE ${TABLES.TASKS} SET status = 'pending', last_error = NULL, updated_at = NOW() WHERE id = $1`,
            [task.id]
          )
          await queue.add('process-task', {
            taskId: task.id,
            studentId: task.student_id,
            imageUrl: task.image_url,
            images: task.images || null,
            originalName: task.original_name,
            // 路由字段必须随恢复 job 带全，否则 workbook/错题重练任务会被静默降级为完整 AI 管线
            taskType: task.task_type || 'general',
            worksheetId: task.worksheet_id || null,
            generatedExamId: task.generated_exam_id || null,
            subject: task.subject || null,
            retryCount: (task.retry_count || 0) + 1
          }, {
            attempts: parseInt(process.env.MAX_RETRIES) || 3,
            backoff: { type: 'exponential', delay: 5000 }
          })
          console.log(`[PendingTaskRecovery] ✅ 已恢复 failed 任务: ${task.original_name} (retry ${task.retry_count || 0}→${(task.retry_count || 0) + 1})`)
          recoveredCount++
        } catch (err) {
          console.error(`[PendingTaskRecovery]  恢复失败 ${task.original_name}:`, err.message)
        }
      }
      console.log(`[PendingTaskRecovery] ✅ failed 任务恢复完成: ${recoveredCount}/${rows.length}`)
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ failed 任务扫描失败:', err)
    }
  }

  /**
   * 扫描 stuck processing 任务：started_at 距今超过 PROCESSING_TIMEOUT_MS 仍未结束
   * （worker 崩溃 / 锁超时未回填），重置为 pending 重新入队。
   */
  async scanProcessingStuck() {
    try {
      const PROCESSING_TIMEOUT_MS = parseInt(process.env.TASK_PROCESSING_TIMEOUT_MS) || 30 * 60 * 1000 // 30 min
      console.log('[PendingTaskRecovery]  开始扫描 stuck processing 任务...')

      const { rows } = await query(
        `SELECT id, student_id, image_url, images, original_name, status, started_at, retry_count,
                task_type, worksheet_id, generated_exam_id, subject
         FROM ${TABLES.TASKS}
         WHERE status = 'processing'
           AND (started_at IS NULL OR started_at < NOW() - INTERVAL '${PROCESSING_TIMEOUT_MS / 1000 / 60} minutes')
         ORDER BY started_at ASC NULLS FIRST`,
        []
      )

      if (rows.length === 0) {
        console.log('[PendingTaskRecovery] ✅ 没有 stuck processing 任务')
        return
      }

      console.log(`[PendingTaskRecovery] 📋 找到 ${rows.length} 个 stuck processing 任务`)

      const queue = await getTaskQueue()
      if (!queue) {
        console.error('[PendingTaskRecovery] ❌ 队列不可用，跳过恢复')
        return
      }

      const inFlightJobs = await queue.getJobs(['waiting', 'active', 'delayed'])
      const inFlightTaskIds = new Set(inFlightJobs.map(j => j.data?.taskId).filter(Boolean))

      let recoveredCount = 0
      for (const task of rows) {
        try {
          if (inFlightTaskIds.has(task.id)) {
            console.log(`[PendingTaskRecovery] ⏭️ ${task.original_name} 已在队列中`)
            continue
          }
          await query(
            `UPDATE ${TABLES.TASKS} SET status = 'pending', updated_at = NOW() WHERE id = $1`,
            [task.id]
          )
          await queue.add('process-task', {
            taskId: task.id,
            studentId: task.student_id,
            imageUrl: task.image_url,
            images: task.images || null,
            originalName: task.original_name,
            // 路由字段必须随恢复 job 带全，否则 workbook/错题重练任务会被静默降级为完整 AI 管线
            taskType: task.task_type || 'general',
            worksheetId: task.worksheet_id || null,
            generatedExamId: task.generated_exam_id || null,
            subject: task.subject || null,
            retryCount: (task.retry_count || 0) + 1
          }, {
            attempts: parseInt(process.env.MAX_RETRIES) || 3,
            backoff: { type: 'exponential', delay: 5000 }
          })
          console.log(`[PendingTaskRecovery] ✅ 已恢复 stuck processing 任务: ${task.original_name}`)
          recoveredCount++
        } catch (err) {
          console.error(`[PendingTaskRecovery]  恢复失败 ${task.original_name}:`, err.message)
        }
      }
      console.log(`[PendingTaskRecovery] ✅ stuck processing 恢复完成: ${recoveredCount}/${rows.length}`)
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ stuck processing 扫描失败:', err)
    }
  }

  /**
   * 扫描超时的 pending 主任务并重新入队
   */
  async scanPendingTasks() {
    try {
      console.log('[PendingTaskRecovery]  开始扫描超时 pending 任务...')

      // Find tasks that have been pending for too long
      const { rows } = await query(
        `SELECT id, student_id, image_url, images, original_name, status, created_at, result,
                task_type, worksheet_id, generated_exam_id, subject
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
            images: task.images || null,
            originalName: task.original_name,
            // 路由字段必须随恢复 job 带全，否则 workbook/错题重练任务会被静默降级为完整 AI 管线
            taskType: task.task_type || 'general',
            worksheetId: task.worksheet_id || null,
            generatedExamId: task.generated_exam_id || null,
            subject: task.subject || null,
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
      console.error('[PendingTaskRecovery] ❌ pending 任务扫描失败:', err)
    }
  }

  /**
   * 扫描卡死的练习册解析：parse_status='parsing' 但 updated_at 超过 15 分钟。
   * 练习册解析在路由进程内后台执行，10 分钟超时兜底也是内存态的——服务器重启/OOM
   * 后状态会永远停在 'parsing'：前端轮询无限转圈，重新上传被 409 拒绝。
   * 此处兜底重置为 failed 并写明原因，让用户可以重新上传。
   */
  async scanStuckWorksheetParsing() {
    try {
      const STUCK_MINUTES = parseInt(process.env.WORKSHEET_PARSING_TIMEOUT_MINUTES) || 15
      const { rows } = await query(
        `UPDATE ${TABLES.WORKSHEETS}
         SET parse_status = 'failed',
             parse_error = '解析进程中断（服务器重启或内存不足），请重新上传'
         WHERE parse_status = 'parsing'
           AND updated_at < NOW() - INTERVAL '${STUCK_MINUTES} minutes'
         RETURNING id, name`,
        []
      )
      if (rows.length > 0) {
        rows.forEach(w => {
          console.log(`[PendingTaskRecovery] ⚠️ 练习册解析卡死，已重置为 failed: ${w.name} (${w.id})`)
        })
      }
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ 练习册解析扫描失败:', err)
    }
  }

  /**
   * 扫描 geometry 重建资产：
   *   1. failed 状态且 retry_count < MAX_RETRIES → 按时间表重新入队
   *   2. pending 状态超过 30 分钟 → 重新入队（防止 Worker 漏掉）
   */
  async scanGeometryAssets() {
    try {
      const geometryQueue = await getGeometryQueue()
      if (!geometryQueue) {
        console.log('[PendingTaskRecovery] ⏭️  geometry 队列不可用，跳过')
        return
      }

      // ── 1. 扫描需要重试的 failed 资产 ──
      const { rows: failedRows } = await query(
        `SELECT a.id, a.question_id, a.retry_count, a.updated_at, a.last_error
         FROM ${TABLES.QUESTION_ASSETS} a
         WHERE a.asset_type = 'geometry_image'
           AND a.tikz_status = 'failed'
           AND a.retry_count < $1
           AND a.retry_count > 0
         ORDER BY a.updated_at ASC`,
        [GEOMETRY_MAX_RETRIES]
      )

      if (failedRows.length > 0) {
        const now = Date.now()
        let retryCount = 0
        for (const asset of failedRows) {
          const retries = asset.retry_count || 0
          const delay = GEOMETRY_RETRY_DELAYS[Math.min(retries - 1, GEOMETRY_RETRY_DELAYS.length - 1)]
          const elapsed = now - new Date(asset.updated_at).getTime()
          if (elapsed >= delay) {
            // 重试时间已到 → 重新入队
            try {
              await geometryQueue.add('reconstruct', {
                assetId: asset.id,
                retryCount: retries + 1
              }, {
                attempts: 1
              })
              // 重置为 pending 状态
              await query(
                `UPDATE ${TABLES.QUESTION_ASSETS}
                 SET tikz_status = 'pending', updated_at = NOW()
                 WHERE id = $1`,
                [asset.id]
              )
              console.log(`[PendingTaskRecovery] ✅ 几何资产重试: ${asset.question_id?.substring(0, 8)} (第 ${retries + 1} 次重试)`)
              retryCount++
            } catch (err) {
              console.error(`[PendingTaskRecovery]  几何重试失败 ${asset.id?.substring(0, 8)}:`, err.message)
            }
          }
        }
        if (retryCount > 0) {
          console.log(`[PendingTaskRecovery] ✅ 几何资产重试: ${retryCount}/${failedRows.length} 个`)
        }
      }

      // ── 2. 扫描超时的 pending 资产（30 分钟以上未处理） ──
      const { rows: stalePending } = await query(
        `SELECT a.id, a.question_id, a.created_at
         FROM ${TABLES.QUESTION_ASSETS} a
         WHERE a.asset_type = 'geometry_image'
           AND a.tikz_status = 'pending'
           AND a.created_at < NOW() - INTERVAL '30 minutes'
         ORDER BY a.created_at ASC
         LIMIT 20`
      )

      if (stalePending.length > 0) {
        console.log(`[PendingTaskRecovery] 📋 发现 ${stalePending.length} 个超时未处理的几何资产`)
        for (const asset of stalePending) {
          try {
            await geometryQueue.add('reconstruct', {
              assetId: asset.id
            }, { attempts: 1 })
            console.log(`[PendingTaskRecovery] ✅ 重新入队: ${asset.question_id?.substring(0, 8)}`)
          } catch (err) {
            console.error(`[PendingTaskRecovery]  入队失败 ${asset.id?.substring(0, 8)}:`, err.message)
          }
        }
      }
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ 几何资产扫描失败:', err)
    }
  }
}

export const pendingTaskRecovery = new PendingTaskRecovery()
