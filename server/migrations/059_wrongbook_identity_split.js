import { query } from '../config/neon.js'

// ============================================================
// 059: wrong_questions 身份键拆分（跨卷串行根治，方案A）
//
// 背景（2026-09-16，见 _错题本跨卷串行根治方案-20260916.md）：
//   052 的唯一索引 uq_wrong_questions_student_ws_qno 覆盖所有有
//   (worksheet_id, question_no) 的行，而 worksheet_id 是「答案册资源」——
//   同一本答案册挂多份周练 → 不同卷子的同题号只能共用一行，
//   addSelfContainedWrongQuestion 的 COALESCE 保旧快照导致题干/判定错配
//   （实测：张诗蕊第01周 27.3(2) 题8 的行被第03周 28.1(2) 题8 批改覆盖）。
//
//   写入侧（neonService.addSelfContainedWrongQuestion）已改为按题定位：
//   有 questionId → 冲突目标 (student_id, question_id)（052 已有索引）；
//   无 questionId（真自包含）→ 保留旧键。
//
//   本迁移把旧宽索引收窄为「仅自包含行」，使两条索引互斥：
//     · 删除 uq_wrong_questions_student_ws_qno（覆盖所有行）
//     · 新建 uq_wrong_questions_student_ws_qno_selfcontained
//       （仅 question_id IS NULL 的行）
//
// 幂等性：先查再建/删，重复跑安全。
// 依赖：写入侧已带 23505/42P10 回退，新旧代码/索引组合下均不中断批改。
// ============================================================
export const migrateWrongQuestionsIdentitySplit = async () => {
  try {
    console.log('📦 [迁移059] wrong_questions 身份键拆分...')

    // 1. 新建自包含行唯一索引（先建后删，避免中间态无索引）
    const { rows: hasSelf } = await query(`
      SELECT 1 FROM pg_indexes
      WHERE tablename='wrong_questions'
        AND indexname='uq_wrong_questions_student_ws_qno_selfcontained'`)
    if (hasSelf.length === 0) {
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_wrong_questions_student_ws_qno_selfcontained
        ON wrong_questions(student_id, worksheet_id, question_no)
        WHERE question_id IS NULL AND worksheet_id IS NOT NULL AND question_no IS NOT NULL`)
      console.log('  ✅ 已建 uq_wrong_questions_student_ws_qno_selfcontained（仅自包含行）')
    } else {
      console.log('  ⏭️ 自包含唯一索引已存在，跳过')
    }

    // 2. 删除旧的宽索引（它是跨卷串行的直接原因）
    const { rows: hasBroad } = await query(`
      SELECT 1 FROM pg_indexes
      WHERE tablename='wrong_questions'
        AND indexname='uq_wrong_questions_student_ws_qno'`)
    if (hasBroad.length > 0) {
      await query(`DROP INDEX IF EXISTS uq_wrong_questions_student_ws_qno`)
      console.log('  ✅ 已删 uq_wrong_questions_student_ws_qno（宽索引，跨卷串行根因）')
    } else {
      console.log('  ⏭️ 宽索引已删除，跳过')
    }

    // 3. 兜底确认 052 的 (student_id, question_id) 部分唯一索引仍在
    const { rows: hasQid } = await query(`
      SELECT 1 FROM pg_indexes
      WHERE tablename='wrong_questions'
        AND indexname='uq_wrong_questions_student_question_id'`)
    if (hasQid.length === 0) {
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_wrong_questions_student_question_id
        ON wrong_questions(student_id, question_id)
        WHERE question_id IS NOT NULL`)
      console.log('  ✅ 已重建 uq_wrong_questions_student_question_id')
    } else {
      console.log('  ⏭️ (student_id, question_id) 唯一索引已存在')
    }

    console.log('✅ [迁移059] 完成：错题本按「题」定位，跨卷同题号不再共行')
  } catch (err) {
    console.error('❌ [迁移059] 失败:', err.message)
    throw err
  }
}
