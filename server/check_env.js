import dotenv from 'dotenv'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import OSS from 'ali-oss'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '.env')

console.log('='.repeat(60))
console.log('.env文件内容分析')
console.log('='.repeat(60))
console.log(`\n.env路径: ${envPath}`)

const content = readFileSync(envPath, 'utf-8')
const lines = content.split('\n')

console.log('\n--- OSS相关行 ---')
lines.forEach((line, i) => {
  if (line.includes('OSS') && line.includes('=')) {
    const [key, ...valueParts] = line.split('=')
    const value = valueParts.join('=').trim()
    
    console.log(`\n行 ${i + 1}:`)
    console.log(`  Key: "${key.trim()}"`)
    console.log(`  Value: "${value.substring(0, 20)}..." (长度: ${value.length})`)
    console.log(`  十六进制: ${Buffer.from(value).toString('hex')}`)
  }
})

console.log('\n--- 加载.env后 ---')
dotenv.config({ path: envPath })

console.log(`OSS_REGION: "${process.env.OSS_REGION}"`)
console.log(`OSS_BUCKET: "${process.env.OSS_BUCKET}"`)
console.log(`OSS_ACCESS_KEY_ID: "${process.env.OSS_ACCESS_KEY_ID}"`)
console.log(`OSS_ACCESS_KEY_SECRET: "${process.env.OSS_ACCESS_KEY_SECRET?.substring(0, 10)}..."`)
console.log(`OSS_ACCESS_KEY_SECRET 长度: ${process.env.OSS_ACCESS_KEY_SECRET?.length || 0}`)
console.log(`OSS_ACCESS_KEY_SECRET 十六进制: ${Buffer.from(process.env.OSS_ACCESS_KEY_SECRET || '').toString('hex')}`)

console.log('\n--- 直接OSS测试 ---')
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
  
  const testContent = Buffer.from('test from server dir')
  const testPath = `test/${Date.now()}.txt`
  console.log(`\n正在上传到: ${testPath}`)
  
  const result = await client.put(testPath, testContent)
  console.log('✅ 上传成功!')
  console.log(`URL: ${result.url}`)
  
  await client.delete(testPath)
  console.log('✅ 清理成功')
  
} catch (err) {
  console.log(`❌ 失败: ${err.message}`)
  console.log(`错误代码: ${err.code || 'N/A'}`)
}
