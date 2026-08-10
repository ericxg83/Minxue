// 完整复现 from-diagnosis 的查询
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
const { parsePeriod } = await import('./server/utils/period.js')

// 模拟 mode=all
const p = parsePeriod({ mode: 'all', offset: 0 })
console.log('periodStart:', p.periodStart, 'ISO:', p.periodStart.toISOString())
console.log('periodEnd:', p.periodEnd, 'ISO:', p.periodEnd.toISOString())

const subject = '英语'
const params = [p.periodStart, p.periodEnd]
let subjectClause = ''
if (subject) {
  subjectClause = ` AND q.subject = $${params.length + 1}`
  params.push(subject)
}

const sql = `SELECT
    COALESCE(NULLIF(q.subject, ''), '其他') AS subject,
    tag,
    COUNT(*) FILTER (WHERE wq.is_blank = TRUE)::int AS blank_count,
    COUNT(*) FILTER (WHERE wq.is_blank IS NOT TRUE)::int AS wrong_count
  FROM ${TABLES.WRONG_QUESTIONS} wq
  JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END
  ) AS tag
  WHERE wq.added_at >= $1 AND wq.added_at < $2
    AND q.is_complete = TRUE
    AND tag != '未分类'${subjectClause}
  GROUP BY q.subject, tag
  ORDER BY blank_count DESC, wrong_count DESC
  LIMIT 12`

console.log('SQL:', sql)
console.log('PARAMS:', params.map(p => p instanceof Date ? p.toISOString() : p))

const { rows, rowCount } = await query(sql, params)
console.log('rows count:', rowCount, 'sample:', JSON.stringify(rows.slice(0, 3), null, 2))

process.exit(0)
