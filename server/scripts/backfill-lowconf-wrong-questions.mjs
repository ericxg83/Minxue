/**
 * 历史判错但被 conf<0.8 挡的题 backfill 入错题本
 *
 * 背景（2026-09-04）：
 *   addWrongQuestions 设计上有 conf<0.8 阈值挡低置信错题。老师复核点「标错」时
 *   本应强入（人工 = ground truth），已修；但历史已判错且老师还没复核过的题，
 *   因 task 早 done，不会再走 rejudge 路径。本次 backfill 一次性扫这些题，
 *   以人工复核同等力度（skipConfidence=true）入册。
 *
 * 入册条件（全满足才入）：
 *   1. is_correct = false（AI 已判错）
 *   2. answer 非空（有参考答案）
 *   3. is_complete = true（题面完整，不挡缺图题，让老师补完图再走 rejudge 入）
 *   4. 关联 task 未软删（deleted_at IS NULL，跳过蔡怡希旧 task 重复版本）
 *   5. wrong_questions 表中不存在（避免重复入；走 052 的 ON CONFLICT DO NOTHING 兜底）
 *
 * 用法：
 *   node scripts/backfill-lowconf-wrong-questions.mjs            # 默认 dry-run
 *   node scripts/backfill-lowconf-wrong-questions.mjs --apply   # 真正写入
 *
 * ⚠️ 生产库执行前请先 dry-run 看输出规模。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'
import { addWrongQuestions } from '../services/neonService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '..', '.env') })

const APPLY = process.argv.includes('--apply')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL })

const findCandidates = async () => {
  const r = await pool.query(`
    SELECT q.id, q.student_id, s.name AS student_name, q.question_number,
           q.confidence, q.content, q.options, q.answer, q.question_type,
           q.geometry_image_url, q.answer_source, q.is_correct
    FROM questions q
    JOIN students s ON s.id = q.student_id
    JOIN tasks t ON t.id = q.task_id
    WHERE q.is_correct = false
      AND q.deleted_at IS NULL
      AND q.answer IS NOT NULL AND q.answer != ''
      AND q.is_complete = TRUE
      AND t.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM wrong_questions wq WHERE wq.question_id = q.id)
    ORDER BY s.name, q.created_at
  `)
  return r.rows
}

const groupByStudent = (rows) => {
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.student_id)) map.set(r.student_id, { name: r.student_name, ids: [] })
    map.get(r.student_id).ids.push(r)
  }
  return map
}

const run = async () => {
  const candidates = await findCandidates()
  const byStudent = groupByStudent(candidates)
  console.log(`\n[backfill-lowconf] ${APPLY ? 'APPLY 模式' : 'DRY-RUN 模式'}`)
  console.log(`  待 backfill 低置信错题: ${candidates.length} 道, 涉及 ${byStudent.size} 个学生\n`)

  let totalAdded = 0
  let totalFailed = 0

  for (const [studentId, { name, ids }] of byStudent) {
    console.log(`  ${name} (${studentId.slice(0, 8)}): ${ids.length} 道`)
    for (const q of ids) {
      console.log(`    - q${q.question_number} ${q.id.slice(0, 8)} conf=${q.confidence}  content=${(q.content || '').slice(0, 30)}…`)
    }
    if (!APPLY) {
      totalAdded += ids.length
      continue
    }
    const questionIds = ids.map(q => q.id)
    const questionMap = new Map(ids.map(q => [q.id, q]))
    try {
      // 强入：跳过 conf 阈值（与老师复核同等力度）
      const added = await addWrongQuestions(studentId, questionIds, null, questionMap, { skipConfidence: true })
      totalAdded += added.length
    } catch (e) {
      totalFailed += 1
      console.error(`    ✗ ${name} 入册失败: ${e.message}`)
    }
  }

  console.log('\n[汇总]')
  console.log(`  候选: ${candidates.length}`)
  console.log(`  实际入册: ${totalAdded}`)
  if (totalFailed) console.log(`  失败: ${totalFailed}`)
  if (!APPLY) console.log(`\n  Dry-run,未写入。要真做请加 --apply`)
}

run()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('[backfill-lowconf] 失败:', e)
    process.exit(1)
  })
