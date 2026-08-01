/**
 * 测试答案指纹匹配（OCR 题号错位兜底）
 * 模拟用户最新试卷截图场景：第 21-22 题（解答题 计算题）
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

// 拿到 worker.js 的新函数（用 dynamic import 拿 export 和 module-level 函数）
const workerMod = await import('../worker.js')

const run = async () => {
  const wsId = '1c31ee45-0879-4d53-a54c-60af85ee15cc'

  // 加载答案库（试卷3|19.2 = 试卷③19.2实数基础性测试）
  const { getResourceAnswersBySection } = await import('../services/neonService.js')
  const map = await getResourceAnswersBySection(wsId)

  // 找 试卷3|19.2 unit
  let targetUnit = null
  for (const k of map.keys()) {
    if (k.includes('试卷3') && k.includes('19.2')) {
      targetUnit = k
      break
    }
  }
  if (!targetUnit) {
    console.log('❌ 找不到 试卷3|19.2 unit')
    return
  }
  const secMap = map.get(targetUnit)
  console.log(`✅ 找到目标 unit: ${targetUnit}`)
  console.log(`   答案库共 ${[...secMap.values()].reduce((s, qMap) => s + qMap.size, 0)} 道题`)

  // 列出 21-22 题（含 sub_no）
  console.log('\n=== 答案库 21-22 题清单 ===')
  for (const [secKey, qMap] of secMap) {
    for (const [qKey, row] of qMap) {
      const [qNo, subNo] = qKey.split('|')
      const qn = Number(qNo)
      if (qn >= 21 && qn <= 23) {
        console.log(`  题${qNo}${subNo ? '(' + subNo + ')' : ''}: [${row.answer_type}] "${row.answer}"`)
      }
    }
  }

  // ─────────────────────────────────────────────────
  // 模拟用户最新试卷场景（4 个测试）
  // ─────────────────────────────────────────────────
  console.log('\n\n========== 模拟用户最新试卷（解答题 21-22）==========\n')

  // 工具：模拟 processAnswerBankGrading 内的查表 + 答案指纹兜底
  const lookupRow = (qNo, subNo) => {
    const qKey = `${Number(qNo)}|${subNo || ''}`
    for (const qMap of secMap.values()) {
      const row = qMap.get(qKey)
      if (row) return row
    }
    return null
  }
  // 简易 judgeAnswer 模拟（精确字符串相等）
  const judgeAnswer = (sAns, refAns) => {
    if (sAns == null || refAns == null) return { isCorrect: null }
    const s = String(sAns).trim()
    const r = String(refAns).trim()
    if (!s) return { isCorrect: null }
    return { isCorrect: s === r }
  }

  const scenarios = [
    {
      name: 'A. 用户正确场景：题号 21(1)=2 22(1)=22-12√2 22(2)=-1',
      questions: [
        { question_number: 21, sub_no: 1, student_answer: '2', question_type: 'answer', content: '√12×√(1/3)' },
        { question_number: 22, sub_no: 1, student_answer: '22-12√2', question_type: 'answer', content: '(3√2-2)²+(3√2+2)²' },
        { question_number: 22, sub_no: 2, student_answer: '-1', question_type: 'answer', content: '(2√3+3)(2√-3)' },
      ],
    },
    {
      name: 'B. OCR 错位场景：把题 21 错读成 22，student="2"',
      questions: [
        { question_number: 22, sub_no: 1, student_answer: '2', question_type: 'answer', content: '√12×√(1/3)' },
      ],
    },
    {
      name: 'C. OCR 错位 + 答案错读：student="9×4=36" 实际是 22(1)=22-12√2',
      questions: [
        { question_number: 22, sub_no: 1, student_answer: '9×4=36', question_type: 'answer', content: '(3√2-2)²+(3√2+2)²' },
      ],
    },
    {
      name: 'D. 旧场景：题号 18-20 选择题（pageTitle=null, chapterHint=第十九章实数）',
      questions: [
        { question_number: 18, student_answer: 'C', question_type: 'choice', content: '填空题' },
        { question_number: 19, student_answer: 'C', question_type: 'choice', content: '下列各式中正确的是' },
        { question_number: 20, student_answer: 'D', question_type: 'choice', content: '数轴题' },
      ],
    },
  ]

  for (const sc of scenarios) {
    console.log(`\n--- ${sc.name} ---`)
    const usedQKeys = new Set()
    const suspects = []

    for (const q of sc.questions) {
      const studentAnswer = String(q.student_answer || '').trim()
      const isEmpty = !studentAnswer
      const answerRow = lookupRow(q.question_number, q.sub_no)
      const refAnswer = answerRow?.answer || null

      let isCorrect = null
      let matchedVia = 'qno'

      if (answerRow && !isEmpty) {
        const j = judgeAnswer(studentAnswer, refAnswer)
        isCorrect = j.isCorrect
        usedQKeys.add(`${Number(q.question_number)}|${q.sub_no || ''}`)

        // 检查答案相似度
        const sim = workerMod.calculateAnswerSimilarity ? workerMod.calculateAnswerSimilarity(studentAnswer, refAnswer) : null
        if (sim !== null && sim < 0.5) {
          suspects.push({ q, studentAnswer, qType: q.question_type, refAnswer, sim })
          console.log(`  题${q.question_number}${q.sub_no ? '(' + q.sub_no + ')' : ''}: 学生="${studentAnswer}" | 答案库题号=${q.question_number} ref="${refAnswer}" | sim=${sim.toFixed(2)} ❌ 可疑`)
        } else {
          console.log(`  题${q.question_number}${q.sub_no ? '(' + q.sub_no + ')' : ''}: 学生="${studentAnswer}" | 答案库题号=${q.question_number} ref="${refAnswer}" | ${isCorrect ? '✓' : '✗ 错'}`)
        }
      }
    }

    // 答案指纹兜底
    if (suspects.length > 0 && workerMod.searchByAnswerFingerprint) {
      console.log(`  \n  [答案指纹兜底] ${suspects.length} 道可疑题`)
      for (const suspect of suspects) {
        const found = workerMod.searchByAnswerFingerprint(suspect.studentAnswer, suspect.qType, secMap, usedQKeys)
        if (found) {
          const newQNo = found.qKey.split('|')[0]
          console.log(`    ✓ OCR题号 ${suspect.q.question_number}${suspect.q.sub_no ? '(' + suspect.q.sub_no + ')' : ''} → 答案库题号 ${newQNo} (score=${found.score.toFixed(2)})`)
          console.log(`      学生="${suspect.studentAnswer.slice(0, 30)}" 答案库="${found.row.answer}"`)
          const j = judgeAnswer(suspect.studentAnswer, found.row.answer)
          console.log(`      重批结果: ${j.isCorrect ? '✓ 正确' : '✗ 错误'}`)
          usedQKeys.add(found.qKey)
        } else {
          console.log(`    ✗ OCR题号 ${suspect.q.question_number}: 无更相似答案（保持原判定）`)
        }
      }
    }
  }

  await pool.end()
}
run().catch(e => { console.error(e.message); process.exit(1) })
