// 调试 from-diagnosis 查询为什么返回空
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

// 1) 直接查 test 学生的错题
const { rows: ws } = await query(
  `SELECT id, question_id, subject, content, added_at
   FROM ${TABLES.WRONG_QUESTIONS} wq
   WHERE wq.student_id = '02d73792-6cff-402b-9dad-bacd734c569a'
   LIMIT 5`
)
console.log('test 错题:', JSON.stringify(ws, null, 2))

// 2) 查 questions 表的 ai_tags
const { rows: qs } = await query(
  `SELECT id, subject, is_complete, ai_tags FROM ${TABLES.QUESTIONS} WHERE subject = '英语' LIMIT 3`
)
console.log('\n英语题:', JSON.stringify(qs, null, 2))

// 3) 模拟 from-diagnosis 的查询
const { rows: diag } = await query(
  `SELECT
     COALESCE(NULLIF(q.subject, ''), '其他') AS subject,
     tag,
     COUNT(*) FILTER (WHERE wq.is_blank = TRUE)::int AS blank_count,
     COUNT(*) FILTER (WHERE wq.is_blank IS NOT TRUE)::int AS wrong_count
   FROM ${TABLES.WRONG_QUESTIONS} wq
   JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
   CROSS JOIN LATERAL jsonb_array_elements_text(
     CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END
   ) AS tag
   WHERE q.is_complete = TRUE
     AND tag != '未分类'
     AND q.subject = '英语'
   GROUP BY q.subject, tag
   ORDER BY blank_count DESC, wrong_count DESC
   LIMIT 12`
)
console.log('\n直接 SQL 查询结果:', JSON.stringify(diag, null, 2))

process.exit(0)
