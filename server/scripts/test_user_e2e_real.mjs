/**
 * 端到端测试：用用户最新试卷的实际数据调用 pickAnswerUnit
 * 模拟：pageTitle="第十九章实数"，chapterHint="第十九章实数"
 * 题目：20-22，包含二次根式特征
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

import { Pool } from 'pg'
import { pickAnswerUnit } from '../worker.js'

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})

const wsId = '1c31ee45-0879-4d53-a54c-60af85ee15cc'

const run = async () => {
  // 1) 加载答案库，按 unit_key 3D 组织：unitKey → sectionKey → qKey → row
  // resource_answers 通过 unit_id 关联到 resource_units（无 answer_page_start 字段）
  const { rows: units } = await pool.query(`
    SELECT ru.id, ru.unit_key, ru.unit_title
    FROM resource_units ru
    WHERE ru.id IN (SELECT DISTINCT unit_id FROM worksheet_answers WHERE worksheet_id = $1)
  `, [wsId])
  const unitMetaMap = new Map(units.map(u => [u.id, u]))

  const { rows } = await pool.query(`
    SELECT ru.unit_key, ru.unit_title, wa.section, wa.question_no, wa.sub_no,
           wa.answer, wa.answer_type, wa.content, ru.id as unit_id
    FROM worksheet_answers wa
    JOIN resource_units ru ON ru.id = wa.unit_id
    WHERE wa.worksheet_id = $1
  `, [wsId])

  const answersByUnit = new Map()
  for (const r of rows) {
    if (!answersByUnit.has(r.unit_key)) {
      answersByUnit.set(r.unit_key, new Map())
    }
    const secMap = answersByUnit.get(r.unit_key)
    const sectionKey = r.section || ''
    if (!secMap.has(sectionKey)) secMap.set(sectionKey, new Map())
    const qKey = `${r.question_no}|${r.sub_no || ''}`
    const meta = unitMetaMap.get(r.unit_id) || {}
    secMap.get(sectionKey).set(qKey, {
      ...r,
      ...meta,
      unit_title: meta.unit_title || r.unit_title,
      unit_key: meta.unit_key || r.unit_key,
      answer_page_start: meta.answer_page_start,
      answer_page_end: meta.answer_page_end,
    })
  }
  console.log(`答案库: ${answersByUnit.size} 个 unit\n`)

  // 2) 模拟用户实际场景
  const userQuestions = [
    { question_number: 20, sub_no: null, content: '已知无理数a,b在数轴上的对应点如图所示，则下列结论正确的是', student_answer: 'D', question_type: 'choice' },
    { question_number: 21, sub_no: 1, content: '计算：(1) √12 × √(1/3)', student_answer: '2', question_type: 'answer' },
    { question_number: 21, sub_no: 2, content: '计算：(2) 2√5 ÷ √0.5', student_answer: '2√10', question_type: 'answer' },
    { question_number: 22, sub_no: 1, content: '计算：(1) (3√2 - 2)² + (3√2 + 2)²', student_answer: '36', question_type: 'answer' },
    { question_number: 22, sub_no: 2, content: '计算：(2) (2√2 + 3)(2√2 - 3)', student_answer: '-1', question_type: 'answer' },
  ]

  console.log('='.repeat(60))
  console.log('用户实际场景测试')
  console.log('='.repeat(60))

  const scenarios = [
    { name: 'A. 用户原任务参数（pageTitle="第十九章实数", chapterHint="第十九章实数", pageNumber=1）',
      pageTitle: '第十九章实数', chapterHint: '第十九章实数', pageNumber: 1 },
    { name: 'B. 无 pageTitle（chapterHint="第十九章实数"）',
      pageTitle: null, chapterHint: '第十九章实数', pageNumber: 1 },
    { name: 'C. 无 pageTitle 无 chapterHint（最恶劣场景）',
      pageTitle: null, chapterHint: null, pageNumber: 1 },
    { name: 'D. 正确 pageTitle（"试卷③ 19.2 实数 基础性测试"）',
      pageTitle: '试卷③ 19.2 实数 基础性测试', chapterHint: null, pageNumber: 1 },
  ]

  for (const sc of scenarios) {
    const result = pickAnswerUnit(answersByUnit, sc.pageTitle, userQuestions, sc.pageNumber, sc.chapterHint)
    console.log(`\n[${sc.name}]`)
    console.log(`  → unit: ${result}`)
    if (result) {
      const secMap = answersByUnit.get(result)
      const sample = [...secMap.values()][0]?.values().next().value
      console.log(`  → title: ${sample?.unit_title}`)
    }
  }

  await pool.end()
  process.exit(0)
}

run().catch(e => { console.error(e); process.exit(1) })
