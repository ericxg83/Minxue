import { query } from '../config/neon.js'

// ============================================================
// 049: students.enrollment_status 在读状态
//
// 背景：
//   students 表此前没有任何在读/停课字段，老师想把结课学生从列表里清掉，
//   唯一手段是 DELETE /api/students/:id —— 那是硬删除，且 tasks /
//   questions / wrong_questions 全是 ON DELETE CASCADE，一删连带毁掉
//   该学生全部错题与判题证据，与「错题是长期学习数据」直接冲突。
//
//   口径（已确认）：手工标记，停课后续费可再开启。不是软删除，学生一直在库里。
//
// 幂等：ADD COLUMN IF NOT EXISTS + 约束/索引存在性检查，重复跑安全。
//       只做加法，不回填、不删除、不改动任何既有行的其他字段。
// ============================================================
export const migrateStudentEnrollmentStatus = async () => {
  try {
    console.log('📦 [迁移049] students.enrollment_status 在读状态列...')

    await query(`
      ALTER TABLE students
      ADD COLUMN IF NOT EXISTS enrollment_status TEXT NOT NULL DEFAULT 'active'
    `)

    // CHECK 约束单独加：ADD CONSTRAINT 无 IF NOT EXISTS，先查 pg_constraint
    const { rows: constraintRows } = await query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'students_enrollment_status_check'
    `)
    if (constraintRows.length === 0) {
      await query(`
        ALTER TABLE students
        ADD CONSTRAINT students_enrollment_status_check
        CHECK (enrollment_status IN ('active', 'paused'))
      `)
    }

    // 停课时间：仅用于展示「何时停课」，NULL = 在读
    await query(`
      ALTER TABLE students
      ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ
    `)

    await query(`
      CREATE INDEX IF NOT EXISTS idx_students_enrollment_status
      ON students(enrollment_status)
    `)

    const { rows } = await query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'students' AND column_name IN ('enrollment_status', 'paused_at')
      ORDER BY column_name
    `)
    if (rows.length !== 2) {
      throw new Error(`迁移 049 失败：期望 2 列，实际 ${rows.length} 列`)
    }
    console.log(`✅ [迁移049] 在读状态列就绪: ${JSON.stringify(rows)}`)
  } catch (e) {
    console.error('❌ [迁移049] 失败:', e.message)
    throw e
  }
}
