import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

import { query } from '../config/neon.js'
import { getResourceAnswersBySection } from '../services/neonService.js'
import { pickAnswerUnit } from '../worker.js'

const taskId = 'd17ba9ad-71d1-4182-8001-105041245d40'

const run = async () => {
  const { rows: taskRows } = await query(
    `SELECT worksheet_id FROM tasks WHERE id = $1`,
    [taskId]
  )
  const worksheetId = taskRows[0]?.worksheet_id
  const answersByUnit = await getResourceAnswersBySection(worksheetId)

  // 模拟 OCR 出的题目：来自截图的 6 道题
  const questions = [
    { question_number: 1, question_type: 'answer', student_answer: '13', content: '1. 169 的算方平方根是' },
    { question_number: 2, question_type: 'answer', student_answer: '', content: '2. 化简：' },
    { question_number: 3, question_type: 'answer', student_answer: '', content: '3. 计算下列各式的值：' },
    { question_number: 4, question_type: 'answer', student_answer: '', content: '4. 化简：' },
    { question_number: 5, question_type: 'answer', student_answer: '', content: '5. 已知√5.42≈2.328, √54.2≈7.362, 则：' },
    { question_number: 6, question_type: 'answer', student_answer: '√2', content: '6. 已知|a-2|+(b-c)²+√c+1=0, 则 a+b-c 的算术平方根为' },
  ]

  const pageTitle = '双基过关堂堂练 第十九章 实数 19.1 平方根与立方根 堂堂练① 19.1(1) 算术平方根'

  const matched = pickAnswerUnit(answersByUnit, pageTitle, questions, 1, null)
  console.log('匹配到的 unit:', matched)

  const passed = matched === '堂堂练1|19.1(1)'
  console.log(passed ? '✅ 堂堂练页面正确匹配到堂堂练单元' : `❌ 匹配错误，期望 堂堂练1|19.1(1)，实际 ${matched}`)
  process.exit(passed ? 0 : 1)
}

run().catch(e => { console.error(e); process.exit(1) })
