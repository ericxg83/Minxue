import { query } from '../config/neon.js'

// ============================================================
// 053: questions.ai_self_check_passed / ai_self_check_issues
//
// 背景（2026-09-02）：
//   OCR 阶段 Qwen3-VL 一次返回的 answer/analysis 都是 LLM 自由输出，
//   会出现"步骤对结论错"的算术幻觉（截图中：y=3(x-1)²+2 代入 x=6，
//   展开步骤全对，"最终答案为 83"实际应为 77），还会把学生手写答案
//   串行污染进 answer 列。单靠 prompt 改措辞治不了，必须在落库前做
//   硬校验。worker.js 在 createQuestions 前对每题调 aiParseSelfCheck，
//   把"是否通过"和"具体 issues"两路都写进 questions 表，前端据此给
//   红色横幅"AI 解析可能不准确"，避免家长/学生无脑照抄。
//
// 字段语义：
//   - ai_self_check_passed: true = 算术一致 + 无字段串行污染；
//                          false = 至少一项不通过，需要人工核对
//   - ai_self_check_issues: JSONB 数组，如 ["arithmetic_mismatch",
//                          "serial_pollution", "self_check_skipped"]
//                          可能为多 issue；null/空 = 全过或未自检
//
// 索引：只对失败行建部分索引，方便后台审计脚本按 ws_id 扫盘。
//       不建成功行索引（数据量太大，写入开销不划算）。
//
// 幂等：ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS。
//       不回填（历史数据保持默认 true，视作"未自检"，不影响既有判题）。
// ============================================================
export const migrateAiSelfCheck = async () => {
  try {
    console.log('📦 [迁移053] questions.ai_self_check_passed + issues...')

    await query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS ai_self_check_passed boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS ai_self_check_issues jsonb
    `)

    // 部分索引：只覆盖失败行，写入开销可忽略
    await query(`
      CREATE INDEX IF NOT EXISTS questions_ai_self_check_failed_idx
      ON questions (ws_id) WHERE ai_self_check_passed = false
    `)

    const { rows } = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'questions'
        AND column_name IN ('ai_self_check_passed', 'ai_self_check_issues')
      ORDER BY column_name
    `)
    if (rows.length !== 2) {
      throw new Error(`迁移 053 失败：期望 2 列，实际 ${rows.length} 列`)
    }
    console.log(`✅ [迁移053] AI 自检字段就绪:`)
    for (const r of rows) {
      console.log(`     ${r.column_name}: ${r.data_type}, nullable=${r.is_nullable}, default=${r.column_default}`)
    }
  } catch (e) {
    console.error('❌ [迁移053] 失败:', e.message)
    throw e
  }
}
