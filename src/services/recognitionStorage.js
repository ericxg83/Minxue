// 识别日志存储键名
const RECOGNITION_LOGS_KEY = 'ai_recognition_logs'

// 记录识别日志到本地存储
export const logRecognition = (logEntry) => {
  try {
    const logs = JSON.parse(localStorage.getItem(RECOGNITION_LOGS_KEY) || '[]')
    logs.unshift({
      ...logEntry,
      timestamp: new Date().toISOString()
    })
    // 只保留最近100条日志
    if (logs.length > 100) {
      logs.pop()
    }
    localStorage.setItem(RECOGNITION_LOGS_KEY, JSON.stringify(logs))
  } catch (error) {
    console.error('记录日志失败:', error)
  }
}

// 获取识别日志
export const getRecognitionLogs = () => {
  try {
    return JSON.parse(localStorage.getItem(RECOGNITION_LOGS_KEY) || '[]')
  } catch {
    return []
  }
}

// 清空识别日志
export const clearRecognitionLogs = () => {
  localStorage.removeItem(RECOGNITION_LOGS_KEY)
}

// 保存识别结果到本地数据库
export const saveRecognitionResult = (taskId, studentId, questions) => {
  try {
    const storageKey = `recognition_results_${studentId}`
    const existing = JSON.parse(localStorage.getItem(storageKey) || '[]')

    const resultEntry = {
      id: `rec-${Date.now()}`,
      task_id: taskId,
      student_id: studentId,
      questions: questions.map(q => ({
        question_id: q.id,
        question_text: q.content,
        question_type: q.question_type,
        options: q.options,
        answer: q.answer,
        student_answer: q.student_answer,
        is_correct: q.is_correct,
        status: q.is_correct ? '识别成功' : '识别成功',
        exam_date: new Date().toISOString()
      })),
      created_at: new Date().toISOString()
    }

    existing.unshift(resultEntry)

    // 只保留最近50条记录
    if (existing.length > 50) {
      existing.pop()
    }

    localStorage.setItem(storageKey, JSON.stringify(existing))
    return { success: true }
  } catch (error) {
    console.error('保存识别结果失败:', error)
    return { success: false, error: error.message }
  }
}

// 获取本地存储的识别结果
export const getRecognitionResults = (studentId) => {
  try {
    const storageKey = `recognition_results_${studentId}`
    return JSON.parse(localStorage.getItem(storageKey) || '[]')
  } catch {
    return []
  }
}
