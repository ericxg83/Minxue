import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '.env')

const raw = readFileSync(envPath)
console.log(`.env文件总大小: ${raw.length} bytes`)
console.log(`前20字节(hex): ${raw.subarray(0, 20).toString('hex')}`)

const lines = raw.toString('utf-8').split('\n')
lines.filter((line, i) => line.includes('OSS_ACCESS_KEY_SECRET')).forEach((line, idx) => {
    const i = lines.indexOf(line)
    console.log(`\n第${i + 1}行:`)
    console.log(`  完整行: "${line}"`)
    console.log(`  行字节: ${Buffer.from(line).toString('hex')}`)
    
    // 提取value部分
    const parts = line.split('=')
    if (parts.length >= 2) {
      const key = parts[0]
      const value = parts.slice(1).join('=')
      
      console.log(`  Key: "${key}" (${key.length} chars, ${Buffer.from(key).length} bytes)`)
      console.log(`  Value: "${value}" (${value.length} chars, ${Buffer.from(value).length} bytes)`)
      
      // 去掉引号（如果有）
      const trimmed = value.trim().replace(/^["']|["']$/g, '')
      console.log(`  清理后: "${trimmed}" (${trimmed.length} chars, ${Buffer.from(trimmed).length} bytes)`)
      
      // 检查是否有BOM或其他特殊字符
      const valueBytes = Buffer.from(value)
      if (valueBytes[0] === 0xEF && valueBytes[1] === 0xBB && valueBytes[2] === 0xBF) {
        console.log(`  ⚠️ 发现UTF-8 BOM!`)
      }
      
      // 显示每个字符的hex
      console.log(`  字符hex:`)
      for (let j = 0; j < Math.min(trimmed.length, 35); j++) {
        const char = trimmed[j]
        const hex = trimmed.charCodeAt(j).toString(16).padStart(2, '0')
        console.log(`    [${j}] '${char}' = 0x${hex}`)
      }
    }
  })
