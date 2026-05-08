import { supabase, TABLES } from '../config/supabase'
import cacheManager from '../utils/cacheManager'

// ==================== 缓存工具函数 (兼容层，逐步迁移到 cacheManager) ====================

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

// ==================== 学生相关操作 ====================

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
  const { data, error } = await supabase
    .from(TABLES.STUDENTS)
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

const API_BASE = import.meta.env.VITE_API_URL || '/api'

export const createStudent = async (studentData) => {
  const response = await fetch(`${API_BASE}/students`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
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
  const allowedFields = ['name', 'grade', 'class', 'remark', 'avatar']
  const cleanUpdates = {}

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      cleanUpdates[field] = updates[field]
    }
  }

  cleanUpdates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from(TABLES.STUDENTS)
    .update(cleanUpdates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  clearCache('students_cache')
  return data
}

export const deleteStudent = async (id) => {
  const { error } = await supabase
    .from(TABLES.STUDENTS)
    .delete()
    .eq('id', id)

  if (error) throw error
  clearCache('students_cache')
  return true
}

// ==================== 任务相关操作 ====================

export const getTasksByStudent = async (studentId, useCache = true) => {
  const cacheKey = `tasks_cache_${studentId}`

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
  try {
    const response = await fetch(`${API_BASE}/tasks/create-by-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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
  } catch (error) {
    console.error('创建任务错误:', error)
    throw error
  }
}

export const updateTaskStatus = async (taskId, status, result = null) => {
  try {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/retry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '更新任务状态失败')
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('更新任务状态错误:', error)
    throw error
  }
}

// ==================== 题目相关操作 ====================

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
  const questionsWithTime = questions.map(q => {
    let statusValue = 'pending'
    if (q.status === 'wrong' || !q.is_correct) {
      statusValue = 'wrong'
    } else if (q.status === 'mastered') {
      statusValue = 'mastered'
    }

    return {
      task_id: q.task_id,
      student_id: q.student_id,
      content: q.content || null,
      options: q.options || [],
      answer: q.answer || null,
      analysis: q.analysis || null,
      question_type: q.question_type || 'choice',
      subject: q.subject || null,
      is_correct: q.is_correct !== undefined ? q.is_correct : true,
      status: statusValue,
      image_url: q.image_url || null,
      ai_tags: q.ai_tags || [],
      manual_tags: q.manual_tags || [],
      tags_source: q.tags_source || 'ai',
      created_at: new Date().toISOString()
    }
  })

  const { data, error } = await supabase
    .from(TABLES.QUESTIONS)
    .insert(questionsWithTime)
    .select()

  if (error) throw error
  return data
}

export const updateQuestion = async (id, updates) => {
  const allowedFields = ['content', 'options', 'answer', 'analysis', 'question_type', 'subject', 'is_correct', 'status', 'image_url', 'ai_tags', 'manual_tags', 'tags_source']
  const cleanUpdates = {}

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      cleanUpdates[field] = updates[field]
    }
  }

  cleanUpdates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from(TABLES.QUESTIONS)
    .update(cleanUpdates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export const updateQuestionTags = async (id, manualTags) => {
  const cleanUpdates = {
    manual_tags: manualTags,
    tags_source: 'manual',
    updated_at: new Date().toISOString()
  }

  const { data, error } = await supabase
    .from(TABLES.QUESTIONS)
    .update(cleanUpdates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export const batchUpdateQuestionTags = async (tagUpdates) => {
  const results = []
  for (const update of tagUpdates) {
    try {
      const result = await updateQuestionTags(update.id, update.ai_tags)
      results.push(result)
    } catch (error) {}
  }
  return results
}

// ==================== 错题本相关操作 ====================

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
  const { data, error } = await supabase
    .from(TABLES.WRONG_QUESTIONS)
    .insert([{
      student_id: studentId,
      question_id: questionId,
      status: 'pending',
      added_at: new Date().toISOString()
    }])
    .select()
    .single()

  if (error) throw error
  clearCache(`wrong_questions_cache_${studentId}`)
  return data
}

export const addWrongQuestions = async (studentId, questionIds) => {
  try {
    const response = await fetch(`${API_BASE}/wrong-questions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ studentId, questionIds })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '添加错题失败')
    }

    const result = await response.json()
    clearCache(`wrong_questions_cache_${studentId}`)
    return result.added || []
  } catch (error) {
    console.error('添加错题错误:', error)
    throw error
  }
}

export const updateWrongQuestionStatus = async (id, status) => {
  const { data, error } = await supabase
    .from(TABLES.WRONG_QUESTIONS)
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export const deleteWrongQuestion = async (id) => {
  const { error } = await supabase
    .from(TABLES.WRONG_QUESTIONS)
    .delete()
    .eq('id', id)

  if (error) throw error
  return true
}

// ==================== 练习记录相关操作 ====================

export const createTrainingLog = async (studentId, questionId) => {
  const { data, error } = await supabase
    .from(TABLES.TRAINING_LOGS)
    .insert([{
      student_id: studentId,
      question_id: questionId,
      status: 'pending',
      created_at: new Date().toISOString()
    }])
    .select()
    .single()

  if (error) throw error
  return data
}

export const updateTrainingResult = async (id, result) => {
  const { data, error } = await supabase
    .from(TABLES.TRAINING_LOGS)
    .update({
      result,
      status: 'done',
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// ==================== 文件上传相关操作 ====================

export const uploadImage = async (file, path) => {
  const fileExt = file.name.split('.').pop()
  const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`
  const filePath = `${path}/${fileName}`

  const { error: uploadError } = await supabase.storage
    .from('homework-images')
    .upload(filePath, file)

  if (uploadError) throw uploadError

  const { data: { publicUrl } } = supabase.storage
    .from('homework-images')
    .getPublicUrl(filePath)

  return publicUrl
}

export const deleteImage = async (path) => {
  const { error } = await supabase.storage
    .from('homework-images')
    .remove([path])

  if (error) throw error
  return true
}

// ==================== 生成试卷相关操作 ====================

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
  try {
    const response = await fetch(`${API_BASE}/generated-exams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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
  } catch (error) {
    console.error('创建试卷错误:', error)
    throw error
  }
}

export const getQuestionsByIds = async (questionIds) => {
  if (!questionIds || questionIds.length === 0) return []

  try {
    const response = await fetch(`${API_BASE}/questions/batch?ids=${questionIds.join(',')}`)
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '批量获取题目失败')
    }
    const result = await response.json()
    return result.questions || []
  } catch (error) {
    console.error('批量获取题目错误:', error)
    throw error
  }
}

// ==================== 缓存清理工具 ====================

export const clearAllCache = () => {
  cacheManager.invalidateAll()
  console.log('所有缓存已清除')
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
