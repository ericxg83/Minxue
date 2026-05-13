const API_BASE = import.meta.env.VITE_API_URL || '/api'

const CACHE_MAX_AGE = {
  STUDENTS: 15 * 60 * 1000,
  TASKS: 5 * 60 * 1000,
  EXAMS: 10 * 60 * 1000,
  QUESTIONS: 5 * 60 * 1000,
  WRONG: 5 * 60 * 1000,
  GENERATED: 10 * 60 * 1000
}

const readCache = (key, maxAge) => {
  try {
    const cached = localStorage.getItem(key)
    const cachedTime = localStorage.getItem(key + '_ts')
    if (cached && cachedTime) {
      const age = Date.now() - parseInt(cachedTime)
      if (age < maxAge) {
        return JSON.parse(cached)
      }
    }
  } catch (e) {
    console.warn('读取缓存失败:', e)
  }
  return null
}

const writeCache = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data))
    localStorage.setItem(key + '_ts', String(Date.now()))
  } catch (e) {
    console.warn('写入缓存失败:', e)
  }
}

const clearCache = (key) => {
  try {
    localStorage.removeItem(key)
    localStorage.removeItem(key + '_ts')
  } catch (e) {}
}

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

  const data = await response.json()
  return data
}

export const getStudents = async (useCache = true) => {
  if (useCache) {
    const cached = readCache('students_cache', CACHE_MAX_AGE.STUDENTS)
    if (cached) return cached
  }

  const data = await apiRequest('/students')
  const students = data.students || []

  if (students.length) writeCache('students_cache', students)
  return students
}

export const getStudentById = async (id) => {
  const data = await apiRequest('/students')
  return (data.students || []).find(s => s.id === id)
}

export const createStudent = async (studentData) => {
  const data = await apiRequest('/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: studentData.name,
      grade: studentData.grade || null,
      avatar: studentData.avatar || null
    })
  })
  clearCache('students_cache')
  return data.student
}

export const updateStudent = async (id, updates) => {
  const data = await apiRequest(`/students/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: updates.name,
      grade: updates.grade,
      avatar: updates.avatar
    })
  })
  clearCache('students_cache')
  return data.student
}

export const deleteStudent = async (id) => {
  await apiRequest(`/students/${id}`, { method: 'DELETE' })
  clearCache('students_cache')
  return true
}

export const getTasksByStudent = async (studentId, useCache = true) => {
  const cacheKey = `tasks_cache_${studentId}`

  if (useCache) {
    const cached = readCache(cacheKey, CACHE_MAX_AGE.TASKS)
    if (cached) return cached
  }

  const data = await apiRequest(`/tasks/student/${studentId}`)
  const tasks = data.tasks || []

  if (tasks.length) writeCache(cacheKey, tasks)
  return tasks
}

export const getExamsByStudent = async (studentId, useCache = true) => {
  const cacheKey = `exams_cache_${studentId}`

  if (useCache) {
    const cached = readCache(cacheKey, CACHE_MAX_AGE.EXAMS)
    if (cached) return cached
  }

  const data = await apiRequest(`/tasks/student/${studentId}`)
  const tasks = data.tasks || []
  const doneTasks = tasks.filter(t => t.status === 'done')

  const result = doneTasks.map(task => ({
    id: task.id,
    student_id: task.student_id,
    name: task.original_name || '未命名试卷',
    exam_no: '',
    thumbnail: task.image_url || '',
    question_count: task.result?.questionCount || 0,
    status: 'ungraded',
    created_at: task.created_at,
    graded_at: null
  }))

  if (doneTasks.length) writeCache(cacheKey, result)
  return result
}

export const createTask = async (taskData) => {
  const data = await apiRequest('/tasks/create-by-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId: taskData.student_id,
      imageUrl: taskData.image_url,
      originalName: taskData.original_name
    })
  })
  clearCache(`tasks_cache_${taskData.student_id}`)
  return data.task
}

export const updateTaskStatus = async (taskId, status, result = null) => {
  if (result) {
    const data = await apiRequest(`/tasks/${taskId}/retry`, { method: 'POST' })
    return data
  }
  return null
}

const parseQuestionFields = (q) => {
  const parse = (val, fallback) => {
    if (!val) return fallback
    if (typeof val === 'string') {
      try { return JSON.parse(val) } catch (e) { return fallback }
    }
    return Array.isArray(val) ? val : fallback
  }
  return {
    ...q,
    options: parse(q.options, []),
    ai_tags: parse(q.ai_tags, []),
    manual_tags: parse(q.manual_tags, []),
    block_coordinates: q.block_coordinates
      ? (typeof q.block_coordinates === 'string' ? (() => { try { return JSON.parse(q.block_coordinates) } catch(e) { return null } })() : q.block_coordinates)
      : null
  }
}

export const getQuestionsByTask = async (taskId, useCache = true) => {
  const cacheKey = `questions_cache_${taskId}`

  if (useCache) {
    const cached = readCache(cacheKey, CACHE_MAX_AGE.QUESTIONS)
    if (cached) return cached
  }

  const data = await apiRequest(`/questions/task/${taskId}`)
  const questions = (data.questions || []).map(parseQuestionFields)

  if (questions.length) writeCache(cacheKey, questions)
  return questions
}

export const getQuestionsByIds = async (questionIds) => {
  if (!questionIds || questionIds.length === 0) return []

  const data = await apiRequest('/questions/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: questionIds })
  })
  return (data.questions || []).map(parseQuestionFields)
}

export const updateQuestion = async (id, updates) => {
  return apiRequest(`/questions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: updates.content,
      options: updates.options,
      answer: updates.answer,
      analysis: updates.analysis,
      question_type: updates.question_type,
      subject: updates.subject,
      status: updates.status,
      image_url: updates.image_url,
      is_correct: updates.is_correct,
      student_answer: updates.student_answer
    })
  })
}

export const updateQuestionTags = async (id, manualTags) => {
  return apiRequest(`/questions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manual_tags: manualTags, tags_source: 'manual' })
  })
}

export const getWrongQuestionsByStudent = async (studentId, useCache = true) => {
  const cacheKey = `wrong_questions_cache_${studentId}`

  if (useCache) {
    const cached = readCache(cacheKey, CACHE_MAX_AGE.WRONG)
    if (cached) return cached
  }

  const data = await apiRequest(`/wrong-questions/student/${studentId}`)
  const wrongQuestions = data.wrongQuestions || []

  const questionIds = wrongQuestions.map(wq => wq.question_id).filter(Boolean)
  let questionsMap = {}

  if (questionIds.length > 0) {
    try {
      const qData = await getQuestionsByIds(questionIds)
      for (const q of qData) {
        questionsMap[q.id] = q
      }
    } catch (error) {
      console.warn('获取题目详情失败，使用错题本原始数据:', error.message)
    }
  }

  const result = wrongQuestions.map(wq => ({
    ...wq,
    question: questionsMap[wq.question_id] || null
  }))

  writeCache(cacheKey, result)
  return result
}

export const addWrongQuestions = async (studentId, questionIds) => {
  return apiRequest('/wrong-questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, questionIds })
  })
}

export const updateWrongQuestionStatus = async (id, status) => {
  return apiRequest(`/wrong-questions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  })
}

export const deleteWrongQuestion = async (id) => {
  return apiRequest(`/wrong-questions/${id}`, { method: 'DELETE' })
}

export const deleteTask = async (taskId) => {
  return apiRequest(`/tasks/${taskId}`, { method: 'DELETE' })
}

export const deleteGeneratedExam = async (id) => {
  return apiRequest(`/generated-exams/${id}`, { method: 'DELETE' })
}

export const getGeneratedExamsByStudent = async (studentId, useCache = true) => {
  const cacheKey = `generated_exams_cache_${studentId}`

  if (useCache) {
    const cached = readCache(cacheKey, CACHE_MAX_AGE.GENERATED)
    if (cached) return cached
  }

  const data = await apiRequest(`/generated-exams/student/${studentId}`)
  const exams = data.generatedExams || []

  const result = exams.map(exam => ({
    id: exam.id,
    student_id: exam.student_id,
    name: exam.name || '错题重练卷',
    question_ids: exam.question_ids || [],
    status: 'ungraded',
    created_at: exam.created_at,
    graded_at: null,
    source: 'generated'
  }))

  if (exams.length) writeCache(cacheKey, result)
  return result
}

export const createGeneratedExam = async (examData) => {
  const data = await apiRequest('/generated-exams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId: examData.student_id,
      name: examData.name || '错题重练卷',
      questionIds: examData.question_ids || []
    })
  })
  clearCache(`generated_exams_cache_${examData.student_id}`)
  return data.exam
}

export const uploadImage = async (file) => {
  const formData = new FormData()
  formData.append('files', file)

  const data = await apiRequest('/upload', {
    method: 'POST',
    body: formData
  })

  return data.url
}

export const clearAllCache = () => {
  try {
    const keys = Object.keys(localStorage)
    for (const key of keys) {
      if (key.includes('_cache') || key.includes('_ts')) {
        localStorage.removeItem(key)
      }
    }
    console.log('所有缓存已清除')
  } catch (e) {
    console.error('清除缓存失败:', e)
  }
}

export const invalidateCache = (type, studentId) => {
  const keyMap = {
    students: 'students_cache',
    tasks: `tasks_cache_${studentId}`,
    exams: `exams_cache_${studentId}`,
    wrong: `wrong_questions_cache_${studentId}`,
    questions: null,
    generated: `generated_exams_cache_${studentId}`
  }

  const key = keyMap[type]
  if (key) {
    clearCache(key)
  }
}
