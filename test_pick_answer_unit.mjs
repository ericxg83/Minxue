// 单元测试：pickAnswerUnit 在 pageTitle=null 时能否根据 chapterHint/content 正确选择"第二十章二次根式"
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: './server/.env' })
import { query } from './server/config/neon.js'
import { pickAnswerUnit } from './server/worker.js'
import { getWorksheetAnswersBySection } from './server/services/neonService.js'

const WORKSHEET_ID = '1c31ee45-0879-4d53-a54c-60af85ee15cc'

// 模拟 30442.jpg 的 OCR 结果（真实场景）：
//   - pageTitle = null（OCR 漏识别）
//   - content = "第 N 题"（占位符，OCR 没返回题干）
//   - student_answer 只有选项字母（D/C 等）
//   - chapterHint 来自新版 prompt（如果 AI 响应了）
const mockQuestions = [
  { question_number: 16, content: '第 16 题', student_answer: 'D', question_type: 'choice' },
  { question_number: 17, content: '第 17 题', student_answer: 'C', question_type: 'choice' },
  { question_number: 18, content: '第 18 题', student_answer: 'C', question_type: 'choice' },
  { question_number: 19, content: '第 19 题', student_answer: 'C', question_type: 'choice' },
  { question_number: 20, content: '第 20 题', student_answer: 'D', question_type: 'choice' },
  { question_number: 21, content: '第 21 题', student_answer: '2', question_type: 'answer' },
  { question_number: 22, content: '第 22 题', student_answer: '36', question_type: 'answer' },
]

const main = async () => {
  const answersByUnit = await getWorksheetAnswersBySection(WORKSHEET_ID)
  console.log(`共 ${answersByUnit.size} 个单元`)

  // 1) 当前问题场景：pageTitle=null, pageNumber=1（无 page range 信息）
  //    走覆盖率打分 → 错挂到"第十九章实数"（修复前行为）
  console.log('\n=== Case 1: 修复前 pageTitle=null ===')
  const r1 = pickAnswerUnit(answersByUnit, null, mockQuestions, 1, null)
  const title1 = answersByUnit.get(r1)?.values()?.next()?.value?.values()?.next()?.value?.unit_title
  console.log('matched unit title:', title1)
  console.log('结果:', title1 === '第二十章二次根式' ? '✓ 正确' : '✗ 错误（应挂"第二十章二次根式"）')

  // 2) 修复后场景：chapterHint="第二十章二次根式"（OCR 推断）
  console.log('\n=== Case 2: 修复后 chapterHint="第二十章二次根式" ===')
  const r2 = pickAnswerUnit(answersByUnit, null, mockQuestions, 1, '第二十章二次根式')
  const title2 = answersByUnit.get(r2)?.values()?.next()?.value?.values()?.next()?.value?.unit_title
  console.log('matched unit title:', title2)
  console.log('结果:', title2 === '第二十章二次根式' ? '✓ 正确' : '✗ 错误')

  // 3) 修复后场景：pageTitle=null + content 含 √ 关键字
  //    即使 chapterHint 没填，content 兜底也应生效
  console.log('\n=== Case 3: chapterHint=null, content 含 √ 关键字 ===')
  const r3 = pickAnswerUnit(answersByUnit, null, mockQuestions, 1, null)
  const title3 = answersByUnit.get(r3)?.values()?.next()?.value?.values()?.next()?.value?.unit_title
  console.log('matched unit title:', title3)
  console.log('结果:', title3 === '第二十章二次根式' ? '✓ content 兜底也正确' : '✗ content 兜底不够（必须依赖 chapterHint）')

  // 4) 真实场景：第十九章内容（无理数、相反数）
  const mock19 = [
    { question_number: 16, content: '与数轴上的点一一对应的是', student_answer: 'A', question_type: 'choice' },
    { question_number: 17, content: '下列说法中错误的是', student_answer: 'B', question_type: 'choice' },
    { question_number: 18, content: '以下说法中正确的是', student_answer: 'C', question_type: 'choice' },
  ]
  console.log('\n=== Case 4: 真实第十九章内容（相反数、无理数特征）===')
  const r4 = pickAnswerUnit(answersByUnit, null, mock19, 1, '第十九章实数')
  const title4 = answersByUnit.get(r4)?.values()?.next()?.value?.values()?.next()?.value?.unit_title
  console.log('matched unit title:', title4)
  console.log('结果:', title4 === '第十九章实数' ? '✓ 正确' : '✗ 错误')

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
