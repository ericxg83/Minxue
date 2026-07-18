const API_BASE = import.meta.env.VITE_API_URL || '/api'

const apiRequest = async (path, options = {}) => {
  const url = `${API_BASE}${path}`
  console.debug('📡📡📡 [API] === REQUEST START ===')
  console.debug('📡 [API] URL:', url)
  console.debug('📡 [API] Method:', options.method || 'GET')
  console.debug('📡 [API] Options:', options)
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers
      }
    })
    console.debug('📡 [API] Response status:', response.status)
    console.debug('📡 [API] Response OK:', response.ok)
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      console.error('💥💥💥 [API] ERROR RESPONSE:', error)
      throw new Error(error.error || `请求失败: ${response.status}`)
    }
    const data = await response.json()
    console.debug('📡 [API] Response data (first 300 chars):', JSON.stringify(data).substring(0, 300))
    console.debug('📡📡📡 [API] === REQUEST SUCCESS ===')
    return data
  } catch (error) {
    console.error('💥💥💥 [API] NETWORK ERROR:', error.message)
    console.error('💥 [API] Error stack:', error.stack)
    throw error
  }
}

export const taskService = {
  uploadFiles: async (studentId, files, options = {}) => {
    console.debug('📤📤📤 [taskService.uploadFiles] === START ===')
    console.debug('📤 [taskService.uploadFiles] studentId:', studentId)
    console.debug('📤 [taskService.uploadFiles] fileCount:', files.length)
    console.debug('📤 [taskService.uploadFiles] files:', files.map(f => ({ name: f.name, size: f.size, type: f.type })))
    console.debug('📤 [taskService.uploadFiles] options:', options)

    const formData = new FormData()
    formData.append('studentId', studentId)
    if (options.generatedExamId) formData.append('generatedExamId', options.generatedExamId)
    if (options.taskType) formData.append('taskType', options.taskType)
    if (options.retryPaperId) formData.append('retryPaperId', options.retryPaperId)
    if (options.worksheetId) formData.append('worksheetId', options.worksheetId)
    if (options.resourceId) formData.append('resourceId', options.resourceId)
    if (options.subject) formData.append('subject', options.subject)

    // Add file names for multi-page papers
    if (options.fileNames) {
      options.fileNames.forEach((name, index) => {
        formData.append(`fileNames[${index}]`, name)
      })
    }

    for (const file of files) {
      formData.append('files', file)
    }
    console.debug('📤 [taskService.uploadFiles] FormData constructed, calling apiRequest...')

    return apiRequest('/tasks/upload', {
      method: 'POST',
      body: formData
    })
  },

  // 错题重练任务入口：老师/学生上传完成后的答卷照片。
  // 通过 generatedExamId 自动关联 student_id / 组卷，无需用户重新选择。
  // taskType='wrong_retry' 使该批改任务进入统一的错题重练批改流程。
  uploadRetryAnswer: async (generatedExamId, files) => {
    const formData = new FormData()
    formData.append('generatedExamId', generatedExamId)

    for (const file of files) {
      formData.append('files', file)
    }
    return apiRequest('/tasks/upload', {
      method: 'POST',
      body: formData
    })
  },

  // 练习册任务入口：学生上传练习册作业照片
  // taskType='workbook' 使该批改任务进入练习册批改流程
  // 会使用 worksheetId 和 subject 匹配标准答案
  uploadWorkbookAnswer: async (studentId, files, worksheetId, subject) => {
    const formData = new FormData()
    formData.append('studentId', studentId)
    formData.append('taskType', 'workbook')
    formData.append('worksheetId', worksheetId)
    formData.append('subject', subject)

    for (const file of files) {
      formData.append('files', file)
    }
    return apiRequest('/tasks/upload', {
      method: 'POST',
      body: formData
    })
  },

  createTaskByUrl: async (studentId, imageUrl, originalName) => {
    return apiRequest('/tasks/create-by-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, imageUrl, originalName })
    })
  },

  getTask: async (taskId) => {
    return apiRequest(`/tasks/${taskId}`)
  },

  getTasksByStudent: async (studentId) => {
    return apiRequest(`/tasks/student/${studentId}`)
  },

  retryTask: async (taskId) => {
    return apiRequest(`/tasks/${taskId}/retry`, {
      method: 'POST'
    })
  },

  getQueueStats: async () => {
    return apiRequest('/queue/stats')
  }
}

export const startTaskPolling = (studentId, onUpdate, intervalMs = 5000) => {
  let polling = true
  let timerId = null
  let failCount = 0
  const MAX_BACKOFF_MS = 30000 // 最大退避 30s

  const poll = async () => {
    if (!polling) return

    try {
      const result = await taskService.getTasksByStudent(studentId)
      if (result.success && polling) {
        onUpdate(result.tasks)
      }
      failCount = 0 // 成功后重置失败计数
    } catch (error) {
      console.debug('轮询任务状态失败:', error)
      failCount++
    }

    if (polling) {
      // 指数退避：失败后 5s → 10s → 20s → 30s（上限），成功后恢复原间隔
      const backoff = Math.min(intervalMs * Math.pow(2, failCount - 1), MAX_BACKOFF_MS)
      const nextInterval = failCount > 0 ? backoff : intervalMs
      timerId = setTimeout(poll, nextInterval)
    }
  }

  poll()

  return () => {
    polling = false
    if (timerId) clearTimeout(timerId)
  }
}
