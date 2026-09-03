// Dry-run：列出所有 status='published' AND answer_status='ai_draft' 的 exam 资源。
// 迁移 055 会把它们升到 teacher_verified。Read-only，不改任何数据。
//
// 用法：cd server && node scripts/dryrun-fix-exam-published-inconsistency.mjs

import { query } from '../config/neon.js'

const main = async () => {
  const { rows: badRows } = await query(`
    SELECT id, name, subject, grade, answer_count, created_at, updated_at
    FROM resources
    WHERE resource_type = 'exam'
      AND status = 'published'
      AND answer_status = 'ai_draft'
    ORDER BY updated_at DESC
  `)
  const { rows: countRows } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE resource_type = 'exam') AS exam_total,
      COUNT(*) FILTER (WHERE resource_type = 'exam' AND status = 'published') AS exam_published,
      COUNT(*) FILTER (WHERE resource_type = 'exam' AND status = 'published' AND answer_status = 'ai_draft') AS exam_dirty,
      COUNT(*) FILTER (WHERE resource_type = 'exam' AND status = 'published' AND answer_status IN ('teacher_verified','official_verified')) AS exam_healthy
    FROM resources
  `)

  console.log('========== Dry-run: status=published + answer_status=ai_draft ==========')
  console.log('Exam 总量         :', countRows[0].exam_total)
  console.log('Exam 已发布       :', countRows[0].exam_published)
  console.log('  └─ 不一致（草稿）:', countRows[0].exam_dirty, '  ← 迁移 055 会修')
  console.log('  └─ 健康           :', countRows[0].exam_healthy)
  console.log()
  console.log(`不一致明细（${badRows.length} 行）:`)
  for (const r of badRows) {
    console.log(`  · id=${r.id} subject=${r.subject ?? '∅'} grade=${r.grade ?? '∅'} answer_count=${r.answer_count} updated_at=${r.updated_at}`)
    console.log(`    name="${r.name}"`)
  }
  console.log('=====================================================================')
  console.log('确认无误后，重启后端会跑迁移 055（幂等）→ 不一致行升 teacher_verified')
  process.exit(0)
}

main().catch(e => {
  console.error('查询失败:', e)
  process.exit(1)
})