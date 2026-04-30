import { createClient } from '@supabase/supabase-js'

// 从环境变量读取 Supabase 配置
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY

// 在开发环境下使用代理路径
const isDevelopment = import.meta.env.VITE_APP_ENV === 'development'
const effectiveUrl = isDevelopment && typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? window.location.origin + '/supabase'
  : supabaseUrl

// 环境变量检查
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ 错误：缺少 Supabase 环境变量配置')
  console.error('请检查 .env.development 或 .env.production 文件')
}

export const supabase = createClient(effectiveUrl, supabaseKey, {
  global: {
    headers: {
      'X-Client-Info': 'minxue-app-v3'
    }
  }
})

// 数据库表名
export const TABLES = {
  STUDENTS: 'students',
  TASKS: 'tasks',
  QUESTIONS: 'questions',
  WRONG_QUESTIONS: 'wrong_questions',
  TRAINING_LOGS: 'training_logs'
}

// 任务状态
export const TASK_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed'
}

// 题目状态
export const QUESTION_STATUS = {
  PENDING: 'pending',
  WRONG: 'wrong',
  MASTERED: 'mastered'
}

// 错题状态
export const WRONG_STATUS = {
  PENDING: 'pending',
  MASTERED: 'mastered'
}

// 练习状态
export const TRAINING_STATUS = {
  PENDING: 'pending',
  DONE: 'done'
}
