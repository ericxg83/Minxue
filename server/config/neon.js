import { Pool } from 'pg'

const connectionString = process.env.NEON_DATABASE_URL

if (!connectionString) {
  console.warn('⚠️  缺少 NEON_DATABASE_URL 环境变量')
  console.warn('请检查 .env 文件或环境变量配置')
}

// 懒加载连接池，避免启动时报错
let _pool = null

const getPool = () => {
  if (!_pool) {
    if (!connectionString) {
      throw new Error('数据库未配置：缺少 NEON_DATABASE_URL 环境变量')
    }
    _pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    })

    _pool.on('error', (err) => {
      console.error('Neon 数据库连接池错误:', err)
    })
  }
  return _pool
}

export const query = async (text, params) => {
  const start = Date.now()
  try {
    const pool = getPool()
    const result = await pool.query(text, params)
    const duration = Date.now() - start
    if (duration > 100) {
      console.debug('慢查询:', { text: text.substring(0, 50), duration, rows: result.rowCount })
    }
    return result
  } catch (error) {
    console.error('数据库查询错误:', error)
    throw error
  }
}

export const transaction = async (callback) => {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

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

export const WRONG_STATUS = {
  PENDING: 'pending',
  MASTERED: 'mastered'
}

export const TRAINING_STATUS = {
  PENDING: 'pending',
  DONE: 'done'
}
