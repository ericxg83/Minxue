import { supabase, TABLES } from '../config/supabase'

const CACHE_MAX_AGE = 15 * 60 * 1000

const getCache = (key) => {
  try {
    const cached = localStorage.getItem(key)
    const cachedTime = localStorage.getItem(key + '_ts')
    if (cached && cachedTime) {
      const age = Date.now() - parseInt(cachedTime)
      if (age < CACHE_MAX_AGE) {
        return JSON.parse(cached)
      }
    }
  } catch (e) {}
  return null
}

const getFallbackCache = (key) => {
  try {
    const cached = localStorage.getItem(key)
    return cached ? JSON.parse(cached) : null
  } catch (e) {}
  return null
}

const setCache = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data))
    localStorage.setItem(key + '_ts', String(Date.now()))
  } catch (e) {}
}

const clearCache = (key) => {
  try {
    localStorage.removeItem(key)
    localStorage.removeItem(key + '_ts')
  } catch (e) {}
}

export const getStudents = async (useCache = true) => {
  if (useCache) {
    const cached = getCache('students_cache')
    if (cached) return cached
  }

  const { data, error } = await supabase
    .from(TABLES.STUDENTS)
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    if (useCache) {
      const fallback = getFallbackCache('students_cache')
      if (fallback) return fallback
    }
    throw error
  }

  if (data) setCache('students_cache', data)
  return data ?? []
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

export const createStudent = async (studentData) => {
  const cleanData = {
    id: generateUUID(),
    name: studentData.name,
    grade: studentData.grade || null,
    class: studentData.class || null,
    remark: studentData.remark || null,
    avatar: studentData.avatar || null
  }

  const { data, error } = await supabase
    .from(TABLES.STUDENTS)
    .insert([cleanData])
    .select()
    .single()

  if (error) throw error

  clearCache('students_cache')
  return data
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
    const cached = getCache(cacheKey)
    if (cached) return cached
  }

  const { data, error } = await supabase
    .from(TABLES.TASKS)
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })

  if (error) {
    if (useCache) {
      const fallback = getFallbackCache(cacheKey)
      if (fallback) return fallback
    }
    throw error
  }

  if (data) setCache(cacheKey, data)
  return data
}

export const getExamsByStudent = async (studentId, useCache = true) => {
  const cacheKey = `exams_cache_${studentId}`

  if (useCache) {
    const cached = getCache(cacheKey)
    if (cached) return cached
  }

  const { data, error } = await supabase
    .from(TABLES.TASKS)
    .select('*')
    .eq('student_id', studentId)
    .eq('status', 'done')
    .order('created_at', { ascending: false })

  if (error) {
    if (useCache) {
      const fallback = getFallbackCache(cacheKey)
      if (fallback) return fallback
    }
    throw error
  }

  const result = (data || []).map(task => ({
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

  if (data) setCache(cacheKey, result)
  return result
}

export const createTask = async (taskData) => {
  const cleanData = {
    student_id: taskData.student_id,
    image_url: taskData.image_url || null,
    original_name: taskData.original_name || null,
    status: taskData.status || 'pending',
    result: taskData.result || null,
    created_at: new Date().toISOString()
  }

  const { data, error } = await supabase
    .from(TABLES.TASKS)
    .insert([cleanData])
    .select()
    .single()

  if (error) throw error
  clearCache(`tasks_cache_${taskData.student_id}`)
  return data
}

export const updateTaskStatus = async (taskId, status, result = null) => {
  const cleanUpdates = {
    status,
    updated_at: new Date().toISOString()
  }
  if (result !== null) {
    cleanUpdates.result = result
  }

  const { data, error } = await supabase
    .from(TABLES.TASKS)
    .update(cleanUpdates)
    .eq('id', taskId)
    .select()
    .single()

  if (error) throw error
  return data
}

// ==================== 题目相关操作 ====================

export const getQuestionsByTask = async (taskId, useCache = true) => {
  const cacheKey = `questions_cache_${taskId}`

  if (useCache) {
    const cached = getCache(cacheKey)
    if (cached) return cached
  }

  const { data, error } = await supabase
    .from(TABLES.QUESTIONS)
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  if (error) {
    if (useCache) {
      const fallback = getFallbackCache(cacheKey)
      if (fallback) return fallback
    }
    throw error
  }

  if (data) setCache(cacheKey, data)
  return data
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
    const cached = getCache(cacheKey)
    if (cached) return cached
  }

  try {
    const { data: wrongData, error: wrongError } = await supabase
      .from(TABLES.WRONG_QUESTIONS)
      .select('*')
      .eq('student_id', studentId)
      .order('added_at', { ascending: false })

    if (wrongError) {
      if (useCache) {
        const fallback = getFallbackCache(cacheKey)
        if (fallback) return fallback
      }
      throw wrongError
    }

    if (!wrongData || wrongData.length === 0) {
      setCache(cacheKey, [])
      return []
    }

    const questionIds = wrongData.map(wq => wq.question_id).filter(Boolean)

    let questionsMap = {}
    if (questionIds.length > 0) {
      const { data: questionsData } = await supabase
        .from(TABLES.QUESTIONS)
        .select('*')
        .in('id', questionIds)

      if (questionsData) {
        for (const q of questionsData) {
          questionsMap[q.id] = q
        }
      }
    }

    const result = wrongData.map(wq => ({
      ...wq,
      question: questionsMap[wq.question_id] || null
    }))

    setCache(cacheKey, result)
    return result
  } catch (error) {
    if (useCache) {
      const fallback = getFallbackCache(cacheKey)
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
  const entries = questionIds.map(questionId => ({
    student_id: studentId,
    question_id: questionId,
    status: 'pending',
    error_count: 1,
    added_at: new Date().toISOString(),
    last_wrong_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  }))

  const { data: existing, error: checkError } = await supabase
    .from(TABLES.WRONG_QUESTIONS)
    .select('id, question_id')
    .eq('student_id', studentId)
    .in('question_id', questionIds)

  const existingIds = new Set((existing || []).map(e => e.question_id))
  const newEntries = entries.filter(e => !existingIds.has(e.question_id))

  if (newEntries.length === 0) return []

  const { data, error } = await supabase
    .from(TABLES.WRONG_QUESTIONS)
    .insert(newEntries)
    .select()

  if (error) {
    if (error.code === '23505') return []
    throw error
  }
  clearCache(`wrong_questions_cache_${studentId}`)
  return data
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
    const cached = getCache(cacheKey)
    if (cached) return cached
  }

  const { data, error } = await supabase
    .from(TABLES.GENERATED_EXAMS)
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })

  if (error) {
    if (useCache) {
      const fallback = getFallbackCache(cacheKey)
      if (fallback) return fallback
    }
    throw error
  }

  const result = (data || []).map(exam => ({
    id: exam.id,
    student_id: exam.student_id,
    name: exam.name || '错题重练卷',
    question_ids: exam.question_ids || [],
    status: 'ungraded',
    created_at: exam.created_at,
    graded_at: null,
    source: 'generated'
  }))

  if (data) setCache(cacheKey, result)
  return result
}

export const createGeneratedExam = async (examData) => {
  const cleanData = {
    student_id: examData.student_id,
    name: examData.name || '错题重练卷',
    question_ids: examData.question_ids || [],
    created_at: new Date().toISOString()
  }

  const { data, error } = await supabase
    .from(TABLES.GENERATED_EXAMS)
    .insert([cleanData])
    .select()
    .single()

  if (error) throw error
  return data
}

export const getQuestionsByIds = async (questionIds) => {
  if (!questionIds || questionIds.length === 0) return []

  const { data, error } = await supabase
    .from(TABLES.QUESTIONS)
    .select('*')
    .in('id', questionIds)

  if (error) throw error
  return data || []
}
