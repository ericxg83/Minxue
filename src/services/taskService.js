import { supabase } from '../config/supabase'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

const apiRequest = async (path, options = {}) => {
  const url = `${API_BASE}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers
    }
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
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
  const channel = supabase
    .channel('task-status-changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'tasks'
      },
      (payload) => {
        onTaskUpdate(payload.new)
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'tasks'
      },
      (payload) => {
        onTaskUpdate(payload.new)
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
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
