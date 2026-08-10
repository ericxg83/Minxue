import { query } from '../config/neon.js'

// ============================================================
// 放宽 questions.question_type CHECK 约束，允许 'judge'
//
// 背景：
//   - questions 表 question_type 初始 CHECK 约束是
//     `IN ('choice', 'fill', 'answer')`，不含 'judge'
//   - 但代码中 judgeService.normalizeJudgeAnswer / QuestionDetailPanel.typeLabel
//     等都按 'judge' 处理，UI 也已经显示"判断题"标签
//   - 实际生产数据可能已存在 'judge' 类型的题（写入时若绕过约束或数据库版本不同），
//     修复 question_type 脏数据时若推断出 'judge' 会被 CHECK 拒掉
//
// 修复：
//   - 删掉旧 CHECK 约束（兼容已有 'judge' 数据，不强约束到 3 值）
//   - 改为允许 4 值：choice / fill / answer / judge
// ============================================================
export const migrateRelaxQuestionTypeCheck = async () => {
  try {
    console.log('📦 [迁移043] 放宽 questions.question_type CHECK 约束...')

    // 删除旧约束（如果存在）
    await query(
      `ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_question_type_check`
    )

    // 添加放宽后的约束
    await query(
      `ALTER TABLE questions
       ADD CONSTRAINT questions_question_type_check
       CHECK (question_type IS NULL OR question_type IN ('choice', 'fill', 'answer', 'judge'))`
    )

    console.log('  ✅ question_type CHECK 已放宽为 choice/fill/answer/judge')
    console.log('✅ [迁移043] question_type 约束放宽迁移完成')
  } catch (error) {
    console.error('❌ [迁移043] 失败:', error.message)
    console.error(error)
  }
}
