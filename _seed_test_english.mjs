// 为 test 学生造英语错题数据，用于测试讲义
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

// test 学生
const { rows: students } = await query(
  `SELECT id, name FROM ${TABLES.STUDENTS} WHERE name = 'test' LIMIT 1`
)
if (students.length === 0) {
  console.error('❌ test 学生不存在')
  process.exit(1)
}
const studentId = students[0].id
console.log('✅ test 学生:', studentId)

// 清理 test 学生已有的英语错题（保持幂等）
await query(
  `DELETE FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1::uuid AND subject = '英语'`,
  [studentId]
)
console.log('🗑️  已清理旧英语错题')

// 5 道英语错题
const questions = [
  {
    content: 'She ____ to the library every weekend when she was in middle school.',
    questionType: 'choice',
    options: ['A. goes', 'B. went', 'C. has gone', 'D. had gone'],
    answer: 'B',
    studentAnswer: 'A',
    aiTags: ['一般过去时', '时间状语从句'],
    isBlank: false,
    errorType: '时态混淆',
    errorReason: '看到 every weekend 误判为一般现在时，但 when 从句中是过去的时间背景',
  },
  {
    content: 'If it ____ tomorrow, we will stay at home.',
    questionType: 'choice',
    options: ['A. rains', 'B. rain', 'C. will rain', 'D. rained'],
    answer: 'A',
    studentAnswer: 'C',
    aiTags: ['一般现在时', '主将从现', '条件状语从句'],
    isBlank: false,
    errorType: '时态规则混淆',
    errorReason: '主将从现规则记反，条件状语从句该用一般现在时表将来',
  },
  {
    content: 'The book ____ on the table belongs to my brother.',
    questionType: 'choice',
    options: ['A. lying', 'B. lying', 'C. lied', 'D. lays'],
    answer: 'A',
    studentAnswer: 'C',
    aiTags: ['现在分词作定语', '非谓语动词'],
    isBlank: false,
    errorType: '非谓语形式错误',
    errorReason: 'lie-lay-lain 是规则变化，现在分词是 lying；学生把 lie 误当作规则动词直接加 -ed',
  },
  {
    content: '—Would you like some more tea? —____, please.',
    questionType: 'choice',
    options: ['A. No more', 'B. Just a little', 'C. It doesn\'t matter', 'D. Yes, I would'],
    answer: 'B',
    studentAnswer: 'A',
    aiTags: ['情景交际', '日常对话'],
    isBlank: false,
    errorType: '情景理解',
    errorReason: '英美习惯：委婉请求时肯定回答用 "Yes, please" 或具体数量，否定回答说 "No, thanks"',
  },
  {
    content: 'The teacher told us that light ____ faster than sound.',
    questionType: 'choice',
    options: ['A. travels', 'B. traveled', 'C. travel', 'D. traveling'],
    answer: 'A',
    studentAnswer: 'B',
    aiTags: ['宾语从句', '客观真理用一般现在时'],
    isBlank: false,
    errorType: '从句时态错误',
    errorReason: '宾语从句表示客观真理时，主从句时态不受主句限制，应保持一般现在时',
  },
]

const now = new Date()
const insertedQuestionIds = []

for (let i = 0; i < questions.length; i++) {
  const q = questions[i]
  // 插入 questions 表
  const { rows: [qRow] } = await query(
    `INSERT INTO ${TABLES.QUESTIONS}
     (content, subject, question_type, options, answer, is_complete, ai_tags, confidence, source_type, created_at, updated_at)
     VALUES ($1, '英语', $2, $3::jsonb, $4, TRUE, $5::text, 0.95, 'manual_seed', $6, $6)
     RETURNING id`,
    [
      q.content,
      q.questionType,
      JSON.stringify(q.options),
      q.answer,
      JSON.stringify(q.aiTags),
      now.toISOString(),
    ]
  )
  const qid = qRow.id
  insertedQuestionIds.push(qid)

  // 插入 wrong_questions 表
  await query(
    `INSERT INTO ${TABLES.WRONG_QUESTIONS}
     (question_id, student_id, subject, content, correct_answer, student_answer,
      is_blank, error_type, error_reason, question_type, source_type, error_count, status, added_at, created_at, updated_at)
     VALUES ($1, $2::uuid, '英语', $3, $4, $5, $6, $7, $8, $9, 'manual_seed', 1, 'active', $10, $10, $10)`,
    [
      qid,
      studentId,
      q.content,
      q.answer,
      q.studentAnswer,
      q.isBlank,
      q.errorType,
      q.errorReason,
      q.questionType,
      now.toISOString(),
    ]
  )

  // 插入 1 条变式题（每道错题配 1 个 variant）
  const variantContent = `[变式] ${q.content.replace(/____/g, '_____')}`
  const variantAnswer = q.answer === 'B' ? 'C' : 'B' // 简单变式：换答案
  await query(
    `INSERT INTO variant_questions
     (source_question_id, strategy, content, options, answer, analysis, difficulty, subject, question_type, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, 3, '英语', $7, $8)`,
    [
      qid,
      'context_shift',
      variantContent,
      JSON.stringify(q.options),
      variantAnswer,
      `本题考查 ${q.aiTags[0]} 知识点，请注意时态一致性。正确答案：${variantAnswer}`,
      q.questionType,
      now.toISOString(),
    ]
  )

  console.log(`✅ 题${i + 1} - ${q.aiTags[0]} - 错题/变式均已插入`)
}

// 验证
const { rows: stats } = await query(
  `SELECT COUNT(*)::int AS cnt FROM ${TABLES.WRONG_QUESTIONS}
   WHERE student_id = $1::uuid AND subject = '英语'`,
  [studentId]
)
const { rows: vstats } = await query(
  `SELECT COUNT(*)::int AS cnt FROM variant_questions
   WHERE source_question_id = ANY($1::uuid[]) AND subject = '英语'`,
  [insertedQuestionIds]
)
const { rows: tagStats } = await query(
  `SELECT tag, COUNT(*)::int AS cnt
   FROM ${TABLES.WRONG_QUESTIONS} wq
   JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
   CROSS JOIN LATERAL jsonb_array_elements_text(
     CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END
   ) AS tag
   WHERE wq.student_id = $1::uuid AND wq.subject = '英语'
   GROUP BY tag ORDER BY cnt DESC`,
  [studentId]
)

console.log('\n=== 汇总 ===')
console.log('英语错题数:', stats[0].cnt)
console.log('英语变式题数:', vstats[0].cnt)
console.log('知识点分布:', JSON.stringify(tagStats, null, 2))

process.exit(0)
