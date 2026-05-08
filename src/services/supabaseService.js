import cacheManager from '../utils/cacheManager'

const API_BASE = import.meta.env.VITE_API_URL || '/api'
console.log('[API_BASE] 当前API地址:', API_BASE)

const CACHE_MAX_AGE = {
  STUDENTS: 15 * 60 * 1000,
  TASKS: 10 * 60 * 1000,
  EXAMS: 10 * 60 * 1000,
  QUESTIONS: 5 * 60 * 1000,
  WRONG: 5 * 60 * 1000,
  GENERATED: 10 * 60 * 1000
}

const readCache = (key, maxAge) => {
  const result = cacheManager.get(key, { maxAge, fallback: true })
  return result.data
}

const writeCache = (key, data) => {
  cacheManager.set(key, data)
}

const readFallbackCache = (key) => {
  const result = cacheManager.get(key, { fallback: true })
  return result.data
}

const clearCache = (key) => {
  cacheManager.remove(key)
}

export const getStudents = async (useCache = true) => {
  if (useCache) {
    const cached = readCache('students_cache', CACHE_MAX_AGE.STUDENTS)
    if (cached) return cached
  }
  try {
    const response = await fetch(`${API_BASE}/students`)
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '获取学生列表失败')
    }
    const result = await response.json()
    const data = result.students || []
    if (data) writeCache('students_cache', data)
    return data
  } catch (error) {
    console.error('获取学生列表错误:', error)
    if (useCache) {
      const fallback = readFallbackCache('students_cache')
      if (fallback) return fallback
    }
    throw error
  }
}

export const getStudentById = async (id) => {
  const response = await fetch(`${API_BASE}/students/${id}`)
  if (!response.ok) throw new Error('获取学生失败')
  const result = await response.json()
  return result.student
}

export const createStudent = async (studentData) => {
  const response = await fetch(`${API_BASE}/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: studentData.name,
      grade: studentData.grade || null,
      class: studentData.class || null,
      remark: studentData.remark || null,
      avatar: studentData.avatar || null
    })
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '创建学生失败')
  }
  const result = await response.json()
  clearCache('students_cache')
  return result.student
}

export const updateStudent = async (id, updates) => {
  const response = await fetch(`${API_BASE}/students/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '更新学生失败')
  }
  const result = await response.json()
  clearCache('students_cache')
  return result.student
}

export const deleteStudent = async (id) => {
  const response = await fetch(`${API_BASE}/students/${id}`, { method: 'DELETE' })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '删除学生失败')
  }
  clearCache('students_cache')
  return true
}

export const getTasksByStudent = async (studentId, useCache = true) => {
  const cacheKey = `tasks_${studentId}`
  if (useCache) {
    const cached = readCache(cacheKey, CACHE_MAX_AGE.TASKS)
    if (cached) return cached
  }
  try {
    const response = await fetch(`${API_BASE}/tasks/student/${studentId}`)
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '获取任务列表失败')
    }
    const result = await response.json()
    const data = result.tasks || []
    if (data) writeCache(cacheKey, data)
    return data
  } catch (error) {
    console.error('获取学生任务列表错误:', error)
    if (useCache) {
      const fallback = readFallbackCache(cacheKey)
      if (fallback) return fallback
    }
    throw error
  }
}

export const getExamsByStudent = async (studentId, useCache = true) => {
  const cacheKey = `exams_cache_${studentId}`
  if (useCache) {
    const cached = readCache(cacheKey, CACHE_MAX_AGE.EXAMS)
    if (cached) return cached
  }
  try {
    const response = await fetch(`${API_BASE}/exams/student/${studentId}`)
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '获取试卷列表失败')
    }
    const result = await response.json()
    const data = result.exams || []
    if (data) writeCache(cacheKey, data)
    return data
  } catch (error) {
    console.error('获取试卷列表错误:', error)
    if (useCache) {
      const fallback = readFallbackCache(cacheKey)
      if (fallback) return fallback
    }
    throw error
  }
}

export const createTask = async (taskData) => {
  const response = await fetch(`${API_BASE}/tasks/create-by-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId: taskData.student_id,
      imageUrl: taskData.image_url,
      originalName: taskData.original_name
    })
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '创建任务失败')
  }
  const result = await response.json()
  clearCache(`tasks_cache_${taskData.student_id}`)
  return result.task
}

export const updateTaskStatus = async (taskId, status, result = null) => {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '更新任务状态失败')
  }
  return await response.json()
}

export const getQuestionsByTask = async (taskId, useCache = true) => {
  const cacheKey = `questions_cache_${taskId}`
  if (useCache) {
    const cached = readCache(cacheKey, CACHE_MAX_AGE.QUESTIONS)
    if (cached) return cached
  }
  try {
    const response = await fetch(`${API_BASE}/questions/task/${taskId}`)
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '获取题目列表失败')
    }
    const result = await response.json()
    const data = result.questions || []
    if (data) writeCache(cacheKey, data)
    return data
  } catch (error) {
    console.error('获取题目列表错误:', error)
    if (useCache) {
      const fallback = readFallbackCache(cacheKey)
      if (fallback) return fallback
    }
    throw error
  }
}

export const createQuestions = async (questions) => {
  const response = await fetch(`${API_BASE}/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions })
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '创建题目失败')
  }
  const result = await response.json()
  return result.questions || []
}

export const updateQuestion = async (id, updates) => {
  const response = await fetch(`${API_BASE}/questions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '更新题目失败')
  }
  const result = await response.json()
  return result.question
}

export const updateQuestionTags = async (id, manualTags) => {
  const response = await fetch(`${API_BASE}/questions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manual_tags: manualTags, tags_source: 'manual' })
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '更新标签失败')
  }
  const result = await response.json()
  return result.question
}

export const batchUpdateQuestionTags = async (tagUpdates) => {
  const response = await fetch(`${API_BASE}/questions/batch-update-tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates: tagUpdates })
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '批量更新标签失败')
  }
  const result = await response.json()
  return result.results || []
}

export const getWrongQuestionsByStudent = async (studentId, useCache = true) => {
  const cacheKey = `wrong_questions_cache_${studentId}`
  if (useCache) {
    const cached = readCache(cacheKey, CACHE_MAX_AGE.WRONG)
    if (cached) return cached
  }
  try {
    const response = await fetch(`${API_BASE}/wrong-questions/student/${studentId}`)
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '获取错题列表失败')
    }
    const result = await response.json()
    const data = result.wrongQuestions || []
    writeCache(cacheKey, data)
    return data
  } catch (error) {
    console.error('获取错题本数据失败:', error)
    if (useCache) {
      const fallback = readFallbackCache(cacheKey)
      if (fallback) return fallback
    }
    throw error
  }
}

export const addWrongQuestion = async (studentId, questionId) => {
  return addWrongQuestions(studentId, [questionId])
}

export const addWrongQuestions = async (studentId, questionIds) => {
  const response = await fetch(`${API_BASE}/wrong-questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, questionIds })
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '添加错题失败')
  }
  const result = await response.json()
  clearCache(`wrong_questions_cache_${studentId}`)
  return result.added || []
}

export const updateWrongQuestionStatus = async (id, status) => {
  const response = await fetch(`${API_BASE}/wrong-questions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '更新错题状态失败')
  }
  const result = await response.json()
  return result.wrongQuestion
}

export const deleteWrongQuestion = async (id) => {
  const response = await fetch(`${API_BASE}/wrong-questions/${id}`, { method: 'DELETE' })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '删除错题失败')
  }
  return true
}

export const getGeneratedExamsByStudent = async (studentId, useCache = true) => {
  const cacheKey = `generated_exams_cache_${studentId}`
  if (useCache) {
    const cached = readCache(cacheKey, CACHE_MAX_AGE.GENERATED)
    if (cached) return cached
  }
  try {
    const response = await fetch(`${API_BASE}/generated-exams/student/${studentId}`)
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '获取生成试卷列表失败')
    }
    const result = await response.json()
    const data = result.generatedExams || []
    if (data) writeCache(cacheKey, data)
    return data
  } catch (error) {
    console.error('获取生成试卷列表错误:', error)
    if (useCache) {
      const fallback = readFallbackCache(cacheKey)
      if (fallback) return fallback
    }
    throw error
  }
}

export const createGeneratedExam = async (examData) => {
  const response = await fetch(`${API_BASE}/generated-exams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId: examData.student_id,
      name: examData.name,
      questionIds: examData.question_ids
    })
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '创建试卷失败')
  }
  const result = await response.json()
  clearCache(`generated_exams_cache_${examData.student_id}`)
  return result.exam
}

export const getQuestionsByIds = async (questionIds) => {
  if (!questionIds || questionIds.length === 0) return []
  const response = await fetch(`${API_BASE}/questions/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: questionIds })
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '批量获取题目失败')
  }
  const result = await response.json()
  return result.questions || []
}

export const clearAllCache = () => {
  cacheManager.invalidateAll()
  console.log('所有缓存已清除')
}

export const invalidateCache = (type, studentId) => {
  const keyMap = {
    students: 'students_cache',
    tasks: `tasks_${studentId}`,
    exams: `exams_${studentId}`,
    wrong: `wrong_questions_${studentId}`,
    pending: `tasks_${studentId}`,
    questions: null,
    generated: `generated_exams_${studentId}`
  }
  const key = keyMap[type]
  if (key) clearCache(key)
}

export const uploadImage = async (file, folder = 'tasks') => {
  if (!file) throw new Error('没有选择文件')

  try {
    const formData = new FormData()
    formData.append('files', file)

    const response = await fetch(`${API_BASE}/tasks/upload`, {
      method: 'POST',
      body: formData
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '图片上传失败')
    }

    const result = await response.json()
    if (result.success && result.tasks && result.tasks.length > 0) {
      const task = result.tasks[0]
      return task.image_url || task.imageUrl || task.url
    }
    return result.imageUrls?.[0] || result.url || result.imageUrl
  } catch (error) {
    console.error('上传图片失败:', error)
    throw error
  }
}
