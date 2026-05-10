import 'dotenv/config'
import { app, createServer } from './server/index.js'
import { query } from './server/config/neon.js'

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
    await query(`DELETE FROM wrong_questions WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM generated_exams WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM questions WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM tasks WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM students WHERE id = $1`, [studentId])
    console.log(`  Cleanup completed for student: ${studentId}`)
  } catch (err) {
    console.log(`  Cleanup warning: ${err.message}`)
  }
}

async function main() {
  console.log('=== Minxue Auto-Debug Integration Test ===\n')
  console.log(`API Base: ${BASE_URL}\n`)

  let studentId = null
  let examId = null

  try {
    serverInstance = await createServer(PORT)
    await delay(1500)
    console.log('✅ Server started successfully\n')

    await test('Health check', async () => {
      const res = await fetch(`${BASE_URL}/health`)
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      if (data.status !== 'ok') throw new Error(`Expected ok, got: ${data.status}`)
      console.log(`     DB: ${data.database}`)
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
      studentId = data.student.id
      console.log(`     Student ID: ${studentId}`)
    })

    await test('Get students list', async () => {
      const res = await fetch(`${BASE_URL}/students`)
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      console.log(`     Students count: ${data.students?.length || 0}`)
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
      examId = data.exam.id
      console.log(`     Exam ID: ${examId}`)
    })

    await test('Get generated exams by student', async () => {
      const res = await fetch(`${BASE_URL}/generated-exams/student/${studentId}`)
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      console.log(`     Exams count: ${data.generatedExams?.length || 0}`)
      if ((data.generatedExams?.length || 0) === 0) {
        throw new Error('Exam was not found in the list')
      }
    })

    await test('Create wrong question entry', async () => {
      const res = await fetch(`${BASE_URL}/wrong-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          questionIds: ['q-wrong-test-1']
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

    await test('Get exams (combined endpoint)', async () => {
      const res = await fetch(`${BASE_URL}/exams/student/${studentId}`)
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      console.log(`     Combined exams count: ${data.exams?.length || 0}`)
    })

    await test('Delete generated exam', async () => {
      const res = await fetch(`${BASE_URL}/generated-exams/${examId}`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error(`Status: ${res.status}`)
      const data = await res.json()
      console.log(`     Deleted: ${data.message}`)
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
