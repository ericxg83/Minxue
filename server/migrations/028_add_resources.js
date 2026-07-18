import { query } from '../config/neon.js'

/**
 * 数据库迁移：统一资源答案库体系
 *
 * 新增表：
 *   resources         — 统一资源表（练习册/试卷/错题重练卷）
 *   resource_answers  — 资源答案库（带状态：ai_draft → teacher_verified / official_verified）
 *
 * 迁移：
 *   worksheets → resources（type='worksheet', answer_status='official_verified'）
 *   worksheet_answers → resource_answers（answer_status='official_verified'）
 *
 * tasks 表加列：
 *   - resource_id UUID  关联统一资源
 *
 * 向后兼容：
 *   创建 worksheets 和 worksheet_answers 视图，旧代码继续可用
 */
const addColumn = async (table, column, definition) => {
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  )
  if (rows.length > 0) {
    console.log(`  ✅ ${table}.${column} 已存在，跳过`)
    return
  }
  await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  console.log(`  ✅ 已添加 ${table}.${column}`)
}

export const migrateResources = async () => {
  try {
    console.log('📦 [迁移028] 开始建立统一资源答案库...')

    // === 1. resources 表 ===
    const { rows: rExist } = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'resources'
    `)
    if (rExist.length === 0) {
      await query(`
        CREATE TABLE resources (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          resource_type TEXT NOT NULL CHECK (resource_type IN ('worksheet', 'exam', 'retry_paper')),
          name TEXT NOT NULL,
          subject TEXT,
          grade TEXT,
          status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'reviewing', 'published')),
          answer_count INTEGER DEFAULT 0,
          pdf_url TEXT,
          parse_status TEXT DEFAULT 'idle' CHECK (parse_status IN ('idle', 'parsing', 'done', 'failed')),
          parse_count INTEGER DEFAULT 0,
          parse_warning TEXT,
          parse_error TEXT,
          exam_date DATE,
          answer_status TEXT DEFAULT 'none' CHECK (answer_status IN ('none', 'ai_draft', 'teacher_verified', 'official_verified')),
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `)
      await query(`CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(resource_type)`)
      await query(`CREATE INDEX IF NOT EXISTS idx_resources_subject ON resources(subject)`)
      await query(`CREATE INDEX IF NOT EXISTS idx_resources_answer_status ON resources(answer_status)`)
      await query(`CREATE TRIGGER update_resources_updated_at BEFORE UPDATE ON resources
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`)
      console.log('✅ resources 表已创建')
    } else {
      console.log('✅ resources 表已存在，跳过')
    }

    // === 2. resource_answers 表 ===
    const { rows: raExist } = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'resource_answers'
    `)
    if (raExist.length === 0) {
      await query(`
        CREATE TABLE resource_answers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
          question_no INTEGER NOT NULL,
          answer TEXT NOT NULL,
          answer_type TEXT DEFAULT 'choice',
          content TEXT,
          section TEXT,
          answer_status TEXT DEFAULT 'ai_draft' CHECK (answer_status IN ('ai_draft', 'teacher_verified', 'official_verified')),
          confidence DECIMAL(3,2) DEFAULT 1.0,
          source TEXT DEFAULT 'ai_parse',
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(resource_id, section, question_no)
        )
      `)
      await query(`CREATE INDEX IF NOT EXISTS idx_resource_answers_resource ON resource_answers(resource_id)`)
      await query(`CREATE INDEX IF NOT EXISTS idx_resource_answers_status ON resource_answers(answer_status)`)
      await query(`CREATE INDEX IF NOT EXISTS idx_resource_answers_rs_section ON resource_answers(resource_id, section)`)
      await query(`CREATE TRIGGER update_resource_answers_updated_at BEFORE UPDATE ON resource_answers
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`)
      console.log('✅ resource_answers 表已创建')
    } else {
      console.log('✅ resource_answers 表已存在，跳过')
    }

    // === 3. 迁移现有 worksheets → resources ===
    const { rows: wsCount } = await query(`SELECT COUNT(*)::int FROM worksheets`)
    if (wsCount[0].count > 0) {
      const { rows: migrated } = await query(`
        INSERT INTO resources (id, resource_type, name, subject, grade, status, pdf_url, parse_status, parse_count, parse_warning, parse_error, answer_status, created_at)
        SELECT id, 'worksheet', name, subject, grade, COALESCE(status, 'published'), pdf_url, COALESCE(parse_status, 'idle'), COALESCE(parse_count, 0), parse_warning, parse_error, 'official_verified', created_at
        FROM worksheets
        ON CONFLICT (id) DO NOTHING
      `)
      console.log(`✅ 已迁移 ${wsCount[0].count} 条 worksheets 记录到 resources`)
    } else {
      console.log('✅ worksheets 表无数据，跳过迁移')
    }

    // === 4. 迁移现有 worksheet_answers → resource_answers ===
    const { rows: waCount } = await query(`SELECT COUNT(*)::int FROM worksheet_answers`)
    if (waCount[0].count > 0) {
      await query(`
        INSERT INTO resource_answers (resource_id, question_no, answer, answer_type, section, content, answer_status, confidence, source, created_at)
        SELECT worksheet_id, question_no, answer, answer_type, section, content, 'official_verified', confidence, source, created_at
        FROM worksheet_answers
        ON CONFLICT (resource_id, section, question_no) DO NOTHING
      `)
      console.log(`✅ 已迁移 ${waCount[0].count} 条 worksheet_answers 记录到 resource_answers`)
    } else {
      console.log('✅ worksheet_answers 表无数据，跳过迁移')
    }

    // === 5. tasks 表加 resource_id 列 ===
    await addColumn('tasks', 'resource_id', 'UUID REFERENCES resources(id) ON DELETE SET NULL')
    await query(`CREATE INDEX IF NOT EXISTS idx_tasks_resource_id ON tasks(resource_id)`).catch(() => {})

    // === 6. 创建向后兼容视图 ===
    const { rows: wsViewExist } = await query(`
      SELECT table_name FROM information_schema.views
      WHERE table_name = 'worksheets'
    `)
    if (wsViewExist.length === 0) {
      // 先把原表重命名，再创建视图
      const { rows: wsTable } = await query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'worksheets'
      `)
      if (wsTable.length > 0) {
        // 检查是否已经是视图（幂等）
        const { rows: checkView } = await query(`
          SELECT table_name FROM information_schema.views
          WHERE table_name = 'worksheets'
        `)
        if (checkView.length === 0) {
          // 原表还存在 → 重命名原表，创建视图
          await query(`ALTER TABLE worksheets RENAME TO worksheets_legacy`)
          await query(`
            CREATE VIEW worksheets AS
            SELECT id, name, subject, grade, pdf_url, status, answer_count, parse_status, parse_count, parse_warning, parse_error, created_at, updated_at
            FROM resources
            WHERE resource_type = 'worksheet'
          `)
          console.log('✅ worksheets 视图已创建（原表已重命名为 worksheets_legacy）')
        }
      }
    } else {
      console.log('✅ worksheets 视图已存在')
    }

    // worksheet_answers 视图
    const { rows: waViewExist } = await query(`
      SELECT table_name FROM information_schema.views
      WHERE table_name = 'worksheet_answers'
    `)
    if (waViewExist.length === 0) {
      await query(`
        CREATE VIEW worksheet_answers AS
        SELECT id, resource_id AS worksheet_id, question_no, answer, answer_type, section, confidence, source, content, metadata, created_at
        FROM resource_answers
        WHERE answer_status = 'official_verified'
      `)
      console.log('✅ worksheet_answers 视图已创建')
    } else {
      console.log('✅ worksheet_answers 视图已存在')
    }

    console.log('✅ [迁移028] 统一资源答案库建立完成')
  } catch (error) {
    console.error('❌ [迁移028] 失败:', error.message)
  }
}