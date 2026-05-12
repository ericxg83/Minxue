/**
 * 上传功能完整测试 - 通过HTTP接口测试
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createServer } from './server/index.js'
import { query, TABLES } from './server/config/neon.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 必须在任何导入之前加载环境变量
dotenv.config({ path: resolve(__dirname, 'server/.env') })

const PORT = 3003
const BASE_URL = `http://localhost:${PORT}/api`

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  console.log('='.repeat(60))
  console.log('敏学App V3 - 上传功能完整测试')
  console.log('='.repeat(60))
  
  let server = null
  let studentId = null
  
  try {
    // 1. 启动服务器
    console.log('\n📡 启动服务器...')
    server = await createServer(PORT)
    await delay(2000)
    console.log(`✅ 服务器已启动在端口 ${PORT}`)
    
    // 2. 健康检查
    console.log('\n🧪 测试: 健康检查')
    try {
      const res = await fetch(`${BASE_URL}/health`)
      const data = await res.json()
      console.log(`✅ 状态: ${data.status}`)
    } catch (err) {
      console.log(`❌ 失败: ${err.message}`)
    }
    
    // 3. 创建测试学生
    console.log('\n🧪 测试: 创建测试学生')
    try {
      const res = await fetch(`${BASE_URL}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `上传测试学生_${Date.now()}`,
          grade: '测试班级'
        })
      })
      const data = await res.json()
      studentId = data.student?.id
      console.log(`✅ 学生ID: ${studentId}`)
    } catch (err) {
      console.log(`❌ 失败: ${err.message}`)
    }
    
    if (!studentId) {
      console.log('\n❌ 无法继续测试：学生创建失败')
      return
    }
    
    // 4. 测试创建任务接口（通过URL方式）
    console.log('\n🧪 测试: 创建任务(通过URL)')
    try {
      const res = await fetch(`${BASE_URL}/tasks/create-by-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          imageUrl: 'https://example.com/test.jpg',
          originalName: '测试试卷.jpg'
        })
      })
      const data = await res.json()
      if (data.task) {
        console.log(`✅ 任务ID: ${data.task.id}`)
        console.log(`✅ 状态: ${data.task.status}`)
      } else {
        console.log(`❌ 响应: ${JSON.stringify(data)}`)
      }
    } catch (err) {
      console.log(`❌ 失败: ${err.message}`)
    }
    
    // 5. 测试文件上传接口
    console.log('\n🧪 测试: 文件上传接口')
    console.log('   (注意: 这会真正上传文件到OSS)')
    
    try {
      // 创建一个简单的FormData
      const formData = new FormData()
      formData.append('studentId', studentId)
      
      // 创建一个测试图片 (1x1 pixel PNG)
      const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
      const blob = new Blob([pngBuffer], { type: 'image/png' })
      formData.append('files', blob, 'test.png')
      
      console.log('   正在上传测试文件...')
      const res = await fetch(`${BASE_URL}/tasks/upload`, {
        method: 'POST',
        body: formData
      })
      
      const data = await res.json()
      
      if (res.ok && data.success) {
        console.log(`✅ 上传成功!`)
        console.log(`   响应: ${JSON.stringify(data, null, 2)}`)
        
        if (data.tasks && data.tasks.length > 0 && data.tasks[0].id) {
          const taskId = data.tasks[0].id
          console.log(`\n   任务ID: ${taskId}`)
          
          // 等待几秒查看任务处理进度
          console.log('   等待3秒后检查任务状态...')
          await delay(3000)
          
          const taskRes = await fetch(`${BASE_URL}/tasks/${taskId}`)
          const taskData = await taskRes.json()
          console.log(`   任务状态: ${taskData.task?.status || 'unknown'}`)
          console.log(`   进度: ${taskData.task?.progress || 0}%`)
        }
      } else {
        console.log(`❌ 上传失败`)
        console.log(`   HTTP状态: ${res.status}`)
        console.log(`   响应: ${JSON.stringify(data, null, 2)}`)
        
        // 显示详细错误信息
        if (data.tasks && data.tasks.length > 0) {
          const task = data.tasks[0]
          console.log(`   错误消息: ${task.message || 'N/A'}`)
          console.log(`   错误类型: ${task.errorType || 'N/A'}`)
        }
      }
    } catch (err) {
      console.log(`❌ 失败: ${err.message}`)
      console.log(`   堆栈: ${err.stack}`)
    }
    
    // 6. 清理测试数据
    if (studentId) {
      console.log('\n🧹 清理测试数据...')
      try {
        await query(`DELETE FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1`, [studentId])
        await query(`DELETE FROM ${TABLES.GENERATED_EXAMS} WHERE student_id = $1`, [studentId])
        await query(`DELETE FROM ${TABLES.QUESTIONS} WHERE student_id = $1`, [studentId])
        await query(`DELETE FROM ${TABLES.TASKS} WHERE student_id = $1`, [studentId])
        await query(`DELETE FROM ${TABLES.STUDENTS} WHERE id = $1`, [studentId])
        console.log('✅ 测试数据已清理')
      } catch (err) {
        console.log(`⚠️ 清理失败: ${err.message}`)
      }
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('✅ 测试完成')
    console.log('='.repeat(60))
    
  } catch (err) {
    console.error(`\n❌ 测试过程出错: ${err.message}`)
    console.error(err.stack)
  } finally {
    if (server) {
      server.close()
      console.log('\n🛑 服务器已停止')
    }
  }
}

main().catch(err => {
  console.error('致命错误:', err)
  process.exit(1)
})
