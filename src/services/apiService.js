const API_BASE = import.meta.env.VITE_API_URL || '/api'

// 版本号：每次部署时自动清理旧缓存
const CACHE_VERSION = '20260701-v1'

const CACHE_MAX_AGE = {
  STUDENTS: 60 * 60 * 1000,      // 1小时（Phase 2优化：从24小时调整，学生信息变化频率低）
  TASKS: 5 * 60 * 1000,          // 5分钟
  EXAMS: 10 * 60 * 1000,         // 10分钟
  QUESTIONS: 30 * 60 * 1000,     // 30分钟（Phase 2优化：从5分钟延长，题目内容稳定）
  WRONG: 5 * 60 * 1000,          // 5分钟
  GENERATED: 10 * 60 * 1000      // 10分钟
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

export const clearCache = (key) => {
  try {
    localStorage.removeItem(key)
    localStorage.removeItem(key + '_ts')
  } catch (e) {}
}

// 自动检测缓存版本，版本不匹配时清理所有旧缓存
const checkCacheVersion = () => {
  const stored = localStorage.getItem('cache_version')
  if (stored !== CACHE_VERSION) {
    try {
      const prefixes = ['students_cache', 'tasks_cache_', 'wrong_questions_cache_', 'exams_cache_', 'generated_exams_cache_', 'questions_cache_', 'cache_version']
      prefixes.forEach(prefix => {
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith(prefix)) {
            localStorage.removeItem(key)
            localStorage.removeItem(key + '_ts')
          }
        })
      })
      localStorage.setItem('cache_version', CACHE_VERSION)
    } catch (e) {}
  }
}

// 页面加载时自动检查
checkCacheVersion()

const apiRequest = async (path, options = {}, retries = 2) => {
  const url = `${API_BASE}${path}`

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // 每个请求最多等 20 秒，防止 Render 冷启动时长时间挂起
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 20000)

      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers
        },
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(error.error || `请求失败: ${response.status}`)
      }

      const data = await response.json()
      return data
    } catch (error) {
      // 最后一次尝试失败时抛出错误
      if (attempt === retries - 1) {
        throw error
      }
      // 等待后重试（指数退避：1s, 2s）
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      console.warn(`请求失败，重试 ${attempt + 1}/${retries - 1}:`, path, error.message)
    }
  }
}

export const getStudents = async (useCache = true) => {
  if (useCache) {
    const cached = readCache('students_cache', CACHE_MAX_AGE.STUDENTS)
    if (cached) return { data: cached, fromCache: true }
  }

  const data = await apiRequest('/students')
  const students = data.students || []

  if (students.length) writeCache('students_cache', students)
  return { data: students, fromCache: false }
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

export const getTaskById = async (taskId) => {
  const data = await apiRequest(`/tasks/${taskId}`)
  return data.task
}

export const getTasksSummary = async () => {
  const data = await apiRequest('/tasks/summary')
  return data
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

  // Fetch questions for each task to calculate AI grading progress
  const result = await Promise.all(doneTasks.map(async (task) => {
    let questions = []
    try {
      questions = await getQuestionsByTask(task.id, false)
    } catch (e) {
      console.warn(`Failed to fetch questions for task ${task.id}:`, e)
    }
    const totalCount = questions.length || task.result?.questionCount || 0
    // Count AI-graded questions (questions with student_answer or ai_answer)
    const gradedCount = questions.filter(q => q.student_answer || q.ai_answer || q.is_correct !== undefined).length

    return {
      id: task.id,
      student_id: task.student_id,
      name: task.original_name || '未命名试卷',
      exam_no: '',
      thumbnail: task.image_url || '',
      question_count: totalCount,
      ai_graded_count: gradedCount,
      status: task.result ? 'done' : 'ungraded',
      created_at: task.created_at,
      graded_at: null,
      raw_task: task
    }
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
  return apiRequest(`/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  })
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

export const getQuestionsByIds = async (questionIds, studentId) => {
  if (!questionIds || questionIds.length === 0) return []

  const data = await apiRequest('/questions/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: questionIds, studentId })
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
      student_answer: updates.student_answer,
      ai_answer: updates.ai_answer,
      answer_source: updates.answer_source,
      geometry_image_url: updates.geometry_image_url,
      ai_tags: updates.ai_tags,           // 修复：使标签编辑落库
      review_status: updates.review_status // 透传，不覆盖已有值（服务端用 COALESCE）
    })
  })
}

/**
 * 搜索/筛选题目（轻量题目管理）
 * @param {Object} params - { keyword, subject, question_type, is_correct, status, student_id, limit, offset }
 */
export const searchQuestions = async (params = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== '' && v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const data = await apiRequest(`/questions/search?${qs}`)
  return data // { success, questions, total, limit, offset }
}

export const rejudgeQuestion = async (questionId) => {
  return apiRequest(`/questions/${questionId}/rejudge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
}

export const updateQuestionReviewStatus = async (questionId, reviewStatus) => {
  return apiRequest(`/questions/${questionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ review_status: reviewStatus })
  })
}

export const recalculateTaskStats = async (taskId) => {
  return apiRequest(`/tasks/${taskId}/recalculate-stats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
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

export const getLatestJudgements = async (studentId, questionIds) => {
  return apiRequest('/judgements/latest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, questionIds })
  })
}

export const addWrongQuestions = async (studentId, questionIds) => {
  return apiRequest('/wrong-questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, questionIds })
  })
}

export const updateWrongQuestionStatus = async (id, status, extraFields = {}) => {
  return apiRequest(`/wrong-questions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, ...extraFields })
  })
}

export const upsertWrongQuestionStatus = async (studentId, questionId, status, isCorrect) => {
  return apiRequest(`/wrong-questions/upsert`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, questionId, status, isCorrect })
  })
}

// 批量更新错题状态（Phase 1 优化）
export const batchUpsertWrongQuestionStatus = async (studentId, results) => {
  return apiRequest(`/wrong-questions/batch-upsert`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId,
      results: results.map(r => ({
        questionId: r.questionId,
        status: r.status,
        isCorrect: r.isCorrect
      }))
    })
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
    name: exam.name || `错题卷-${exam.created_at ? exam.created_at.slice(5,10) : new Date().toISOString().slice(5,10)}`,
    question_ids: exam.question_ids || [],
    status: exam.status === 'done' || exam.status === 'graded' ? 'graded' : 'ungraded',
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
      name: examData.name || `错题卷-${new Date().toISOString().slice(5,10)}`,
      questionIds: examData.question_ids || []
    })
  })
  clearCache(`generated_exams_cache_${examData.student_id}`)
  return data.exam
}

export const markGeneratedExamGraded = async (examId) => {
  const data = await apiRequest(`/generated-exams/${examId}/graded`, {
    method: 'PUT'
  })
  return data
}

// 批改组卷试卷（含掌握度进阶逻辑）
export const gradeGeneratedExam = async (examId, studentId, results) => {
  const data = await apiRequest(`/generated-exams/${examId}/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, results })
  })
  return data
}

export const uploadImage = async (file, studentId) => {
  const formData = new FormData()
  formData.append('files', file)
  if (studentId) formData.append('studentId', studentId)

  const data = await apiRequest('/upload', {
    method: 'POST',
    body: formData
  })

  return data.url
}

export const clearAllCache = () => {
  try {
    localStorage.removeItem('cache_version')
    const keys = Object.keys(localStorage)
    for (const key of keys) {
      if (key.includes('_cache') || key.includes('_ts')) {
        localStorage.removeItem(key)
      }
    }
    console.debug('所有缓存已清除')
  } catch (e) {
    console.error('清除缓存失败:', e)
  }
}

export const clearStudentCaches = (studentId) => {
  try {
    const studentCacheKeys = [
      `tasks_cache_${studentId}`,
      `exams_cache_${studentId}`,
      `wrong_questions_cache_${studentId}`,
      `generated_exams_cache_${studentId}`
    ]
    studentCacheKeys.forEach(key => {
      clearCache(key)
    })
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(`questions_cache_`)) {
        clearCache(key)
      }
    })
    console.debug(`学生 ${studentId} 的缓存已清除`)
  } catch (e) {
    console.error('清除学生缓存失败:', e)
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
