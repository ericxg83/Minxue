import { Pool } from 'pg'

let _pool = null

const getPool = () => {
  if (!_pool) {
    const connectionString = process.env.NEON_DATABASE_URL
    
    if (!connectionString) {
      throw new Error('鏁版嵁搴撴湭閰嶇疆锛氱己灏?NEON_DATABASE_URL 鐜鍙橀噺')
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
      console.error('Neon 鏁版嵁搴撹繛鎺ユ睜閿欒:', err)
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
      console.debug('鎱㈡煡璇?', { text: text.substring(0, 50), duration, rows: result.rowCount })
    }
    return result
  } catch (error) {
    console.error('鏁版嵁搴撴煡璇㈤敊璇?', error)
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
  GENERATED_EXAMS: 'generated_exams',
  QUESTION_CACHE: 'question_cache',
  JUDGEMENTS: 'judgements'
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

export const getQuestionsByTask = async (taskId) => {
  const { rows } = await query(`SELECT * FROM ${TABLES.QUESTIONS} WHERE task_id = $1 ORDER BY created_at`, [taskId])
  return rows
}

