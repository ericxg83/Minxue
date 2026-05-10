import { spawn } from 'child_process'
import { createServer } from './server/index.js'
import { query, TABLES } from './server/config/neon.js'
import FormData from 'form-data'

const FRONTEND_PORT = 3000
const SERVER_PORT = 3001
const API_BASE = 'http://localhost:3001/api'

console.log('=== E2E Upload Flow Test ===\n')

let backendServer = null
let frontendServer = null
let studentId = null
let taskId = null

async function startBackend() {
  console.log('🔵 Starting backend server...')
  backendServer = await createServer(SERVER_PORT)
  console.log(`✅ Backend running on port ${SERVER_PORT}`)
}

async function startFrontend() {
  console.log('🟢 Starting frontend dev server...')
  return new Promise((resolve, reject) => {
    const vite = spawn('npx', ['vite', '--port', FRONTEND_PORT.toString(), '--open', 'false'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    })

    vite.stdout.on('data', (data) => {
      const output = data.toString()
      console.log('  [Vite]', output.trim())
      if (output.includes('ready') || output.includes('Local:') || output.includes('http://localhost')) {
        setTimeout(resolve, 3000)
      }
    })

    vite.stderr.on('data', (data) => {
      const output = data.toString()
      console.error('  [Vite ERR]', output.trim())
      if (output.includes('ready') || output.includes('Local:') || output.includes('http://localhost')) {
        setTimeout(resolve, 3000)
      }
    })

    vite.on('error', (err) => {
      reject(new Error(`Failed to start Vite: ${err.message}`))
    })

    frontendServer = vite

    // Fallback timeout in case detection fails
    setTimeout(resolve, 8000)
  })
}

async function testHealthCheck() {
  console.log('\n--- Test 1: Backend Health Check ---')
  try {
    const res = await fetch(`${API_BASE}/health`)
    if (!res.ok) throw new Error(`Status: ${res.status}`)
    const data = await res.json()
    console.log(`  ✅ Backend healthy: ${data.status}`)
    return true
  } catch (err) {
    console.log(`  ❌ Health check failed: ${err.message}`)
    return false
  }
}

async function testFrontendProxy() {
  console.log('\n--- Test 2: Frontend Vite Proxy ---')
  try {
    const res = await fetch(`http://localhost:${FRONTEND_PORT}/api/health`)
    if (!res.ok) throw new Error(`Status: ${res.status}`)
    const data = await res.json()
    console.log(`  ✅ Vite proxy working: ${data.status}`)
    return true
  } catch (err) {
    console.log(`  ❌ Vite proxy failed: ${err.message}`)
    return false
  }
}

async function testStudentCreation() {
  console.log('\n--- Test 3: Create Student ---')
  try {
    const res = await fetch(`${API_BASE}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `E2E_Test_${Date.now()}`,
        grade: '高三·1班'
      })
    })

    if (!res.ok) {
      const errData = await res.json()
      throw new Error(`Status: ${res.status}, ${errData.error}`)
    }

    const data = await res.json()
    studentId = data.student?.id || data.id
    console.log(`  ✅ Student created: ${studentId}`)
    return true
  } catch (err) {
    console.log(`  ❌ Student creation failed: ${err.message}`)
    return false
  }
}

async function testTaskCreation() {
  console.log('\n--- Test 4: Create Task (via create-by-url) ---')
  try {
    const res = await fetch(`${API_BASE}/tasks/create-by-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        imageUrl: 'https://example.com/test.jpg',
        originalName: '测试试卷.jpg'
      })
    })

    if (!res.ok) {
      const errData = await res.json()
      throw new Error(`Status: ${res.status}, ${errData.error}`)
    }

    const data = await res.json()
    taskId = data.task?.id
    console.log(`  ✅ Task created: ${taskId}`)
    return true
  } catch (err) {
    console.log(`  ❌ Task creation failed: ${err.message}`)
    return false
  }
}

async function testFileUpload() {
  console.log('\n--- Test 5: Upload Image Files ---')
  try {
    // Create a minimal JPEG buffer (valid JPEG header + minimal data)
    const jpegBuffer = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
      0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
      0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
      0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
      0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
      0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xD9
    ])

    const formData = new FormData()
    formData.append('studentId', studentId)
    formData.append('files', jpegBuffer, { filename: 'test_upload.jpg', contentType: 'image/jpeg' })

    console.log(`  📤 Uploading to ${API_BASE}/tasks/upload`)
    console.log(`     FormData: studentId=${studentId}, files=[test_upload.jpg]`)

    const res = await fetch(`${API_BASE}/tasks/upload`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders ? formData.getHeaders() : {}
    })

    console.log(`  📡 Response status: ${res.status}`)

    if (!res.ok) {
      const errData = await res.json()
      console.log(`  ❌ Upload failed: ${res.status} - ${errData.error}`)
      return false
    }

    const data = await res.json()
    console.log(`  ✅ Upload success! Response: ${JSON.stringify(data).substring(0, 300)}`)

    // Verify tasks are visible
    const tasksRes = await fetch(`${API_BASE}/tasks/student/${studentId}`)
    const tasksData = await tasksRes.json()
    console.log(`  📋 Student tasks count: ${tasksData.tasks?.length || 0}`)

    if (tasksData.tasks && tasksData.tasks.length > 0) {
      const task = tasksData.tasks[0]
      console.log(`  📋 Task ID: ${task.id}`)
      console.log(`  📋 Task status: ${task.status}`)
      console.log(`  📋 Task image_url: ${task.image_url?.substring(0, 80)}...`)
    }

    return true
  } catch (err) {
    console.log(`  ❌ Upload test failed: ${err.message}`)
    console.log(`     Stack: ${err.stack}`)
    return false
  }
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...')
  if (studentId) {
    try {
      await query(`DELETE FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1`, [studentId]).catch(() => {})
      await query(`DELETE FROM ${TABLES.GENERATED_EXAMS} WHERE student_id = $1`, [studentId]).catch(() => {})
      await query(`DELETE FROM ${TABLES.QUESTIONS} WHERE student_id = $1`, [studentId]).catch(() => {})
      await query(`DELETE FROM ${TABLES.TASKS} WHERE student_id = $1`, [studentId]).catch(() => {})
      await query(`DELETE FROM ${TABLES.STUDENTS} WHERE id = $1`, [studentId]).catch(() => {})
      console.log(`  ✅ Cleaned up student ${studentId}`)
    } catch (err) {
      console.log(`  ⚠️ Cleanup warning: ${err.message}`)
    }
  }
}

async function stopServers() {
  if (frontendServer) {
    frontendServer.kill('SIGTERM')
    console.log('  ⏹️  Frontend dev server stopped')
  }
  if (backendServer) {
    backendServer.close()
    console.log('  ⏹️  Backend server stopped')
  }
}

async function main() {
  let allPassed = true

  try {
    // Start both servers
    await startBackend()
    await startFrontend()
    console.log('\n✅ Both servers running\n')

    // Run tests
    const health = await testHealthCheck()
    const proxy = await testFrontendProxy()
    const student = await testStudentCreation()
    const task = await testTaskCreation()
    const upload = await testFileUpload()

    allPassed = health && proxy && student && task && upload

    console.log('\n' + '='.repeat(60))
    console.log('E2E Upload Flow Test Summary')
    console.log('='.repeat(60))
    console.log(`  Health Check:      ${health ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`  Vite Proxy:        ${proxy ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`  Student Creation:  ${student ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`  Task Creation:     ${task ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`  File Upload:       ${upload ? '✅ PASS' : '❌ FAIL'}`)
    console.log('='.repeat(60))

    if (allPassed) {
      console.log('\n✅ ALL TESTS PASSED')
    } else {
      console.log('\n❌ SOME TESTS FAILED')
    }

  } catch (err) {
    console.log(`\n💥 Fatal error: ${err.message}`)
    console.log(err.stack)
    allPassed = false
  } finally {
    await cleanup()
    await stopServers()
  }

  process.exit(allPassed ? 0 : 1)
}

main()
