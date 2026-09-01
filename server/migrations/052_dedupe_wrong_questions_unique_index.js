import { query } from '../config/neon.js'

// ============================================================
// 052: wrong_questions 学生内 UNIQUE 索引
//
// 背景（2026-09-02）：
//   wrong_questions 表没有 UNIQUE 索引。addSelfContainedWrongQuestion
//   走 SELECT+INSERT 双步，并发场景下（worker concurrency=2 处理同一
//   worksheet 的两个 task）会双写。线上已观察到 (student, worksheet,
//   question_no) 出现多行重复。
//
//   修复：加部分 UNIQUE 索引 (student_id, worksheet_id, question_no)，
//   仅对有自然键的行生效（worksheet_id/question_no 都非空）。无自然键
//   的传统错题（question_id-only）不参与，避免影响 addWrongQuestions
//   路径。
//
//   写入侧同步改造：
//   - addSelfContainedWrongQuestion 改为 ON CONFLICT DO UPDATE
//   - 借助 UNIQUE 索引做最后兜底，前置 SELECT 失败也不会双写
//
// 幂等性：
//   CREATE UNIQUE INDEX IF NOT EXISTS，重复跑安全。
//
// 依赖：必须先清理重复行（运行 scripts/dedupe-wrong-questions.mjs --apply），
//       否则 CREATE UNIQUE INDEX 会因重复行失败。
// ============================================================
export const migrateWrongQuestionsUniqueIndex = async () => {
  try {
    console.log('📦 [迁移052] wrong_questions 学生内 UNIQUE 索引...')

    // 1. 检测当前是否有重复行（无法跳过此步，否则 UNIQUE INDEX 会失败）
    const { rows: dupRows } = await query(`
      SELECT COUNT(*) as n FROM (
        SELECT 1 FROM wrong_questions
        WHERE student_id IS NOT NULL
          AND worksheet_id IS NOT NULL
          AND question_no IS NOT NULL
        GROUP BY student_id, worksheet_id, question_no
        HAVING COUNT(*) >= 2
      ) t
    `)
    const dupCount = parseInt(dupRows[0].n, 10)
    console.log(`  📊 当前重复组: ${dupCount}`)

    if (dupCount > 0) {
      throw new Error(
        `wrong_questions 存在 ${dupCount} 个 (student, worksheet, question_no) 重复组。\n` +
        `请先执行: cd server && node scripts/dedupe-wrong-questions.mjs --apply\n` +
        `（先 dry-run 看看保留/删除哪些行：node scripts/dedupe-wrong-questions.mjs）`
      )
    }

    // 2. 加两条部分 UNIQUE 索引，覆盖 workbook 路径 + 传统路径
    //    - workbook 路径自然键 (student_id, worksheet_id, question_no)
    //    - 传统路径自然键 (student_id, question_id)
    //    两组 WHERE 互斥（同一行只匹配其中一个），不会冲突
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_wrong_questions_student_ws_qno
      ON wrong_questions(student_id, worksheet_id, question_no)
      WHERE worksheet_id IS NOT NULL AND question_no IS NOT NULL
    `)
    console.log(`✅ [迁移052] UNIQUE 索引: uq_wrong_questions_student_ws_qno (workbook 路径)`)

    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_wrong_questions_student_question_id
      ON wrong_questions(student_id, question_id)
      WHERE question_id IS NOT NULL
    `)
    console.log(`✅ [迁移052] UNIQUE 索引: uq_wrong_questions_student_question_id (传统路径)`)

    // 3. 验证
    const { rows: idxRows } = await query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'wrong_questions'
        AND indexname IN ('uq_wrong_questions_student_ws_qno', 'uq_wrong_questions_student_question_id')
      ORDER BY indexname
    `)
    if (idxRows.length !== 2) {
      throw new Error(`迁移 052 失败：期望 2 个 UNIQUE 索引，实际 ${idxRows.length}`)
    }
    for (const r of idxRows) {
      console.log(`  📋 ${r.indexname}: ${r.indexdef}`)
    }
  } catch (e) {
    console.error('❌ [迁移052] 失败:', e.message)
    throw e
  }
}