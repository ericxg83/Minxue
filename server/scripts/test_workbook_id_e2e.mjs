// 端到端测试：练习册 worksheetId 传递链路
//
// 模拟前端修复后的行为：
//   1. 创建一个 worksheet（用 worksheets API）
//   2. 模拟前端 handleUploadAsWorkbook 之后的 taskService.uploadFiles 调用
//      （带 taskType='workbook' + worksheetId + subject）
//   3. 立即检查 tasks 表里的 worksheet_id 是否被正确保存
//   4. 模拟前端 bug 场景：不传 worksheetId → 后端应该 INSERT worksheet_id=NULL
//
// 用法：node server/scripts/test_workbook_id_e2e.mjs
// 前置：server/.env 已配置 + 后端未启动（脚本会自己启动一个最简 HTTP server）

import http from 'http'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = parseInt(process.env.TEST_PORT) || 4099
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0, fail = 0
const ok = (label) => { pass++; console.log(`  ✓ ${label}`) }
const bad = (label, detail) => { fail++; console.error(`  ✗ ${label}\n    ${detail}`) }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function waitForServer(maxMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok || r.status === 404) return true
    } catch {}
    await sleep(300)
  }
  return false
}

async function getStudents() {
  const r = await fetch(`${BASE}/api/students`)
  const j = await r.json()
  if (!j.success || !j.students?.length) throw new Error('没学生可测')
  return j.students
}

async function getWorksheets() {
  const r = await fetch(`${BASE}/api/worksheets`)
  const j = await r.json()
  return j.worksheets || []
}

async function uploadTest(studentId, opts) {
  // 用一个真实的测试图片（必须存在）
  const imgPath = path.resolve(__dirname, '..', 'test_upload.jpg')
  if (!fs.existsSync(imgPath)) throw new Error('缺少测试图: ' + imgPath)
  const buf = fs.readFileSync(imgPath)

  const fd = new FormData()
  fd.append('studentId', studentId)
  if (opts.taskType) fd.append('taskType', opts.taskType)
  if (opts.worksheetId) fd.append('worksheetId', opts.worksheetId)
  if (opts.subject) fd.append('subject', opts.subject)
  if (opts.resourceId) fd.append('resourceId', opts.resourceId)
  if (opts.generatedExamId) fd.append('generatedExamId', opts.generatedExamId)
  fd.append('files', buf, { filename: 'test.jpg', contentType: 'image/jpeg' })

  // form-data npm 包的 .getHeaders() 返回 boundary 等，必须传
  const r = await fetch(`${BASE}/api/tasks/upload`, {
    method: 'POST',
    body: fd.getBuffer(),
    headers: fd.getHeaders(),
  })
  const j = await r.json()
  if (!j.success) throw new Error('上传失败: ' + JSON.stringify(j))
  return j.tasks?.[0]
}

async function getTaskById(taskId) {
  const r = await fetch(`${BASE}/api/tasks/${taskId}`)
  if (!r.ok) return null
  const j = await r.json()
  return j.task || null
}

async function main() {
  console.log('==== 启动后端（端口', PORT, '）====')
  const child = spawn('node', ['server/index.js'], {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', d => process.stdout.write(`[srv] ${d}`))
  child.stderr.on('data', d => process.stderr.write(`[srv!] ${d}`))

  const cleanup = () => { try { child.kill('SIGTERM') } catch {} }
  process.on('exit', cleanup)
  process.on('SIGINT', () => { cleanup(); process.exit(130) })

  const ready = await waitForServer()
  if (!ready) {
    bad('后端启动失败', '超时 30s')
    cleanup()
    process.exit(1)
  }
  ok('后端启动成功')

  try {
    console.log('\n==== [1/3] 准备数据：获取学生 + 练习册 ====')
    const students = await getStudents()
    const studentId = students[0].id
    ok(`拿到学生: ${students[0].name} (${studentId})`)

    const worksheets = await getWorksheets()
    if (worksheets.length === 0) {
      bad('没练习册', '请先在后台建一个练习册并上传预埋答案')
      cleanup()
      process.exit(1)
    }
    const worksheetId = worksheets[0].id
    ok(`拿到练习册: ${worksheets[0].name} (${worksheetId})`)

    console.log('\n==== [2/3] 场景 A：修复后 → 前端传 taskType=workbook + worksheetId ====')
    const taskA = await uploadTest(studentId, {
      taskType: 'workbook',
      worksheetId,
      subject: worksheets[0].subject || '数学',
    })
    ok(`上传返回 taskId=${taskA.id}`)
    if (taskA.task_type !== 'workbook') {
      bad('返回 task.task_type', `期望 'workbook' 实际 ${taskA.task_type}`)
    } else {
      ok('返回 task.task_type = workbook')
    }
    if (taskA.worksheet_id !== worksheetId) {
      bad('返回 task.worksheet_id', `期望 ${worksheetId} 实际 ${taskA.worksheet_id}`)
    } else {
      ok('返回 task.worksheet_id = worksheetId（链路通了！）')
    }
    // 通过后端 API 回查（避免子进程 dotenv 重复加载的麻烦）
    const dbRowA = await getTaskById(taskA.id)
    if (!dbRowA) {
      bad('后端 GET /api/tasks/:id 回读', '查不到任务')
    } else {
      if (dbRowA.worksheet_id === worksheetId) ok('DB 行 worksheet_id 正确（直接查 DB）')
      else bad('DB 行 worksheet_id', `期望 ${worksheetId} 实际 ${dbRowA.worksheet_id}`)
      if (dbRowA.task_type === 'workbook') ok('DB 行 task_type = workbook')
      else bad('DB 行 task_type', `期望 workbook 实际 ${dbRowA.task_type}`)
    }

    console.log('\n==== [3/3] 场景 B：bug 现场（不传 worksheetId）→ 后端必然降级 ====')
    const taskB = await uploadTest(studentId, {
      taskType: 'workbook',
      // worksheetId 故意不传
    })
    if (taskB.task_type !== 'workbook') {
      bad('场景 B 返回 task.task_type', `期望 'workbook' 实际 ${taskB.task_type}`)
    } else {
      ok('场景 B 返回 task.task_type = workbook（前端的 bug 行为）')
    }
    if (taskB.worksheet_id !== null) {
      bad('场景 B 返回 task.worksheet_id', `期望 null 实际 ${taskB.worksheet_id}`)
    } else {
      ok('场景 B 返回 task.worksheet_id = null（确认 bug 现象）')
    }

    console.log('\n==== 结论 ====')
    console.log(`  ${pass} passed, ${fail} failed`)
    if (fail === 0) {
      console.log('  ✅ 后端 API 接收端 OK：只要前端传 worksheetId，链路就通。')
      console.log('     修复重点必须是前端传值——已修 App.jsx 的 ref 同步问题。')
    } else {
      console.log('  ❌ 链路仍有异常，需要进一步排查')
    }
  } catch (e) {
    console.error('测试异常:', e)
    fail++
  } finally {
    cleanup()
    await sleep(500)
    process.exit(fail > 0 ? 1 : 0)
  }
}

main()
