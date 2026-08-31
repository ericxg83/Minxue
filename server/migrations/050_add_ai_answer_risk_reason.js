import { query } from '../config/neon.js'

// ============================================================
// 050: questions.ai_answer_risk_reason 图题风险提示列
//
// 背景：
//   客观题（choice / fill / judge）配图为几何图（image_type='geometry'）
//   或图表（image_type='chart'）时，AI 需要"看图推结论"。当前所有视觉
//   大模型在这类题目上能力都偏弱：能把学生答案 C/D 读对，但自己独立解
//   题时常给出看似合理其实错的"参考答案"，最后 AI 错误其实不是学生错
//   而是参考错了（用户截图：题 #3 平行线分线段成比例、题 #4 看二次函数
//   图判断 a,b,c 符号）。
//
//   与现有 answer_exception_reason 列区别清楚：
//     · answer_exception_reason = "AI 没给出正误结论"（判不出）
//     · ai_answer_risk_reason  = "AI 给出了结论，但参考本身可能不可靠"
//   两条语义不混。前端 wrong 状态也能读 ai_answer_risk_reason 给老师
//   "建议人工核对"的提示。
//
// 幂等：ADD COLUMN IF NOT EXISTS，重复跑安全。
//       只加列，不回填、不删改任何既有行的其他字段。
// ============================================================
export const migrateAiAnswerRiskReason = async () => {
  try {
    console.log('📦 [迁移050] questions.ai_answer_risk_reason 图题风险提示列...')

    await query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS ai_answer_risk_reason TEXT
    `)

    const { rows } = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'ai_answer_risk_reason'
    `)
    if (rows.length !== 1) {
      throw new Error(`迁移 050 失败：期望 1 列，实际 ${rows.length} 列`)
    }
    console.log(`✅ [迁移050] 图题风险提示列就绪: ${JSON.stringify(rows)}`)
  } catch (e) {
    console.error('❌ [迁移050] 失败:', e.message)
    throw e
  }
}