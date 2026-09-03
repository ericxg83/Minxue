import { query } from '../config/neon.js'

// ============================================================
// 055: 修复 exam 资源 status='published' 但 answer_status='ai_draft' 的脏状态
//
// 背景（2026-09-03）：
//   server/index.js "留底为答案库" 老逻辑有两段 UPDATE：
//     1. UPDATE resources SET name=..., subject=..., grade=..., status='published'
//     2. UPDATE resources SET answer_count=..., answer_status='teacher_verified', status='published'
//   段 1 把 status 推到 published 后，如果请求中断（前端关掉 / 服务重启），
//   段 2 没机会跑完，资源会停在 status='published' + answer_status='ai_draft'。
//
//   这种状态在前台消费时不会被列出：
//     - GET /api/resources/exam-papers 要求 answer_status IN ('teacher_verified','official_verified')
//     - AnswerBank 复用管线 (worker.js:4207) 见 answer_status='ai_draft' 就降级 general
//   表现：列表显示「已发布」但移动端再上传不弹选择对话框。
//
// 修复（server/index.js:1062-1078）：
//   删除段 1，把 name/subject/grade 并入段 2，单 UPDATE 一次性写入所有列。
//   任何中断都不会留下不一致状态。
//
// 本迁移：把现存的所有 status='published' AND answer_status='ai_draft' 的
// exam 资源一次性升到 teacher_verified，老师不需重做留底。
//
// 幂等性：UPDATE 后 answer_status 已是 teacher_verified，重复跑 no-op。
// ============================================================
export const migrateFixExamPublishedInconsistency = async () => {
  try {
    console.log('📦 [迁移055] 修复 exam 资源 status=published + answer_status=ai_draft 脏状态...')

    // 1. 查脏数据范围（dry-run）
    const { rows: badRows } = await query(`
      SELECT id, name, subject, grade, answer_count, created_at, updated_at
      FROM resources
      WHERE resource_type = 'exam'
        AND status = 'published'
        AND answer_status = 'ai_draft'
      ORDER BY updated_at DESC
    `)
    console.log(`  📊 当前脏数据行数: ${badRows.length}`)
    for (const r of badRows) {
      console.log(`     · id=${r.id} name="${r.name}" updated_at=${r.updated_at}`)
    }

    if (badRows.length === 0) {
      console.log('✅ [迁移055] 无需修复，跳过')
      return
    }

    // 2. 一次性升 teacher_verified
    const { rows: updRows } = await query(`
      UPDATE resources
      SET answer_status = 'teacher_verified', updated_at = NOW()
      WHERE resource_type = 'exam'
        AND status = 'published'
        AND answer_status = 'ai_draft'
      RETURNING id
    `)
    console.log(`✅ [迁移055] 已将 ${updRows.length} 行 answer_status 升为 teacher_verified`)

    // 3. 验证：不应再有任何 status='published' + answer_status='ai_draft' 的 exam
    const { rows: remainRows } = await query(`
      SELECT COUNT(*) as n FROM resources
      WHERE resource_type = 'exam'
        AND status = 'published'
        AND answer_status = 'ai_draft'
    `)
    const remain = parseInt(remainRows[0].n, 10)
    if (remain !== 0) {
      throw new Error(`迁移055 失败：仍有 ${remain} 行不一致状态`)
    }
    console.log('✅ [迁移055] 验证通过：所有 exam 资源 published ⇒ answer_status 已可信')
  } catch (error) {
    console.error('❌ [迁移055] 失败:', error.message)
    throw error
  }
}