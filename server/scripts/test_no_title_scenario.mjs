/**
 * 测试无 pageTitle 场景的 pickAnswerUnit 行为
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
const { getResourceAnswersBySection } = await import('../services/neonService.js')

const run = async () => {
  const wsId = '1c31ee45-0879-4d53-a54c-60af85ee15cc'
  const map = await getResourceAnswersBySection(wsId)
  console.log(`构建答案库: ${map.size} 个 unit`)

  // 模拟用户截图：题号 18, 19, 20，无 pageTitle
  const noTitleQuestions = [
    { question_number: 18, content: '以下说法中，正确的是', student_answer: 'C', question_type: 'choice' },
    { question_number: 19, content: '下列各式中，正确的是 A. √4=±2 B. 8的立方根=±2 C. ³√-1=-1 D. ±√9=3', student_answer: 'C', question_type: 'choice' },
    { question_number: 20, content: '已知无理数 a, b 在数轴上的对应点如图所示，则下列结论正确的是 A. b-a>0 B. a,b 互为相反数 C. b 可能等于 √5-2 D. ab<0', student_answer: 'D', question_type: 'choice' },
  ]

  const report = (name, pageTitle, ch) => {
    const r = pickAnswerUnit(map, pageTitle, noTitleQuestions, 1, ch)
    console.log(`\n========== ${name} ==========`)
    console.log(`  pageTitle=${JSON.stringify(pageTitle)}, chapterHint=${JSON.stringify(ch)}`)
    console.log(`  选: ${r}`)
    if (r) {
      const secMap = map.get(r)
      const sample = [...secMap.values()][0]?.values().next().value
      console.log(`  unit_title: ${sample?.unit_title}`)
      let correct = 0, wrong = 0, miss = 0
      for (const q of noTitleQuestions) {
        const qKey = `${q.question_number}|${q.sub_no || ''}`
        let row = null
        for (const qMap of secMap.values()) {
          if (qMap.has(qKey)) { row = qMap.get(qKey); break }
        }
        if (!row) { miss++; continue }
        const match = String(q.student_answer).trim() === String(row.answer).trim()
        if (match) correct++
        else {
          wrong++
          console.log(`  ❌ 题${q.question_number}: 学生="${q.student_answer}" vs 答案库="${row.answer}"`)
        }
      }
      console.log(`  批改: 对=${correct} 错=${wrong} miss=${miss}`)
    }
  }

  report('Scenario A: pageTitle=null, chapterHint=null', null, null)
  report('Scenario B: pageTitle=null, chapterHint="第十九章实数"', null, '第十九章实数')
  report('Scenario C: pageTitle="试卷④ 19.2 实数 提高性测试"', '试卷④ 19.2 实数 提高性测试', null)

  await pool.end()
}
run().catch(e => { console.error(e.message); process.exit(1) })
