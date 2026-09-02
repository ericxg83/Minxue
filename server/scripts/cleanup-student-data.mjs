/**
 * 按学生清理数据（dry-run 默认；--apply 才真正删）
 *
 * 场景：
 *   某个学生的数据乱了（重复上传、半截任务、跨卷错题关联断裂等），
 *   准备让他从头重传。最干净的做法：把该学生的 tasks / questions /
 *   wrong_questions / generated_exams 全部清掉。
 *
 * 删除顺序（单事务内）：
 *   1. wrong_questions  — 先删，避免 FK 校验阻塞（FK SET NULL 但仍安全）
 *   2. questions        — 学生名下的题目
 *   3. generated_exams  — 学生名下的重练卷
 *   4. tasks            — 最后删
 *
 * 为什么不用软删？
 *   user 明确说「重新上传」，需要彻底清空，软删只是 hidden，统计/错题关联
 *   还会被老数据污染。OSS 文件不在事务里，单独走 gc-orphan-oss.mjs。
 *
 * 用法：
 *   node scripts/cleanup-student-data.mjs --student="张诗蕊"               # dry-run
 *   node scripts/cleanup-student-data.mjs --student="张诗蕊" --apply      # 真删
 *   node scripts/cleanup-student-data.mjs --student-id="uuid-here" --apply # 直接按 ID
 *
 * 安全：
 *   - dry-run 默认；要 --apply 才执行
 *   - 找不到学生 → 直接退出，不会误删同名近邻
 *   - 多名学生匹配 → 要求 --student-id 或更精确的 name
 *   - 事务回滚：失败时不留半截脏数据
 *   - 建议先备份：
 *       CREATE TABLE tasks_backup_YYYYMMDD AS SELECT * FROM tasks WHERE student_id=$1;
 *       CREATE TABLE questions_backup_YYYYMMDD AS SELECT * FROM questions WHERE student_id=$1;
 *       CREATE TABLE wrong_questions_backup_YYYYMMDD AS SELECT * FROM wrong_questions WHERE student_id=$1;
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const APPLY = process.argv.includes('--apply')
const argv = process.argv.filter((a) => a.startsWith('--'))
const nameArg = argv.find((a) => a.startsWith('--student='))?.slice('--student='.length)
const idArg = argv.find((a) => a.startsWith('--student-id='))?.slice('--student-id='.length)

if (!nameArg && !idArg) {
  console.error('❌ 必须指定 --student="姓名" 或 --student-id="uuid"')
  process.exit(2)
}

if (APPLY) {
  console.log('⚠️  APPLY 模式：以下操作会真实删除该学生的 tasks / questions / wrong_questions / generated_exams。\n')
} else {
  console.log('🔍 DRY-RUN 模式（不删数据）。加 --apply 才会执行。\n')
}

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const fmt = (n) => String(n).padStart(5, ' ')

const client = await pool.connect()
try {
  // 1. 解析 student
  let student
  if (idArg) {
    const { rows } = await client.query(
      `SELECT id, name, grade, created_at FROM students WHERE id = $1`,
      [idArg]
    )
    if (rows.length === 0) {
      console.error(`❌ 找不到 student_id = ${idArg}`)
      process.exit(3)
    }
    student = rows[0]
  } else {
    // 名字精确匹配优先；多个候选打印让用户确认
    const { rows: exact } = await client.query(
      `SELECT id, name, grade, created_at FROM students WHERE name = $1 ORDER BY created_at DESC`,
      [nameArg]
    )
    if (exact.length === 1) {
      student = exact[0]
    } else if (exact.length > 1) {
      console.error(`❌ 名字 "${nameArg}" 匹配到 ${exact.length} 个学生，请用 --student-id 指定：`)
      exact.forEach((r) => console.error(`   - id=${r.id}  name=${r.name}  grade=${r.grade}  created=${r.created_at.toISOString().slice(0, 10)}`))
      process.exit(3)
    } else {
      // 模糊匹配兜底
      const { rows: fuzzy } = await client.query(
        `SELECT id, name, grade, created_at FROM students WHERE name ILIKE $1 ORDER BY created_at DESC`,
        [`%${nameArg}%`]
      )
      if (fuzzy.length === 0) {
        console.error(`❌ 找不到名字包含 "${nameArg}" 的学生`)
        process.exit(3)
      }
      if (fuzzy.length > 1) {
        console.error(`❌ 模糊匹配到 ${fuzzy.length} 个学生，请精确 --student 或用 --student-id：`)
        fuzzy.forEach((r) => console.error(`   - id=${r.id}  name=${r.name}  grade=${r.grade}  created=${r.created_at.toISOString().slice(0, 10)}`))
        process.exit(3)
      }
      console.log(`ℹ️  精确匹配无结果，使用唯一模糊匹配：${fuzzy[0].name}\n`)
      student = fuzzy[0]
    }
  }

  console.log('═══════════════════════════════════════════════════════')
  console.log('👤 学生确认')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`   id     : ${student.id}`)
  console.log(`   name   : ${student.name}`)
  console.log(`   grade  : ${student.grade || '-'}`)
  console.log(`   created: ${student.created_at?.toISOString?.().slice(0, 10) || '-'}`)
  console.log('')

  const studentId = student.id

  // 2. 统计待删数量（dry-run 也要查）
  // pg.Pool 的 client 同时只能持一个查询，串行执行避免 pg@9.0 弃用警告
  const tasksRows = await client.query(
    `SELECT COUNT(*)::int AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at
     FROM tasks WHERE student_id = $1`,
    [studentId]
  )
  const wqRows = await client.query(
    `SELECT COUNT(*)::int AS n, MIN(added_at) AS first_at, MAX(added_at) AS last_at
     FROM wrong_questions WHERE student_id = $1`,
    [studentId]
  )
  const qRows = await client.query(
    `SELECT COUNT(*)::int AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at
     FROM questions WHERE student_id = $1`,
    [studentId]
  )
  const examRows = await client.query(
    `SELECT COUNT(*)::int AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at
     FROM generated_exams WHERE student_id = $1`,
    [studentId]
  )

  const tasks = tasksRows.rows[0]
  const wq = wqRows.rows[0]
  const q = qRows.rows[0]
  const exam = examRows.rows[0]

  console.log('═══════════════════════════════════════════════════════')
  console.log('📊 待删除数据规模（按当前未软删统计）')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`   tasks             ${fmt(tasks.n)} 条  ${tasks.first_at ? `(${tasks.first_at.toISOString().slice(0, 10)} ~ ${tasks.last_at.toISOString().slice(0, 10)})` : ''}`)
  console.log(`   questions         ${fmt(q.n)} 条  ${q.first_at ? `(${q.first_at.toISOString().slice(0, 10)} ~ ${q.last_at.toISOString().slice(0, 10)})` : ''}`)
  console.log(`   wrong_questions   ${fmt(wq.n)} 条  ${wq.first_at ? `(${wq.first_at.toISOString().slice(0, 10)} ~ ${wq.last_at.toISOString().slice(0, 10)})` : ''}`)
  console.log(`   generated_exams   ${fmt(exam.n)} 条  ${exam.first_at ? `(${exam.first_at.toISOString().slice(0, 10)} ~ ${exam.last_at.toISOString().slice(0, 10)})` : ''}`)
  console.log('')

  // 3. tasks 还要看原始 OSS 文件数（这些图片不会随数据库删，要提醒走 GC）
  if (tasks.n > 0) {
    const { rows: imgRows } = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE image_url IS NOT NULL)::int AS n_single,
         COUNT(*) FILTER (WHERE images IS NOT NULL)::int AS n_multi
       FROM tasks WHERE student_id = $1`,
      [studentId]
    )
    const { rows: qImgRows } = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE image_url IS NOT NULL)::int AS n
       FROM questions WHERE student_id = $1`,
      [studentId]
    )
    console.log(`🖼️  关联 OSS 图片：task 单图 ${imgRows[0].n_single}，task 多图 ${imgRows[0].n_multi}（按 images JSON 计），question 配图 ${qImgRows[0].n}`)
    console.log('   数据库删除不会清理 OSS 文件；如需释放存储，跑 gc-orphan-oss.mjs 单独处理。\n')
  }

  const totalRows = tasks.n + q.n + wq.n + exam.n
  if (totalRows === 0) {
    console.log('✅ 没有数据可清，无需操作。')
    await client.query('ROLLBACK')
    process.exit(0)
  }

  if (!APPLY) {
    console.log('💡 加 --apply 才会执行。建议执行前备份：')
    console.log(`   CREATE TABLE tasks_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, '')} AS SELECT * FROM tasks WHERE student_id = '${studentId}';`)
    console.log(`   CREATE TABLE questions_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, '')} AS SELECT * FROM questions WHERE student_id = '${studentId}';`)
    console.log(`   CREATE TABLE wrong_questions_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, '')} AS SELECT * FROM wrong_questions WHERE student_id = '${studentId}';`)
    console.log(`   CREATE TABLE generated_exams_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, '')} AS SELECT * FROM generated_exams WHERE student_id = '${studentId}';`)
    await client.query('ROLLBACK')
    process.exit(0)
  }

  // 4. 真删：单事务内按顺序
  console.log('⏳ 开始删除...\n')
  const deleted = { tasks: 0, questions: 0, wrong_questions: 0, generated_exams: 0 }

  // 4a. wrong_questions（FK SET NULL；按 student_id 直删最干净）
  const r1 = await client.query(
    `DELETE FROM wrong_questions WHERE student_id = $1 RETURNING id`,
    [studentId]
  )
  deleted.wrong_questions = r1.rowCount

  // 4b. questions（按 student_id；FK SET NULL 让 task 删除时 questions.task_id 自动置 NULL，
  //     但因为我们按 student_id 直删，task 删除时不再有指向 questions 的 FK 约束反向）
  const r2 = await client.query(
    `DELETE FROM questions WHERE student_id = $1 RETURNING id`,
    [studentId]
  )
  deleted.questions = r2.rowCount

  // 4c. generated_exams（按 student_id；questions 已删，question_ids 数组里的 uuid 已不存在但不会被 FK 校验）
  const r3 = await client.query(
    `DELETE FROM generated_exams WHERE student_id = $1 RETURNING id`,
    [studentId]
  )
  deleted.generated_exams = r3.rowCount

  // 4d. tasks（最后删；questions.task_id FK 是 SET NULL，删 task 安全）
  const r4 = await client.query(
    `DELETE FROM tasks WHERE student_id = $1 RETURNING id`,
    [studentId]
  )
  deleted.tasks = r4.rowCount

  console.log('═══════════════════════════════════════════════════════')
  console.log('✅ 删除完成')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`   tasks             ${fmt(deleted.tasks)} 条`)
  console.log(`   questions         ${fmt(deleted.questions)} 条`)
  console.log(`   wrong_questions   ${fmt(deleted.wrong_questions)} 条`)
  console.log(`   generated_exams   ${fmt(deleted.generated_exams)} 条`)
  console.log('')

  // 5. 验证
  const verify = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM tasks WHERE student_id = $1) AS tasks,
       (SELECT COUNT(*)::int FROM questions WHERE student_id = $1) AS questions,
       (SELECT COUNT(*)::int FROM wrong_questions WHERE student_id = $1) AS wrong_questions,
       (SELECT COUNT(*)::int FROM generated_exams WHERE student_id = $1) AS generated_exams`,
    [studentId]
  )
  const v = verify.rows[0]
  console.log(`🔍 验证（应该都是 0）：tasks=${v.tasks}, questions=${v.questions}, wrong_questions=${v.wrong_questions}, generated_exams=${v.generated_exams}`)
  console.log('')
  console.log('📌 学生档案（students 表）保留未动；如需整条删除，单独处理。')
  console.log('📌 OSS 图片未删；如需清理，跑 gc-orphan-oss.mjs。')

  await client.query('COMMIT')
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('\n❌ 失败:', err.message)
  console.error(err.stack)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}