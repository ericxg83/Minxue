import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, 'server/.env') })

import { app, createServer } from './server/index.js'
import { query, TABLES } from './server/config/neon.js'

const BASE_URL = 'http://localhost:3001/api'
const PORT = 3001

let passedTests = 0
let failedTests = 0
let serverInstance = null

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✅ PASS: ${name}`)
    passedTests++
  } catch (err) {
    console.log(`  ❌ FAIL: ${name}`)
    console.log(`     Error: ${err.message}`)
    failedTests++
    throw err
  }
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function cleanupTestData(studentId) {
  if (!studentId) return
  try {
    await query(`DELETE FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM ${TABLES.GENERATED_EXAMS} WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM ${TABLES.QUESTIONS} WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM ${TABLES.TASKS} WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM ${TABLES.STUDENTS} WHERE id = $1`, [studentId])
    console.log(`  Cleanup completed for student: ${studentId}`)
  } catch (err) {
    console.log(`  Cleanup warning: ${err.message}`)
  }
}

async function main() {
  console.log('=== Minxue Auto-Debug Integration Test ===\n')
  console.log(`API Base: ${BASE_URL}\n`)
  console.log(`Database: ${process.env.NEON_DATABASE_URL?.split('@')[1]?.split('?')[0] || 'not set'}`)

  let studentId = null
  let taskId = null
  let questionId = null

  try {
    serverInstance = await createServer(PORT)
    await delay(1500)
    console.log('✅ Server started successfully\n')

    await test('Health check', async () => {
      const res = await fetch(`${BASE_URL}/health`)
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      if (data.status !== 'ok') throw new Error(`Expected ok, got: ${data.status}`)
      console.log(`     Timestamp: ${data.timestamp}`)
    })

    await test('Queue stats endpoint', async () => {
      const res = await fetch(`${BASE_URL}/queue/stats`)
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      console.log(`     Stats: ${JSON.stringify(data.stats)}`)
    })

    await test('Create student', async () => {
      const res = await fetch(`${BASE_URL}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `TestStudent_${Date.now()}`,
          grade: '高三·1班',
          class: '高三·1班'
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`Status: ${res.status}, ${err.error}`)
      }
      const data = await res.json()
      studentId = data.student?.id || data.id
      if (!studentId) throw new Error('No student ID returned')
      console.log(`     Student ID: ${studentId}`)
    })

    await test('Get students list', async () => {
      const res = await fetch(`${BASE_URL}/students`)
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      const students = data.students || data.data || []
      console.log(`     Students count: ${students.length}`)
    })

    await test('Get tasks by student (empty)', async () => {
      const res = await fetch(`${BASE_URL}/tasks/student/${studentId}`)
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      console.log(`     Tasks count: ${data.tasks?.length || 0}`)
    })

    await test('Create a task (for questions FK)', async () => {
      const res = await fetch(`${BASE_URL}/tasks/create-by-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          imageUrl: 'https://example.com/test.jpg',
          originalName: '测试试卷.jpg'
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`Status: ${res.status}, ${err.error}`)
      }
      const data = await res.json()
      taskId = data.task?.id
      console.log(`     Task ID: ${taskId}`)
    })

    await test('Create a question (for wrong questions FK)', async () => {
      const res = await fetch(`${BASE_URL}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: taskId,
          student_id: studentId,
          content: '测试题目',
          answer: 'A',
          options: ['A', 'B', 'C', 'D'],
          question_type: 'choice',
          subject: '数学'
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`Status: ${res.status}, ${err.error}`)
      }
      const data = await res.json()
      questionId = data.question?.id
      console.log(`     Question ID: ${questionId}`)
    })

    await test('Create wrong question entry', async () => {
      const res = await fetch(`${BASE_URL}/wrong-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          questionIds: [questionId]
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`Status: ${res.status}, ${err.error}`)
      }
      const data = await res.json()
      console.log(`     Added count: ${data.added?.length || 0}`)
    })

    await test('Get wrong questions by student', async () => {
      const res = await fetch(`${BASE_URL}/wrong-questions/student/${studentId}`)
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      console.log(`     Wrong questions count: ${data.wrongQuestions?.length || 0}`)
    })

    await test('Create generated exam', async () => {
      const res = await fetch(`${BASE_URL}/generated-exams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          name: '测试错题卷',
          questionIds: ['q-test-1', 'q-test-2', 'q-test-3']
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`Status: ${res.status}, ${err.error}`)
      }
      const data = await res.json()
      console.log(`     Exam ID: ${data.exam?.id}`)
    })

    await test('Get generated exams by student', async () => {
      const res = await fetch(`${BASE_URL}/generated-exams/student/${studentId}`)
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      const exams = data.generatedExams || []
      console.log(`     Exams count: ${exams.length}`)
      if (exams.length === 0) throw new Error('Exam was not found in the list')
    })

    await test('Get exams (combined endpoint)', async () => {
      const res = await fetch(`${BASE_URL}/exams/student/${studentId}`)
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      console.log(`     Combined exams count: ${data.exams?.length || 0}`)
    })

    console.log('\n=== Test Summary ===')
    console.log(`Passed: ${passedTests}, Failed: ${failedTests}`)

    if (failedTests > 0) {
      console.log('\n❌ Some tests failed!')
    } else {
      console.log('\n✅ All tests passed!')
    }
  } catch (err) {
    console.log(`\n❌ Test suite failed: ${err.message}`)
    console.log(`   Stack: ${err.stack}`)
  } finally {
    await cleanupTestData(studentId)
    if (serverInstance) {
      serverInstance.close()
      console.log('\nServer stopped.')
    }
  }

  process.exit(failedTests > 0 ? 1 : 0)
}

main().catch(err => {
  console.log(`\n❌ Fatal error: ${err.message}`)
  console.log(err.stack)
  process.exit(1)
})
