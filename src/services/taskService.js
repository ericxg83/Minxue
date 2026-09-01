const API_BASE = import.meta.env.VITE_API_URL || '/api'

// 计算单个文件的 SHA-256，返回 64 字符 hex
// 用于服务端去重（X-Content-Hashes 头），同图重传直接复用旧 task。
// crypto.subtle 在 HTTPS / localhost 下可用，失败时返回 null，服务端按无 hash 走原逻辑。
const sha256Hex = async (blob) => {
  try {
    const buf = await blob.arrayBuffer()
    const hashBuf = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  } catch (e) {
    console.warn('[taskService] SHA-256 计算失败，跳过去重:', e.message)
    return null
  }
}

// 多文件并行算 hash，按顺序返回 hex 数组；任一失败整组返回 null
const computeContentHashes = async (files) => {
  const results = await Promise.all(files.map(f => sha256Hex(f)))
  if (results.some(r => !r)) return null
  return results
}

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
      const errorBody = await response.json().catch(() => ({ error: response.statusText }))
      console.error('💥💥💥 [API] ERROR RESPONSE:', errorBody)
      // 2026-09-02：409 EXISTING_FAILED_TASK 是"已上传过相同内容、上次批改失败"的
      // 去重信号，需要让上层弹"已上传过"提示而不是"请求失败"。
      // 抛带 code 的 Error 让 uploadViaBackend 识别。
      if (response.status === 409 && errorBody.error === 'EXISTING_FAILED_TASK') {
        const conflictErr = new Error(errorBody.message || '已上传过相同内容试卷，上次批改失败')
        conflictErr.code = 'EXISTING_FAILED_TASK'
        conflictErr.existingTask = errorBody.existingTask || null
        throw conflictErr
      }
      throw new Error(errorBody.error || `请求失败: ${response.status}`)
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
    console.debug('📤🔥 [taskService.uploadFiles] options.worksheetId=', options.worksheetId, 'len=', options.worksheetId?.length, 'taskType=', options.taskType, 'subject=', options.subject, 'resourceId=', options.resourceId)

    const formData = new FormData()
    formData.append('studentId', studentId)
    if (options.generatedExamId) formData.append('generatedExamId', options.generatedExamId)
    if (options.taskType) formData.append('taskType', options.taskType)
    if (options.retryPaperId) formData.append('retryPaperId', options.retryPaperId)
    if (options.worksheetId) formData.append('worksheetId', options.worksheetId)
    if (options.resourceId) formData.append('resourceId', options.resourceId)
    if (options.subject) formData.append('subject', options.subject)
    if (options.taskName) formData.append('taskName', options.taskName)

    // 诊断：检查 formData 实际内容
    const formDataEntries = []
    for (const [k, v] of formData.entries()) {
      formDataEntries.push(typeof v === 'string' ? `${k}=${v}` : `${k}=<File:${v.name}>`)
    }
    console.debug('📤🔥 [taskService.uploadFiles] FormData entries:', formDataEntries)

    // Add file names for multi-page papers
    if (options.fileNames) {
      options.fileNames.forEach((name, index) => {
        formData.append(`fileNames[${index}]`, name)
      })
    }

    for (const file of files) {
      formData.append('files', file)
    }

    // 内容 hash 去重：算每张图 SHA-256 拼成 X-Content-Hashes 头，
    // 服务端 student_id+content_hash 命中时直接返回旧 task。
    // 算失败（老浏览器/无 subtle）则服务端按无 hash 走原逻辑，不影响功能。
    const contentHashes = await computeContentHashes(files)
    const headers = {}
    if (contentHashes) headers['X-Content-Hashes'] = contentHashes.join(',')

    console.debug('📤 [taskService.uploadFiles] FormData constructed, calling apiRequest...')

    return apiRequest('/tasks/upload', {
      method: 'POST',
      body: formData,
      headers
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

    const contentHashes = await computeContentHashes(files)
    const headers = {}
    if (contentHashes) headers['X-Content-Hashes'] = contentHashes.join(',')

    return apiRequest('/tasks/upload', {
      method: 'POST',
      body: formData,
      headers
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

    const contentHashes = await computeContentHashes(files)
    const headers = {}
    if (contentHashes) headers['X-Content-Hashes'] = contentHashes.join(',')

    return apiRequest('/tasks/upload', {
      method: 'POST',
      body: formData,
      headers
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
