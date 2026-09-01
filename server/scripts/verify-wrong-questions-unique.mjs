/**
 * 验证 wrong_questions UNIQUE 索引兜底（只读/极短写）
 *
 * 1. SELECT 一个 student
 * 2. INSERT 一条 worksheet_id 路径错题（模拟 worker 调用）
 * 3. 再 INSERT 一条同 (student_id, worksheet_id, question_no) 的错题 → 应被 UNIQUE 索引拒绝
 * 4. 走 addSelfContainedWrongQuestion 第二次调用，应触发 ON CONFLICT DO UPDATE
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { addSelfContainedWrongQuestion } from '../services/neonService.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const { query } = await import('../config/neon.js')

const TEST_STUDENT_ID = 'bf235b85-e5d4-4f50-9e42-af8330df9451' // 张诗蕊（从 /api/students 查到）
const TEST_WORKSHEET_ID = '00000000-0000-0000-0000-000000000999'
const TEST_QNO = 99999  // INTEGER 列

console.log('🧪 验证 wrong_questions UNIQUE 索引\n')

// 0. 清理：先删掉之前的 verify 行（幂等）
await query(`DELETE FROM wrong_questions WHERE worksheet_id = $1`, [TEST_WORKSHEET_ID])

// 1. 第一次写入
console.log('1️⃣  第一次写入错题...')
const id1 = await addSelfContainedWrongQuestion({
  studentId: TEST_STUDENT_ID,
  worksheetId: TEST_WORKSHEET_ID,
  questionNo: TEST_QNO,
  studentAnswer: '答: x=1',
  correctAnswer: 'x=2',
  subject: '数学',
  sourceType: 'workbook'
})
console.log(`   → 返回 id=${id1}`)

const after1 = await query(`SELECT id, error_count, student_answer FROM wrong_questions WHERE id = $1`, [id1])
console.log(`   → 写入后: error_count=${after1.rows[0].error_count}  answer=${after1.rows[0].student_answer}`)

// 2. 第二次写入（同一自然键）— 应触发 ON CONFLICT DO UPDATE
console.log('\n2️⃣  第二次写入（同一 student + worksheet + qno）— 应触发 ON CONFLICT 累加 error_count...')
const id2 = await addSelfContainedWrongQuestion({
  studentId: TEST_STUDENT_ID,
  worksheetId: TEST_WORKSHEET_ID,
  questionNo: TEST_QNO,
  studentAnswer: '答: x=3（重做）',
  correctAnswer: 'x=2',
  subject: '数学',
  sourceType: 'workbook'
})
console.log(`   → 返回 id=${id2}（应等于第一次的 id）`)

const after2 = await query(`SELECT id, error_count, student_answer FROM wrong_questions WHERE id = $1`, [id1])
console.log(`   → 累加后: error_count=${after2.rows[0].error_count}  answer=${after2.rows[0].student_answer}`)

// 3. 直接 SQL INSERT 一条重复行 — 应被 UNIQUE 索引拒绝
console.log('\n3️⃣  直接 SQL 插入一条重复行 — 应被 UNIQUE 索引拒绝（23505）...')
try {
  await query(`
    INSERT INTO wrong_questions
      (student_id, worksheet_id, question_no, status, error_count)
    VALUES ($1, $2, $3, 'pending', 1)
  `, [TEST_STUDENT_ID, TEST_WORKSHEET_ID, TEST_QNO])
  console.log('   ❌ 索引失效！INSERT 未被拒绝')
} catch (err) {
  if (err.code === '23505') {
    console.log(`   ✅ UNIQUE 索引生效，INSERT 被拒: ${err.message.split('\n')[0]}`)
  } else {
    console.log(`   ⚠️  其他错误: ${err.code} ${err.message}`)
  }
}

// 4. 验证最终只有一行
const finalRows = await query(`SELECT id, error_count FROM wrong_questions WHERE worksheet_id = $1`, [TEST_WORKSHEET_ID])
console.log(`\n📋 最终: 错题本里 worksheet_id=${TEST_WORKSHEET_ID.slice(0,8)}.. 共 ${finalRows.rowCount} 行`)
finalRows.rows.forEach(r => console.log(`   - id=${r.id.slice(0,8)}..  err=${r.error_count}`))

// 5. 清理
console.log('\n🧹 清理 verify 测试数据...')
await query(`DELETE FROM wrong_questions WHERE worksheet_id = $1`, [TEST_WORKSHEET_ID])
console.log('✅ 清理完成')

console.log('\n=== 验证结论 ===')
console.log('如果看到 "✅ UNIQUE 索引生效" 且 "最终 1 行"，则重复双写问题已修复。')

process.exit(0)