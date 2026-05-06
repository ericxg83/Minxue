import { supabase, TABLES } from '../config/supabase'

// ==================== 学生相关操作 ====================

// 获取所有学生（带本地缓存优化）
const CACHE_KEY = 'students_cache'
const CACHE_TIMESTAMP_KEY = 'students_cache_timestamp'
const CACHE_MAX_AGE = 5 * 60 * 1000 // 5分钟缓存有效期

export const getStudents = async (useCache = true) => {
  // 尝试从缓存读取
  if (useCache) {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      const cachedTime = localStorage.getItem(CACHE_TIMESTAMP_KEY)
      
      if (cached && cachedTime) {
        const age = Date.now() - parseInt(cachedTime)
        if (age < CACHE_MAX_AGE) {
          console.log('从本地缓存加载学生数据（瞬时响应）')
          return JSON.parse(cached)
        }
      }
    } catch (e) {
      console.warn('读取缓存失败:', e)
    }
  }

  // 从 Supabase 加载
  console.log('正在从 Supabase 获取学生列表...')
  
  const { data, error } = await supabase
    .from(TABLES.STUDENTS)
    .select('*')
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('Supabase 获取学生列表错误:', error)
    // 如果网络请求失败，尝试返回缓存数据作为降级
    if (useCache) {
      try {
        const cached = localStorage.getItem(CACHE_KEY)
        if (cached) {
          console.log('网络请求失败，使用缓存数据降级')
          return JSON.parse(cached)
        }
      } catch (e) {}
    }
    throw error
  }
  
  console.log('Supabase 返回的学生数据:', data)
  
  // 更新缓存
  if (data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
      localStorage.setItem(CACHE_TIMESTAMP_KEY, String(Date.now()))
    } catch (e) {
      console.warn('更新缓存失败:', e)
    }
  }
  
  return data ?? []
}

// 根据ID获取学生
export const getStudentById = async (id) => {
  const { data, error } = await supabase
    .from(TABLES.STUDENTS)
    .select('*')
    .eq('id', id)
    .single()
  
  if (error) {
    console.error('Supabase 获取学生详情错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
  return data
}

// 生成 UUID
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// 创建学生
export const createStudent = async (studentData) => {
  console.log('Supabase createStudent 接收到的数据:', studentData)
  
  // 清理数据，移除可能导致问题的字段
  const cleanData = {
    id: generateUUID(),
    name: studentData.name,
    grade: studentData.grade || null,
    class: studentData.class || null,
    remark: studentData.remark || null,
    avatar: studentData.avatar || null
  }
  
  console.log('清理后的数据:', cleanData)
  
  const { data, error } = await supabase
    .from(TABLES.STUDENTS)
    .insert([cleanData])
    .select()
    .single()
  
  if (error) {
    console.error('Supabase 创建学生错误:', error)
    throw error
  }
  
  console.log('Supabase 创建学生成功:', data)
  return data
}

// 更新学生
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
  
  if (error) {
    console.error('Supabase 更新学生错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
  return data
}

// 删除学生
export const deleteStudent = async (id) => {
  const { error } = await supabase
    .from(TABLES.STUDENTS)
    .delete()
    .eq('id', id)
  
  if (error) {
    console.error('Supabase 删除学生错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
  return true
}

// ==================== 任务相关操作 ====================

// 获取学生的所有任务（带本地缓存优化）
const TASKS_CACHE_PREFIX = 'tasks_cache_'
const TASKS_CACHE_TIMESTAMP_PREFIX = 'tasks_cache_ts_'
const TASKS_CACHE_MAX_AGE = 3 * 60 * 1000 // 3分钟缓存有效期

export const getTasksByStudent = async (studentId, useCache = true) => {
  // 尝试从缓存读取
  if (useCache) {
    try {
      const cacheKey = TASKS_CACHE_PREFIX + studentId
      const timestampKey = TASKS_CACHE_TIMESTAMP_PREFIX + studentId
      const cached = localStorage.getItem(cacheKey)
      const cachedTime = localStorage.getItem(timestampKey)
      
      if (cached && cachedTime) {
        const age = Date.now() - parseInt(cachedTime)
        if (age < TASKS_CACHE_MAX_AGE) {
          console.log(`从本地缓存加载任务数据（学生: ${studentId}）`)
          return JSON.parse(cached)
        }
      }
    } catch (e) {
      console.warn('读取任务缓存失败:', e)
    }
  }

  // 从 Supabase 加载
  console.log('从 Supabase 加载任务数据...')
  const { data, error } = await supabase
    .from(TABLES.TASKS)
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('Supabase 获取学生任务列表错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    // 网络请求失败时尝试使用缓存
    if (useCache) {
      try {
        const cacheKey = TASKS_CACHE_PREFIX + studentId
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          console.log('网络请求失败，使用任务缓存数据降级')
          return JSON.parse(cached)
        }
      } catch (e) {}
    }
    throw error
  }
  
  // 更新缓存
  if (data) {
    try {
      const cacheKey = TASKS_CACHE_PREFIX + studentId
      const timestampKey = TASKS_CACHE_TIMESTAMP_PREFIX + studentId
      localStorage.setItem(cacheKey, JSON.stringify(data))
      localStorage.setItem(timestampKey, String(Date.now()))
    } catch (e) {
      console.warn('更新任务缓存失败:', e)
    }
  }
  
  return data
}

// 获取学生的所有试卷（已完成的试卷）- 带本地缓存
const EXAMS_CACHE_PREFIX = 'exams_cache_'
const EXAMS_CACHE_TS_PREFIX = 'exams_cache_ts_'
const EXAMS_CACHE_MAX_AGE = 3 * 60 * 1000

export const getExamsByStudent = async (studentId, useCache = true) => {
  // 尝试从缓存读取
  if (useCache) {
    try {
      const cacheKey = EXAMS_CACHE_PREFIX + studentId
      const tsKey = EXAMS_CACHE_TS_PREFIX + studentId
      const cached = localStorage.getItem(cacheKey)
      const cachedTime = localStorage.getItem(tsKey)
      
      if (cached && cachedTime) {
        const age = Date.now() - parseInt(cachedTime)
        if (age < EXAMS_CACHE_MAX_AGE) {
          console.log(`从本地缓存加载试卷数据（学生: ${studentId}）`)
          return JSON.parse(cached)
        }
      }
    } catch (e) {
      console.warn('读取试卷缓存失败:', e)
    }
  }

  console.log('从 Supabase 加载试卷数据...')
  const { data, error } = await supabase
    .from(TABLES.TASKS)
    .select('*')
    .eq('student_id', studentId)
    .eq('status', 'done')
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('Supabase 获取学生试卷列表错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    // 网络请求失败时尝试使用缓存
    if (useCache) {
      try {
        const cacheKey = EXAMS_CACHE_PREFIX + studentId
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          console.log('网络请求失败，使用试卷缓存数据降级')
          return JSON.parse(cached)
        }
      } catch (e) {}
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

  // 更新缓存
  if (data) {
    try {
      const cacheKey = EXAMS_CACHE_PREFIX + studentId
      const tsKey = EXAMS_CACHE_TS_PREFIX + studentId
      localStorage.setItem(cacheKey, JSON.stringify(result))
      localStorage.setItem(tsKey, String(Date.now()))
    } catch (e) {
      console.warn('更新试卷缓存失败:', e)
    }
  }

  return result
}

// 创建任务
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
  
  if (error) {
    console.error('Supabase 创建任务错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
  
  return data
}

// 更新任务状态
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
  
  if (error) {
    console.error('Supabase 更新任务状态错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
  return data
}

// ==================== 题目相关操作 ====================

// 获取任务的所有题目 - 带本地缓存
const QUESTIONS_CACHE_PREFIX = 'questions_cache_'
const QUESTIONS_CACHE_TS_PREFIX = 'questions_cache_ts_'
const QUESTIONS_CACHE_MAX_AGE = 3 * 60 * 1000

export const getQuestionsByTask = async (taskId, useCache = true) => {
  // 尝试从缓存读取
  if (useCache) {
    try {
      const cacheKey = QUESTIONS_CACHE_PREFIX + taskId
      const tsKey = QUESTIONS_CACHE_TS_PREFIX + taskId
      const cached = localStorage.getItem(cacheKey)
      const cachedTime = localStorage.getItem(tsKey)
      
      if (cached && cachedTime) {
        const age = Date.now() - parseInt(cachedTime)
        if (age < QUESTIONS_CACHE_MAX_AGE) {
          console.log(`从本地缓存加载题目数据（任务: ${taskId}）`)
          return JSON.parse(cached)
        }
      }
    } catch (e) {
      console.warn('读取题目缓存失败:', e)
    }
  }

  console.log('从 Supabase 加载题目数据...')
  const { data, error } = await supabase
    .from(TABLES.QUESTIONS)
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
  
  if (error) {
    console.error('Supabase 获取任务题目列表错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    // 网络请求失败时尝试使用缓存
    if (useCache) {
      try {
        const cacheKey = QUESTIONS_CACHE_PREFIX + taskId
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          console.log('网络请求失败，使用题目缓存数据降级')
          return JSON.parse(cached)
        }
      } catch (e) {}
    }
    throw error
  }

  // 更新缓存
  if (data) {
    try {
      const cacheKey = QUESTIONS_CACHE_PREFIX + taskId
      const tsKey = QUESTIONS_CACHE_TS_PREFIX + taskId
      localStorage.setItem(cacheKey, JSON.stringify(data))
      localStorage.setItem(tsKey, String(Date.now()))
    } catch (e) {
      console.warn('更新题目缓存失败:', e)
    }
  }

  return data
}

// 批量创建题目
export const createQuestions = async (questions) => {
  const questionsWithTime = questions.map(q => {
    // 映射 status 为合法值：'pending', 'wrong', 'mastered'
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
  
  console.log('准备插入题目数据，数量:', questionsWithTime.length)
  console.log('示例题目:', questionsWithTime[0])
  
  const { data, error } = await supabase
    .from(TABLES.QUESTIONS)
    .insert(questionsWithTime)
    .select()
  
  if (error) {
    console.error('Supabase 批量创建题目错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
  
  console.log('题目插入成功，返回数据:', data?.length || 0, '条')
  return data
}

// 更新题目
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
  
  if (error) {
    console.error('Supabase 更新题目错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
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

  if (error) {
    console.error('Supabase 更新题目标签错误:', error)
    throw error
  }
  return data
}

export const batchUpdateQuestionTags = async (tagUpdates) => {
  const results = []
  for (const update of tagUpdates) {
    try {
      const result = await updateQuestionTags(update.id, update.ai_tags)
      results.push(result)
    } catch (error) {
      console.error(`批量更新标签失败，题目ID: ${update.id}`, error)
    }
  }
  return results
}

// ==================== 错题本相关操作 ====================

// 获取学生的所有错题 - 带本地缓存
const WRONG_CACHE_KEY = 'wrong_questions_cache'
const WRONG_CACHE_TS_KEY = 'wrong_questions_cache_ts'
const WRONG_CACHE_MAX_AGE = 3 * 60 * 1000

export const getWrongQuestionsByStudent = async (studentId, useCache = true) => {
  // 尝试从缓存读取
  if (useCache) {
    try {
      const cached = localStorage.getItem(WRONG_CACHE_KEY + studentId)
      const cachedTime = localStorage.getItem(WRONG_CACHE_TS_KEY + studentId)
      
      if (cached && cachedTime) {
        const age = Date.now() - parseInt(cachedTime)
        if (age < WRONG_CACHE_MAX_AGE) {
          console.log(`从本地缓存加载错题数据（学生: ${studentId}）`)
          return JSON.parse(cached)
        }
      }
    } catch (e) {
      console.warn('读取错题缓存失败:', e)
    }
  }

  try {
    console.log('从 Supabase 加载错题数据...')
    // 使用简单查询（避免关联查询失败）
    const { data: simpleData, error: simpleError } = await supabase
      .from(TABLES.WRONG_QUESTIONS)
      .select('*')
      .eq('student_id', studentId)
      .order('added_at', { ascending: false })
    
    if (simpleError) {
      console.error('Supabase 获取学生错题列表错误:', simpleError)
      console.error('错误详情:', { code: simpleError.code, message: simpleError.message, details: simpleError.details })
      // 网络请求失败时尝试使用缓存
      if (useCache) {
        try {
          const cached = localStorage.getItem(WRONG_CACHE_KEY + studentId)
          if (cached) {
            console.log('网络请求失败，使用错题缓存数据降级')
            return JSON.parse(cached)
          }
        } catch (e) {}
      }
      throw simpleError
    }
    
    // 简单查询成功，手动获取题目详情
    const wrongQuestionsWithDetails = await Promise.all(
      (simpleData || []).map(async (wq) => {
        try {
          const { data: questionData } = await supabase
            .from(TABLES.QUESTIONS)
            .select('*')
            .eq('id', wq.question_id)
            .single()
          return { ...wq, question: questionData }
        } catch (e) {
          return { ...wq, question: null }
        }
      })
    )
    
    // 更新缓存
    if (simpleData) {
      try {
        localStorage.setItem(WRONG_CACHE_KEY + studentId, JSON.stringify(wrongQuestionsWithDetails))
        localStorage.setItem(WRONG_CACHE_TS_KEY + studentId, String(Date.now()))
      } catch (e) {
        console.warn('更新错题缓存失败:', e)
      }
    }
    
    return wrongQuestionsWithDetails
  } catch (error) {
    console.error('Supabase 获取学生错题列表错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
}

// 添加错题
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
  
  if (error) {
    console.error('Supabase 添加错题错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
  return data
}

// 批量添加错题
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
  
  console.log('准备添加错题:', entries.length, '条')
  console.log('示例数据:', entries[0])
  
  // 先查询已存在的记录，避免重复插入
  const { data: existing, error: checkError } = await supabase
    .from(TABLES.WRONG_QUESTIONS)
    .select('id, question_id')
    .eq('student_id', studentId)
    .in('question_id', questionIds)
  
  if (checkError) {
    console.error('检查已有错题失败:', checkError)
  }
  
  const existingIds = new Set((existing || []).map(e => e.question_id))
  const newEntries = entries.filter(e => !existingIds.has(e.question_id))
  
  if (newEntries.length === 0) {
    console.log('题目已在错题本中，跳过添加')
    return []
  }
  
  console.log('新增错题数量:', newEntries.length)
  
  const { data, error } = await supabase
    .from(TABLES.WRONG_QUESTIONS)
    .insert(newEntries)
    .select()
  
  if (error) {
    console.error('Supabase 批量添加错题错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    
    // 如果是重复插入（唯一约束冲突），不抛错
    if (error.code === '23505') {
      console.warn('题目已在错题本中，跳过添加')
      return []
    }
    
    throw error
  }
  return data
}

// 更新错题状态
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
  
  if (error) {
    console.error('Supabase 更新错题状态错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
  return data
}

// 删除错题
export const deleteWrongQuestion = async (id) => {
  const { error } = await supabase
    .from(TABLES.WRONG_QUESTIONS)
    .delete()
    .eq('id', id)
  
  if (error) {
    console.error('Supabase 删除错题错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
  return true
}

// ==================== 练习记录相关操作 ====================

// 创建练习记录
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
  
  if (error) {
    console.error('Supabase 创建练习记录错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
  return data
}

// 更新练习结果
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
  
  if (error) {
    console.error('Supabase 更新练习结果错误:', error)
    console.error('错误详情:', { code: error.code, message: error.message, details: error.details })
    throw error
  }
  return data
}

// ==================== 文件上传相关操作 ====================

// 上传图片到 Storage
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

// 删除图片
export const deleteImage = async (path) => {
  const { error } = await supabase.storage
    .from('homework-images')
    .remove([path])
  
  if (error) throw error
  return true
}

// ==================== 生成试卷相关操作 ====================

const GENERATED_EXAMS_CACHE_PREFIX = 'generated_exams_cache_'
const GENERATED_EXAMS_TS_PREFIX = 'generated_exams_cache_ts_'
const GENERATED_EXAMS_CACHE_MAX_AGE = 3 * 60 * 1000

export const getGeneratedExamsByStudent = async (studentId, useCache = true) => {
  if (useCache) {
    try {
      const cacheKey = GENERATED_EXAMS_CACHE_PREFIX + studentId
      const tsKey = GENERATED_EXAMS_TS_PREFIX + studentId
      const cached = localStorage.getItem(cacheKey)
      const cachedTime = localStorage.getItem(tsKey)
      
      if (cached && cachedTime) {
        const age = Date.now() - parseInt(cachedTime)
        if (age < GENERATED_EXAMS_CACHE_MAX_AGE) {
          console.log(`从本地缓存加载生成试卷数据（学生: ${studentId}）`)
          return JSON.parse(cached)
        }
      }
    } catch (e) {
      console.warn('读取生成试卷缓存失败:', e)
    }
  }

  console.log('从 Supabase 加载生成试卷数据...')
  const { data, error } = await supabase
    .from(TABLES.GENERATED_EXAMS)
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('Supabase 获取学生生成试卷列表错误:', error)
    if (useCache) {
      try {
        const cacheKey = GENERATED_EXAMS_CACHE_PREFIX + studentId
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          console.log('网络请求失败，使用生成试卷缓存数据降级')
          return JSON.parse(cached)
        }
      } catch (e) {}
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

  if (data) {
    try {
      const cacheKey = GENERATED_EXAMS_CACHE_PREFIX + studentId
      const tsKey = GENERATED_EXAMS_TS_PREFIX + studentId
      localStorage.setItem(cacheKey, JSON.stringify(result))
      localStorage.setItem(tsKey, String(Date.now()))
    } catch (e) {
      console.warn('更新生成试卷缓存失败:', e)
    }
  }

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
  
  if (error) {
    console.error('Supabase 创建生成试卷错误:', error)
    throw error
  }
  
  return data
}

export const getQuestionsByIds = async (questionIds) => {
  if (!questionIds || questionIds.length === 0) return []
  
  const { data, error } = await supabase
    .from(TABLES.QUESTIONS)
    .select('*')
    .in('id', questionIds)
  
  if (error) {
    console.error('Supabase 根据ID获取题目错误:', error)
    throw error
  }
  
  return data || []
}
