/**
 * 用 worker.js 的真实 pickAnswerUnit 跑端到端测试
 * 直接 import server/worker.js，验证 6 个场景
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})

const { pickAnswerUnit } = await import('../worker.js')

const run = async () => {
  const wsId = '1c31ee45-0879-4d53-a54c-60af85ee15cc'

  const { rows: ans } = await pool.query(`
    SELECT ra.unit_id, ra.question_no, ra.sub_no, ra.answer, ra.answer_type, ra.section, ra.content,
           ru.unit_key, ru.unit_title, ru.unit_seq, ru.answer_page_start, ru.answer_page_end
    FROM resource_answers ra
    LEFT JOIN resource_units ru ON ru.id = ra.unit_id
    WHERE ra.resource_id = $1
      AND ra.answer_status IN ('teacher_verified','official_verified')
      AND (ru.unit_key LIKE '试卷%' OR ru.unit_title LIKE '%试卷%')
  `, [wsId])

  const map = new Map()
  for (const r of ans) {
    const uk = r.unit_key
    if (!map.has(uk)) map.set(uk, new Map())
    const secMap = map.get(uk)
    const sec = r.section || ''
    if (!secMap.has(sec)) secMap.set(sec, new Map())
    secMap.get(sec).set(`${Number(r.question_no)}|${r.sub_no||''}`, {
      answer: r.answer,
      answer_type: r.answer_type,
      unit_title: r.unit_title,
      unit_key: r.unit_key,
      answer_page_start: r.answer_page_start,
      answer_page_end: r.answer_page_end,
    })
  }
  console.log(`构建答案库: ${map.size} 个试卷 unit`)

  const studentQuestions = [
    { question_number: 1, content: '√6-5 的绝对值是', student_answer: '5-2√6' },
    { question_number: 2, content: '计算 (√15)² + (-√3)² - 4', student_answer: '15' },
    { question_number: 3, content: '已知太阳地球距离约 1.5×10⁸ km, 光速 3×10⁵ km/s', student_answer: '5×10²' },
    { question_number: 4, content: '关于反说法正确的是', student_answer: '①④' },
    { question_number: 5, content: '解方程 x²+1=2x', student_answer: '±5/6' },
    { question_number: 6, content: '设a=1.732', student_answer: '1/100' },
    { question_number: 7, content: '已知√(101²) = 10.1', student_answer: '±1.01' },
    { question_number: 8, content: '已知1<a<5, 化简', student_answer: '1/√5' },
    { question_number: 9, content: '正方形周长 4cm, 面积 50cm²', student_answer: '0' },
    { question_number: 10, content: '若x-2的平方根是±5, 那么x-2', student_answer: '7' },
    { question_number: 11, content: '底数部分为-6', student_answer: '-6√2' },
    { question_number: 12, content: '求 |x|+y=1', student_answer: '0' },
    { question_number: 13, content: '下列各式', student_answer: '-12' },
    { question_number: 14, content: '求值', student_answer: '2/3' },
  ]

  // Test 1: 用户截图场景
  const r1 = pickAnswerUnit(map, '试卷① 19.2 实数 提高性测试', studentQuestions, 1, '第十九章实数')
  console.log(`Test 1 (用户截图): 选 ${r1} ${r1 === '试卷4|19.2' ? '✅' : '❌'}`)

  // Test 2: 正常识别
  const r2 = pickAnswerUnit(map, '试卷4 19.2实数提高性测试', studentQuestions, 1, null)
  console.log(`Test 2 (正常识别): 选 ${r2} ${r2 === '试卷4|19.2' ? '✅' : '❌'}`)

  // Test 3: 试卷6
  const r3 = pickAnswerUnit(map, '试卷6 第十九章实数提高性测试', studentQuestions.slice(0, 4), 1, '第十九章实数')
  console.log(`Test 3 (试卷6): 选 ${r3} ${r3 === '试卷6' ? '✅' : '❌'}`)

  // Test 4: pageTitle=null + chapterHint=大章
  const r4 = pickAnswerUnit(map, null, studentQuestions, 1, '第十九章实数')
  const expected4 = new Set(['试卷1|19.1', '试卷2|19.1', '试卷3|19.2', '试卷4|19.2'])
  console.log(`Test 4 (chapterHint=大章): 选 ${r4} ${expected4.has(r4) ? '✅' : '❌'}`)

  // Test 5: pageTitle=null + chapterHint=小节
  const r5 = pickAnswerUnit(map, null, studentQuestions, 1, '19.2')
  const expected5 = new Set(['试卷3|19.2', '试卷4|19.2'])
  console.log(`Test 5 (chapterHint=19.2): 选 ${r5} ${expected5.has(r5) ? '✅' : '❌'}`)

  // Test 6: 仅 lessonHint
  const r6 = pickAnswerUnit(map, null, [{ ...studentQuestions[0], content: '19.2 实数 提高性测试 第1题：' + studentQuestions[0].content }, ...studentQuestions.slice(1)], 1, null)
  const expected6 = new Set(['试卷3|19.2', '试卷4|19.2'])
  console.log(`Test 6 (仅 lessonHint): 选 ${r6} ${expected6.has(r6) ? '✅' : '❌'}`)

  await pool.end()
}
run().catch(e => { console.error(e.message); process.exit(1) })
