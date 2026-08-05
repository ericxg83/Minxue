// runErrorDiagnosis 数据库写入路径集成测试
// 构造测试数据（空题 + 本地可判做错）→ 跑回填 → 验证写库 → 清理

process.env.MODELSCOPE_BACKUP_API_KEY = ''
process.env.GEMINI_API_KEY = ''
process.env.AGNES_API_KEY = ''
process.env.SENSENOVA_API_KEY = ''
process.env.FREEMODEL_API_KEY = ''
process.env.AI_API_KEY = ''

import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, 'server/.env') })

import { query } from './server/config/neon.js'
import { runErrorDiagnosis } from './server/services/diagnosisService.js'
import { randomUUID } from 'crypto'

const assert = (cond, label) => {
  if (cond) console.log(`  ✅ ${label}`)
  else { console.error(`  ❌ ${label}`); process.exitCode = 1 }
}

const studentId = randomUUID()
const taskId = randomUUID()
const qBlankId = randomUUID()
const qWrongId = randomUUID()
const wqBlankId = randomUUID()
const wqWrongId = randomUUID()

try {
  console.log('== 1. 构造测试数据 ==')
  await query(`INSERT INTO students (id, name, grade) VALUES ($1, $2, $3)`, [studentId, '诊断测试学生', '三年级'])
  await query(`INSERT INTO tasks (id, student_id, original_name, status, created_at) VALUES ($1, $2, $3, 'done', NOW())`, [taskId, studentId, '诊断测试作业'])

  // Q1: 空题（学生没写）
  await query(
    `INSERT INTO questions (id, task_id, student_id, content, answer, student_answer, answer_source, question_type, subject, is_correct, ai_tags, is_complete, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, NOW())`,
    [qBlankId, taskId, studentId, '计算 12+7=?', '19', '', 'blank', 'answer', '数学', false, JSON.stringify(['分数运算', '测试知识点A'])]
  )
  // Q2: 本地可判计算错误
  await query(
    `INSERT INTO questions (id, task_id, student_id, content, answer, student_answer, answer_source, question_type, subject, is_correct, ai_tags, is_complete, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, NOW())`,
    [qWrongId, taskId, studentId, '计算 7*8=?', '56', '54', 'recognized', 'answer', '数学', false, JSON.stringify(['乘法', '测试知识点B'])]
  )

  await query(
    `INSERT INTO wrong_questions (id, student_id, question_id, status, error_count, added_at, last_wrong_at, created_at, updated_at, student_answer)
     VALUES ($1, $2, $3, 'pending', 1, NOW(), NOW(), NOW(), NOW(), $4)`,
    [wqBlankId, studentId, qBlankId, '']
  )
  await query(
    `INSERT INTO wrong_questions (id, student_id, question_id, status, error_count, added_at, last_wrong_at, created_at, updated_at, student_answer)
     VALUES ($1, $2, $3, 'pending', 1, NOW(), NOW(), NOW(), NOW(), $4)`,
    [wqWrongId, studentId, qWrongId, '54']
  )
  console.log('  测试数据已插入（空题 wq + 做错 wq）')

  console.log('== 2. 跑 runErrorDiagnosis ==')
  const result = await runErrorDiagnosis({ limit: 10, trigger: 'test' })
  console.log(`   ${JSON.stringify(result)}`)

  console.log('== 3. 验证写库 ==')
  const blankRow = await query(`SELECT is_blank, error_type FROM wrong_questions WHERE id = $1`, [wqBlankId])
  const wrongRow = await query(`SELECT is_blank, error_type, error_reason, ai_confidence FROM wrong_questions WHERE id = $1`, [wqWrongId])

  assert(blankRow.rows[0]?.is_blank === true, `空题正确标记 is_blank=true（且 error_type 为 ${blankRow.rows[0]?.error_type || 'NULL'}，不做错因）`)
  assert(blankRow.rows[0]?.error_type === null, '空题不写错因')
  assert(wrongRow.rows[0]?.error_type === '计算错误', `做错正确写错因: ${wrongRow.rows[0]?.error_type}`)
  assert(wrongRow.rows[0]?.ai_confidence > 0, `置信度已写: ${wrongRow.rows[0]?.ai_confidence}`)

  console.log('== 4. 幂等验证：再跑一次不应重复处理（已被标记的跳出扫描） ==')
  const result2 = await runErrorDiagnosis({ limit: 10, trigger: 'test2' })
  const alreadyAnalyzed = (await query(`SELECT error_type FROM wrong_questions WHERE id = $1`, [wqWrongId])).rows[0]
  assert(alreadyAnalyzed.error_type === '计算错误', '已分析的记录未被覆盖')

  console.log('\n🎉 runErrorDiagnosis 数据库写入路径测试完成')
} catch (e) {
  console.error('测试异常:', e.message)
  process.exitCode = 1
} finally {
  // 清理测试数据
  try {
    await query(`DELETE FROM wrong_questions WHERE id = ANY($1)`, [[wqBlankId, wqWrongId]])
    await query(`DELETE FROM questions WHERE id = ANY($1)`, [[qBlankId, qWrongId]])
    await query(`DELETE FROM tasks WHERE id = $1`, [taskId])
    await query(`DELETE FROM students WHERE id = $1`, [studentId])
    console.log('  已清理测试数据')
  } catch (e) {
    console.error('清理失败:', e.message)
  }
  process.exit(process.exitCode || 0)
}
