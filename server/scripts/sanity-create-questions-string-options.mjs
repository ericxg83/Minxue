// 验证 createQuestions 修复：AI 把 options 当成 JSON 字符串返回时，不会再炸 PG jsonb 列
// 用法：node server/scripts/sanity-create-questions-string-options.mjs
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const { Pool } = pg
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
})

// 真实跑一遍 neonService.createQuestions —— 必须先 import 它（依赖 neon pool）
const { createQuestions } = await import('../services/neonService.js')

// 找一个安全的临时学生做测试（不污染生产数据）
async function findOrCreateTestStudent() {
  const { rows } = await pool.query(
    `SELECT id FROM students WHERE name = '__sanity_options_string__' LIMIT 1`
  )
  if (rows.length > 0) return rows[0].id
  const id = randomUUID()
  await pool.query(
    `INSERT INTO students (id, name, grade) VALUES ($1, $2, 'sanity')`,
    [id, '__sanity_options_string__']
  )
  return id
}

async function findOrCreateTestTask(studentId) {
  // 用一个 stable id 方便清理
  const taskId = '00000000-0000-4000-8000-0000000000a1' // 仅用于 sanity 测试
  await pool.query(
    `INSERT INTO tasks (id, student_id, original_name, status, task_type, images, result)
     VALUES ($1, $2, 'sanity options 字符串测试', 'processing', 'general',
            $3::jsonb, $4::jsonb)
     ON CONFLICT (id) DO UPDATE SET status = 'processing', updated_at = NOW()`,
    [
      taskId,
      studentId,
      JSON.stringify([{ page_number: 1, image_url: 'https://example.com/sanity.jpg', file_name: 'sanity.jpg' }]),
      JSON.stringify({ progress: 0 }),
    ]
  )
  return taskId
}

async function cleanup(taskId, studentId) {
  await pool.query(`DELETE FROM questions WHERE task_id = $1`, [taskId])
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [taskId])
  await pool.query(`DELETE FROM students WHERE id = $1`, [studentId])
}

async function main() {
  console.log('🧪 Sanity 测试：createQuestions 在 options 是 JSON 字符串时是否还会炸 PG jsonb 列\n')

  const studentId = await findOrCreateTestStudent()
  const taskId = await findOrCreateTestTask(studentId)

  // 测试三组：options 是字符串、数组、缺失
  const cases = [
    { label: 'options 是 JSON 字符串（朱思诺事故的根因）', options: '["A. 3/4","B. 4/3"]' },
    { label: 'options 是对象（防御）', options: { a: 'A. 3/4', b: 'B. 4/3' } },
    { label: 'options 是 undefined（防御）', options: undefined },
    { label: 'options 是数组（正常情况，必须成功）', options: ['A. 3/4', 'B. 4/3'] },
  ]

  let allPassed = true
  const questionIds = []

  for (const c of cases) {
    const qid = randomUUID()
    const fakeQuestion = {
      id: qid,
      task_id: taskId,
      student_id: studentId,
      content: '算术平方根等于它本身的数是？',
      options: c.options,
      answer: '0 和 1',
      student_answer: '0, 1',
      question_type: 'choice',
      page_number: 1,
      question_number: 1,
      confidence: 0.9,
      ai_tags: c.options && typeof c.options === 'string' ? '["算术平方根"]' : ['算术平方根'], // 也试一下字符串
      manual_tags: [],
    }
    try {
      await createQuestions([fakeQuestion])
      // 验证写进去的 options 是合法 JSON
      const { rows } = await pool.query(`SELECT options, ai_tags FROM questions WHERE id = $1`, [qid])
      const opts = rows[0].options
      const tags = rows[0].ai_tags
      const optsIsArray = Array.isArray(opts)
      const tagsIsArray = Array.isArray(tags)
      console.log(`  ✅ ${c.label}`)
      console.log(`     写入 options=${JSON.stringify(opts).slice(0, 60)}（数组？${optsIsArray}）`)
      console.log(`     写入 ai_tags=${JSON.stringify(tags).slice(0, 60)}（数组？${tagsIsArray}）`)
      questionIds.push(qid)
    } catch (e) {
      allPassed = false
      console.log(`  ❌ ${c.label}`)
      console.log(`     报错: ${e.message.slice(0, 200)}`)
    }
  }

  // 清理
  await cleanup(taskId, studentId)

  console.log('\n═══════════════════════════════════════════════════════')
  console.log(allPassed ? '✅ 全部通过：createQuestions 不再因 options 字符串炸 jsonb 列'
                       : '❌ 仍有失败：修复未生效')
  console.log('═══════════════════════════════════════════════════════')

  await pool.end()
  process.exit(allPassed ? 0 : 1)
}

main().catch(async (e) => {
  console.error('❌ 脚本异常:', e.message)
  await pool.end().catch(() => {})
  process.exit(1)
})