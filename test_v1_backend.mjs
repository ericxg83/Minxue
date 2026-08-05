import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, 'server/.env') })

import { query, TABLES } from './server/config/neon.js'
import { migrateErrorAnalysis } from './server/migrations/035_add_error_analysis.js'
import { isBlankAnswer, analyzeErrorLocally, getErrorTypes } from './server/services/diagnosisService.js'

const assert = (cond, label) => {
  if (cond) console.log(`  ✅ ${label}`)
  else { console.error(`  ❌ ${label}`); process.exitCode = 1 }
}

console.log('== 1. 数据库连接 ==')
try {
  const { rows } = await query(`SELECT NOW() AS now`)
  assert(rows.length === 1, `连接成功: ${rows[0].now}`)
} catch (e) {
  console.error('数据库连接失败:', e.message)
  process.exit(1)
}

console.log('== 2. 迁移 035（幂等） ==')
await migrateErrorAnalysis()

console.log('== 3. error_types 表 ==')
const types = await getErrorTypes()
assert(types.length >= 10, `错因库 ${types.length} 类: ${types.join(' / ')}`)

console.log('== 4. wrong_questions 新列 ==')
const cols = await query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'wrong_questions' AND column_name IN ('is_blank','error_type','error_reason','ai_confidence')`
)
const colNames = cols.rows.map(r => r.column_name).sort()
assert(colNames.length === 4, `列齐全: ${colNames.join(', ')}`)

console.log('== 5. isBlankAnswer 纯函数 ==')
assert(isBlankAnswer({ studentAnswer: '' }) === true, '空串=空题')
assert(isBlankAnswer({ studentAnswer: '   ' }) === true, '空白=空题')
assert(isBlankAnswer({ studentAnswer: null }) === true, 'null=空题')
assert(isBlankAnswer({ studentAnswer: undefined }) === true, 'undefined=空题')
assert(isBlankAnswer({ studentAnswer: '无' }) === true, '"无"=空题')
assert(isBlankAnswer({ studentAnswer: '不会' }) === true, '"不会"=空题')
assert(isBlankAnswer({ answerSource: 'blank' }) === true, 'answer_source=blank 空题')
assert(isBlankAnswer({ studentAnswer: '3.14' }) === false, '有答案=非空题')

console.log('== 6. analyzeErrorLocally 纯函数 ==')
assert(analyzeErrorLocally({ content: '3+5=?', studentAnswer: '7', correctAnswer: '8' })?.errorType === '计算错误', '计算错误判定')
assert(analyzeErrorLocally({ content: '求x', studentAnswer: '5', correctAnswer: '5元' })?.errorType === '单位错误', '单位错误判定')
assert(analyzeErrorLocally({ content: '3+5=?', studentAnswer: 'x', correctAnswer: '8' }) === null, '无法判定返回 null（交 LLM）')
assert(analyzeErrorLocally({ content: '', studentAnswer: '', correctAnswer: '' }) === null, '空输入返回 null')

console.log('\n🎉 V1 后端纯函数 + 迁移测试完成')
process.exit(process.exitCode || 0)
