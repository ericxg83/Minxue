import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 加载 server/.env（脚本存放在 server/scripts 下）
dotenv.config({ path: path.resolve(__dirname, '../.env') })

import { cleanupStudentData } from '../services/dataCleanupService.js'

const args = process.argv.slice(2)
const dryRun = !args.includes('--execute')

async function main() {
  console.log(`\n=== 学生数据清理 (${dryRun ? '预览模式' : '执行模式'}) ===\n`)

  const result = await cleanupStudentData({
    tasks: true,
    wrongQuestions: true,
    generatedExams: true,
    dryRun,
  })

  console.log('清理范围:', result.scopes)
  console.log('\n清理前统计:')
  console.log('  tasks:', result.before.tasks)
  console.log('  questions:', result.before.questions)
  console.log('  wrong_questions:', result.before.wrong_questions)
  console.log('  generated_exams:', result.before.generated_exams)
  console.log('  worksheets (保留):', result.before.worksheets)
  console.log('  worksheet_answers (保留):', result.before.worksheet_answers)

  if (!dryRun) {
    console.log('\n实际删除:')
  console.log('  tasks:', result.deleted.tasks)
  console.log('  orphan_questions:', result.deleted.orphanQuestions)
  console.log('  wrong_questions:', result.deleted.wrongQuestions)
  console.log('  generated_exams:', result.deleted.generatedExams)
  console.log('\n清理后统计:')
  console.log('  tasks:', result.after.tasks)
  console.log('  questions:', result.after.questions)
  console.log('  wrong_questions:', result.after.wrong_questions)
  console.log('  generated_exams:', result.after.generated_exams)
  console.log('  worksheets (保留):', result.after.worksheets)
  console.log('  worksheet_answers (保留):', result.after.worksheet_answers)
    console.log('\n✅ 清理完成')
  } else {
    console.log('\n⚠️  以上为预览，未实际删除。追加 --execute 参数执行清理。')
  }
}

main().catch(err => {
  console.error('\n❌ 清理失败:', err.message)
  process.exit(1)
})
