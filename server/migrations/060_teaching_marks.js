import { query } from '../config/neon.js'

// ============================================================
// 060: 白板「讲题状态」持久化（teaching_marks）
//
// 背景（见 _周末班白板-讲题状态-产品评审-20260925.md）：
//   周末班白板此前是**无状态**的 —— 笔迹只落浏览器本机，题目上没有任何
//   「讲过没有」的记录。取数只排除 lifecycle_status='mastered'，于是
//   「讲过但学生还没被重练卷刷掉」的题每次打开都原样重现，老师只能靠脑子记，
//   重复讲是机制性必然。
//
// 本表只记录**老师的教学行为**，与掌握度彻底解耦：
//   - 不参与 wrong_questions.lifecycle_status 状态机（那是掌握度，唯一写入方是
//     services/gradingFinalizer.js:getNextLifecycle，由重练卷批改结果驱动）
//   - 不参与 knowledge_mastery
//   - 不参与 questions.review_status（那是判分语义）
//   老师嘴上说「讲过了」≠ 学生会了。这条是本表唯一的红线。
//
// ── 字段语义 ──────────────────────────────────────────────
//   anchor_key      稳定题锚点，复用 server/lib/weekendHandout.js 的 topicKey
//                   （练习册走 worksheet+页码+题号+题干指纹，其余走 normalizeStem）。
//                   ⚠ 绝不能用 slide.index —— 那是本次聚合内 seq++ 的顺序号，
//                   换时段就整体漂移，会把标记挂到别的题上。
//   anchor_key_alt  完整题干合并键（mergeKeyOf），仅作 OCR 题面微差时的兜底匹配
//   scope_key       作用域。当前 = grade（系统里没有班级表、没有排课表，
//                   「周末班」的实际定义就是年级 + 手选学生姓名）。
//                   留此字段是为了将来带多个班时升级为 grade:班级，不必改表结构。
//   status          new / done（已讲·过关）/ rework（已讲·要回炉）/ skip（不讲·跳过）
//   source          auto（翻页停留自动判定）/ manual（老师长按手动标）
//   dwell_seconds   自动判定时的停留时长，用于事后核对「为什么被标成已讲」
//   taught_at       最近一次「讲」的时间（仅 done / rework 会写）
//   taught_times    讲过的次数
//
// ── 自动判定不覆盖既有状态（重要）──────────────────────────
//   第二次打开白板时，老师会再翻一遍。如果自动判定无脑覆盖，taught_at 会被
//   不断刷新成「刚刚」，那么「讲完之后学生又被做错」这个回炉信号就永远不会触发。
//   因此 upsert 里约定：source='auto' 且既有 status ≠ 'new' 时不改状态与 taught_at。
//   手动标记（source='manual'）永远生效。
// ============================================================
export const migrateTeachingMarks = async () => {
  try {
    console.log('📦 [迁移060] 白板讲题状态 teaching_marks...')

    await query(`
      CREATE TABLE IF NOT EXISTS teaching_marks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        anchor_key text NOT NULL,
        anchor_key_alt text NOT NULL DEFAULT '',
        scope_key text NOT NULL DEFAULT '',
        grade text NOT NULL,
        subject text,
        status text NOT NULL DEFAULT 'new',
        source text NOT NULL DEFAULT 'auto',
        question_id uuid,
        wq_ids uuid[],
        student_count int,
        difficulty int,
        dwell_seconds int,
        taught_at timestamptz,
        taught_times int NOT NULL DEFAULT 0,
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    // CHECK 约束单独加：ADD CONSTRAINT 无 IF NOT EXISTS，先查 pg_constraint
    const { rows: c1 } = await query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'teaching_marks_status_check'
    `)
    if (c1.length === 0) {
      await query(`
        ALTER TABLE teaching_marks
        ADD CONSTRAINT teaching_marks_status_check
        CHECK (status IN ('new', 'done', 'rework', 'skip'))
      `)
    }

    const { rows: c2 } = await query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'teaching_marks_source_check'
    `)
    if (c2.length === 0) {
      await query(`
        ALTER TABLE teaching_marks
        ADD CONSTRAINT teaching_marks_source_check
        CHECK (source IN ('auto', 'manual'))
      `)
    }

    // 一题（锚点）在一个作用域内只有一行 —— upsert 的冲突目标
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_teaching_marks_anchor
      ON teaching_marks(anchor_key, scope_key)
    `)
    // 白板打开时按「作用域」一次性把标记全捞出来（buildHandout 读侧），这是它的索引
    await query(`
      CREATE INDEX IF NOT EXISTS idx_teaching_marks_scope
      ON teaching_marks(scope_key, status)
    `)
    await query(`
      CREATE INDEX IF NOT EXISTS idx_teaching_marks_taught
      ON teaching_marks(scope_key, taught_at DESC)
    `)

    const { rows } = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'teaching_marks'
        AND column_name IN ('anchor_key', 'anchor_key_alt', 'scope_key', 'status', 'source', 'taught_at')
      ORDER BY column_name
    `)
    if (rows.length !== 6) {
      throw new Error(`迁移 060 失败：期望 6 列，实际 ${rows.length} 列`)
    }
    console.log(`✅ [迁移060] teaching_marks 就绪: ${rows.map(r => r.column_name).join(', ')}`)
  } catch (e) {
    console.error('❌ [迁移060] 失败:', e.message)
    throw e
  }
}
