/**
 * OSS直接连接测试 - 在server目录运行
 */
import OSS from 'ali-oss'
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '.env') })

async function testOSS() {
  console.log('='.repeat(60))
  console.log('OSS 直接连接测试')
  console.log('='.repeat(60))
  
  console.log('\n配置信息:')
  console.log(`  Region: ${process.env.OSS_REGION}`)
  console.log(`  Bucket: ${process.env.OSS_BUCKET}`)
  console.log(`  AccessKey ID: ${process.env.OSS_ACCESS_KEY_ID}`)
  console.log(`  AccessKey Secret长度: ${process.env.OSS_ACCESS_KEY_SECRET?.length || 0}`)
  console.log(`  CDN Domain: ${process.env.OSS_CDN_DOMAIN}`)
  
  // 检查key是否有隐藏字符
  const secret = process.env.OSS_ACCESS_KEY_SECRET || ''
  console.log(`\nSecret字符检查:`)
  console.log(`  长度: ${secret.length}`)
  console.log(`  包含空格: ${secret.includes(' ')}`)
  console.log(`  包含换行: ${secret.includes('\n') || secret.includes('\r')}`)
  console.log(`  首字符: ${secret.charCodeAt(0)} ('${secret[0]}')`)
  console.log(`  尾字符: ${secret.charCodeAt(secret.length-1)} ('${secret[secret.length-1]}')`)
  
  // 测试1: 使用原始配置
  console.log('\n--- 测试1: 使用原始ali-oss配置 ---')
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
    
    const testContent = Buffer.from('test content')
    const testPath = `test/${Date.now()}.txt`
    
    console.log(`\n正在上传测试文件到: ${testPath}`)
    const result = await client.put(testPath, testContent)
    console.log('✅ 上传成功!')
    console.log(`   URL: ${result.url}`)
    console.log(`   状态码: ${result.res.status}`)
    
    // 清理
    console.log(`\n正在清理测试文件: ${testPath}`)
    await client.delete(testPath)
    console.log('✅ 清理成功')
    
    return
  } catch (err) {
    console.log(`❌ 失败`)
    console.log(`   错误类型: ${err.name || 'Unknown'}`)
    console.log(`   错误代码: ${err.code || 'N/A'}`)
    console.log(`   HTTP状态: ${err.status || 'N/A'}`)
    console.log(`   错误信息: ${err.message}`)
    
    if (err.code === 'SignatureDoesNotMatch' || err.status === 403) {
      console.log('\n📋 可能原因:')
      console.log('   1. AccessKey Secret 不正确')
      console.log('   2. AccessKey 已禁用')
      console.log('   3. RAM用户没有OSS写入权限')
      console.log('   4. Bucket权限策略限制')
      console.log('\n🔧 请检查:')
      console.log('   1. 在阿里云RAM控制台确认AccessKey状态为"启用"')
      console.log('   2. 确认该用户有OSS读写权限')
      console.log('   3. 尝试在阿里云OSS控制台使用"访问控制"测试')
    }
  }
  
  // 测试2: 使用endpoint格式
  console.log('\n--- 测试2: 使用endpoint格式 ---')
  try {
    const endpoint = `${process.env.OSS_REGION}.aliyuncs.com`
    console.log(`  Endpoint: ${endpoint}`)
    
    const client = new OSS({
      endpoint: endpoint,
      bucket: process.env.OSS_BUCKET,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
      secure: true,
      timeout: 60000
    })
    
    console.log('✅ OSS客户端创建成功')
    
    const testContent = Buffer.from('test content 2')
    const testPath = `test/${Date.now()}.txt`
    
    console.log(`\n正在上传测试文件到: ${testPath}`)
    const result = await client.put(testPath, testContent)
    console.log('✅ 上传成功!')
    console.log(`   URL: ${result.url}`)
    
    await client.delete(testPath)
    console.log('✅ 清理成功')
  } catch (err) {
    console.log(`❌ 失败: ${err.message}`)
  }
  
  // 测试3: 只读测试
  console.log('\n--- 测试3: 列出Bucket内容 ---')
  try {
    const client = new OSS({
      region: process.env.OSS_REGION,
      bucket: process.env.OSS_BUCKET,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
      secure: true,
      timeout: 60000
    })
    
    const result = await client.list({ 'max-keys': 3 })
    console.log('✅ Bucket访问成功')
    console.log(`   对象数量: ${result.objects?.length || 0}`)
    if (result.objects && result.objects.length > 0) {
      console.log('   前3个对象:')
      result.objects.slice(0, 3).forEach(obj => {
        console.log(`     - ${obj.name} (${obj.size} bytes)`)
      })
    }
  } catch (err) {
    console.log(`❌ 失败: ${err.message}`)
  }
}

testOSS().catch(console.error)
