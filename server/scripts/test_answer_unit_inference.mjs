/**
 * 测试：按学生答案反推单元（searchUnitByStudentAnswers）
 *
 * 场景：
 *   学生答案包含填空/解答题的具体数值或表达式，
 *   跨多个 unit 搜索时，应命中正确的 unit。
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

import { Pool } from 'pg'
import { searchUnitByStudentAnswers, calculateAnswerSimilarity } from '../worker.js'

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const wsId = '1c31ee45-0879-4d53-a54c-60af85ee15cc'

const run = async () => {
  // 1) 加载答案库 3D Map
  const { getResourceAnswersBySection } = await import('../services/neonService.js')
  const answersByUnit = await getResourceAnswersBySection(wsId)

  console.log('=== 学生答案反推单元测试 ===')
  console.log(`答案库 unit 数: ${answersByUnit.size}`)
  console.log(`unit 列表: ${[...answersByUnit.keys()].slice(0, 10).join(', ')}${answersByUnit.size > 10 ? '...' : ''}\n`)

  // 2) 构造模拟题目：来自"试卷3|19.2"的真实答案
  const targetUnit = '试卷3|19.2'
  const targetAnswers = answersByUnit.get(targetUnit)
  if (!targetAnswers) {
    console.log(`❌ 找不到单元 ${targetUnit}`)
    await pool.end()
    process.exit(1)
  }

  // 从目标单元抽取若干道题的标准答案作为学生答案
  const sampleQuestions = []
  for (const [qKey, row] of [...targetAnswers.values()].flatMap(m => [...m]).slice(0, 8)) {
    if (!row.answer) continue
    const [qNo, subNo] = qKey.split('|')
    sampleQuestions.push({
      question_number: Number(qNo),
      sub_no: subNo || '',
      question_type: row.answer_type || 'answer',
      student_answer: row.answer,
    })
  }

  if (sampleQuestions.length < 2) {
    console.log('❌ 目标单元可用样本不足')
    await pool.end()
    process.exit(1)
  }

  console.log(`样本数: ${sampleQuestions.length}`)
  for (const q of sampleQuestions.slice(0, 4)) {
    console.log(`  q${q.question_number}${q.sub_no ? '(' + q.sub_no + ')' : ''}: "${q.student_answer}"`)
  }

  // 3) 调用 searchUnitByStudentAnswers
  const inferred = searchUnitByStudentAnswers(sampleQuestions, answersByUnit)
  console.log(`\n反推结果: ${inferred ? inferred.unitKey : 'null'}`)
  if (inferred) {
    console.log(`  hits=${inferred.hits}, totalScore=${inferred.totalScore.toFixed(2)}`)
  }

  const passed = inferred && inferred.unitKey === targetUnit
  console.log('\n' + (passed ? '✅ 反推单元正确' : '❌ 反推单元错误'))

  // 4) 额外测试：完全无关的答案不应命中任何单元
  const wrongUnitQuestions = sampleQuestions.map(q => ({ ...q, student_answer: 'abcdefg' }))
  const inferredWrong = searchUnitByStudentAnswers(wrongUnitQuestions, answersByUnit)
  const passed2 = !inferredWrong
  console.log(passed2 ? '✅ 无关答案未触发误匹配' : `❌ 无关答案误匹配到 ${inferredWrong?.unitKey}`)

  await pool.end()
  process.exit(passed && passed2 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
