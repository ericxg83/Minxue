import { query } from '../config/neon.js'

// ============================================================
// 061: 考法库多对多承载表（teaching_question_type_kps）
//
// ⛔ 为什么必须建这张表（实测阻断，不是设计洁癖）：
//   `teaching_question_types.kp_id` 是 uuid NOT NULL 的**单值**外键，只能挂一个知识点。
//   而「考法 = 这道题在考哪套动作」**天然跨多个知识点** —— 主管原话：
//   「一个考法可跨多个知识点（如『先证直角再求边』挂 勾股定理+逆定理+直角判定），
//     考法本身就是知识点网的胶水」。
//   2026-10-05 实测：按考点分批让 BigModel 归纳出的考法，kps 字段平均含 4 个知识点；
//   而按「primary 单值 + question_type」分组的旧 auto-organize 产出的是
//   「平方根 · 填空题关键结论」这种「知识点 × 题型形式」的机械拼接 —— 0 条考法信息。
//   没有这张表 ⇒「跨考点」物理上落不了地。
//
// 口径（与既有表的关系，别改错）：
//   - 本表是 `teaching_question_types` 的**从属表**（一个考法 N 个考点），不是替代。
//   - `teaching_question_types.kp_id` **保留**，语义收紧为**主考点**
//     （落点 = (知识点, 考法)）。保留它是为了不破坏既有 67 条数据、
//     既有唯一约束 `uq_teaching_question_types_user_id_kp_id_name_key`、
//     以及既有索引 `idx_teaching_question_types_user_kp`。
//   - role='primary' 行 = 主考点（与 kp_id 一致，全程唯一）；其余为 'secondary'。
//   - question_count 是**现算的展示缓存**（该考法名下挂的代表题覆盖多少道题），
//     ⛔ 不可当真相来源 —— 真相同 `teaching_question_type_examples`。
//
// 回滚：本表可整体 DROP，`teaching_question_types` 本身零改动 ⇒ 回滚零风险。
// ============================================================
export const migrateKaofaMultiKp = async () => {
  try {
    console.log('📦 [迁移061] 考法多对多表 teaching_question_type_kps...')

    await query(`
      CREATE TABLE IF NOT EXISTS teaching_question_type_kps (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type_id uuid NOT NULL REFERENCES teaching_question_types(id) ON DELETE CASCADE,
        kp_id uuid NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
        role text NOT NULL DEFAULT 'secondary',
        question_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_kaofa_type_kp UNIQUE (type_id, kp_id)
      )
    `)

    // CHECK 约束单独加：ADD CONSTRAINT 没有 IF NOT EXISTS，先查 pg_constraint
    const { rows: roleCk } = await query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'teaching_question_type_kps_role_check'
    `)
    if (roleCk.length === 0) {
      await query(`
        ALTER TABLE teaching_question_type_kps
        ADD CONSTRAINT teaching_question_type_kps_role_check
        CHECK (role IN ('primary', 'secondary'))
      `)
    }

    // 按考点拉「它参与的所有考法」—— 双链导航的反向那一链
    await query(`
      CREATE INDEX IF NOT EXISTS idx_kaofa_kps_kp
      ON teaching_question_type_kps(kp_id, role)
    `)
    // 读某个考法的全部关联考点
    await query(`
      CREATE INDEX IF NOT EXISTS idx_kaofa_kps_type
      ON teaching_question_type_kps(type_id, role)
    `)

    // ---- 回填存量：给每条考法补一行 role='primary'，kp_id = teaching_question_types.kp_id ----
    // 为什么必须回填：读侧（前端/接口）会 JOIN 本表拿「考法→考点」，
    // 存量 67 条若没有 primary 行，在新读侧里会显示成「这个考法不属于任何考点」——
    // 看起来像数据丢了。这是纯派生数据，INSERT ... SELECT 幂等，可反复跑。
    const { rows: filled } = await query(`
      INSERT INTO teaching_question_type_kps (type_id, kp_id, role, question_count)
      SELECT t.id, t.kp_id, 'primary',
             (SELECT COUNT(DISTINCT e.source_question_id)::int
                FROM teaching_question_type_examples e
               WHERE e.type_id = t.id AND e.source_question_id IS NOT NULL)
        FROM teaching_question_types t
      ON CONFLICT (type_id, kp_id) DO NOTHING
      RETURNING type_id
    `)

    // ---- 一致性复核：每条考法都必须恰好有 1 行 primary ----
    // ⛔ 迁移里带校验不是为了好看，是为了「回填漏了」这种静默半成品状态
    //   在这里就暴露，而不是等老师在界面上发现「这考法没考点」。
    const { rows: bad } = await query(`
      SELECT t.id, t.name
        FROM teaching_question_types t
       WHERE t.status <> 'archived'
         AND (SELECT COUNT(*) FROM teaching_question_type_kps k
               WHERE k.type_id = t.id AND k.role = 'primary') <> 1
       LIMIT 10
    `)

    console.log(`   ✅ 表就绪；回填 primary ${filled.length} 条`)
    if (bad.length) {
      console.warn(`   ⚠️ 有 ${bad.length} 条考法缺 primary 关联（需人工检查）:`,
        bad.map((r) => r.name).join('、'))
    }
  } catch (error) {
    console.error('❌ [迁移061] 失败:', error.message)
    throw error
  }
}
