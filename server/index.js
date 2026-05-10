import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { query, TABLES, TASK_STATUS, QUESTION_STATUS, WRONG_STATUS } from './config/neon.js'
import { uploadImage } from './services/ossService.js'
import { getTaskQueue, getQueueStats, taskWorker } from './queue.js'

const app = express()
const PORT = process.env.PORT || 3001

const allowedOrigins = process.env.ALLOWED_ORIGIN 
  ? process.env.ALLOWED_ORIGIN.split(',')
  : ['http://localhost:3000', 'http://localhost:5173']

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

// Upload images and create tasks
app.post('/api/tasks/upload', upload.array('files', 20), async (req, res) => {
  try {
    const { studentId } = req.body
    if (!studentId) {
      return res.status(400).json({ error: '缺少 studentId' })
    }

    const files = req.files
    if (!files || files.length === 0) {
      return res.status(400).json({ error: '没有上传文件' })
    }

    // 初始化队列（如果尚未初始化）
    const queue = await getTaskQueue()
    console.log(`📥 [Upload] 收到 ${files.length} 个文件, studentId=${studentId}, queue=${queue ? 'connected' : 'null'}`)

    const tasks = []

    for (const file of files) {
      try {
        // Decode UTF-8 filename
        let decodedName = file.originalname
        try {
          decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8')
        } catch (e) {
          decodedName = file.originalname
        }

        const imageUrl = await uploadImage(file.buffer, decodedName, studentId)
        const safeUrl = typeof imageUrl === 'string' ? imageUrl : (imageUrl?.url || imageUrl?.ossPath || String(imageUrl))
        console.log(`  OSS 上传成功: ${decodedName} → ${safeUrl}`)

        const { rows } = await query(
          `INSERT INTO ${TABLES.TASKS} (student_id, image_url, original_name, status, result)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [studentId, safeUrl, decodedName || `照片_${Date.now()}.jpg`, TASK_STATUS.PENDING, JSON.stringify({ progress: 0 })]
        )

        const savedTask = rows[0]
        console.log(`  DB 记录已创建: taskId=${savedTask.id}`)

        if (queue) {
          console.log(`   提交任务到 Redis 队列: taskId=${savedTask.id}`)
          const job = await queue.add('process-task', {
            taskId: savedTask.id,
            studentId: studentId,
            imageUrl: imageUrl,
            originalName: savedTask.original_name
          }, {
            attempts: parseInt(process.env.MAX_RETRIES) || 3,
            backoff: { type: 'exponential', delay: 5000 }
          })
          console.log(`  ✅ 任务已加入队列: jobId=${job.id}`)
        } else {
          console.log(`  ⚠️  Redis 队列未连接，任务无法异步处理`)
        }

        tasks.push(savedTask)
      } catch (fileError) {
        console.error(`处理文件 ${decodedName} 失败:`, fileError)
        tasks.push({
          error: true,
          originalName: decodedName,
          message: fileError.message
        })
      }
    }

    res.json({
      success: true,
      count: tasks.filter(t => !t.error).length,
      failed: tasks.filter(t => t.error).length,
      tasks
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
    const { rows } = await query(
      `SELECT * FROM ${TABLES.TASKS} WHERE student_id = $1 ORDER BY created_at DESC`,
      [studentId]
    )
    res.json({ success: true, tasks: rows })
  } catch (error) {
    console.error('获取学生任务失败:', error)
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
    } catch (error) {
      console.error('创建学生失败:', error)
      res.status(500).json({ error: error.message })
    }
  })

app.get('/api/students', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM ${TABLES.STUDENTS} ORDER BY created_at DESC`
    )
    res.json({ success: true, students: rows })
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
    } catch (error) {
      console.error('更新学生失败:', error)
      res.status(500).json({ error: error.message })
    }
  })

app.delete('/api/students/:id', async (req, res) => {
  try {
    const { id } = req.params
    await query(`DELETE FROM ${TABLES.STUDENTS} WHERE id = $1`, [id])
    res.json({ success: true, message: '学生已删除' })
  } catch (error) {
    console.error('删除学生失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Questions CRUD
app.post('/api/questions', async (req, res) => {
  try {
    const { task_id, student_id, content, options, answer, status, question_type, subject, analysis } = req.body

    if (!task_id || !student_id || !content) {
      return res.status(400).json({ error: '缺少必要字段' })
    }

    const { rows } = await query(
      `INSERT INTO ${TABLES.QUESTIONS} (task_id, student_id, content, options, answer, status, question_type, subject, analysis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [task_id, student_id, content, JSON.stringify(options || []), answer || '', status || 'pending', question_type || 'answer', subject || '数学', analysis || '']
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
    const { content, options, answer, analysis, status, question_type, subject } = req.body

    const { rows } = await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET content = COALESCE($1, content),
           options = COALESCE($2, options),
           answer = COALESCE($3, answer),
           analysis = COALESCE($4, analysis),
           status = COALESCE($5, status),
           question_type = COALESCE($6, question_type),
           subject = COALESCE($7, subject),
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [content, options, answer, analysis, status, question_type, subject, id]
    )

    if (rows.length === 0) return res.status(404).json({ error: '题目不存在' })

    res.json({ success: true, question: rows[0] })
  } catch (error) {
    console.error('更新题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/questions/batch-update-tags', async (req, res) => {
  try {
    const { updates } = req.body
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ error: '缺少 updates 数组' })
    }

    res.json({ success: true, message: '标签已更新' })
  } catch (error) {
    console.error('批量更新标签失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/questions/batch', async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.json({ success: true, questions: [] })
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    const { rows } = await query(
      `SELECT * FROM ${TABLES.QUESTIONS} WHERE id IN (${placeholders})`,
      ids
    )

    res.json({ success: true, questions: rows })
  } catch (error) {
    console.error('批量获取题目失败:', error)
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

    const values = newIds.map((id, i) => `($1, $${i + 2})`).join(',')
    const params = [studentId, ...newIds]

    await query(
      `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      params
    )

    res.json({ success: true, added: newIds })
  } catch (error) {
    console.error('添加错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/wrong-questions/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const { rows } = await query(
      `SELECT * FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 ORDER BY added_at DESC`,
      [studentId]
    )
    res.json({ success: true, wrongQuestions: rows })
  } catch (error) {
    console.error('获取错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/wrong-questions/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    await query(
      `UPDATE ${TABLES.WRONG_QUESTIONS} SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id]
    )

    res.json({ success: true, message: '状态已更新' })
  } catch (error) {
    console.error('更新错题状态失败:', error)
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
    const { rows } = await query(
      `SELECT * FROM ${TABLES.GENERATED_EXAMS} WHERE student_id = $1 ORDER BY created_at DESC`,
      [studentId]
    )
    res.json({ success: true, generatedExams: rows })
  } catch (error) {
    console.error('获取错题卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/generated-exams/:id', async (req, res) => {
  try {
    const { id } = req.params
    await query(`DELETE FROM ${TABLES.GENERATED_EXAMS} WHERE id = $1`, [id])
    res.json({ success: true, message: '错题卷已删除' })
  } catch (error) {
    console.error('删除错题卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Combined exams endpoint (legacy support)
app.get('/api/exams/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const { rows } = await query(
      `SELECT * FROM ${TABLES.GENERATED_EXAMS} WHERE student_id = $1 ORDER BY created_at DESC`,
      [studentId]
    )
    res.json({ success: true, exams: rows })
  } catch (error) {
    console.error('获取考试列表失败:', error)
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

import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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

    console.log(`并发数: ${process.env.CONCURRENCY || 2}`)
    console.log(`数据库: Neon PostgreSQL`)
  })
}

export { app }

export const createServer = (port = PORT) => {
  return new Promise(async (resolve) => {
    // 启动时初始化队列
    await getTaskQueue()

    const server = app.listen(port, () => {
      resolve(server)
    })
  })
}
