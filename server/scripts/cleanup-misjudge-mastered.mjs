/**
 * 清理被 rejudge 误判为「已掌握」的错题行（dry-run 默认；--apply 才真删）
 *
 * 背景：
 *   finalizeRejudgeResult 旧版本在 rejudge 答对时把错题行 UPDATE 为 status='mastered'，
 *   这是错的——PC rejudge = 误判，对的题应从错题本移除（DELETE），不是 mastered。
 *   真正的「已掌握」走 finalizeGeneratedExamResults 状态机，lifecycle_status 才会到 'mastered'。
 *
 * 判定（干净可解释）：
 *   status='mastered' AND COALESCE(lifecycle_status,'new') != 'mastered'
 *   凡是 lifecycle_status 没推到 'mastered' 但 status 已是 'mastered' 的错题行，
 *   必是 rejudge 路径产生的误判掌握，应当从错题本移除。
 *
 * 删除的是 wrong_questions 行（学生错题记录），不动 questions 表、不动 judgements 审计。
 *
 * 用法：
 *   node scripts/cleanup-misjudge-mastered.mjs                        # 全部受影响行 dry-run
 *   node scripts/cleanup-misjudge-mastered.mjs --student="胡传政"       # 单个学生 dry-run
 *   node scripts/cleanup-misjudge-mastered.mjs --student-id="uuid"    # 按 student_id
 *   node scripts/cleanup-misjudge-mastered.mjs --student="胡传政" --apply   # 真删
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

console.log(`🔧 ${APPLY ? 'APPLY 模式（将真删）' : 'DRY-RUN 模式（不删）'}\n`)

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const fmt = (n) => String(n).padStart(5, ' ')

const client = await pool.connect()
try {
  // 1. 缩窄到指定学生（可选）
  let studentFilter = ''
  const params = []
  if (idArg) {
    studentFilter = 'AND wq.student_id = $1'
    params.push(idArg)
    const { rows: stuRows } = await client.query(
      `SELECT id, name, grade FROM students WHERE id = $1`,
      [idArg]
    )
    if (stuRows.length === 0) {
      console.error(`❌ 找不到 student_id = ${idArg}`)
      process.exit(3)
    }
    console.log(`👤 范围: ${stuRows[0].name} (${stuRows[0].grade || '-'}  id=${idArg})\n`)
  } else if (nameArg) {
    const { rows: stuRows } = await client.query(
      `SELECT id, name, grade FROM students WHERE name = $1 ORDER BY created_at DESC`,
      [nameArg]
    )
    if (stuRows.length === 0) {
      console.error(`❌ 找不到 name = ${nameArg}`)
      process.exit(3)
    }
    if (stuRows.length > 1) {
      console.error(`❌ 名字 "${nameArg}" 匹配到 ${stuRows.length} 个学生，请用 --student-id 指定：`)
      stuRows.forEach((r) => console.error(`   - id=${r.id}  ${r.name}  ${r.grade || '-'}`))
      process.exit(3)
    }
    params.push(stuRows[0].id)
    studentFilter = 'AND wq.student_id = $1'
    console.log(`👤 范围: ${stuRows[0].name} (${stuRows[0].grade || '-'}  id=${stuRows[0].id})\n`)
  } else {
    console.log('👤 范围: 所有受影响学生\n')
  }

  // 2. 列出受影响的错题行
  const listSql = `
    SELECT wq.id, wq.student_id, s.name AS student_name, s.grade,
           wq.question_id, wq.status, wq.lifecycle_status, wq.error_count,
           wq.mastered_at, wq.last_wrong_at, wq.created_at
    FROM wrong_questions wq
    JOIN students s ON s.id = wq.student_id
    WHERE wq.status = 'mastered'
      AND COALESCE(wq.lifecycle_status, 'new') != 'mastered'
      ${studentFilter}
    ORDER BY s.name, wq.last_wrong_at DESC NULLS LAST
  `
  const listRes = await client.query(listSql, params)

  console.log('═══════════════════════════════════════════════════════')
  console.log(`📋 误判「已掌握」的错题行（status=mastered && lifecycle_status≠mastered）`)
  console.log('═══════════════════════════════════════════════════════')

  if (listRes.rows.length === 0) {
    console.log('✅ 没有受影响行，无需清理。')
    process.exit(0)
  }

  // 聚合按学生分组展示
  const byStudent = new Map()
  for (const r of listRes.rows) {
    if (!byStudent.has(r.student_id)) {
      byStudent.set(r.student_id, { name: r.student_name, grade: r.grade, rows: [] })
    }
    byStudent.get(r.student_id).rows.push(r)
  }

  for (const [sid, info] of byStudent) {
    console.log(`\n   ${info.name} (${info.grade || '-'}  id=${sid})  共 ${info.rows.length} 行`)
    info.rows.forEach((r) => {
      const lastWrong = r.last_wrong_at ? r.last_wrong_at.toISOString().slice(0, 10) : '-'
      const masteredAt = r.mastered_at ? r.mastered_at.toISOString().slice(0, 10) : '-'
      const qShort = r.question_id ? r.question_id.slice(0, 8) : '(question_id NULL)'
      console.log(`     - wrong_questions.id=${r.id.slice(0, 8)}  q=${qShort}  err_cnt=${r.error_count}  last_wrong=${lastWrong}  mastered_at=${masteredAt}  lifecycle=${r.lifecycle_status || 'NULL'}`)
    })
  }

  console.log('\n───────────────────────────────────────────────────────')
  console.log(`📊 总计: ${fmt(listRes.rows.length)} 行  涉及 ${fmt(byStudent.size)} 个学生`)
  console.log('───────────────────────────────────────────────────────')

  // 3. 备份建议
  if (!APPLY) {
    console.log('\n💡 加 --apply 才会执行。建议执行前备份：')
    console.log(`   CREATE TABLE wrong_questions_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, '')} AS`)
    console.log(`     SELECT * FROM wrong_questions WHERE status='mastered' AND COALESCE(lifecycle_status,'new') != 'mastered'${studentFilter ? ' AND student_id IS NOT NULL' : ''};`)
    process.exit(0)
  }

  // 4. 真删（dry-run 已经把 ID 全部列出来了）
  console.log('\n⏳ 开始删除...\n')
  const ids = listRes.rows.map((r) => r.id)
  const delRes = await client.query(
    `DELETE FROM wrong_questions WHERE id = ANY($1::uuid[])`,
    [ids]
  )
  console.log(`✅ 已删除 ${delRes.rowCount} 行 wrong_questions`)

  // 5. 验证
  const verifyRes = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM wrong_questions
     WHERE status='mastered' AND COALESCE(lifecycle_status,'new') != 'mastered' ${studentFilter}`,
    params
  )
  console.log(`🔍 验证：剩余误判掌握行 = ${verifyRes.rows[0].n}（应为 0）`)

  console.log('\n📌 judgements 表未动（审计追踪，按设计保留）')
  console.log('📌 questions 表未动（题本身是对的，rejudge 已经把 is_correct 翻对了）')
} catch (err) {
  console.error('\n❌ 失败:', err.message)
  console.error(err.stack)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}