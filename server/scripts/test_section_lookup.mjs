import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

import { query } from '../config/neon.js'
import { getResourceAnswersBySection } from '../services/neonService.js'

const taskId = 'd17ba9ad-71d1-4182-8001-105041245d40'

const sectionScoreForType = (section, questionType) => {
  if (!section) return 50
  const s = String(section)
  if (questionType === 'choice') return /选择/.test(s) ? 100 : 0
  if (questionType === 'judge') return /判断/.test(s) ? 100 : 0
  if (/填空/.test(s)) return 100
  if (/解答|计算|证明|简答|作图/.test(s)) return 90
  if (/选择/.test(s)) return 0
  if (/判断/.test(s)) return 0
  return 50
}

const lookupRow = (unitAnswers, qNo, subNo, questionType) => {
  if (!unitAnswers) return null
  const qKey = `${Number(qNo)}|${subNo || ''}`
  let best = null
  let bestScore = -1
  for (const [section, qMap] of unitAnswers) {
    const row = qMap.get(qKey)
    if (!row) continue
    const score = sectionScoreForType(section, questionType)
    if (score > bestScore) {
      bestScore = score
      best = row
    }
  }
  return best
}

const run = async () => {
  const { rows: taskRows } = await query(
    `SELECT worksheet_id FROM tasks WHERE id = $1`,
    [taskId]
  )
  const worksheetId = taskRows[0]?.worksheet_id
  const answersByUnit = await getResourceAnswersBySection(worksheetId)
  const unitAnswers = answersByUnit.get('堂堂练1|19.1(1)')

  console.log('=== 堂堂练1|19.1(1) section 列表 ===')
  for (const sec of unitAnswers.keys()) {
    console.log(`  ${sec}`)
  }

  const tests = [
    { qNo: 1, subNo: '', questionType: 'answer', expected: '13' },
    { qNo: 6, subNo: '', questionType: 'answer', expected: '√2.' },
  ]

  let allPassed = true
  for (const t of tests) {
    const row = lookupRow(unitAnswers, t.qNo, t.subNo, t.questionType)
    const passed = row && row.answer === t.expected
    console.log(`q${t.qNo} type=${t.questionType} → answer="${row?.answer}" (期望 "${t.expected}") ${passed ? '✅' : '❌'}`)
    if (!passed) allPassed = false
  }

  process.exit(allPassed ? 0 : 1)
}

run().catch(e => { console.error(e); process.exit(1) })
