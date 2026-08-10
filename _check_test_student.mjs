// 加载 server/.env
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, 'server/.env')
const content = readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
for (const line of content.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const { query, TABLES } = await import('./server/config/neon.js')

// students 表结构
const { rows: cols } = await query(
  `SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = $1 ORDER BY ordinal_position`,
  ['students']
)
console.log('=== students 列 ===')
console.log(JSON.stringify(cols.map(c => c.column_name), null, 2))

// test 学生
const { rows: students } = await query(
  `SELECT * FROM ${TABLES.STUDENTS} WHERE name ILIKE '%test%' OR name ILIKE '%测试%' LIMIT 10`
)
console.log('\n=== test 学生 ===')
console.log(JSON.stringify(students, null, 2))

// test 学生的错题
if (students.length > 0) {
  const ids = students.map(s => s.id)
  const { rows: testWrong } = await query(
    `SELECT wq.id, wq.added_at, q.subject, q.content
     FROM ${TABLES.WRONG_QUESTIONS} wq
     JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
     WHERE wq.student_id = ANY($1::uuid[])
     ORDER BY wq.added_at DESC
     LIMIT 20`,
    [ids]
  )
  console.log('\n=== test 学生错题(最近20) ===')
  console.log(JSON.stringify(testWrong, null, 2))

  // 按学科汇总
  const { rows: bySubj } = await query(
    `SELECT COALESCE(NULLIF(q.subject,''),'其他') AS subject, COUNT(*) AS cnt
     FROM ${TABLES.WRONG_QUESTIONS} wq
     JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
     WHERE wq.student_id = ANY($1::uuid[])
     GROUP BY q.subject ORDER BY cnt DESC`,
    [ids]
  )
  console.log('\n=== test 学生错题按学科 ===')
  console.log(JSON.stringify(bySubj, null, 2))
}

process.exit(0)
