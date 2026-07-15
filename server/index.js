import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { pendingTaskRecovery } from './pendingTaskRecovery.js'
import { migrateGeometryImageUrl } from './migrations/addGeometryImageUrl.js'
import { migrateLifecycleStatus } from './migrations/007_add_lifecycle_status.js'
import { migrateReviewStatus } from './migrations/008_add_review_status.js'
import { migrateQuestionCacheId } from './migrations/009_add_question_cache_id.js'
import { migrateJudgements } from './migrations/010_add_judgements_table.js'
import { migrateIsComplete } from './migrations/011_add_is_complete.js'
import { migratePracticeCount } from './migrations/012_add_practice_count.js'
import { migrateDifficulty } from './migrations/013_add_difficulty.js'
import { migratePageUnderstanding } from './migrations/014_add_page_understanding.js'
import { migrateGeometryCleanup } from './migrations/015_add_geometry_cleanup.js'
import { migrateGeometryTikzDisplay } from './migrations/016_add_tikz_display.js'
import { migrateGeometryCropType } from './migrations/017_add_geometry_crop_type.js'
import { migrateCleanGeometrySvg } from './migrations/018_add_clean_geometry_svg.js'
import { migrateSourceType } from './migrations/019_add_source_type.js'
import { migrateRetryTaskFields } from './migrations/020_add_retry_task_fields.js'
import { migrateGeometryReconstructionAsync } from './migrations/021_add_geometry_reconstruction_async.js'
import { migrateTaskSystemFields } from './migrations/022_task_system_fields.js'
import { migrateWorksheets } from './migrations/023_add_worksheets_tables.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '.env') })

import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { query, TABLES, TASK_STATUS, QUESTION_STATUS, WRONG_STATUS, LIFECYCLE_STATUS } from './config/neon.js'
import { uploadFilesWithRetry } from './services/uploadRetryManager.js'
import { createUploadReport, logUploadReport } from './services/uploadReportLogger.js'
import { createJudgement, batchUpdateQuestionTags, getQuestionAssets, getQuestionAssetsByType } from './services/neonService.js'
import { judgeAnswer } from './services/judgeService.js'
import { checkQuestionCompleteness } from './utils/questionCompleteness.js'
import { uploadImage, deleteFile } from './services/ossService.js'
import { getTaskQueue, getGeometryQueue, getQueueStats, taskWorker } from './queue.js'
import { processTask } from './worker.js'
// 定时回填走 LLM（backfillTags.js 的 generateTag），用于修正上传热路径产出的
// 本地占位标签/难度（difficulty 默认 3），写入 tags_source='ai' 后退出筛选。
import { generateTag as generateTagWithLLM } from './backfillTags.js'
import { AI_CONFIG, getAIHeaders, buildTaggingPrompt, resetModelIndex } from './config/ai.js'
import weeklyReportRouter from './routes/weeklyReport.js'
import worksheetsRouter from './routes/worksheets.js'

const app = express()
const PORT = process.env.PORT || 4000

const allowedOrigins = process.env.ALLOWED_ORIGIN 
  ? process.env.ALLOWED_ORIGIN.split(',')
  : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:3001', 'http://localhost:3002', 'http://192.168.71.9:3001']

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))
app.use(express.json({ limit: '50mb' }))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Proxy image fetch — avoids CORS issues when drawing cross-origin images to canvas
app.get('/api/proxy-image', async (req, res) => {
  try {
    const { url } = req.query
    if (!url) return res.status(400).json({ error: 'Missing url param' })
    const decoded = decodeURIComponent(url)
    const resp = await fetch(decoded)
    if (!resp.ok) return res.status(resp.status).json({ error: 'Fetch failed' })
    const buffer = Buffer.from(await resp.arrayBuffer())
    const contentType = resp.headers.get('content-type') || 'image/jpeg'
    res.set('Content-Type', contentType)
    res.set('Cache-Control', 'public, max-age=86400')
    res.send(buffer)
  } catch (e) {
    res.status(500).json({ error: 'Proxy fetch failed' })
  }
})

// Upload a single image (for question images, avatars, etc.)
app.post('/api/upload', upload.single('files'), async (req, res) => {
  try {
    const file = req.file
    if (!file) {
      return res.status(400).json({ error: '没有上传文件' })
    }

    // Decode UTF-8 filename (multer may encode as Latin-1)
    try {
      const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8')
      if (Buffer.from(decoded, 'utf8').toString('utf8') === decoded) {
        file.originalname = decoded
      }
    } catch (e) {}

    const studentId = req.body.studentId || 'unknown'
    const url = await uploadImage(file.buffer, file.originalname, studentId)

    res.json({ success: true, url })
  } catch (error) {
    console.error('上传失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Upload images and create tasks (with validation + retry pipeline)
app.post('/api/tasks/upload', upload.array('files', 20), async (req, res) => {
  try {
    const { studentId, taskType, generatedExamId, worksheetId, subject } = req.body
    const normalizedTaskType = taskType === 'wrong_retry' ? 'wrong_retry'
      : taskType === 'workbook' ? 'workbook'
      : 'general'
    const normalizedGeneratedExamId = generatedExamId && /^[0-9a-f-]{36}$/i.test(generatedExamId) ? generatedExamId : null

    // 错题重练上传：未传 studentId 时，从组卷记录自动关联（二维码只承载 task 定位）
    let resolvedStudentId = studentId
    if (!resolvedStudentId && normalizedGeneratedExamId) {
      const { rows } = await query(
        `SELECT student_id FROM ${TABLES.GENERATED_EXAMS} WHERE id = $1`,
        [normalizedGeneratedExamId]
      )
      if (rows.length > 0) resolvedStudentId = rows[0].student_id
    }
    if (!resolvedStudentId) {
      return res.status(400).json({ error: '缺少 studentId' })
    }

    const files = req.files
    if (!files || files.length === 0) {
      return res.status(400).json({ error: '没有上传文件' })
    }

    // Fix: multer may interpret UTF-8 filenames as Latin-1 (ISO-8859-1).
    // Decode each filename back to proper UTF-8 before processing.
    for (const file of files) {
      try {
        const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8')
        // Verify the decoded string is valid UTF-8 (round-trip check)
        if (Buffer.from(decoded, 'utf8').toString('utf8') === decoded) {
          file.originalname = decoded
        }
      } catch (e) {
        // If decoding fails, keep original filename
      }
    }

    const queue = await getTaskQueue()
    console.log(`[Upload Pipeline] 收到 ${files.length} 个文件, studentId=${resolvedStudentId}`)

    const uploadSummary = await uploadFilesWithRetry(files, resolvedStudentId, {
      maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
      onFileProgress: (filename, step, data) => {
        console.log(`[Upload Pipeline] [${filename}] ${step}: ${data.valid ? 'PASS' : 'FAIL'}`)
      },
    })

    const tasks = []
    const boundingBoxResults = []

    for (const result of uploadSummary.results) {
      if (result.success) {
        try {
          const safeUrl = typeof result.url === 'string' ? result.url : String(result.url)
          console.log(`  OSS 上传成功: ${result.filename} → ${safeUrl}`)

          const { rows } = await query(
            `INSERT INTO ${TABLES.TASKS} (student_id, image_url, original_name, status, result, task_type, generated_exam_id, worksheet_id, subject)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [resolvedStudentId, safeUrl, result.filename, TASK_STATUS.PENDING, JSON.stringify({ progress: 0 }), normalizedTaskType, normalizedGeneratedExamId, worksheetId || null, subject || null]
          )

          const savedTask = rows[0]
          console.log(`  DB 记录已创建: taskId=${savedTask.id}`)

          if (queue) {
            console.log(`   提交任务到 Redis 队列: taskId=${savedTask.id}`)
            try {
              const job = await queue.add('process-task', {
                taskId: savedTask.id,
                studentId: resolvedStudentId,
                imageUrl: safeUrl,
                originalName: result.filename,
                generatedExamId: normalizedGeneratedExamId,
                taskType: normalizedTaskType,
                worksheetId: worksheetId || null
              }, {
                attempts: parseInt(process.env.MAX_RETRIES) || 3,
                backoff: { type: 'exponential', delay: 5000 }
              })
              console.log(`  ? 任务已加入队列: jobId=${job.id}`)
            } catch (queueError) {
              // 队列提交失败时清理孤儿任务，避免 pending 任务堆积
              console.error(`  ? 队列提交失败，清理 DB 记录: taskId=${savedTask.id}`, queueError.message)
              query(`DELETE FROM ${TABLES.TASKS} WHERE id = $1`, [savedTask.id])
                .catch(e => console.error(`  ? 清理孤儿任务失败:`, e.message))
              throw queueError // 由外层 catch 统一处理
            }
          } else {
            console.log(`  ??  Redis 队列未连接，跳过队列提交`)
            // 兜底：直接同步调用 Worker 处理
            processTask({ data: { taskId: savedTask.id, studentId: resolvedStudentId, imageUrl: safeUrl, originalName: result.filename, generatedExamId: normalizedGeneratedExamId, taskType: normalizedTaskType, worksheetId: worksheetId || null } }).catch(e => console.error('  ? 同步处理失败: ' + e.message))
          }

          tasks.push(savedTask)
          boundingBoxResults.push({
            filename: result.filename,
            taskId: savedTask.id,
            status: 'queued',
            note: '等待队列处理后生成边界框',
          })
        } catch (dbError) {
          console.error(`? [Upload] 数据库创建任务失败 for ${result.filename}:`, dbError)
          tasks.push({
            error: true,
            originalName: result.filename,
            message: '数据库写入失败: ' + dbError.message,
            errorType: 'DB_ERROR'
          })
          boundingBoxResults.push({
            filename: result.filename,
            status: 'failed',
            error: dbError.message,
          })
          // 清理已上传的 OSS 文件（避免生成孤儿文件）
          try { const urlObj = new URL(result.url); const ossPath = urlObj.pathname.replace(/^\//, ''); await deleteFile(ossPath) } catch (e) { console.error('  OSS 清理失败:', e.message) }
        }
      } else {
        console.error(`? [Upload] 文件 ${result.filename} 上传失败: ${result.errorType} — ${result.error}`)
        tasks.push({
          error: true,
          originalName: result.filename,
          message: result.error || '上传失败',
          errorType: result.errorType || 'UPLOAD_FAILED',
          attempts: result.attempts.map(a => ({
            type: a.type,
            result: a.result,
            error: a.error,
            timestamp: a.timestamp,
          })),
        })
        boundingBoxResults.push({
          filename: result.filename,
          status: 'skipped',
          error: result.error,
          note: '上传失败，跳过边界框生成',
        })
      }
    }

    const report = createUploadReport(studentId, uploadSummary, boundingBoxResults)
    logUploadReport(report)

    res.json({
      success: true,
      count: tasks.filter(t => !t.error).length,
      failed: tasks.filter(t => t.error).length,
      reportId: report.id,
      tasks,
      summary: report.summary,
    })
  } catch (error) {
    console.error('上传处理失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Create task by URL
app.post('/api/tasks/create-by-url', async (req, res) => {
  try {
    const { studentId, imageUrl, originalName } = req.body
    if (!studentId || !imageUrl) {
      return res.status(400).json({ error: '缺少 studentId 或 imageUrl' })
    }

    const queue = await getTaskQueue()

    const { rows } = await query(
      `INSERT INTO ${TABLES.TASKS} (student_id, image_url, original_name, status, result)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [studentId, imageUrl, originalName || `试卷_${Date.now()}.jpg`, TASK_STATUS.PENDING, JSON.stringify({ progress: 0 })]
    )

    const savedTask = rows[0]

    if (queue) {
      await queue.add('process-task', {
        taskId: savedTask.id,
        studentId: studentId,
        imageUrl: imageUrl,
        originalName: savedTask.original_name
      }, {
        attempts: parseInt(process.env.MAX_RETRIES) || 3,
        backoff: { type: 'exponential', delay: 5000 }
      })
    }

    res.json({ success: true, task: savedTask })
  } catch (error) {
    console.error('创建任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── 通知摘要缓存（10 秒 TTL，减少轮询时的重复查询）──
let summaryCache = { data: null, timestamp: 0 }
const SUMMARY_TTL = 10000

// ─────────────────────────────────────────────
// 通知摘要（跨学生全局聚合）
// ─────────────────────────────────────────────
app.get('/api/tasks/summary', async (req, res) => {
  try {
    // 缓存命中且未过期
    const now = Date.now()
    if (summaryCache.data && (now - summaryCache.timestamp) < SUMMARY_TTL) {
      return res.json(summaryCache.data)
    }

    // 单次查询：用子查询合并 3 个 COUNT，避免 3 次 DB 往返
    const { rows } = await query(
      `SELECT
         COALESCE((SELECT COUNT(*)::int FROM ${TABLES.TASKS} WHERE status = $1 AND deleted_at IS NULL), 0) AS pending_review,
         COALESCE((SELECT COUNT(*)::int FROM ${TABLES.TASKS} WHERE status = $2 AND deleted_at IS NULL), 0) AS failed_tasks,
         COALESCE((SELECT COUNT(*)::int FROM ${TABLES.WRONG_QUESTIONS} WHERE lifecycle_status = $3 AND added_at::date = CURRENT_DATE), 0) AS today_new_wrong,
         (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
           SELECT t.id, t.original_name, t.status, t.created_at, t.updated_at, s.name AS student_name
           FROM ${TABLES.TASKS} t
           LEFT JOIN ${TABLES.STUDENTS} s ON s.id = t.student_id
           WHERE t.deleted_at IS NULL AND (t.status = $1 OR t.status = $2)
           ORDER BY t.updated_at DESC LIMIT 5
         ) t) AS recent_tasks`,
      [TASK_STATUS.DONE, 'failed', 'new']
    )

    const r = rows[0]
    const data = {
      success: true,
      summary: {
        pendingReview: r.pending_review,
        failedTasks: r.failed_tasks,
        todayNewWrongQuestions: r.today_new_wrong,
        totalNotifications: r.pending_review + r.failed_tasks,
        recentTasks: (r.recent_tasks || []).map(t => ({
          id: t.id,
          originalName: t.original_name,
          status: t.status,
          createdAt: t.created_at,
          studentName: t.student_name
        }))
      }
    }

    // 写入缓存
    summaryCache = { data, timestamp: now }

    res.json(data)
  } catch (error) {
    console.error('获取通知摘要失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get single task
app.get('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params
    const { rows } = await query(
      `SELECT * FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )

    if (rows.length === 0) return res.status(404).json({ error: '任务不存在' })

    res.json({ success: true, task: rows[0] })
  } catch (error) {
    console.error('获取任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get tasks by student
app.get('/api/tasks/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = parseInt(req.query.offset) || 0
    const { rows } = await query(
      `SELECT id, student_id, status, original_name, image_url, result,
              created_at, updated_at, task_type, worksheet_id, subject, generated_exam_id
       FROM ${TABLES.TASKS} WHERE student_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
    )
    res.json({ success: true, tasks: rows })
  } catch (error) {
    console.error('获取学生任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Update task (e.g., mark review as done)
app.put('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params
    const { status } = req.body
    const { rows } = await query(
      `UPDATE ${TABLES.TASKS} SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, taskId]
    )
    if (rows.length === 0) return res.status(404).json({ error: '任务不存在' })
    res.json({ success: true, task: rows[0] })
  } catch (error) {
    console.error('更新任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Retry task
app.post('/api/tasks/:taskId/retry', async (req, res) => {
  try {
    const { taskId } = req.params

    const { rows } = await query(
      `SELECT * FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )

    if (rows.length === 0) return res.status(404).json({ error: '任务不存在' })

    const task = rows[0]
    const queue = await getTaskQueue()

    await query(
      `UPDATE ${TABLES.TASKS} SET status = $1, result = $2, updated_at = NOW() WHERE id = $3`,
      [TASK_STATUS.PENDING, JSON.stringify({ progress: 0, retryCount: (task.result?.retryCount || 0) + 1, previousError: task.result?.error || null }), taskId]
    )

    if (queue) {
      await queue.add('process-task', {
        taskId: task.id,
        studentId: task.student_id,
        imageUrl: task.image_url,
        originalName: task.original_name
      }, {
        attempts: parseInt(process.env.MAX_RETRIES) || 3,
        backoff: { type: 'exponential', delay: 5000 }
      })
    }

    res.json({ success: true, message: '任务已重新提交' })
  } catch (error) {
    console.error('重试任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Recalculate task statistics from questions
app.post('/api/tasks/:taskId/recalculate-stats', async (req, res) => {
  try {
    const { taskId } = req.params

    const { rows } = await query(
      `SELECT is_correct, answer_source FROM ${TABLES.QUESTIONS} WHERE task_id = $1`,
      [taskId]
    )

    let questionCount = rows.length
    let wrongCount = 0
    let emptyCount = 0
    rows.forEach(q => {
      if (q.is_correct === false) wrongCount++
      if (q.answer_source === 'blank') emptyCount++
    })

    const { rows: taskRows } = await query(
      `UPDATE ${TABLES.TASKS}
       SET result = COALESCE(result, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify({ questionCount, wrongCount, emptyCount, progress: 100 }), taskId]
    )

    if (taskRows.length === 0) {
      return res.status(404).json({ error: '任务不存在' })
    }

    res.json({ success: true, result: taskRows[0].result })
  } catch (error) {
    console.error('重新计算任务统计失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Delete task - soft delete to preserve wrong questions
app.delete('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(taskId)) {
      return res.status(400).json({ error: '无效的任务ID' })
    }
    
    // Soft delete: set deleted_at instead of actual deletion
    // This preserves questions and wrong_questions associations
    await query(
      `UPDATE ${TABLES.TASKS} SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [taskId]
    )
    
    res.json({ success: true, message: '任务已删除（错题已保留）' })
  } catch (error) {
    console.error('删除任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Queue stats
app.get('/api/queue/stats', async (req, res) => {
  try {
    const stats = await getQueueStats()
    res.json({ success: true, stats })
  } catch (error) {
    console.error('获取队列统计失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Retry a pending/failed task
app.post('/api/tasks/retry', async (req, res) => {
  try {
    const { taskId, imageUrl, studentId, originalName } = req.body

    if (!taskId || !imageUrl || !studentId) {
      return res.status(400).json({ error: '缺少必要参数' })
    }

    // Update task status back to pending
    await query(
      `UPDATE ${TABLES.TASKS} SET status = 'pending', updated_at = NOW() WHERE id = $1`,
      [taskId]
    )

    // Re-add to queue
    const queue = await getTaskQueue()
    if (!queue) {
      return res.status(503).json({ error: '队列不可用，请检查 Redis 连接' })
    }

    await queue.add('process-task', {
      taskId,
      studentId,
      imageUrl,
      originalName: originalName || '重试任务',
      retryCount: 1
    }, {
      attempts: parseInt(process.env.MAX_RETRIES) || 3,
      backoff: { type: 'exponential', delay: 5000 }
    })

    console.log(`[API] 任务已重新加入队列: ${originalName || taskId}`)
    res.json({ success: true, message: '任务已重新加入队列' })
  } catch (error) {
    console.error('重试任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Diagnostics: Upload Reports
app.get('/api/diagnostics/upload-reports', async (req, res) => {
  try {
    const { getAllUploadReports, getUploadReport, getReportsByStudent } = await import('./services/uploadReportLogger.js')
    const { reportId, studentId } = req.query

    if (reportId) {
      const report = getUploadReport(reportId)
      return res.json({ success: true, report })
    }
    if (studentId) {
      const reports = getReportsByStudent(studentId)
      return res.json({ success: true, reports })
    }
    const reports = getAllUploadReports()
    res.json({ success: true, count: reports.length, reports })
  } catch (error) {
    console.error('获取上传报告诊断失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Diagnostics: Worker Status & System Health
app.get('/api/diagnostics/worker-status', async (req, res) => {
  try {
    const queue = await getTaskQueue()
    const stats = await getQueueStats()

    // Get failed jobs details
    let recentFailures = []
    let recentActive = []
    if (queue) {
      try {
        const failedJobs = await queue.getJobs(['failed'], 0, 4)
        recentFailures = failedJobs.map(j => ({
          jobId: j.id,
          taskId: j.data?.taskId,
          error: j.failedReason,
          failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
          attempts: j.attemptsMade
        }))
      } catch (e) {}

      try {
        const activeJobs = await queue.getJobs(['active'], 0, 4)
        recentActive = activeJobs.map(j => ({
          jobId: j.id,
          taskId: j.data?.taskId,
          progress: j.progress,
          startedAt: j.processedOn ? new Date(j.processedOn).toISOString() : null
        }))
      } catch (e) {}
    }

    // Check OSS config
    const ossConfigOk = !!(process.env.OSS_REGION && process.env.OSS_BUCKET && process.env.OSS_ACCESS_KEY_ID)

    // Check AI config
    const aiConfigOk = !!process.env.AI_API_KEY

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      worker: {
        available: !!queue,
        pid: process.pid
      },
      redis: {
        connected: stats.available || false,
        waiting: stats.waiting || 0,
        active: stats.active || 0,
        completed: stats.completed || 0,
        failed: stats.failed || 0,
        delayed: stats.delayed || 0
      },
      config: {
        oss: ossConfigOk,
        ai: aiConfigOk,
        neon: !!process.env.NEON_DATABASE_URL,
        redis: !!(process.env.REDIS_URL || process.env.REDIS_HOST)
      },
      jobs: {
        recentFailures,
        recentActive
      }
    })
  } catch (error) {
    console.error('诊断接口失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Students CRUD
app.post('/api/students', async (req, res) => {
    try {
      const { name, grade, avatar } = req.body
      if (!name) return res.status(400).json({ error: '缺少 name' })

      const { rows } = await query(
        `INSERT INTO ${TABLES.STUDENTS} (name, grade, avatar)
         VALUES ($1, $2, $3) RETURNING *`,
        [name, grade || '', avatar || '']
      )

      res.status(201).json({ success: true, student: rows[0] })
	      studentsCache = { data: null, timestamp: 0 } // 使缓存失效
    } catch (error) {
      console.error('创建学生失败:', error)
      res.status(500).json({ error: error.message })
    }
  })

// ── 学生列表缓存（5 分钟 TTL，学生列表变化极慢）──
let studentsCache = { data: null, timestamp: 0 }
const STUDENTS_TTL = 300000

app.get('/api/students', async (req, res) => {
  try {
    const now = Date.now()
    if (studentsCache.data && (now - studentsCache.timestamp) < STUDENTS_TTL) {
      return res.json(studentsCache.data)
    }
    const { rows } = await query(
      `SELECT id, name, grade, avatar, created_at FROM ${TABLES.STUDENTS} ORDER BY created_at DESC`
    )
    const data = { success: true, students: rows }
    studentsCache = { data, timestamp: now }
    res.json(data)
  } catch (error) {
    console.error('获取学生列表失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/students/:id', async (req, res) => {
    try {
      const { id } = req.params
      const { name, grade, avatar } = req.body

      const { rows } = await query(
        `UPDATE ${TABLES.STUDENTS}
         SET name = COALESCE($1, name),
             grade = COALESCE($2, grade),
             avatar = COALESCE($3, avatar),
             updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [name, grade, avatar, id]
      )

      if (rows.length === 0) return res.status(404).json({ error: '学生不存在' })

      res.json({ success: true, student: rows[0] })
      studentsCache = { data: null, timestamp: 0 } // 使缓存失效
    } catch (error) {
      console.error('更新学生失败:', error)
      res.status(500).json({ error: error.message })
    }
  })

app.delete('/api/students/:id', async (req, res) => {
  try {
    const { id } = req.params
    await query(`DELETE FROM ${TABLES.STUDENTS} WHERE id = $1`, [id])
    studentsCache = { data: null, timestamp: 0 } // 使缓存失效
    res.json({ success: true, message: '学生已删除' })
  } catch (error) {
    console.error('删除学生失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Questions CRUD
app.post('/api/questions', async (req, res) => {
  try {
    const { task_id, student_id, content, options, answer, status, question_type, subject, analysis, image_url, geometry_image_url } = req.body

    if (!task_id || !student_id || !content) {
      return res.status(400).json({ error: '缺少必要字段' })
    }

    const { rows } = await query(
      `INSERT INTO ${TABLES.QUESTIONS} (task_id, student_id, content, options, answer, status, question_type, subject, analysis, image_url, geometry_image_url, is_complete)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [task_id, student_id, content, JSON.stringify(options || []), answer || null, status || 'pending', question_type || 'answer', subject || '数学', analysis || '', image_url || null, geometry_image_url || null, checkQuestionCompleteness({ content, options, answer, question_type, geometry_image_url }).isComplete]
    )

    res.status(201).json({ success: true, question: rows[0] })
  } catch (error) {
    console.error('创建题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/questions/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { content, options, answer, analysis, status, question_type, subject, is_correct, student_answer, image_url, ai_answer, answer_source, geometry_image_url, review_status, display_image_type, source_type } = req.body
    const hasIsCorrect = 'is_correct' in req.body
    const hasAnswerSource = 'answer_source' in req.body && answer_source !== undefined
    const hasReviewStatus = 'review_status' in req.body
    const hasDisplayImageType = 'display_image_type' in req.body
    const hasSourceType = 'source_type' in req.body && source_type !== undefined

    // [P1-4b] is_correct 变更前读取旧值，用于 judgement 记录
    let oldIsCorrect = null
    if (hasIsCorrect) {
      const { rows: oldRows } = await query(
        `SELECT is_correct, task_id FROM ${TABLES.QUESTIONS} WHERE id = $1`,
        [id]
      )
      if (oldRows.length > 0) {
        oldIsCorrect = oldRows[0].is_correct
      }
    }

    // PostgreSQL pg 驱动无法推断 undefined 的类型，统一转 null
    const n = (v) => v === undefined ? null : v

    const { rows } = await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET content = COALESCE($1, content),
           options = COALESCE($2, options),
           answer = COALESCE($3, answer),
           analysis = COALESCE($4, analysis),
           status = COALESCE($5, status),
           question_type = COALESCE($6, question_type),
           subject = COALESCE($7, subject),
           is_correct = CASE WHEN $14 THEN $8::boolean ELSE is_correct END,
           student_answer = COALESCE($9, student_answer),
           image_url = COALESCE($10, image_url),
           ai_answer = COALESCE($11, ai_answer),
           answer_source = CASE WHEN $15 THEN $12::text ELSE answer_source END,
           geometry_image_url = COALESCE($16, geometry_image_url),
           review_status = CASE WHEN $17 THEN $18::text ELSE review_status END,
           display_image_type = CASE WHEN $20 THEN $19::text ELSE display_image_type END,
           source_type = CASE WHEN $21 THEN $22::text ELSE source_type END,
           updated_at = NOW()
       WHERE id = $13
       RETURNING *`,
      [n(content), n(options), n(answer), n(analysis), n(status), n(question_type), n(subject), n(is_correct), n(student_answer), n(image_url), n(ai_answer), n(answer_source), id, hasIsCorrect, hasAnswerSource, n(geometry_image_url), hasReviewStatus, n(review_status), n(display_image_type), hasDisplayImageType, hasSourceType, n(source_type)]
    )

    if (rows.length === 0) return res.status(404).json({ error: '题目不存在' })

    res.json({ success: true, question: rows[0] })

    // [cache_id] 如果题目关联了 question_cache 且更新了权威字段，同步写入缓存
    const updatedQuestion = rows[0]
    if (updatedQuestion.cache_id) {
      const canonicalFields = ['content', 'options', 'answer', 'analysis', 'question_type', 'subject']
      const hasCanonicalUpdate = canonicalFields.some(f => f in req.body)
      if (hasCanonicalUpdate) {
        const cacheUpdates = []
        const cacheParams = []
        let paramIdx = 1
        for (const field of canonicalFields) {
          if (field in req.body) {
            let val = req.body[field]
            if (val !== undefined) {
              // JSONB 字段需要序列化
              if (field === 'options') {
                val = JSON.stringify(val)
              }
              cacheUpdates.push(`${field} = $${paramIdx++}`)
              cacheParams.push(val)
            }
          }
        }
        if (cacheUpdates.length > 0) {
          cacheParams.push(updatedQuestion.cache_id)
          query(
            `UPDATE ${TABLES.QUESTION_CACHE}
             SET ${cacheUpdates.join(', ')}, updated_at = NOW()
             WHERE id = $${paramIdx}`,
            cacheParams
          ).catch(e => console.error(`[cache_id] 同步写入缓存失败 cache=${updatedQuestion.cache_id.substring(0, 8)}:`, e.message))
        }
      }
    }

    // [P1-4b] is_correct 变更时追加写入 PC 编辑判定记录
    if (hasIsCorrect && oldIsCorrect !== is_correct) {
      createJudgement({
        questionId: id,
        source: 'pc_edit',
        isCorrect: is_correct,
        metadata: { oldIsCorrect, editedFields: Object.keys(req.body).filter(k => k !== 'id') }
      }).catch(e => console.error('[Shadow] judgements写入失败 (pc_edit):', e.message))
    }

    // 重算 is_complete（非阻塞）
    ;(async () => {
      try {
        const { isComplete } = checkQuestionCompleteness(updatedQuestion)
        if (isComplete !== updatedQuestion.is_complete) {
          await query(
            `UPDATE ${TABLES.QUESTIONS} SET is_complete = $1, updated_at = NOW() WHERE id = $2`,
            [isComplete, id]
          )
        }
      } catch (e) {
        console.error(`is_complete 更新失败 q=${id.substring(0, 8)}:`, e.message)
      }
    })()
  } catch (error) {
    console.error('更新题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ─────────────────────────────────────────────
// 重批改（重新判定 is_correct）
// ─────────────────────────────────────────────
app.post('/api/questions/:id/rejudge', async (req, res) => {
  try {
    const { id } = req.params

    const { rows } = await query(
      `SELECT id, student_id, student_answer, answer, question_type, is_correct
       FROM ${TABLES.QUESTIONS} WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    )
    if (rows.length === 0) return res.status(404).json({ error: '题目不存在' })

    const q = rows[0]
    const { student_answer, answer, question_type, student_id, is_correct: oldIsCorrect } = q

    // Re-judge using pure logic (no AI)
    const { isCorrect } = judgeAnswer(student_answer, answer, question_type)

    // Update is_correct in questions table
    await query(
      `UPDATE ${TABLES.QUESTIONS} SET is_correct = $1, updated_at = NOW() WHERE id = $2`,
      [isCorrect, id]
    )

    // Write judgement record
    createJudgement({
      questionId: id,
      studentId: student_id,
      source: 'pc_rejudge',
      isCorrect,
      answer,
      studentAnswer: student_answer,
      metadata: { oldIsCorrect, questionType: question_type }
    }).catch(e => console.error('[Shadow] judgements写入失败 (pc_rejudge):', e.message))

    // Sync wrong_questions table
    if (student_id && answer && answer.trim() !== '') {
      if (isCorrect === false) {
        // 完整性检查 — 不完整的题目不进错题本
        const { rows: qRows } = await query(
          `SELECT content, geometry_image_url, question_type, options, answer
           FROM ${TABLES.QUESTIONS} WHERE id = $1`,
          [id]
        )
        if (qRows.length > 0) {
          const { isComplete, issues } = checkQuestionCompleteness(qRows[0])
          if (!isComplete) {
            console.log(`  ⚠️ [rejudge] 题目不完整，未加入错题本: ${issues.join('; ')} (q=${id.substring(0, 8)})`)
            return res.json({
              success: true,
              is_correct: isCorrect,
              warning: `题目不完整，未加入错题本: ${issues.join('; ')}`
            })
          }
        }
        // Wrong answer — ensure it's in the wrong book
        const { rows: existing } = await query(
          `SELECT id FROM ${TABLES.WRONG_QUESTIONS}
           WHERE student_id = $1 AND question_id = $2`,
          [student_id, id]
        )
        if (existing.length === 0) {
          await query(
            `INSERT INTO ${TABLES.WRONG_QUESTIONS}
             (student_id, question_id, status, error_count, added_at, last_wrong_at, created_at)
             VALUES ($1, $2, 'pending', 1, NOW(), NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            [student_id, id]
          )
        }
      } else if (isCorrect === true) {
        // Now correct — mark as mastered in wrong book if exists
        await query(
          `UPDATE ${TABLES.WRONG_QUESTIONS}
           SET status = 'mastered', mastered_at = NOW(), updated_at = NOW()
           WHERE student_id = $1 AND question_id = $2 AND status != 'mastered'`,
          [student_id, id]
        )
      }
    }

    res.json({ success: true, is_correct: isCorrect })
  } catch (error) {
    console.error('重批改失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/questions/batch-update-tags', async (req, res) => {
  try {
    const { updates } = req.body
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ error: '缺少 updates 数组' })
    }

    const results = await batchUpdateQuestionTags(updates)
    res.json({ success: true, updated: results.length })
  } catch (error) {
    console.error('批量更新标签失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/questions/batch', async (req, res) => {
  try {
    const { ids, studentId } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.json({ success: true, questions: [] })
    }

    // 过滤掉无效的 UUID（防止 PostgreSQL 报错 "invalid input syntax for type uuid"）
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const validIds = ids.filter(id => uuidRegex.test(id))
    if (validIds.length === 0) {
      return res.json({ success: true, questions: [] })
    }

    const placeholders = validIds.map((_, i) => `$${i + 1}`).join(',')
    let queryStr = `SELECT q.*,
      qc.content AS _cache_content,
      qc.options AS _cache_options,
      qc.answer AS _cache_answer,
      qc.analysis AS _cache_analysis,
      qc.ai_tags AS _cache_ai_tags`
    // 当提供 studentId 时，LEFT JOIN wrong_questions 带出掌握度信息
    if (studentId) {
      queryStr += `, wq.error_count, wq.lifecycle_status, wq.status AS wq_status`
    }
    queryStr += ` FROM ${TABLES.QUESTIONS} q
       LEFT JOIN ${TABLES.QUESTION_CACHE} qc ON q.cache_id = qc.id`
    if (studentId) {
      queryStr += ` LEFT JOIN ${TABLES.WRONG_QUESTIONS} wq ON wq.question_id = q.id AND wq.student_id = $${validIds.length + 1}`
    }
    queryStr += ` WHERE q.id IN (${placeholders})`

    const params = studentId ? [...validIds, studentId] : validIds
    const { rows } = await query(queryStr, params)

    const merged = rows.map(q => ({
      ...q,
      content: q.content || q._cache_content,
      options: q.options || q._cache_options,
      answer: q.answer || q._cache_answer,
      analysis: q.analysis || q._cache_analysis,
      ai_tags: q.ai_tags || q._cache_ai_tags
    }))
    for (const qq of merged) {
      delete qq._cache_content
      delete qq._cache_options
      delete qq._cache_answer
      delete qq._cache_analysis
      delete qq._cache_ai_tags
    }

    // 关键修复：PostgreSQL 的 `WHERE id IN (...)` 不保证返回顺序与输入顺序一致，
    // 且移动端（不带 studentId，无 JOIN）与 PC 后台（带 studentId，含 LEFT JOIN）
    // 的查询计划不同，会导致同一套卷子的题目在两端以不同顺序展现（重大 BUG）。
    // 这里按输入 question_ids 的顺序重新排序，确保两端完全一致。
    const orderMap = new Map(validIds.map((id, idx) => [id, idx]))
    merged.sort((a, b) => {
      const ia = orderMap.has(a.id) ? orderMap.get(a.id) : Number.MAX_SAFE_INTEGER
      const ib = orderMap.has(b.id) ? orderMap.get(b.id) : Number.MAX_SAFE_INTEGER
      return ia - ib
    })

    res.json({ success: true, questions: merged })
  } catch (error) {
    console.error('批量获取题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get questions by task ID
app.get('/api/questions/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params
    const { rows } = await query(
      `SELECT q.*,
              qc.content AS _cache_content,
              qc.options AS _cache_options,
              qc.answer AS _cache_answer,
              qc.analysis AS _cache_analysis,
              qc.question_type AS _cache_question_type,
              qc.subject AS _cache_subject,
              qc.ai_tags AS _cache_ai_tags
       FROM ${TABLES.QUESTIONS} q
       LEFT JOIN ${TABLES.QUESTION_CACHE} qc ON q.cache_id = qc.id
       WHERE q.task_id = $1
       ORDER BY COALESCE((q.block_coordinates->>'y')::float, 99999), q.created_at`,
      [taskId]
    )
    // JS 层做 COALESCE：cache 字段优先于 question 自身字段
    const merged = rows.map(q => ({
      ...q,
      content: q.content ?? q._cache_content,
      options: q.options ?? q._cache_options,
      answer: q.answer || q._cache_answer,
      analysis: q.analysis ?? q._cache_analysis,
      question_type: q.question_type ?? q._cache_question_type,
      subject: q.subject ?? q._cache_subject,
      ai_tags: q.ai_tags ?? q._cache_ai_tags
    }))
    // 移除 _cache_ 前缀的临时字段
    for (const qq of merged) {
      delete qq._cache_content
      delete qq._cache_options
      delete qq._cache_answer
      delete qq._cache_analysis
      delete qq._cache_question_type
      delete qq._cache_subject
      delete qq._cache_ai_tags
    }
    res.json({ success: true, questions: merged })
  } catch (error) {
    console.error('获取任务题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Question search & filter
app.get('/api/questions/search', async (req, res) => {
  try {
    const {
      keyword = '',
      subject = '',
      question_type = '',
      is_correct = '',
      status = '',
      student_id = '',
      limit = '30',
      offset = '0'
    } = req.query

    const conditions = []
    const params = []
    let idx = 1

    // keyword: search across content, answer, analysis (both q and qc)
    if (keyword.trim()) {
      const kw = `%${keyword.trim()}%`
      conditions.push(`(q.content ILIKE $${idx} OR qc.content ILIKE $${idx} OR qc.answer ILIKE $${idx} OR qc.analysis ILIKE $${idx})`)
      params.push(kw)
      idx++
    }

    if (subject) {
      conditions.push(`q.subject = $${idx}`)
      params.push(subject)
      idx++
    }

    if (question_type) {
      conditions.push(`q.question_type = $${idx}`)
      params.push(question_type)
      idx++
    }

    if (is_correct === 'true' || is_correct === 'false') {
      conditions.push(`q.is_correct = $${idx}`)
      params.push(is_correct === 'true')
      idx++
    }

    if (status) {
      conditions.push(`q.status = $${idx}`)
      params.push(status)
      idx++
    }

    if (student_id) {
      conditions.push(`q.student_id = $${idx}`)
      params.push(student_id)
      idx++
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM ${TABLES.QUESTIONS} q
       LEFT JOIN ${TABLES.QUESTION_CACHE} qc ON q.cache_id = qc.id
       ${whereClause}`,
      params
    )
    const total = parseInt(countResult.rows[0]?.total || '0', 10)

    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 200)
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0)

    params.push(limitNum)
    const limitIdx = idx++
    params.push(offsetNum)
    const offsetIdx = idx++

    const { rows } = await query(
      `SELECT q.*,
              qc.content AS _cache_content,
              qc.options AS _cache_options,
              qc.answer AS _cache_answer,
              qc.analysis AS _cache_analysis,
              qc.ai_tags AS _cache_ai_tags
       FROM ${TABLES.QUESTIONS} q
       LEFT JOIN ${TABLES.QUESTION_CACHE} qc ON q.cache_id = qc.id
       ${whereClause}
       ORDER BY q.updated_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    )

    const merged = rows.map(q => ({
      ...q,
      content: q.content ?? q._cache_content,
      options: q.options ?? q._cache_options,
      answer: q.answer || q._cache_answer,
      analysis: q.analysis || q._cache_analysis,
      ai_tags: q.ai_tags || q._cache_ai_tags
    }))
    for (const qq of merged) {
      delete qq._cache_content
      delete qq._cache_options
      delete qq._cache_answer
      delete qq._cache_analysis
      delete qq._cache_ai_tags
    }

    res.json({ success: true, questions: merged, total, limit: limitNum, offset: offsetNum })
  } catch (error) {
    console.error('题目搜索失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── question_assets API ──

/**
 * GET /api/questions/:questionId/assets
 * 获取指定题目的所有资源（几何图、图表等）
 */
app.get('/api/questions/:questionId/assets', async (req, res) => {
  try {
    const { questionId } = req.params
    const { type } = req.query
    let assets
    if (type) {
      assets = await getQuestionAssetsByType(questionId, type)
    } else {
      assets = await getQuestionAssets(questionId)
    }
    res.json({ success: true, assets })
  } catch (error) {
    console.error('获取题目资源失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// [P1-4a] 批量查询每道题的最新 judgement
app.post('/api/judgements/latest', async (req, res) => {
  try {
    const { studentId, questionIds } = req.body
    if (!studentId || !questionIds || !Array.isArray(questionIds) || questionIds.length === 0) {
      return res.json({ success: true, judgements: [] })
    }

    const placeholders = questionIds.map((_, i) => `$${i + 2}`).join(',')
    const { rows } = await query(
      `SELECT DISTINCT ON (question_id) *
       FROM ${TABLES.JUDGEMENTS}
       WHERE student_id = $1 AND question_id IN (${placeholders})
       ORDER BY question_id, created_at DESC`,
      [studentId, ...questionIds]
    )

    res.json({ success: true, judgements: rows })
  } catch (error) {
    console.error('获取最新判定记录失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Wrong Questions
app.post('/api/wrong-questions', async (req, res) => {
  try {
    const { studentId, questionIds } = req.body
    if (!studentId || !questionIds || !Array.isArray(questionIds)) {
      return res.status(400).json({ error: '缺少 studentId 或 questionIds' })
    }

    const existingRows = await query(
      `SELECT question_id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = ANY($2)`,
      [studentId, questionIds]
    )
    const existingIds = new Set(existingRows.rows.map(r => r.question_id))
    const newIds = questionIds.filter(id => !existingIds.has(id))

    if (newIds.length === 0) {
      return res.json({ success: true, added: [], message: '全部已存在' })
    }

    // 完整性检查 — 过滤不完整题目
    const { rows: qRows } = await query(
      `SELECT id, content, geometry_image_url, question_type, options, answer FROM ${TABLES.QUESTIONS} WHERE id = ANY($1)`,
      [newIds]
    )
    const qMap = new Map(qRows.map(r => [r.id, r]))
    const skippedIds = []
    const validIds = newIds.filter(id => {
      const q = qMap.get(id)
      if (!q) return false
      const { isComplete } = checkQuestionCompleteness(q)
      if (!isComplete) skippedIds.push(id)
      return isComplete
    })
    if (skippedIds.length > 0) {
      console.log(`  ⚠️ [manual-add] ${skippedIds.length} 道题不完整，已跳过: ${skippedIds.join(', ')}`)
    }
    if (validIds.length === 0) {
      return res.json({ success: true, added: [], skipped: skippedIds, message: '所有题目均不完整' })
    }

    const values = validIds.map((id, i) => `($1, $${i + 2})`).join(',')
    const params = [studentId, ...newIds]

    await query(
      `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      params
    )

    res.json({ success: true, added: validIds, skipped: skippedIds })
    // [Shadow Mode] 追加写入人工添加错题判定记录
    for (const qId of validIds) {
      createJudgement({
        questionId: qId,
        studentId: studentId,
        source: 'manual_review',
        isCorrect: false,
        metadata: { action: 'manual_add_to_wrong_book' }
      }).catch(e => console.error('[Shadow] judgements写入失败 (人工加错题):', e.message))
    }
  } catch (error) {
    console.error('添加错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/wrong-questions/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const limit = Math.min(parseInt(req.query.limit) || 100, 500)
    const offset = parseInt(req.query.offset) || 0
    const { rows } = await query(
      `SELECT wq.* FROM ${TABLES.WRONG_QUESTIONS} wq
       INNER JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id AND q.is_complete = TRUE
       WHERE wq.student_id = $1 ORDER BY wq.added_at DESC LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
    )
    res.json({ success: true, wrongQuestions: rows })
  } catch (error) {
    console.error('获取错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// [P0-2a] 按 (student_id, question_id) upsert，修复扫码批改 ID 错配
app.put('/api/wrong-questions/upsert', async (req, res) => {
  try {
    const { studentId, questionId, status, lifecycleStatus, isCorrect } = req.body
    if (!studentId || !questionId) {
      return res.status(400).json({ error: '缺少 studentId 或 questionId' })
    }

    // 完整性检查 — 不完整的题目不能添加/更新错题本
    const { rows: qRows } = await query(
      `SELECT content, geometry_image_url, question_type, options, answer FROM ${TABLES.QUESTIONS} WHERE id = $1`,
      [questionId]
    )
    if (qRows.length > 0) {
      const { isComplete, issues } = checkQuestionCompleteness(qRows[0])
      if (!isComplete) {
        return res.status(422).json({ error: '题目不完整', issues })
      }
    }

    // 查找已有记录（按 student_id + question_id 唯一约束）
    let { rows } = await query(
      `SELECT id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = $2`,
      [studentId, questionId]
    )

    let wqId
    if (rows.length === 0) {
      const { rows: inserted } = await query(
        `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id, status, error_count, practice_count, added_at, last_wrong_at, created_at, updated_at)
         VALUES ($1, $2, 'pending', 1, 1, NOW(), NOW(), NOW(), NOW())
         RETURNING id`,
        [studentId, questionId]
      )
      wqId = inserted[0].id
    } else {
      wqId = rows[0].id
      // 现有记录：递增 practice_count
      await query(
        `UPDATE ${TABLES.WRONG_QUESTIONS} SET practice_count = practice_count + 1, updated_at = NOW() WHERE id = $1`,
        [wqId]
      )
    }

    // 动态构建 UPDATE SET（状态/生命周期）
    const setClauses = ["updated_at = NOW()"]
    const params = []
    if (status) { params.push(status); setClauses.push(`status = $${params.length}`) }
    if (lifecycleStatus) { params.push(lifecycleStatus); setClauses.push(`lifecycle_status = $${params.length}`) }

    if (setClauses.length > 1) {
      params.push(wqId)
      await query(
        `UPDATE ${TABLES.WRONG_QUESTIONS} SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
        params
      )
    }

    // 同步更新 questions 表的 is_correct
    if (isCorrect !== undefined) {
      await query(
        `UPDATE ${TABLES.QUESTIONS} SET is_correct = $1, updated_at = NOW() WHERE id = $2`,
        [isCorrect, questionId]
      )
    }

    // [Shadow Mode] 追加写入人工复审判定记录
    createJudgement({
      questionId,
      studentId,
      source: 'manual_review',
      isCorrect: isCorrect ?? null,
      metadata: { status, lifecycleStatus, wrongQuestionId: wqId }
    }).catch(e => console.error('[Shadow] judgements写入失败 (upsert):', e.message))

    res.json({ success: true, wrongQuestionId: wqId })
  } catch (error) {
    console.error('Upsert错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 批量 upsert 错题状态（Phase 1 优化）
app.put('/api/wrong-questions/batch-upsert', async (req, res) => {
  try {
    const { studentId, results } = req.body

    if (!studentId || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: '缺少 studentId 或 results 数组' })
    }

    const successIds = []
    const failures = []

    // 批量处理每个题目
    for (const result of results) {
      const { questionId, status, isCorrect } = result

      if (!questionId) {
        failures.push({ questionId, error: '缺少 questionId' })
        continue
      }

      try {
        // 查找已有记录
        let { rows } = await query(
          `SELECT id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = $2`,
          [studentId, questionId]
        )

        let wqId
        if (rows.length === 0) {
          // 创建新记录
          const { rows: inserted } = await query(
            `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id, status, error_count, practice_count, added_at, last_wrong_at, created_at, updated_at)
             VALUES ($1, $2, $3, 1, 1, NOW(), NOW(), NOW(), NOW())
             RETURNING id`,
            [studentId, questionId, status || 'pending']
          )
          wqId = inserted[0].id
        } else {
          wqId = rows[0].id
          // 更新现有记录
          await query(
            `UPDATE ${TABLES.WRONG_QUESTIONS}
             SET status = $1, practice_count = practice_count + 1, updated_at = NOW()
             WHERE id = $2`,
            [status || 'pending', wqId]
          )
        }

        // 同步更新 questions 表的 is_correct
        if (isCorrect !== undefined) {
          await query(
            `UPDATE ${TABLES.QUESTIONS} SET is_correct = $1, updated_at = NOW() WHERE id = $2`,
            [isCorrect, questionId]
          )
        }

        // [Shadow Mode] 追加写入人工复审判定记录
        createJudgement({
          questionId,
          studentId,
          source: 'manual_review',
          isCorrect: isCorrect ?? null,
          metadata: { status, wrongQuestionId: wqId, batchUpsert: true }
        }).catch(e => console.error('[Shadow] judgements写入失败 (batch-upsert):', e.message))

        successIds.push(questionId)
      } catch (error) {
        console.error(`批量处理失败 questionId=${questionId}:`, error.message)
        failures.push({ questionId, error: error.message })
      }
    }

    res.json({
      success: true,
      total: results.length,
      successCount: successIds.length,
      failureCount: failures.length,
      successIds,
      failures
    })
  } catch (error) {
    console.error('批量Upsert错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/wrong-questions/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { status, lifecycle_status, student_answer } = req.body

    // 动态构建 SET 子句
    const setClauses = ["updated_at = NOW()"]
    const params = []
    if (status) { params.push(status); setClauses.push(`status = $${params.length}`) }
    if (lifecycle_status) { params.push(lifecycle_status); setClauses.push(`lifecycle_status = $${params.length}`) }
    if (student_answer) { params.push(student_answer); setClauses.push(`student_answer = $${params.length}`) }

    if (setClauses.length > 1) {
      params.push(id)
      await query(
        `UPDATE ${TABLES.WRONG_QUESTIONS} SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
        params
      )
    }

    res.json({ success: true, message: '状态已更新' })

    // [Shadow Mode] 追加写入人工复审判定记录（错题状态变更）
    createJudgement({
      questionId: id,
      source: 'manual_review',
      metadata: { updatedStatus: status, wrongQuestionId: id }
    }).catch(e => console.error('[Shadow] judgements写入失败 (人工复审):', e.message))

  } catch (error) {
    console.error('更新错题状态失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/wrong-questions/:id', async (req, res) => {
  try {
    const { id } = req.params
    await query(`DELETE FROM ${TABLES.WRONG_QUESTIONS} WHERE id = $1`, [id])
    res.json({ success: true, message: '错题已移出' })
  } catch (error) {
    console.error('删除错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Generated Exams
app.post('/api/generated-exams', async (req, res) => {
  try {
    const { studentId, name, questionIds } = req.body
    if (!studentId || !name || !questionIds || !Array.isArray(questionIds)) {
      return res.status(400).json({ error: '缺少 studentId、name 或 questionIds' })
    }

    const { rows } = await query(
      `INSERT INTO ${TABLES.GENERATED_EXAMS} (student_id, name, question_ids)
       VALUES ($1, $2, $3) RETURNING *`,
      [studentId, name, JSON.stringify(questionIds)]
    )

    res.status(201).json({ success: true, exam: rows[0] })
  } catch (error) {
    console.error('创建错题卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/generated-exams/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = parseInt(req.query.offset) || 0
    const { rows } = await query(
      `SELECT id, student_id, name, question_ids, status, retry_task_id, created_at, updated_at
       FROM ${TABLES.GENERATED_EXAMS} WHERE student_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
    )

    // 批量计算所有试卷的统计（1 次查询替代 N 次 per-exam 查询）
    const allQIds = [...new Set(rows.flatMap(e => e.question_ids || []))]
    const qCorrectMap = new Map()
    if (allQIds.length > 0) {
      const placeholders = allQIds.map((_, i) => `$${i + 1}`).join(',')
      const { rows: qRows } = await query(
        `SELECT id, is_correct, answer_source FROM ${TABLES.QUESTIONS} WHERE id IN (${placeholders})`,
        allQIds
      )
      for (const q of qRows) {
        qCorrectMap.set(q.id, { is_correct: q.is_correct, answer_source: q.answer_source })
      }
    }

    const examsWithStats = rows.map(exam => {
      const qIds = exam.question_ids || []
      let correct_count = 0, wrong_count = 0, not_answered_count = 0
      for (const qid of qIds) {
        const info = qCorrectMap.get(qid)
        if (!info || info.is_correct === null || info.answer_source === 'blank') not_answered_count++
        else if (info.is_correct === true) correct_count++
        else wrong_count++
      }
      return { ...exam, correct_count, wrong_count, not_answered_count, excluded_count: 0, total_count: qIds.length }
    })

    res.json({ success: true, generatedExams: examsWithStats })
  } catch (error) {
    console.error('获取错题卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 按 ID 查询单个组卷（扫码批改：二维码只含组卷ID，扫码后拉取详情）
app.get('/api/generated-exams/:id', async (req, res) => {
  try {
    const { id } = req.params
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: '无效的试卷ID' })
    }
    const { rows } = await query(
      `SELECT e.*, s.name AS student_name
       FROM ${TABLES.GENERATED_EXAMS} e
       LEFT JOIN ${TABLES.STUDENTS} s ON s.id = e.student_id
       WHERE e.id = $1`,
      [id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: '试卷不存在' })
    }
    res.json({ success: true, exam: rows[0] })
  } catch (error) {
    console.error('获取组卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/generated-exams/:id', async (req, res) => {
  try {
    const { id } = req.params
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: '无效的试卷ID' })
    }
    await query(`DELETE FROM ${TABLES.GENERATED_EXAMS} WHERE id = $1`, [id])
    res.json({ success: true, message: '错题卷已删除' })
  } catch (error) {
    console.error('删除错题卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 标记错题卷为已批改
app.put('/api/generated-exams/:id/graded', async (req, res) => {
  try {
    const { id } = req.params
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: '无效的试卷ID' })
    }
    await query(
      `UPDATE ${TABLES.GENERATED_EXAMS} SET status = 'graded', updated_at = NOW() WHERE id = $1`,
      [id]
    )
    res.json({ success: true, message: '错题卷已标记为已批改' })
  } catch (error) {
    console.error('标记错题卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ===== 错题重练任务入口（二维码 = /retry-task/:id） =====
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 错题重练任务详情（入口页拉取）：学生/名称/题数/状态 + 关联批改任务状态
app.get('/api/retry-tasks/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (!UUID_RE.test(id)) return res.status(400).json({ error: '无效的任务ID' })
    const { rows } = await query(
      `SELECT e.*, s.name AS student_name
       FROM ${TABLES.GENERATED_EXAMS} e
       LEFT JOIN ${TABLES.STUDENTS} s ON s.id = e.student_id
       WHERE e.id = $1`,
      [id]
    )
    if (rows.length === 0) return res.status(404).json({ error: '任务不存在' })
    const exam = rows[0]
    let gradingTask = null
    if (exam.retry_task_id) {
      const { rows: tRows } = await query(
        `SELECT id, status, result, image_url, original_name, created_at FROM ${TABLES.TASKS} WHERE id = $1`,
        [exam.retry_task_id]
      )
      if (tRows.length) gradingTask = tRows[0]
    }
    res.json({ success: true, task: { ...exam, gradingTask } })
  } catch (error) {
    console.error('获取错题重练任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 关联 AI 批改任务 + 置 grading（上传答卷照片后调用）
app.patch('/api/retry-tasks/:id/link', async (req, res) => {
  try {
    const { id } = req.params
    const { retryTaskId } = req.body || {}
    if (!UUID_RE.test(id)) return res.status(400).json({ error: '无效的任务ID' })
    if (!retryTaskId || !UUID_RE.test(retryTaskId)) {
      return res.status(400).json({ error: '无效的批改任务ID' })
    }
    await query(
      `UPDATE ${TABLES.GENERATED_EXAMS}
       SET retry_task_id = $1, status = 'grading', updated_at = NOW()
       WHERE id = $2`,
      [retryTaskId, id]
    )
    res.json({ success: true, message: '已关联批改任务' })
  } catch (error) {
    console.error('关联错题重练任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 批改组卷试卷（含掌握度进阶逻辑）
app.post('/api/generated-exams/:id/grade', async (req, res) => {
  try {
    const { id } = req.params
    const { studentId, results } = req.body

    if (!studentId || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: '缺少 studentId 或 results 数组' })
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: '无效的试卷ID' })
    }

    // 掌握度进阶：new → review_1 → review_2 → mastered
    const getNextLifecycle = (current) => {
      switch (current) {
        case LIFECYCLE_STATUS.NEW: return LIFECYCLE_STATUS.REVIEW_1
        case LIFECYCLE_STATUS.REVIEW_1: return LIFECYCLE_STATUS.REVIEW_2
        case LIFECYCLE_STATUS.REVIEW_2: return LIFECYCLE_STATUS.MASTERED
        default: return LIFECYCLE_STATUS.REVIEW_1
      }
    }

    const lifecycleChanges = []
    let masteredCount = 0
    let upgradedCount = 0
    let resetCount = 0

    // ── 批量获取现有 wrong_questions 记录，只需 1 次查询 ──
    const questionIds = results.map(r => r.questionId).filter(Boolean)
    const { rows: existingWqRows } = await query(
      `SELECT id, question_id, lifecycle_status, error_count FROM ${TABLES.WRONG_QUESTIONS}
       WHERE student_id = $1 AND question_id = ANY($2::uuid[])`,
      [studentId, questionIds]
    )
    const wqByQuestionId = new Map()
    for (const row of existingWqRows) {
      wqByQuestionId.set(row.question_id, row)
    }

    // ── 批量计算并构建 INSERT / UPDATE 参数 ──
    const insertRows = [] // 需要 INSERT 的新记录
    const updateWqRows = [] // 需要 UPDATE 的现有记录（按 id）
    const updateQIds = [] // 需要更新 questions.is_correct
    const updateQValues = []

    for (const result of results) {
      const { questionId, isCorrect } = result
      if (!questionId) continue

      const existing = wqByQuestionId.get(questionId)
      const currentLifecycle = existing ? (existing.lifecycle_status || 'new') : 'new'
      let newLifecycle
      let errorCountDelta = 0

      if (isCorrect) {
        newLifecycle = getNextLifecycle(currentLifecycle)
        if (newLifecycle === LIFECYCLE_STATUS.MASTERED && currentLifecycle !== LIFECYCLE_STATUS.MASTERED) {
          masteredCount++
        } else if (newLifecycle !== currentLifecycle) {
          upgradedCount++
        }
      } else {
        newLifecycle = LIFECYCLE_STATUS.NEW
        errorCountDelta = 1
        if (currentLifecycle !== LIFECYCLE_STATUS.NEW) {
          resetCount++
        }
      }

      const newStatus = newLifecycle === LIFECYCLE_STATUS.MASTERED ? WRONG_STATUS.MASTERED : WRONG_STATUS.PENDING

      if (!existing) {
        insertRows.push({ studentId, questionId, newStatus, newLifecycle, isCorrect })
      } else {
        updateWqRows.push({ wqId: existing.id, currentErrorCount: existing.error_count || 1, newStatus, newLifecycle, errorCountDelta })
      }

      updateQIds.push(questionId)
      updateQValues.push(isCorrect ? true : false)

      lifecycleChanges.push({
        questionId,
        previous: currentLifecycle,
        current: newLifecycle
      })
    }

    // ── 批量 INSERT 新 wrong_questions ──
    if (insertRows.length > 0) {
      const insertPlaceholders = insertRows.map((_, i) => {
        const base = i * 7
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
      }).join(', ')
      const insertParams = insertRows.flatMap(r => [
        r.studentId, r.questionId, r.newStatus, r.newLifecycle,
        r.isCorrect ? 0 : 1, new Date().toISOString(), new Date().toISOString()
      ])
      await query(
        `INSERT INTO ${TABLES.WRONG_QUESTIONS}
         (student_id, question_id, status, lifecycle_status, error_count, created_at, updated_at)
         VALUES ${insertPlaceholders}`,
        insertParams
      )
    }

    // ── 批量 UPDATE 现有 wrong_questions ──
    for (const wq of updateWqRows) {
      await query(
        `UPDATE ${TABLES.WRONG_QUESTIONS}
         SET status = $1, lifecycle_status = $2, error_count = $3, practice_count = practice_count + 1, updated_at = NOW()
         WHERE id = $4`,
        [wq.newStatus, wq.newLifecycle, wq.currentErrorCount + wq.errorCountDelta, wq.wqId]
      )
    }

    // ── 批量 UPDATE questions.is_correct（1 条 SQL 替代 N 条）──
    if (updateQIds.length > 0) {
      const caseClauses = updateQIds.map((_, i) =>
        `WHEN $${i * 2 + 1}::uuid THEN $${i * 2 + 2}`
      ).join(' ')
      const caseParams = updateQIds.flatMap((id, i) => [id, updateQValues[i]])
      // 参数索引靠后，补 PARAMS_OFFSET
      const idsParamIdx = caseParams.length + 1
      await query(
        `UPDATE ${TABLES.QUESTIONS} SET is_correct = CASE id ${caseClauses} END, updated_at = NOW()
         WHERE id = ANY($${idsParamIdx}::uuid[])`,
        [...caseParams, updateQIds]
      )
    }

    // 标记组卷为已批改
    await query(
      `UPDATE ${TABLES.GENERATED_EXAMS} SET status = 'graded', updated_at = NOW() WHERE id = $1`,
      [id]
    )

    res.json({
      success: true,
      stats: {
        total: results.length,
        masteredCount,
        upgradedCount,
        resetCount
      },
      lifecycleChanges
    })
  } catch (error) {
    console.error('组卷批改失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Error handler
app.use((err, req, res, next) => {
  console.error('服务器错误:', err)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件大小超过限制（最大20MB）' })
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: '文件数量超过限制（最多20个）' })
    }
  }
  res.status(500).json({ error: err.message || '服务器内部错误' })
})

// 知识点标签回填：为所有已有题目重新生成 AI 知识点标签
let backfillRunning = false
let backfillProgress = { total: 0, updated: 0, skipped: 0, failed: 0, done: false, detail: '', remaining: null }

// 筛选"缺知识点标签 或 缺难度 或 仅有本地占位"的题目 —— select 与 count 共用，避免两处漂移。
// tags_source='local'：上传热路径用本地规则分类打的占位（tags 可能是「未分类」、difficulty 恒为 3），
// 需由定时 LLM 回填修正；修正成功后 tags_source 被写为 'ai'，自然不再被重复捞取。
const BACKFILL_WHERE = `q.is_complete = TRUE
         AND (
           q.ai_tags IS NULL
           OR q.ai_tags = ''
           OR q.ai_tags = '[]'
           OR q.ai_tags::text = '["未分类"]'
           OR q.difficulty IS NULL
           OR q.tags_source = 'local'
         )`

/** 把题目 options 归一化成字符串数组：兼容数组 / JSON字符串 / 对象 / null */
function normalizeOptionsToArray(raw) {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return []
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) return parsed
      if (parsed && typeof parsed === 'object') return Object.values(parsed)
      return [String(parsed)]
    } catch {
      return [s]
    }
  }
  if (typeof raw === 'object') return Object.values(raw)
  return [String(raw)]
}

/** 统计当前仍待回填的题目总数（全局，跨批次） */
async function countBackfillRemaining() {  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM ${TABLES.QUESTIONS} q WHERE ${BACKFILL_WHERE}`
  )
  return rows[0]?.n ?? 0
}

/**
 * 回填核心逻辑（小批量）：每次只捞 limit 道「缺标签 或 缺难度」的题目，逐题重生成并写回。
 * free 实例内存/CPU 有限，单批控制在 ~20 题 / 20 余秒内结束，避免长任务被 OOM/spin-down 腰斩。
 * chain=true 时，一批跑完若仍有剩余，自动延时触发下一批，直到全部补齐。
 * @param {{limit?:number, trigger?:string, chain?:boolean}} opts
 */
async function runBackfillTags({ limit = 20, trigger = 'manual', chain = false } = {}) {
  if (backfillRunning) {
    return { started: false, reason: 'running', progress: backfillProgress }
  }
  backfillRunning = true
  backfillProgress = { total: 0, updated: 0, skipped: 0, failed: 0, done: false, detail: '', remaining: null }

  try {
    // 重置模型轮换索引，从第一个模型开始
    backfillProgress.detail = '重置模型索引...'
    resetModelIndex()

    // 1. 查找本批需要回填的题目：知识点标签缺失 或 难度未判定
    backfillProgress.detail = '查询数据库中...'
    const { rows: questions } = await query(
      `SELECT q.id, q.content, q.options, q.subject, q.ai_tags, q.difficulty, q.question_type
       FROM ${TABLES.QUESTIONS} q
       WHERE ${BACKFILL_WHERE}
       ORDER BY q.created_at DESC
       LIMIT $1`,
      [limit]
    )

    backfillProgress.total = questions.length
    if (questions.length === 0) {
      console.log(`[BackfillTags] (${trigger}) 没有待回填的题目`)
      backfillProgress.done = true
      backfillProgress.remaining = 0
      return { started: true, total: 0, remaining: 0 }
    }

    console.log(`[BackfillTags] (${trigger}) 本批 ${questions.length} 道（小批量）`)

    // 2. 逐题处理（串行，避免并发触发模型限流）
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const content = q.content || ''
      // options 可能是数组、JSON 字符串、对象或 null（不同来源/历史数据不一致）——统一成数组
      const options = normalizeOptionsToArray(q.options).join('；')
      const fullContent = options ? `${content}\n选项：${options}` : content
      const subject = q.subject || null

      const shortId = String(q.id).substring(0, 8)
      backfillProgress.detail = `[${i + 1}/${questions.length}] ${shortId}`

      try {
        // 单次生成标签+难度（LLM），内置重试和主备 API 切换。
        // 回填的目的就是用 LLM 修正上传时的本地占位（tags 可能是「未分类」、difficulty 恒为 3）。
        const tagResult = await generateTagWithLLM(fullContent, subject)

        const hasTags = tagResult && tagResult.tags && tagResult.tags.length > 0 && tagResult.tags[0] !== '未分类'
        const hasDifficulty = tagResult && tagResult.difficulty !== null && tagResult.difficulty !== undefined

        if (hasTags || hasDifficulty) {
          // 动态拼装 SET 子句：只更新本次成功识别出的字段，避免用 NULL 覆盖已有值
          const sets = []
          const params = []
          let p = 1
          if (hasTags) {
            const uniqueTags = [...new Set(tagResult.tags.map(t => t.trim()).filter(Boolean))]
            sets.push(`ai_tags = $${p++}::jsonb`, `tags_source = 'ai'`)
            params.push(JSON.stringify(uniqueTags))
          }
          if (hasDifficulty) {
            sets.push(`difficulty = $${p++}`)
            params.push(tagResult.difficulty)
          }
          sets.push('updated_at = NOW()')
          params.push(q.id)

          try {
            await query(
              `UPDATE ${TABLES.QUESTIONS} SET ${sets.join(', ')} WHERE id = $${p}`,
              params
            )
            backfillProgress.updated++
            const tagStr = hasTags ? tagResult.tags.join(', ') : '(保留原标签)'
            console.log(`  [BackfillTags] ✅ [${i + 1}/${questions.length}] ${shortId}: ${tagStr} | 难度=${hasDifficulty ? tagResult.difficulty : '-'}`)
          } catch (err) {
            backfillProgress.failed++
            console.error(`  [BackfillTags] ❌ [${i + 1}/${questions.length}] ${shortId}: DB写入失败 ${err.message}`)
          }
        } else {
          // AI 未返回有效标签且未判定难度（主备均失败或内容残缺）→ 保持字段为 NULL，
          // 不写「未分类」，让后续回填任务可持续重试。计入 skipped 以便观察。
          backfillProgress.skipped++
          console.log(`  [BackfillTags] ⏭️ [${i + 1}/${questions.length}] ${shortId}: 未识别/失败 (${subject || '无学科'})`)
        }
      } catch (err) {
        backfillProgress.failed++
        console.error(`  [BackfillTags] ❌ [${i + 1}/${questions.length}] ${shortId}: ${err.message}`)
      }

      // 每题间隔 1.5 秒，避免触发 ModelScope 限流
      if (i < questions.length - 1) {
        await new Promise(r => setTimeout(r, 1500))
      }
    }

    console.log(`[BackfillTags] (${trigger}) 本批完成！更新:${backfillProgress.updated} 跳过:${backfillProgress.skipped} 失败:${backfillProgress.failed}`)
    return { started: true, total: questions.length }
  } catch (err) {
    backfillProgress.detail = `错误: ${err.message}`
    console.error(`[BackfillTags] (${trigger}) 执行失败:`, err)
    return { started: true, error: err.message }
  } finally {
    // 统计全局剩余，供进度接口展示；失败时置 null 不阻断
    try {
      backfillProgress.remaining = await countBackfillRemaining()
    } catch { backfillProgress.remaining = null }
    backfillProgress.done = true
    backfillProgress.detail = ''
    backfillRunning = false

    // 自链式：本批跑完仍有剩余则延时触发下一批，直至补齐。
    // 用短批 + 15s 间隙，规避 free 实例内存峰值与 spin-down；
    // 仅当本批确有产出（updated>0）才继续，避免主备全挂时空转刷屏。
    if (chain && backfillProgress.remaining > 0 && backfillProgress.updated > 0) {
      const nextRemaining = backfillProgress.remaining
      setTimeout(() => {
        console.log(`[BackfillTags] (chain) 仍剩 ${nextRemaining} 道，触发下一批...`)
        runBackfillTags({ limit, trigger: 'chain', chain: true })
          .catch(e => console.error('[BackfillTags] 链式回填异常:', e.message))
      }, 15000)
    }
  }
}

app.post('/api/admin/backfill-tags', async (req, res) => {
  if (backfillRunning) {
    return res.status(409).json({ error: '回填任务正在进行中', progress: backfillProgress })
  }

  // sync=1：在请求内同步跑完一小批再返回。free 实例空闲时事件循环几乎不给 CPU，
  // 后台 setTimeout 接力会被冻结；把一批放进「有活跃请求」的处理器里执行，
  // 才能保证整批拿到 CPU。由外部驱动（curl 循环 / cron）反复调用直到 remaining=0。
  const sync = req.query.sync === '1' || req.query.sync === 'true'
  if (sync) {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20)
    const result = await runBackfillTags({ limit, trigger: 'sync', chain: false })
    return res.json({ success: true, sync: true, ...result, progress: backfillProgress })
  }

  // 异步模式（兼容旧调用）：不阻塞响应，chain=true 小批量自动接力。
  res.json({ success: true, message: '标签回填任务已启动（小批量自动接力）' })
  runBackfillTags({ trigger: 'manual', chain: true }).catch(err => {
    console.error('[BackfillTags] 手动回填异常:', err)
  })
})

    // 查询回填进度
app.get('/api/admin/backfill-tags/progress', (req, res) => {
  res.json({ success: true, ...backfillProgress })
})

// 周学习诊断报告
app.use('/api/weekly-report', weeklyReportRouter)
app.use('/api/worksheets', worksheetsRouter)

const __filename = fileURLToPath(import.meta.url)

if (process.argv[1] === __filename || process.argv[1]?.endsWith('server/index.js')) {
  app.listen(PORT, async () => {
    console.log(`敏学后端服务已启动: http://localhost:${PORT}`)

    // 启动队列和 Worker
    try {
      const queue = await getTaskQueue()
      const worker = taskWorker
      console.log(`任务队列: ${queue ? '已连接' : '未连接'}`)
      console.log(`Worker: ${worker ? '已启动' : '未启动'}`)
      if (queue) {
        const stats = await getQueueStats()
        console.log(`队列统计: waiting=${stats.waiting}, active=${stats.active}, failed=${stats.failed}`)
      }
    } catch (err) {
      console.error('队列初始化失败:', err.message)
    }

    // 启动 Pending 任务恢复扫描器
    try {
      pendingTaskRecovery.start()
    } catch (err) {
      console.error('Pending 任务恢复扫描器启动失败:', err.message)
    }

    // 运行数据库迁移
    try {
      await migrateGeometryImageUrl()
      await migrateLifecycleStatus()
      await migrateReviewStatus()
      await migrateQuestionCacheId()
      await migrateJudgements()
      await migrateIsComplete()
      await migratePracticeCount()
      await migrateDifficulty()
      await migratePageUnderstanding()
      await migrateGeometryCleanup()
      await migrateGeometryTikzDisplay()
      await migrateGeometryCropType()
      await migrateCleanGeometrySvg()
      await migrateSourceType()
      await migrateRetryTaskFields()
      await migrateGeometryReconstructionAsync()
      await migrateTaskSystemFields()
      await migrateWorksheets()
    } catch (err) {
      console.error('数据库迁移失败:', err.message)
    }

    // 定时自动回填知识点标签+难度：让曾因限流失败的题目能被持续重试补齐。
    // 启动 2 分钟后先跑一次，之后每 BACKFILL_INTERVAL_HOURS 小时（默认 6h）跑一次。
    try {
      const intervalHours = Number(process.env.BACKFILL_INTERVAL_HOURS) || 6
      const intervalMs = intervalHours * 60 * 60 * 1000
      setTimeout(() => {
        runBackfillTags({ trigger: 'auto', chain: true }).catch(e => console.error('[BackfillTags] 定时回填异常:', e.message))
      }, 2 * 60 * 1000)
      setInterval(() => {
        runBackfillTags({ trigger: 'auto', chain: true }).catch(e => console.error('[BackfillTags] 定时回填异常:', e.message))
      }, intervalMs)
      console.log(`⏰ 知识点/难度定时回填已启用（每 ${intervalHours} 小时）`)
    } catch (err) {
      console.error('定时回填启动失败:', err.message)
    }

    console.log(`并发数: ${process.env.CONCURRENCY || 2}`)
    console.log(`数据库: Neon PostgreSQL`)
  })
}

export { app }

export const createServer = (port = PORT) => {
  return new Promise(async (resolve) => {
    // 启动时初始化队列
    await getTaskQueue()

    // 启动 Pending 任务恢复扫描器
    try {
      pendingTaskRecovery.start()
    } catch (err) {
      console.error('Pending 任务恢复扫描器启动失败:', err.message)
    }

    const server = app.listen(port, () => {
      resolve(server)
    })
  })
}







