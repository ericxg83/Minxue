import dotenv from 'dotenv'
import { dirname, resolve, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, readFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

console.log('='.repeat(60))
console.log('.env文件加载测试')
console.log('='.repeat(60))

// 测试不同的.env路径
const paths = [
  join(__dirname, '.env'),
  join(__dirname, '..', '.env'),
  resolve(__dirname, '.env'),
  join(process.cwd(), '.env'),
]

console.log(`\n当前工作目录: ${process.cwd()}`)
console.log(`脚本目录: ${__dirname}`)

paths.forEach((p, i) => {
  console.log(`\n路径${i + 1}: ${p}`)
  if (existsSync(p)) {
    console.log(`  ✅ 存在 (${readFileSync(p).length} bytes)`)
    
    // 加载并检查
    const result = dotenv.config({ path: p })
    if (result.parsed) {
      console.log(`  OSS_ACCESS_KEY_SECRET: "${result.parsed.OSS_ACCESS_KEY_SECRET}"`)
      console.log(`  长度: ${result.parsed.OSS_ACCESS_KEY_SECRET?.length || 0}`)
    }
  } else {
    console.log(`  ❌ 不存在`)
  }
})
