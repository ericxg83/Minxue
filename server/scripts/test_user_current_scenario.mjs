/**
 * 诊断用户场景：解答题 21-22 (实数/二次根式)
 * 模拟 OCR 识别结果，看 pickAnswerUnit 选了哪个 unit，答案库对应题号的标准答案是什么
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

import { Pool } from 'pg'
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})

const { pickAnswerUnit } = await import('../worker.js')
const { getResourceAnswersBySection } = await import('../services/neonService.js')

const run = async () => {
  const wsId = '1c31ee45-0879-4d53-a54c-60af85ee15cc'

  console.log('=== 1. 加载答案库 ===')
  const map = await getResourceAnswersBySection(wsId)
  console.log(`unit 总数: ${map.size}`)
  console.log('所有 unit (key | title):')
  for (const [ukey, secMap] of map) {
    const sample = [...secMap.values()][0]?.values().next().value
    const title = sample?.unit_title || '(no title)'
    const lessonCode = ukey.match(/\|(\d+(?:\.\d+)?(?:\(\d+\))?)/)?.[1] || ''
    console.log(`  ${ukey.padEnd(20)} | ${title} [${lessonCode}]`)
  }

  console.log('\n=== 2. 模拟用户新截图 OCR ===')
  console.log('截图内容：第 21-22 题 解答题（计算题）')
  console.log('  21(1) √12×√(1/3) | 21(2) 2√3×√0.5 + 2√3×(√3/2)')
  console.log('  22(1) (3√-2)²+(3√2+2) | 22(2) (2√3+3)(2√-3)')

  // 模拟 AI 识别的"完整版"OCR（页眉有"试卷⑥ 第十九章实数"小标题的话）
  const scenarios = [
    {
      name: 'Scenario D: OCR 识别到页眉"试卷④ 19.2 实数 提高性测试"',
      pageTitle: '试卷④ 19.2 实数 提高性测试',
      chapterHint: '第十九章实数',
      questions: [
        { question_number: 21, content: '计算：(1) √12×√(1/3)', student_answer: '2', question_type: 'answer' },
        { question_number: 22, content: '计算：(1) (3√-2)²+(3√2+2)² (2) (2√3+3)(2√-3)', student_answer: '2-2√6', question_type: 'answer' },
      ],
    },
    {
      name: 'Scenario E: OCR 漏页眉（pageTitle=null）',
      pageTitle: null,
      chapterHint: '第十九章实数',
      questions: [
        { question_number: 21, content: '计算：(1) √12×√(1/3)', student_answer: '2', question_type: 'answer' },
        { question_number: 22, content: '计算：(1) (3√-2)²+(3√2+2)² (2) (2√3+3)(2√-3)', student_answer: '2-2√6', question_type: 'answer' },
      ],
    },
    {
      name: 'Scenario F: OCR 错把第21-22题当 19.x',
      pageTitle: '试卷① 19.1 平方根与立方根 基础性测试',
      chapterHint: '第十九章实数',
      questions: [
        { question_number: 19, content: '下列各式中正确的是', student_answer: 'D', question_type: 'choice' },
        { question_number: 20, content: '数轴上表示-1的点', student_answer: 'B', question_type: 'choice' },
        { question_number: 21, content: '计算', student_answer: '2-2√6', question_type: 'answer' },
        { question_number: 22, content: '计算', student_answer: '2', question_type: 'answer' },
      ],
    },
  ]

  for (const sc of scenarios) {
    console.log(`\n========== ${sc.name} ==========`)
    console.log(`  pageTitle=${JSON.stringify(sc.pageTitle)}, chapterHint=${JSON.stringify(sc.chapterHint)}`)
    const matched = pickAnswerUnit(map, sc.pageTitle, sc.questions, 1, sc.chapterHint)
    console.log(`  选 unit: ${matched}`)
    if (matched) {
      const secMap = map.get(matched)
      const sample = [...secMap.values()][0]?.values().next().value
      console.log(`  unit_title: ${sample?.unit_title}`)
      console.log(`  \n  逐题比对:`)
      for (const q of sc.questions) {
        const qKey = `${q.question_number}|${q.sub_no || ''}`
        let row = null
        for (const qMap of secMap.values()) {
          if (qMap.has(qKey)) { row = qMap.get(qKey); break }
        }
        if (!row) {
          console.log(`    题${q.question_number}: 学生="${q.student_answer}" | 答案库无此题 ❓`)
        } else {
          const match = String(q.student_answer || '').trim() === String(row.answer || '').trim()
          console.log(`    题${q.question_number}: 学生="${q.student_answer}" | 答案库="${row.answer}" ${match ? '✓' : '✗ 错位'}`)
        }
      }
    }
  }

  await pool.end()
}
run().catch(e => { console.error(e.message); process.exit(1) })
