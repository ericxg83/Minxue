import fetch from 'node-fetch'

const BASE_URL = process.env.API_URL || 'http://localhost:3001/api'

let passedTests = 0
let failedTests = 0

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

async function main() {
  console.log('=== Minxue Auto-Debug Integration Test ===\n')
  console.log(`API Base: ${BASE_URL}\n`)

  let studentId, taskId, questionId, wrongQuestionId, examId

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
        name: `测试学生_${Date.now()}`,
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

  await test('Upload image & create task', async () => {
    const FormData = (await import('form-data')).default
    const formData = new FormData()
    formData.append('studentId', studentId)
    formData.append('files', Buffer.from('test'), 'test.jpg')

    const res = await fetch(`${BASE_URL}/tasks/upload`, {
      method: 'POST',
      body: formData
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(`Status: ${res.status}, ${err.error}`)
    }
    const data = await res.json()
    console.log(`     Success: ${data.success}, Count: ${data.count}`)
    if (data.tasks && data.tasks[0]) {
      taskId = data.tasks[0].id
      console.log(`     Task ID: ${taskId}`)
    }
  })

  await test('Get tasks by student', async () => {
    const res = await fetch(`${BASE_URL}/tasks/student/${studentId}`)
    if (!res.ok) throw new Error(`Status: ${res.status}`)
    const data = await res.json()
    console.log(`     Tasks count: ${data.tasks?.length || 0}`)
  })

  await test('Create generated exam', async () => {
    const res = await fetch(`${BASE_URL}/generated-exams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        name: '测试错题卷',
        questionIds: ['q1', 'q2', 'q3']
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
  })

  await test('Create wrong question', async () => {
    const res = await fetch(`${BASE_URL}/wrong-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        questionIds: ['q-wrong-1']
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

  console.log('\n=== Test Summary ===')
  console.log(`Passed: ${passedTests}, Failed: ${failedTests}`)

  if (failedTests > 0) {
    console.log('\n❌ Some tests failed!')
    process.exit(1)
  } else {
    console.log('\n✅ All tests passed!')
    process.exit(0)
  }
}

main().catch(err => {
  console.log(`\n❌ Test suite failed: ${err.message}`)
  process.exit(1)
})
