import { query } from '../config/neon.js'

// ============================================================
// 057: questions.parent_stem / questions.sub_no —— 多小问（题组）共享题干
//
// 背景（2026-09-11 产品评审定稿，用户截图实证）：
//   原卷一道大题含 (1)(2) 两小问时，系统会把它拆成两条独立 question 行
//   （question_number 相同），而拆行时**共享题干被丢弃**：
//     · 练习册管线 OCR 提示词（worker.js）主动要求「content 只写该小问的题干」；
//     · 通用管线模型自发拆行；
//     · services/answerParseService.js splitOcrQuestionsBySubNo 遇 AI 已给
//       sub_no 的对象直接原样保留，不做任何共享题干的回补。
//   后果（实测 task da0b3d35，「27.2 二次函数的图像与性质（2）」）：
//     Q10(1) content = "(1)求a、b的值；"
//     Q10(2) content = "(2)求抛物线与直线y=x+5的两交点…面积。"
//     而共用条件「已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).」
//     在全库这两行里都查不到 —— 重练卷印出来是无条件空题，学生无法作答。
//
// 方案（评审方案 A：加列，不动 content 语义）：
//   content 继续只承载「该行自己那一问」的题干，是判题/答案引擎/完整性闸/
//   题干指纹的共同输入，**绝不把共享题干拼进 content**（会污染判题证据）。
//   共享题干单独落 parent_stem，只在展示层（错题本卡片、重练卷 PDF、批改页
//   题干区）拼接渲染。
//
//   sub_no：小问号，与 resource_answers.sub_no 口径一致（TEXT）。
//   非小问题为 NULL。它只用于展示归组（同 (task_id, question_number) 连排）
//   与「第10题(2)」这类标注，**不参与判题与错题生命周期**。
//
// 兼容性：
//   · ADD COLUMN IF NOT EXISTS，无默认值，历史行全部为 NULL —— 渲染层对
//     parent_stem 为空时行为完全不变，零回归。
//   · 存量被拆行无法自动回补共享题干（采集层已丢），另行评估回填脚本；
//     本迁移只保证「新采集不再丢」。
//   · 索引 (task_id, question_number) 供「同一大题的小问连排」查询，
//     question_number 原本无索引，加复合索引不改变任何写入路径。
// ============================================================
export const migrateQuestionParentStem = async () => {
  try {
    console.log('📦 [迁移057] questions.parent_stem / sub_no 多小问共享题干...')

    await query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS parent_stem TEXT
    `)
    await query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS sub_no TEXT
    `)

    // 同一大题的小问连排查询：WHERE task_id = $1 ORDER BY question_number, sub_no
    await query(`
      CREATE INDEX IF NOT EXISTS idx_questions_task_qno_sub
      ON questions (task_id, question_number, sub_no)
    `)

    const { rows } = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name IN ('parent_stem', 'sub_no')
      ORDER BY column_name
    `)
    if (rows.length !== 2) {
      throw new Error(`迁移 057 失败：期望 2 列，实际 ${rows.length} 列`)
    }
    console.log(`✅ [迁移057] 共享题干列就绪: ${JSON.stringify(rows)}`)
  } catch (e) {
    console.error('❌ [迁移057] 失败:', e.message)
    throw e
  }
}
