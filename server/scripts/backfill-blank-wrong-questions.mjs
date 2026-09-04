/**
 * 历史空答题入错题本 backfill 脚本
 *
 * 背景（2026-09-04）：
 *   改 finalizer/worker 入册过滤前，answer_source='blank' 的题永远不进 wrong_questions。
 *   现已支持，但历史已批改的题不会自动入册——需要 backfill 一遍。
 *
 * 复用 addWrongQuestions（包含置信度、完整性、UNIQUE 检查），
 * 传 questionMap 时显式带 answer_source，addWrongQuestions 会同步写
 * is_blank=TRUE / error_type='未作答'。
 *
 * 用法：
 *   node scripts/backfill-blank-wrong-questions.mjs                # 默认 dry-run
 *   node scripts/backfill-blank-wrong-questions.mjs --apply       # 真正写入
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

// 让 addWrongQuestions / query 用上 pool:我们用最简路径直接 query/insert。
const target = { name: 'backfill-blank' }
const { query } = await import('../config/neon.js').then(m => ({
  query: (text, params) => pool.query(text, params),
}))

const findCandidates = async () => {
  const r = await pool.query(`
    SELECT q.id, q.student_id, q.content, q.options, q.answer, q.question_type,
           q.subject, q.is_correct, q.answer_source, q.geometry_image_url,
           s.name AS student_name, q.question_number
    FROM questions q
    JOIN students s ON s.id = q.student_id
    WHERE q.answer_source = 'blank'
      AND q.deleted_at IS NULL
      AND q.answer IS NOT NULL AND q.answer != ''
      AND NOT EXISTS (SELECT 1 FROM wrong_questions wq WHERE wq.question_id = q.id)
    ORDER BY s.name, q.question_number
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
  console.log(`\n[${target.name}] ${APPLY ? 'APPLY 模式' : 'DRY-RUN 模式'}`)
  console.log(`  待 backfill 空答题: ${candidates.length} 道, 涉及 ${byStudent.size} 个学生\n`)

  let totalAdded = 0
  let totalSkipped = 0
  let totalFailed = 0

  for (const [studentId, { name, ids }] of byStudent) {
    console.log(`  ${name} (${studentId.slice(0, 8)}): ${ids.length} 道`)
    for (const q of ids) {
      console.log(`    - q${q.question_number}  ${q.id.slice(0, 8)}  content=${(q.content || '').slice(0, 30)}…`)
    }
    if (!APPLY) {
      totalAdded += ids.length
      continue
    }

    // 真做：按学生批量调 addWrongQuestions
    const questionIds = ids.map(q => q.id)
    const questionMap = new Map(ids.map(q => [q.id, q]))
    try {
      const added = await addWrongQuestions(studentId, questionIds, null, questionMap)
      totalAdded += added.length
      totalSkipped += ids.length - added.length
    } catch (e) {
      totalFailed += 1
      console.error(`    ✗ ${name} 入册失败: ${e.message}`)
    }
  }

  console.log('\n[汇总]')
  console.log(`  待入册: ${candidates.length}`)
  console.log(`  实际入册: ${totalAdded}`)
  if (totalSkipped) console.log(`  跳过(完整性/置信度): ${totalSkipped}`)
  if (totalFailed) console.log(`  失败: ${totalFailed}`)
  if (!APPLY) console.log(`\n  Dry-run,未写入。要真做请加 --apply`)
}

run()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('[backfill] 失败:', e)
    process.exit(1)
  })
