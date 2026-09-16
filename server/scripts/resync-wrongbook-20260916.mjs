/**
 * 错题本重同步（2026-09-16）：把「应入册」（is_correct=false 或 未作答）的题
 * 用线上同款 addSelfContainedWrongQuestion 重新写入（ON CONFLICT 幂等）。
 * 用于重判/作废之后错题本出现「应入未入」的对账缺口。
 *
 * 用法：node server/scripts/resync-wrongbook-20260916.mjs <taskId> [--apply]
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const taskId = process.argv.slice(2).find(a => !a.startsWith('--'))
if (!taskId) { console.error('用法: node server/scripts/resync-wrongbook-20260916.mjs <taskId> [--apply]'); process.exit(1) }

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await pool.query(s, p)).rows

const { addSelfContainedWrongQuestion } = await import('../services/neonService.js')

const task = (await q(`SELECT id, student_id, worksheet_id, subject FROM tasks WHERE id=$1::uuid`, [taskId]))[0]
if (!task) { console.error('任务不存在'); process.exit(1) }
const qs = await q(`
  SELECT id, question_number, page_number, student_answer, answer, question_type, content,
         block_coordinates, image_url, is_correct, answer_source
  FROM questions WHERE task_id=$1::uuid AND (is_correct=false OR answer_source='blank')
  ORDER BY question_number`, [taskId])
console.log(`===== ${APPLY ? '应用' : 'DRY-RUN'} | 应入册 ${qs.length} 题 =====`)
for (const x of qs) {
  const params = {
    studentId: task.student_id,
    worksheetId: task.worksheet_id,
    questionNo: x.question_number,
    pageNumber: x.page_number,
    studentAnswer: x.student_answer || '',
    correctAnswer: x.answer || '',
    answerType: x.question_type || 'answer',
    content: x.content || `第${x.question_number}题`,
    questionType: x.question_type || 'answer',
    blockCoordinates: x.block_coordinates || null,
    questionImageUrl: x.image_url || null,
    subject: task.subject || null,
    sourceType: 'workbook',
    questionId: x.id,
    taskId: task.id,
  }
  console.log(`  题${x.question_number} 判=${x.is_correct} 源=${x.answer_source} → ${APPLY ? '写入' : '(dry-run)'}`)
  if (APPLY) {
    const row = await addSelfContainedWrongQuestion(params)
    console.log(`    → ${row?.id ? '已入册 ' + String(row.id).slice(0, 8) : '被守卫拒绝/已存在'}`)
  }
}
if (!APPLY) console.log('（dry-run：未写库，加 --apply 执行）')
await pool.end()
