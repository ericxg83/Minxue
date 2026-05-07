import { supabase, TABLES } from '../config/supabase.js'

export const uploadImage = async (fileBuffer, path, originalName) => {
  const fileExt = originalName ? originalName.split('.').pop() : 'jpg'
  const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`
  const filePath = `${path}/${fileName}`

  const { error: uploadError } = await supabase.storage
    .from('homework-images')
    .upload(filePath, fileBuffer, {
      contentType: `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`,
      upsert: false
    })

  if (uploadError) throw uploadError

  const { data: { publicUrl } } = supabase.storage
    .from('homework-images')
    .getPublicUrl(filePath)

  return publicUrl
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

  if (error) {
    console.error('创建任务失败:', error)
    throw error
  }

  return data
}

export const updateTaskStatus = async (taskId, status, result = null) => {
  const cleanUpdates = {
    status,
    updated_at: new Date().toISOString()
  }

  if (result !== null) {
    const { data: existingTask } = await supabase
      .from(TABLES.TASKS)
      .select('result')
      .eq('id', taskId)
      .single()

    cleanUpdates.result = {
      ...(existingTask?.result || {}),
      ...result
    }
  }

  const { data, error } = await supabase
    .from(TABLES.TASKS)
    .update(cleanUpdates)
    .eq('id', taskId)
    .select()
    .single()

  if (error) {
    console.error('更新任务状态失败:', error)
    throw error
  }

  return data
}

export const getTasksByStudent = async (studentId) => {
  const { data, error } = await supabase
    .from(TABLES.TASKS)
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('获取学生任务失败:', error)
    throw error
  }

  return data || []
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

  if (error) {
    console.error('批量创建题目失败:', error)
    throw error
  }

  return data
}

export const batchUpdateQuestionTags = async (tagUpdates) => {
  const results = []
  for (const update of tagUpdates) {
    try {
      const { data, error } = await supabase
        .from(TABLES.QUESTIONS)
        .update({
          ai_tags: update.ai_tags,
          tags_source: 'ai',
          updated_at: new Date().toISOString()
        })
        .eq('id', update.id)
        .select()
        .single()

      if (error) throw error
      results.push(data)
    } catch (error) {
      console.error(`更新标签失败，题目ID: ${update.id}`, error)
    }
  }
  return results
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

  if (checkError) {
    console.error('检查已有错题失败:', checkError)
  }

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

  return data
}
