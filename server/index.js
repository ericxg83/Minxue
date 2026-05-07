import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { taskQueue, TASK_EVENTS, getQueueStats } from './queue.js'
import { supabase, TABLES, TASK_STATUS } from './config/supabase.js'
import { uploadImage, updateTaskStatus, createTask, getTasksByStudent, addWrongQuestions } from './services/supabaseService.js'

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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

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
        const imageUrl = await uploadImage(file.buffer, `tasks/${studentId}`, file.originalname)

        const taskData = {
          student_id: studentId,
          image_url: imageUrl,
          original_name: file.originalname || `照片_${Date.now()}.jpg`,
          status: TASK_STATUS.PENDING,
          result: { progress: 0 }
        }

        const savedTask = await createTask(taskData)

        await taskQueue.add('process-task', {
          taskId: savedTask.id,
          studentId: studentId,
          imageUrl: imageUrl,
          originalName: taskData.original_name
        }, {
          attempts: parseInt(process.env.MAX_RETRIES) || 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          }
        })

        tasks.push(savedTask)
      } catch (fileError) {
        console.error(`处理文件 ${file.originalname} 失败:`, fileError)
        tasks.push({
          error: true,
          originalName: file.originalname,
          message: fileError.message
        })
      }
    }

    res.json({
      success: true,
      count: tasks.filter(t => !t.error).length,
      failed: tasks.filter(t => t.error).length,
      tasks: tasks
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

    const taskData = {
      student_id: studentId,
      image_url: imageUrl,
      original_name: originalName || `试卷_${Date.now()}.jpg`,
      status: TASK_STATUS.PENDING,
      result: { progress: 0 }
    }

    const savedTask = await createTask(taskData)

    await taskQueue.add('process-task', {
      taskId: savedTask.id,
      studentId: studentId,
      imageUrl: imageUrl,
      originalName: taskData.original_name
    }, {
      attempts: parseInt(process.env.MAX_RETRIES) || 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    })

    res.json({ success: true, task: savedTask })
  } catch (error) {
    console.error('创建任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params
    const { data, error } = await supabase
      .from(TABLES.TASKS)
      .select('*')
      .eq('id', taskId)
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: '任务不存在' })

    res.json({ success: true, task: data })
  } catch (error) {
    console.error('获取任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/tasks/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const tasks = await getTasksByStudent(studentId)
    res.json({ success: true, tasks })
  } catch (error) {
    console.error('获取学生任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/tasks/:taskId/retry', async (req, res) => {
  try {
    const { taskId } = req.params

    const { data: task, error: fetchError } = await supabase
      .from(TABLES.TASKS)
      .select('*')
      .eq('id', taskId)
      .single()

    if (fetchError) throw fetchError
    if (!task) return res.status(404).json({ error: '任务不存在' })

    await updateTaskStatus(taskId, TASK_STATUS.PENDING, {
      progress: 0,
      retryCount: (task.result?.retryCount || 0) + 1,
      previousError: task.result?.error || null
    })

    await taskQueue.add('process-task', {
      taskId: task.id,
      studentId: task.student_id,
      imageUrl: task.image_url,
      originalName: task.original_name
    }, {
      attempts: parseInt(process.env.MAX_RETRIES) || 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    })

    res.json({ success: true, message: '任务已重新提交' })
  } catch (error) {
    console.error('重试任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/queue/stats', async (req, res) => {
  try {
    const stats = await getQueueStats()
    res.json({ success: true, stats })
  } catch (error) {
    console.error('获取队列统计失败:', error)
    res.status(500).json({ error: error.message })
  }
})

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
})
