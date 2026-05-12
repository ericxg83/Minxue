import dotenv from 'dotenv'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

console.log('='.repeat(60))
console.log('.env文件内容分析')
console.log('='.repeat(60))

const envPath = resolve(__dirname, 'server/.env')
console.log(`\n.env路径: ${envPath}`)

// 读取原始文件内容
const content = readFileSync(envPath, 'utf-8')
const lines = content.split('\n')

console.log('\n--- OSS相关行 ---')
lines.forEach((line, i) => {
  if (line.includes('OSS')) {
    const [key, ...valueParts] = line.split('=')
    const value = valueParts.join('=')
    
    console.log(`\n行 ${i + 1}:`)
    console.log(`  Key: "${key}" (长度: ${key?.length || 0})`)
    console.log(`  Value: "${value}" (长度: ${value?.length || 0})`)
    
    if (value) {
      console.log(`  值字节: ${Buffer.from(value).length}`)
      console.log(`  包含隐藏字符: ${value.includes('\r') || value.includes('\t') || value.includes(' ')}`)
      console.log(`  十六进制: ${Buffer.from(value).toString('hex').substring(0, 40)}...`)
      
      // 检查首尾空格
      const trimmed = value.trim()
      if (trimmed !== value) {
        console.log(`  ⚠️ 警告: 值包含首尾空格!`)
        console.log(`  原始长度: ${value.length}, 去除空格后: ${trimmed.length}`)
      }
    }
  }
})

// 加载.env并测试
console.log('\n--- 加载.env后 ---')
dotenv.config({ path: envPath })

const secret = process.env.OSS_ACCESS_KEY_SECRET || ''
console.log(`OSS_ACCESS_KEY_SECRET 长度: ${secret.length}`)
console.log(`OSS_ACCESS_KEY_SECRET 值: ${secret}`)
console.log(`OSS_REGION: ${process.env.OSS_REGION}`)
console.log(`OSS_BUCKET: ${process.env.OSS_BUCKET}`)
console.log(`OSS_ACCESS_KEY_ID: ${process.env.OSS_ACCESS_KEY_ID}`)

// 直接测试OSS
console.log('\n--- 直接OSS测试 ---')
import OSS from 'ali-oss'

try {
  const client = new OSS({
    region: process.env.OSS_REGION,
    bucket: process.env.OSS_BUCKET,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    secure: true,
    timeout: 60000
  })
  
  console.log('✅ OSS客户端创建成功')
  
  const testContent = Buffer.from('test')
  const testPath = `test/${Date.now()}.txt`
  console.log(`正在上传到: ${testPath}`)
  
  const result = await client.put(testPath, testContent)
  console.log('✅ 上传成功!')
  console.log(`URL: ${result.url}`)
  
  await client.delete(testPath)
  console.log('✅ 清理成功')
  
} catch (err) {
  console.log(`❌ 失败: ${err.message}`)
  console.log(`错误代码: ${err.code || 'N/A'}`)
  console.log(`HTTP状态: ${err.status || 'N/A'}`)
}
