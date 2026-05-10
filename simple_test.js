/**
 * 极简后端接口测试脚本
 * 只测试：http://localhost:3001/api/health 和创建学生接口
 */
import { createServer } from './server/index.js'

const API_BASE = 'http://localhost:3001/api'
let server = null

async function test() {
  console.log('=== 极简后端接口测试 ===\n')
  
  // 1. 启动后端服务
  console.log('1️⃣ 启动后端服务...')
  try {
    server = await createServer(3001)
    console.log('✅ 后端服务已启动\n')
  } catch (e) {
    console.log('❌ 后端服务启动失败:', e.message)
    process.exit(1)
  }

  // 2. 测试健康检查
  console.log('2️⃣ 测试 /api/health...')
  try {
    const res = await fetch(`${API_BASE}/health`)
    const data = await res.json()
    console.log(`✅ Health Check 通过: ${JSON.stringify(data)}\n`)
  } catch (e) {
    console.log(`❌ Health Check 失败: ${e.message}\n`)
  }

  // 3. 测试创建学生
  console.log('3️⃣ 测试 POST /api/students...')
  try {
    const res = await fetch(`${API_BASE}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `TestUser_${Date.now()}`,
        grade: '测试班级'
      })
    })
    const data = await res.json()
    
    if (!res.ok) {
      console.log(`❌ 创建学生失败: HTTP ${res.status}`)
      console.log(`   错误信息: ${data.error}`)
    } else {
      console.log(`✅ 创建学生成功!`)
      console.log(`   学生 ID: ${data.student?.id || data.id}`)
      console.log(`   响应数据: ${JSON.stringify(data).substring(0, 200)}\n`)
    }
  } catch (e) {
    console.log(`❌ 创建学生异常: ${e.message}`)
    console.log(`   堆栈: ${e.stack}\n`)
  }

  // 4. 清理
  if (server) {
    server.close()
    console.log('⏹️  后端服务已停止')
  }
  
  console.log('\n=== 测试结束 ===')
}

test()
