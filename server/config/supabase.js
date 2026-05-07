import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ 缺少 Supabase 环境变量配置')
  process.exit(1)
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    headers: {
      'X-Client-Info': 'minxue-server'
    }
  }
})

export const TABLES = {
  STUDENTS: 'students',
  TASKS: 'tasks',
  QUESTIONS: 'questions',
  WRONG_QUESTIONS: 'wrong_questions',
  TRAINING_LOGS: 'training_logs',
  GENERATED_EXAMS: 'generated_exams'
}

export const TASK_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed'
}

export const QUESTION_STATUS = {
  PENDING: 'pending',
  WRONG: 'wrong',
  MASTERED: 'mastered'
}
