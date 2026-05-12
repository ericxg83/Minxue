/**
 * 上传功能诊断脚本
 * 用于诊断文件上传失败的根本原因
 */
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createServer } from './server/index.js'
import { query, TABLES } from './server/config/neon.js'
import { uploadImage } from './server/services/ossService.js'
import { getTaskQueue } from './server/queue.js'
import fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE_URL = `http://localhost:${PORT}/api`
const PORT = 3002

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function test(name, fn) {
  try {
    console.log(`\n🧪 测试: ${name}`)
    await fn()
    console.log(`✅ 通过: ${name}`)
    return true
  } catch (err) {
    console.log(`❌ 失败: ${name}`)
    console.log(`   错误: ${err.message}`)
    console.log(`   堆栈: ${err.stack}`)
    return false
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('敏学App V3 - 上传功能诊断')
  console.log('='.repeat(60))

  let server = null
  let studentId = null
  let taskId = null

  try {
    // 1. 启动服务器
    console.log('\n📡 启动服务器...')
    server = await createServer(PORT)
    await delay(1500)
    console.log(`✅ 服务器已启动在端口 ${PORT}`)

    // 2. 健康检查
    await test('健康检查', async () => {
      const res = await fetch(`${BASE_URL}/health`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      console.log(`   状态: ${data.status}`)
    })

    // 3. 检查OSS配置
    await test('OSS配置检查', async () => {
      const hasConfig = !!(process.env.OSS_REGION && process.env.OSS_BUCKET && process.env.OSS_ACCESS_KEY_ID)
      if (!hasConfig) {
        throw new Error('缺少OSS配置: OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID')
      }
      console.log(`   Region: ${process.env.OSS_REGION}`)
      console.log(`   Bucket: ${process.env.OSS_BUCKET}`)
    })

    // 4. 检查Redis配置
    await test('Redis配置检查', async () => {
      const hasRedis = !!(process.env.REDIS_URL || process.env.REDIS_HOST)
      if (!hasRedis) {
        throw new Error('缺少Redis配置: REDIS_URL 或 REDIS_HOST')
      }
      console.log(`   Redis URL: ${process.env.REDIS_URL ? '已配置' : '未配置'}`)
    })

    // 5. 检查数据库连接
    await test('数据库连接检查', async () => {
      const result = await query('SELECT NOW()')
      console.log(`   数据库时间: ${result.rows[0].now}`)
    })

    // 6. 创建测试学生
    await test('创建测试学生', async () => {
      const res = await fetch(`${BASE_URL}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `上传测试学生_${Date.now()}`,
          grade: '测试班级'
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      studentId = data.student?.id
      if (!studentId) throw new Error('未返回学生ID')
      console.log(`   学生ID: ${studentId}`)
    })

    // 7. 测试队列连接
    await test('队列连接检查', async () => {
      const queue = await getTaskQueue()
      if (!queue) {
        throw new Error('队列未连接')
      }
      console.log(`   队列已连接`)
    })

    // 8. 测试OSS上传
    await test('OSS上传测试', async () => {
      try {
        const testBuffer = Buffer.from('test image content')
        const url = await uploadImage(testBuffer, 'test.jpg', studentId)
        console.log(`   OSS URL: ${url}`)
      } catch (err) {
        if (err.message.includes('OSS 未配置') || err.message.includes('accessKeyId')) {
          console.log(`   ⚠️ OSS配置不完整，这是上传失败的常见原因`)
          throw new Error('OSS配置不完整 - 请检查server/.env文件中的OSS配置')
        }
        throw err
      }
    })

    // 9. 测试文件上传接口（无真实文件）
    await test('上传接口测试(无文件)', async () => {
      const res = await fetch(`${BASE_URL}/tasks/upload`, {
        method: 'POST',
        body: (() => {
          const form = new FormData()
          form.append('studentId', studentId)
          return form
        })()
      })
      
      const data = await res.json()
      
      if (res.status === 400) {
        console.log(`   预期错误: 没有上传文件 (这是正常的)`)
        return
      }
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${data.error || '未知错误'}`)
      }
    })

    // 10. 测试创建任务接口
    await test('创建任务接口测试', async () => {
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
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      
      const data = await res.json()
      taskId = data.task?.id
      console.log(`   任务ID: ${taskId}`)
    })

    // 清理测试数据
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

    // 打印诊断报告
    console.log('\n' + '='.repeat(60))
    console.log('📋 诊断报告')
    console.log('='.repeat(60))
    
    const envChecks = [
      { name: 'NEON_DATABASE_URL', value: process.env.NEON_DATABASE_URL ? '✅ 已配置' : '❌ 未配置' },
      { name: 'OSS_REGION', value: process.env.OSS_REGION ? `✅ ${process.env.OSS_REGION}` : '❌ 未配置' },
      { name: 'OSS_BUCKET', value: process.env.OSS_BUCKET ? `✅ ${process.env.OSS_BUCKET}` : '❌ 未配置' },
      { name: 'OSS_ACCESS_KEY_ID', value: process.env.OSS_ACCESS_KEY_ID ? `✅ ${process.env.OSS_ACCESS_KEY_ID?.substring(0, 8)}...` : '❌ 未配置' },
      { name: 'OSS_ACCESS_KEY_SECRET', value: process.env.OSS_ACCESS_KEY_SECRET ? '✅ 已配置' : '❌ 未配置' },
      { name: 'REDIS_URL', value: process.env.REDIS_URL ? '✅ 已配置' : '❌ 未配置' },
      { name: 'REDIS_HOST', value: process.env.REDIS_HOST ? `✅ ${process.env.REDIS_HOST}` : '❌ 未配置' },
    ]

    console.log('\n环境变量检查:')
    envChecks.forEach(check => {
      console.log(`  ${check.name}: ${check.value}`)
    })

    console.log('\n💡 常见问题排查:')
    if (!process.env.OSS_REGION || !process.env.OSS_BUCKET || !process.env.OSS_ACCESS_KEY_ID) {
      console.log('  ⚠️ OSS配置不完整 - 这会导致文件上传失败')
      console.log('  解决方法: 在 server/.env 文件中配置OSS相关环境变量')
    }
    if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
      console.log('  ⚠️ Redis未配置 - 任务队列功能将不可用')
      console.log('  注意: 上传功能可以工作，但AI处理将不会自动执行')
    }

    console.log('\n🔧 调试建议:')
    console.log('  1. 检查浏览器控制台中的详细错误信息')
    console.log('  2. 检查后端日志中的OSS相关错误')
    console.log('  3. 确保 server/.env 文件中的OSS配置正确')
    console.log('  4. 尝试上传一个小文件测试')
    console.log('  5. 检查网络连接和防火墙设置')

  } catch (err) {
    console.error(`\n❌ 诊断过程出错: ${err.message}`)
  } finally {
    if (server) {
      server.close()
      console.log('\n🛑 服务器已停止')
    }
  }
}

// 加载环境变量
import dotenv from 'dotenv'
dotenv.config({ path: resolve(__dirname, 'server/.env') })

main().catch(err => {
  console.error('致命错误:', err)
  process.exit(1)
})
