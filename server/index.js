import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { taskQueue, getQueueStats } from './queue.js'
import { query, TABLES, TASK_STATUS } from './config/neon.js'
import { uploadImage as uploadToOSS } from './services/ossService.js'

const app = express()
const PORT = process.env.PORT || 3001

const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',')
  : ['http://localhost:3000', 'http://localhost:5173', 'https://minxue-app.pages.dev']

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

// 格式化任务数据：将 result JSON 字符串解析为对象
const formatTask = (task) => {
  if (!task) return task
  const formatted = { ...task }
  if (typeof formatted.result === 'string') {
    try {
      formatted.result = JSON.parse(formatted.result)
    } catch {
      formatted.result = {}
    }
  }
  return formatted
}

const formatTasks = (tasks) => {
  if (!Array.isArray(tasks)) return []
  return tasks.map(formatTask)
}

// ==================== 健康检查 ====================
app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1')
    res.json({ status: 'ok', timestamp: new Date().toISOString(), database: 'connected' })
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message })
  }
})

// ==================== Redis 连接测试 ====================
app.get('/api/redis-test', async (req, res) => {
  try {
    const { taskQueue } = await import('./queue.js')
    const waiting = await taskQueue.getWaitingCount()
    res.json({ status: 'ok', redis: 'connected', waitingJobs: waiting })
  } catch (error) {
    console.error('Redis 连接测试失败:', error)
    res.status(500).json({ status: 'error', redis: 'disconnected', message: error.message })
  }
})

// ==================== 学生相关 API ====================

app.get('/api/students', async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM ${TABLES.STUDENTS} ORDER BY created_at DESC`)
    res.json({ success: true, students: rows })
  } catch (error) {
    console.error('获取学生列表失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/students', async (req, res) => {
  try {
    const { name, grade, class: className, remark, avatar } = req.body
    const { rows } = await query(
      `INSERT INTO ${TABLES.STUDENTS} (name, grade, class, remark, avatar) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, grade || null, className || null, remark || null, avatar || null]
    )
    res.json({ success: true, student: rows[0] })
  } catch (error) {
    console.error('创建学生失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/students/:id', async (req, res) => {
  try {
    const { id } = req.params
    const allowedFields = ['name', 'grade', 'class', 'remark', 'avatar']
    const updates = []
    const values = []
    let paramIndex = 1

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex}`)
        values.push(req.body[field])
        paramIndex++
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' })
    }

    updates.push(`updated_at = NOW()`)
    values.push(id)

    const { rows } = await query(
      `UPDATE ${TABLES.STUDENTS} SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    )
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
    res.json({ success: true })
  } catch (error) {
    console.error('删除学生失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ==================== 任务相关 API ====================

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

    const tasks = []

    for (const file of files) {
      try {
        const ossResult = await uploadToOSS(file.buffer, file.originalname, studentId)

        const taskData = {
          student_id: studentId,
          image_url: ossResult.url,
          original_name: file.originalname || `照片_${Date.now()}.jpg`,
          status: TASK_STATUS.PENDING,
          result: JSON.stringify({ progress: 0 })
        }

        const { rows } = await query(
          `INSERT INTO ${TABLES.TASKS} (student_id, image_url, original_name, status, result)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [taskData.student_id, taskData.image_url, taskData.original_name, taskData.status, taskData.result]
        )
        const savedTask = rows[0]

        await taskQueue.add('process-task', {
          taskId: savedTask.id,
          studentId: studentId,
          imageUrl: ossResult.url,
          originalName: taskData.original_name
        }, {
          attempts: parseInt(process.env.MAX_RETRIES) || 3,
          backoff: { type: 'exponential', delay: 5000 }
        })

        tasks.push(savedTask)
      } catch (fileError) {
        console.error(`处理文件 ${file.originalname} 失败:`, fileError)
        tasks.push({ error: true, originalName: file.originalname, message: fileError.message })
      }
    }

    res.json({
      success: true,
      count: tasks.filter(t => !t.error).length,
      failed: tasks.filter(t => t.error).length,
      tasks: tasks.map(t => t.error ? t : formatTask(t))
    })
  } catch (error) {
    console.error('上传处理失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/tasks/create-by-url', async (req, res) => {
  try {
    const { studentId, imageUrl, originalName } = req.body
    if (!studentId || !imageUrl) {
      return res.status(400).json({ error: '缺少 studentId 或 imageUrl' })
    }

    const { rows } = await query(
      `INSERT INTO ${TABLES.TASKS} (student_id, image_url, original_name, status, result)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [studentId, imageUrl, originalName || `试卷_${Date.now()}.jpg`, TASK_STATUS.PENDING, JSON.stringify({ progress: 0 })]
    )
    const savedTask = rows[0]

    await taskQueue.add('process-task', {
      taskId: savedTask.id,
      studentId: studentId,
      imageUrl: imageUrl,
      originalName: savedTask.original_name
    }, {
      attempts: parseInt(process.env.MAX_RETRIES) || 3,
      backoff: { type: 'exponential', delay: 5000 }
    })

    res.json({ success: true, task: formatTask(savedTask) })
  } catch (error) {
    console.error('创建任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params
    const { rows } = await query(`SELECT * FROM ${TABLES.TASKS} WHERE id = $1`, [taskId])
    if (rows.length === 0) return res.status(404).json({ error: '任务不存在' })
    res.json({ success: true, task: formatTask(rows[0]) })
  } catch (error) {
    console.error('获取任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/tasks/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const { rows } = await query(
      `SELECT * FROM ${TABLES.TASKS} WHERE student_id = $1 ORDER BY created_at DESC`,
      [studentId]
    )
    res.json({ success: true, tasks: formatTasks(rows) })
  } catch (error) {
    console.error('获取学生任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/tasks/:taskId/retry', async (req, res) => {
  try {
    const { taskId } = req.params
    const { rows } = await query(`SELECT * FROM ${TABLES.TASKS} WHERE id = $1`, [taskId])
    if (rows.length === 0) return res.status(404).json({ error: '任务不存在' })

    const task = rows[0]
    // 解析 result JSON 字符串
    let currentResult = task.result || {}
    if (typeof currentResult === 'string') {
      try {
        currentResult = JSON.parse(currentResult)
      } catch {
        currentResult = {}
      }
    }
    const newResult = {
      ...currentResult,
      progress: 0,
      retryCount: (currentResult.retryCount || 0) + 1,
      previousError: currentResult.error || null
    }

    await query(
      `UPDATE ${TABLES.TASKS} SET status = $1, result = $2, updated_at = NOW() WHERE id = $3`,
      [TASK_STATUS.PENDING, JSON.stringify(newResult), taskId]
    )

    await taskQueue.add('process-task', {
      taskId: task.id,
      studentId: task.student_id,
      imageUrl: task.image_url,
      originalName: task.original_name
    }, {
      attempts: parseInt(process.env.MAX_RETRIES) || 3,
      backoff: { type: 'exponential', delay: 5000 }
    })

    res.json({ success: true, message: '任务已重新提交' })
  } catch (error) {
    console.error('重试任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ==================== 题目相关 API ====================

app.get('/api/questions/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params
    const { rows } = await query(
      `SELECT * FROM ${TABLES.QUESTIONS} WHERE task_id = $1 ORDER BY created_at ASC`,
      [taskId]
    )
    res.json({ success: true, questions: rows })
  } catch (error) {
    console.error('获取题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/questions/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { rows } = await query(`SELECT * FROM ${TABLES.QUESTIONS} WHERE id = $1`, [id])
    if (rows.length === 0) return res.status(404).json({ error: '题目不存在' })
    res.json({ success: true, question: rows[0] })
  } catch (error) {
    console.error('获取题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/questions/:id', async (req, res) => {
  try {
    const { id } = req.params
    const allowedFields = ['content', 'options', 'answer', 'analysis', 'question_type', 'subject', 'is_correct', 'status', 'image_url', 'ai_tags', 'manual_tags', 'tags_source']
    const updates = []
    const values = []
    let paramIndex = 1

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex}`)
        values.push(['options', 'ai_tags', 'manual_tags'].includes(field)
          ? JSON.stringify(req.body[field])
          : req.body[field])
        paramIndex++
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' })
    }

    updates.push(`updated_at = NOW()`)
    values.push(id)

    const { rows } = await query(
      `UPDATE ${TABLES.QUESTIONS} SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    )
    res.json({ success: true, question: rows[0] })
  } catch (error) {
    console.error('更新题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/questions/batch-update-tags', async (req, res) => {
  try {
    const { updates } = req.body
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'updates 必须是数组' })
    }

    const results = []
    for (const update of updates) {
      const { rows } = await query(
        `UPDATE ${TABLES.QUESTIONS} SET ai_tags = $1, tags_source = 'ai', updated_at = NOW() WHERE id = $2 RETURNING *`,
        [JSON.stringify(update.ai_tags || []), update.id]
      )
      if (rows.length > 0) results.push(rows[0])
    }

    res.json({ success: true, results })
  } catch (error) {
    console.error('批量更新标签失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ==================== 错题本相关 API ====================

app.get('/api/wrong-questions/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const { rows: wrongData } = await query(
      `SELECT * FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 ORDER BY added_at DESC`,
      [studentId]
    )

    if (!wrongData || wrongData.length === 0) {
      return res.json({ success: true, wrongQuestions: [] })
    }

    const questionIds = wrongData.map(wq => wq.question_id).filter(Boolean)
    let questionsMap = {}

    if (questionIds.length > 0) {
      const placeholders = questionIds.map((_, i) => `$${i + 1}`).join(',')
      const { rows: questionsData } = await query(
        `SELECT * FROM ${TABLES.QUESTIONS} WHERE id IN (${placeholders})`,
        questionIds
      )
      for (const q of questionsData) {
        questionsMap[q.id] = q
      }
    }

    const result = wrongData.map(wq => ({
      ...wq,
      question: questionsMap[wq.question_id] || null
    }))

    res.json({ success: true, wrongQuestions: result })
  } catch (error) {
    console.error('获取错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/wrong-questions', async (req, res) => {
  try {
    const { studentId, questionIds } = req.body
    if (!studentId || !Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ error: '缺少 studentId 或 questionIds' })
    }

    const { rows: existing } = await query(
      `SELECT question_id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = ANY($2)`,
      [studentId, questionIds]
    )

    const existingIds = new Set((existing || []).map(e => e.question_id))
    const newIds = questionIds.filter(id => !existingIds.has(id))

    if (newIds.length === 0) {
      return res.json({ success: true, added: [] })
    }

    const created = []
    for (const questionId of newIds) {
      const { rows } = await query(
        `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id, status, error_count, added_at, last_wrong_at)
         VALUES ($1, $2, 'pending', 1, NOW(), NOW()) RETURNING *`,
        [studentId, questionId]
      )
      created.push(rows[0])
    }

    res.json({ success: true, added: created })
  } catch (error) {
    console.error('添加错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/wrong-questions/:id/status', async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body
    const { rows } = await query(
      `UPDATE ${TABLES.WRONG_QUESTIONS} SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    )
    res.json({ success: true, wrongQuestion: rows[0] })
  } catch (error) {
    console.error('更新错题状态失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/wrong-questions/:id', async (req, res) => {
  try {
    const { id } = req.params
    await query(`DELETE FROM ${TABLES.WRONG_QUESTIONS} WHERE id = $1`, [id])
    res.json({ success: true })
  } catch (error) {
    console.error('删除错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ==================== 试卷相关 API ====================

app.get('/api/exams/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const { rows: taskExams } = await query(
      `SELECT id, student_id, original_name as name, image_url, result, created_at, status
       FROM ${TABLES.TASKS} WHERE student_id = $1 AND status = 'done' ORDER BY created_at DESC`,
      [studentId]
    )

    const { rows: generatedExams } = await query(
      `SELECT * FROM ${TABLES.GENERATED_EXAMS} WHERE student_id = $1 ORDER BY created_at DESC`,
      [studentId]
    )

    const formattedTaskExams = (taskExams || []).map(task => {
      // 解析 result JSON 字符串
      let result = task.result
      if (typeof result === 'string') {
        try {
          result = JSON.parse(result)
        } catch {
          result = {}
        }
      }
      return {
        id: task.id,
        student_id: task.student_id,
        name: task.name || '未命名试卷',
        exam_no: '',
        thumbnail: task.image_url || '',
        question_count: result?.questionCount || 0,
        status: 'ungraded',
        created_at: task.created_at,
        graded_at: null,
        source: 'upload'
      }
    })

    const formattedGeneratedExams = (generatedExams || []).map(exam => ({
      id: exam.id,
      student_id: exam.student_id,
      name: exam.name || '错题重练卷',
      question_ids: exam.question_ids || [],
      status: 'ungraded',
      created_at: exam.created_at,
      graded_at: null,
      source: 'generated'
    }))

    res.json({ success: true, exams: [...formattedTaskExams, ...formattedGeneratedExams] })
  } catch (error) {
    console.error('获取试卷失败:', error)
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

    const result = (rows || []).map(exam => ({
      id: exam.id,
      student_id: exam.student_id,
      name: exam.name || '错题重练卷',
      question_ids: exam.question_ids || [],
      status: 'ungraded',
      created_at: exam.created_at,
      graded_at: null,
      source: 'generated'
    }))

    res.json({ success: true, generatedExams: result })
  } catch (error) {
    console.error('获取生成试卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/generated-exams', async (req, res) => {
  try {
    const { studentId, name, questionIds } = req.body
    if (!studentId || !Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ error: '缺少 studentId 或 questionIds' })
    }

    const { rows } = await query(
      `INSERT INTO ${TABLES.GENERATED_EXAMS} (student_id, name, question_ids) VALUES ($1, $2, $3) RETURNING *`,
      [studentId, name || '错题重练卷', JSON.stringify(questionIds)]
    )
    res.json({ success: true, exam: rows[0] })
  } catch (error) {
    console.error('创建试卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/questions/batch', async (req, res) => {
  try {
    const { ids } = req.query
    if (!ids) return res.status(400).json({ error: '缺少 ids 参数' })

    const questionIds = ids.split(',')
    if (questionIds.length === 0) return res.json({ success: true, questions: [] })

    const placeholders = questionIds.map((_, i) => `$${i + 1}`).join(',')
    const { rows } = await query(
      `SELECT * FROM ${TABLES.QUESTIONS} WHERE id IN (${placeholders})`,
      questionIds
    )
    res.json({ success: true, questions: rows })
  } catch (error) {
    console.error('批量获取题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ==================== 队列统计 API ====================

app.get('/api/queue/stats', async (req, res) => {
  try {
    const stats = await getQueueStats()
    res.json({ success: true, stats })
  } catch (error) {
    console.error('获取队列统计失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ==================== 错误处理 ====================

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

app.listen(PORT, () => {
  console.log(`🚀 敏学后端服务已启动: http://localhost:${PORT}`)
  console.log(`📋 任务队列已就绪，并发数: ${process.env.CONCURRENCY || 2}`)
  console.log(`🗄️  数据库: Neon PostgreSQL`)
  console.log(`☁️  文件存储: 阿里 OSS`)
})
