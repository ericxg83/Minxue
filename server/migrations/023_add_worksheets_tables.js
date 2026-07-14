import { query } from '../config/neon.js'

/**
 * 数据库迁移：练习册答案库系统
 *
 * 新增表：
 *   worksheets              — 练习册主表
 *   worksheet_answers       — 答案库
 *   student_worksheet_settings — 学生默认练习册
 *
 * tasks 表加列：
 *   - worksheet_id UUID    关联练习册
 *   - subject TEXT          科目
 *
 * 更新 tasks.task_type 约束，新增 'workbook'
 */
export const migrateWorksheets = async () => {
  try {
    // === 1. worksheets 表 ===
    const { rows: wsExist } = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'worksheets'
    `)
    if (wsExist.length === 0) {
      await query(`
        CREATE TABLE worksheets (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          subject TEXT,
          grade TEXT,
          pdf_url TEXT,
          status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'reviewing', 'published')),
          answer_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `)
      await query(`CREATE INDEX IF NOT EXISTS idx_worksheets_status ON worksheets(status)`)
      await query(`CREATE TRIGGER update_worksheets_updated_at BEFORE UPDATE ON worksheets
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`)
      console.log('✅ worksheets 表已创建')
    } else {
      console.log('✅ worksheets 表已存在，跳过')
    }

    // === 2. worksheet_answers 表 ===
    const { rows: waExist } = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'worksheet_answers'
    `)
    if (waExist.length === 0) {
      await query(`
        CREATE TABLE worksheet_answers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          worksheet_id UUID NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
          question_no INTEGER NOT NULL,
          answer TEXT NOT NULL,
          answer_type TEXT DEFAULT 'choice',
          section TEXT,
          confidence DECIMAL(3,2) DEFAULT 1.0,
          source TEXT DEFAULT 'pdf_parse',
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(worksheet_id, section, question_no)
        )
      `)
      await query(`CREATE INDEX IF NOT EXISTS idx_worksheet_answers_ws_id ON worksheet_answers(worksheet_id)`)
      await query(`CREATE INDEX IF NOT EXISTS idx_worksheet_answers_ws_section ON worksheet_answers(worksheet_id, section)`)
      console.log('✅ worksheet_answers 表已创建')
    } else {
      console.log('✅ worksheet_answers 表已存在，跳过')
    }

    // === 3. student_worksheet_settings 表 ===
    const { rows: sssExist } = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'student_worksheet_settings'
    `)
    if (sssExist.length === 0) {
      await query(`
        CREATE TABLE student_worksheet_settings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          subject TEXT NOT NULL,
          default_worksheet_id UUID REFERENCES worksheets(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(student_id, subject)
        )
      `)
      await query(`CREATE INDEX IF NOT EXISTS idx_student_ws_settings_student ON student_worksheet_settings(student_id)`)
      await query(`CREATE TRIGGER update_student_worksheet_settings_updated_at BEFORE UPDATE ON student_worksheet_settings
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`)
      console.log('✅ student_worksheet_settings 表已创建')
    } else {
      console.log('✅ student_worksheet_settings 表已存在，跳过')
    }

    // === 4. tasks 表加列 ===
    let { rows } = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'worksheet_id'
    `)
    if (rows.length === 0) {
      await query(`ALTER TABLE tasks ADD COLUMN worksheet_id UUID REFERENCES worksheets(id) ON DELETE SET NULL`)
      console.log('✅ tasks.worksheet_id 字段已添加')
    } else {
      console.log('✅ tasks.worksheet_id 已存在，跳过')
    }

    ;({ rows } = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'subject'
    `))
    if (rows.length === 0) {
      await query(`ALTER TABLE tasks ADD COLUMN subject TEXT`)
      console.log('✅ tasks.subject 字段已添加')
    } else {
      console.log('✅ tasks.subject 已存在，跳过')
    }

    // 更新 task_type 约束
    try {
      await query(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check`)
      await query(`ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check
        CHECK (task_type IN ('general', 'wrong_retry', 'retry_paper', 'workbook'))`)
      console.log('✅ tasks.task_type 约束已更新')
    } catch (e) {
      console.log('✅ tasks.task_type 约束已存在或无需更新')
    }

    // 索引
    await query(`CREATE INDEX IF NOT EXISTS idx_tasks_worksheet_id ON tasks(worksheet_id)`).catch(() => {})
  } catch (error) {
    console.error('worksheets 迁移失败:', error.message)
  }
}