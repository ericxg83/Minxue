import { query } from '../config/neon.js'

// ============================================================
// 063: questions.reference_source —— 把「参考答案从哪来」从 answer_source 里拆出来
//
// ⛔ 为什么必须拆（2026-10-10 实测，负责人裁决走「乙方案」）
//
//   `answer_source` 这一列同时被写入两个**正交**的维度：
//     · 学生有没有作答          → recognized / teacher_input / blank
//     · 参考答案是从哪来的      → worksheet（答案册）
//   后果是 worker.js 里blank 分支无条件覆写了同一行刚设好的 'worksheet'，
//   于是库中出现自相矛盾的行：
//     answer_source='blank' ∧ student_answer='' ∧ answer非空
//   实测 **374 道**（127 份 task，265 道已进错题本），其中 238 道 cache_id 非空
//   —— 说明答案引擎确实算出过参考答案，存进库了，标记却说「学生没写」。
//
// ⚠️ 为什么不能直接给 answer_source 加新枚举值（比如 'blank_with_ref'）：
//   `answer_source === 'blank'` 被 **40+ 处**当作「学生未作答」判据，连带
//   错题本入库（wrongBookCompensation / gradingFinalizer）、置信度闸、
//   掌握度统计（knowledgeMasteryService）、诊断服务、paperReviewDecision。
//   **`blank ⇔ student_answer 为空` 是全系统不变量**，动它会连锁破坏判题域契约。
//   所以只能「另开一格」，不能「改旧格含义」。
//
// —— 新列语义（只回答「参考答案哪来的」，不回答学生写没写）——
//   'engine'   答案引擎算出（含答案缓存命中）
//   'worksheet' 练习册答案库匹配（server/index.js:2947 显式写入的同义档）
//   'teacher'   老师人工改写/ 录入参考答案
//   'external'  练习册答案册等外部给定、未经答案引擎
//   NULL       尚无参考答案（与 answer_source='blank' 并不冲突：那是「无参考答案」）
//
//   ⛔ 本迁移**只加列，不回填、不改任何既有行的其他字段**（含 answer_source）。
//      存量 374 道的回填由独立脚本处理，且必须在真实批改验证三域无回归之后。
//
// 幂等：ADD COLUMN IF NOT EXISTS，重复跑安全。
// ============================================================
export const migrateReferenceSource = async () => {
  try {
    console.log('📦 [迁移063] questions.reference_source 参考答案来源列...')

    await query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS reference_source TEXT
    `)

    // 只加索引不加约束：这是纯观测列，不参与判定，任何写入顺序都不该被它拦住。
    await query(`
      CREATE INDEX IF NOT EXISTS idx_questions_reference_source
      ON questions(reference_source)
    `)

    const { rows } = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'reference_source'
    `)
    if (rows.length !== 1) {
      throw new Error(`迁移 063 失败：期望 1 列，实际 ${rows.length} 列`)
    }
    console.log(`✅ [迁移063] 参考答案来源列就绪: ${JSON.stringify(rows)}`)
  } catch (e) {
    console.error('❌ [迁移063] 失败:', e.message)
    throw e
  }
}
