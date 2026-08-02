/**
 * 对截图中的真实失败任务做回归测试
 * taskId = 73464f43-d669-42e7-93a9-e1dbfb14a0d3
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

import { query } from '../config/neon.js'
import { getResourceAnswersBySection } from '../services/neonService.js'
import { searchUnitByStudentAnswers } from '../worker.js'
import { regradeTaskPageWithUnit } from '../services/worksheetPageService.js'

const taskId = '73464f43-d669-42e7-93a9-e1dbfb14a0d3'
const pageNumber = 1

const run = async () => {
  // 1) task 信息
  const { rows: taskRows } = await query(
    `SELECT id, worksheet_id, status, created_at FROM tasks WHERE id = $1`,
    [taskId]
  )
  if (taskRows.length === 0) {
    console.log('❌ task 不存在')
    process.exit(1)
  }
  const task = taskRows[0]
  console.log('=== 任务信息 ===')
  console.log(`taskId=${task.id}`)
  console.log(`worksheetId=${task.worksheet_id}`)
  console.log(`status=${task.status}`)

  // 2) 该页所有题目
  const { rows: questions } = await query(
    `SELECT id, question_number, question_type, student_answer, answer, status
     FROM questions
     WHERE task_id = $1 AND page_number = $2 AND deleted_at IS NULL
     ORDER BY question_number`,
    [taskId, pageNumber]
  )
  console.log(`\n=== 第 ${pageNumber} 页题目（${questions.length} 道）===`)
  for (const q of questions) {
    console.log(`q${q.question_number} [${q.question_type}] student="${(q.student_answer || '').slice(0, 40)}" answer="${(q.answer || '').slice(0, 60)}" status=${q.status}`)
  }

  // 3) 加载答案库
  const answersByUnit = await getResourceAnswersBySection(task.worksheet_id)
  console.log(`\n=== 答案库 unit 数: ${answersByUnit.size} ===`)

  // 4) 方案1测试：用学生答案反推单元
  console.log('\n=== 方案1：学生答案反推单元 ===')
  const inferred = searchUnitByStudentAnswers(questions, answersByUnit)
  if (inferred) {
    console.log(`反推单元: ${inferred.unitKey}`)
    console.log(`hits=${inferred.hits}, totalScore=${inferred.totalScore.toFixed(2)}`)

    // 查看该单元下 q21 的正确答案
    const unitAnswers = answersByUnit.get(inferred.unitKey)
    if (unitAnswers) {
      for (const qMap of unitAnswers.values()) {
        for (const [qKey, row] of qMap) {
          if (qKey.startsWith('21|')) {
            console.log(`  该单元 q21 答案: "${row.answer}" (answer_type=${row.answer_type})`)
          }
        }
      }
    }
  } else {
    console.log('未能反推单元（可能该页都是选择/判断题，或学生答案为空/全错）')
  }

  // 5) 方案2测试：手动指定到"试卷3|19.2"，看 q21 答案是否正确
  console.log('\n=== 方案2：手动指定到 试卷3|19.2 并重新批改 ===')
  const result = await regradeTaskPageWithUnit(taskId, pageNumber, '试卷3|19.2')
  console.log(JSON.stringify(result, null, 2))

  // 6) 重新读取 q21 答案
  const { rows: after } = await query(
    `SELECT id, question_number, question_type, student_answer, answer, status
     FROM questions
     WHERE task_id = $1 AND page_number = $2 AND question_number = 21 AND deleted_at IS NULL`,
    [taskId, pageNumber]
  )
  if (after.length > 0) {
    const q = after[0]
    console.log(`\n修复后 q21:`)
    console.log(`  student="${q.student_answer}"`)
    console.log(`  answer="${q.answer}"`)
    console.log(`  status=${q.status}`)
  }

  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
