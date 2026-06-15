const API_BASE = import.meta.env.VITE_API_URL || '/api'

const apiRequest = async (path, options = {}) => {
  const url = `${API_BASE}${path}`
  console.log('📡📡📡 [API] === REQUEST START ===')
  console.log('📡 [API] URL:', url)
  console.log('📡 [API] Method:', options.method || 'GET')
  console.log('📡 [API] Options:', options)
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers
      }
    })
    console.log('📡 [API] Response status:', response.status)
    console.log('📡 [API] Response OK:', response.ok)
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      console.error('💥💥💥 [API] ERROR RESPONSE:', error)
      throw new Error(error.error || `请求失败: ${response.status}`)
    }
    const data = await response.json()
    console.log('📡 [API] Response data (first 300 chars):', JSON.stringify(data).substring(0, 300))
    console.log('📡📡📡 [API] === REQUEST SUCCESS ===')
    return data
  } catch (error) {
    console.error('💥💥💥 [API] NETWORK ERROR:', error.message)
    console.error('💥 [API] Error stack:', error.stack)
    throw error
  }
}

export const taskService = {
  uploadFiles: async (studentId, files) => {
    console.log('📤📤📤 [taskService.uploadFiles] === START ===')
    console.log('📤 [taskService.uploadFiles] studentId:', studentId)
    console.log('📤 [taskService.uploadFiles] fileCount:', files.length)
    console.log('📤 [taskService.uploadFiles] files:', files.map(f => ({ name: f.name, size: f.size, type: f.type })))
    
    const formData = new FormData()
    formData.append('studentId', studentId)

    for (const file of files) {
      formData.append('files', file)
    }
    console.log('📤 [taskService.uploadFiles] FormData constructed, calling apiRequest...')

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
