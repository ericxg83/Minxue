const API_BASE = import.meta.env.VITE_API_URL || '/api'

const apiRequest = async (path, options = {}) => {
  const url = `${API_BASE}${path}`
  console.log(`[API Request] ${options.method || 'GET'} ${url}`)
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers
    }
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText)
    let error
    try {
      error = JSON.parse(errorText)
    } catch {
      error = { error: errorText || response.statusText }
    }
    console.error(`[API Error] ${url}:`, error)
    throw new Error(error.error || `请求失败: ${response.status}`)
  }

  return response.json()
}

export const taskService = {
  uploadFiles: async (studentId, files) => {
    const formData = new FormData()
    formData.append('studentId', studentId)

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

export const subscribeToTaskUpdates = (onTaskUpdate) => {
  // 由于任务数据存储在 Neon 数据库中，而非 Supabase，
  // 使用轮询代替 Supabase Realtime 订阅
  let polling = true
  let timerId = null
  let lastTasks = new Map()

  const poll = async () => {
    if (!polling) return

    try {
      // 获取所有学生的任务（通过遍历当前已知任务的学生ID）
      // 这里简化处理：轮询会由 startTaskPolling 处理每个学生的任务
      // 此函数仅作为兼容层保留
    } catch (error) {
      console.debug('轮询任务更新失败:', error)
    }

    if (polling) {
      timerId = setTimeout(poll, 10000)
    }
  }

  poll()

  return () => {
    polling = false
    if (timerId) clearTimeout(timerId)
  }
}

export const startTaskPolling = (studentId, onUpdate, intervalMs = 5000) => {
  let polling = true
  let timerId = null

  const poll = async () => {
    if (!polling) return

    try {
      const result = await taskService.getTasksByStudent(studentId)
      if (result.success && polling) {
        onUpdate(result.tasks)
      }
    } catch (error) {
      console.debug('轮询任务状态失败:', error)
    }

    if (polling) {
      timerId = setTimeout(poll, intervalMs)
    }
  }

  poll()

  return () => {
    polling = false
    if (timerId) clearTimeout(timerId)
  }
}
