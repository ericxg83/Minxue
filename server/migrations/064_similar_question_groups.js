import { query } from '../config/neon.js'

// ============================================================
// 064: 疑似同类题组表（similar_question_groups）
//
// 背景（2026-10-18 负责人拍板，方案见 docs/similar-groups-方案.md）：
//   错题海里「同考法、题面相近」的题（如「√3/3=__」与「√2/4=__」）是考法库
//   的珍贵素材，而非脏数据。本表承接「字符相似聚类 → 老师确认 → 沉淀为考法」。
//
// 为什么必须建这张表：
//   ① 相近题聚类是「待确认候选」—— 不能进 teaching_question_types（那是已确认的考法），
//      需要 pending 状态 + 确认/忽略动作。
//   ② 完全重复合并已被实测否决（变式题误判率 96%），本表**不得**承担合并——
//      只做「分组快照」，错题记录一字不动（AGENTS.md 第 9 条红线）。
//   ③ 组是学生维度（重练卷是单学生的），跨学生组无练习意义。
//
// 数据流：
//   wrong_questions --聚类--> similar_question_groups(pending)
//     --confirm--> teaching_question_types(draft) + examples 挂组内错题
//     --整组送重练--> 复用 POST /api/generated-exams（questionIds 取 question_ids 快照）
//
// 回滚：DROP TABLE similar_question_groups 即可，其余表零改动。
// ============================================================
export const migrateSimilarQuestionGroups = async () => {
  try {
    console.log('📦 [迁移064] 疑似同类题组表 similar_question_groups...')

    await query(`
      CREATE TABLE IF NOT EXISTS similar_question_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'pending',
        reason text NOT NULL DEFAULT 'content',
        title text,
        wrong_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        question_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        question_preview jsonb NOT NULL DEFAULT '[]'::jsonb,
        type_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        confirmed_at timestamptz,
        ignored_at timestamptz
      )
    `)

    const { rows: ck } = await query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'similar_question_groups_status_check'`)
    if (ck.length === 0) {
      await query(`
        ALTER TABLE similar_question_groups
        ADD CONSTRAINT similar_question_groups_status_check
        CHECK (status IN ('pending', 'confirmed', 'ignored'))
      `)
    }

    const { rows: reasonCk } = await query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'similar_question_groups_reason_check'`)
    if (reasonCk.length === 0) {
      await query(`
        ALTER TABLE similar_question_groups
        ADD CONSTRAINT similar_question_groups_reason_check
        CHECK (reason IN ('content', 'kp'))
      `)
    }

    await query(`CREATE INDEX IF NOT EXISTS idx_simgrp_student_status ON similar_question_groups(student_id, status)`)
    await query(`CREATE INDEX IF NOT EXISTS idx_simgrp_status ON similar_question_groups(status)`)

    const { rows } = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'similar_question_groups' ORDER BY ordinal_position`)
    console.log(`   ✅ 表就绪: ${rows.map(r => r.column_name).join(', ')}`)
  } catch (error) {
    console.error('❌ [迁移064] 失败:', error.message)
    throw error
  }
}