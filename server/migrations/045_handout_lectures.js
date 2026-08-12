import { query } from '../config/neon.js'

// ============================================================
// 045: 备课讲义持久化（P2）
//
// 新增 3 张表：
//   1. handout_lectures         讲义主表（一份讲义 = 一行）
//   2. handout_lecture_notes    老师笔记（按页存）
//   3. handout_lecture_templates 模板元数据（替代代码层硬编码）
//
// 用途：
//   - Render 免费用户无 Shell，所有数据靠 DB
//   - 讲义是老师资产，不能丢
//   - 笔记可编辑、可跨设备同步
//   - 后续可可视化配置模板
// ============================================================
export const migrateHandoutLectures = async () => {
  try {
    console.log('📦 [迁移045] 备课讲义持久化...')

    // 1. 讲义主表
    await query(`
      CREATE TABLE IF NOT EXISTS handout_lectures (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text,                    -- 老师 ID（占位，多老师隔离时使用）
        title text NOT NULL,
        subject text,
        period_text text,
        template text,
        base_query jsonb,                -- 当时的查询参数（mode/offset/subject/maxItems/template）
        base_diagnosis jsonb,            -- 当时诊断快照：[{kpName, total, blankCount, wrongCount}]
        blocks jsonb NOT NULL,           -- 完整讲义 pages 结构
        lecture_script jsonb,            -- P4 讲课提词器：按时间分块脚本
        metadata jsonb,                  -- 灵活扩展字段（标签、可见性等）
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await query(`CREATE INDEX IF NOT EXISTS idx_handout_lectures_user_created ON handout_lectures(user_id, created_at DESC)`)
    await query(`CREATE INDEX IF NOT EXISTS idx_handout_lectures_subject ON handout_lectures(subject, created_at DESC) WHERE subject IS NOT NULL`)

    // 2. 老师笔记表（按页存：pageName = 知识点名 或 '_default'）
    await query(`
      CREATE TABLE IF NOT EXISTS handout_lecture_notes (
        lecture_id uuid NOT NULL REFERENCES handout_lectures(id) ON DELETE CASCADE,
        page_name text NOT NULL,
        content text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (lecture_id, page_name)
      )
    `)

    // 3. 模板元数据表
    await query(`
      CREATE TABLE IF NOT EXISTS handout_lecture_templates (
        id text PRIMARY KEY,
        label text NOT NULL,
        description text,
        supports_subject text,
        block_config jsonb,              -- block 渲染配置（可选）
        enabled boolean NOT NULL DEFAULT true,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    // 4. 初始化模板元数据（与代码层注册中心同步）
    await query(`
      INSERT INTO handout_lecture_templates (id, label, description, supports_subject, sort_order, enabled)
      VALUES
        ('lecture_prep', '备课讲义', '按知识点组织：错题按题型分组 + 讲解引导 + 老师笔记（核心模板）', 'all', 10, true),
        ('english_lecture_prep', '英语备课讲义', '按英语题型分组：完形/语法/阅读/写作/翻译/改错 + 讲解引导', '英语', 20, true)
      ON CONFLICT (id) DO UPDATE SET
        label = EXCLUDED.label,
        description = EXCLUDED.description,
        supports_subject = EXCLUDED.supports_subject,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    `)

    console.log('  ✅ handout_lectures / handout_lecture_notes / handout_lecture_templates 已就绪')
    console.log('  ✅ 2 个内置模板元数据已写入')
    console.log('✅ [迁移045] 完成')
  } catch (error) {
    console.error('❌ [迁移045] 失败:', error.message)
    console.error(error)
  }
}
