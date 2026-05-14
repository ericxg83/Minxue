import { Pool } from 'pg'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env') })

const connectionString = process.env.NEON_DATABASE_URL

if (!connectionString) {
  console.error('❌ 缺少 NEON_DATABASE_URL 环境变量')
  process.exit(1)
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
})

async function initDatabase() {
  console.log('🔌 连接数据库...')
  
  try {
    // 删除现有表（按依赖顺序）
    await pool.query('DROP TABLE IF EXISTS generated_exams CASCADE')
    await pool.query('DROP TABLE IF EXISTS wrong_questions CASCADE')
    await pool.query('DROP TABLE IF EXISTS questions CASCADE')
    await pool.query('DROP TABLE IF EXISTS tasks CASCADE')
    await pool.query('DROP TABLE IF EXISTS students CASCADE')
    console.log('✅ 已清理旧表')

    // 创建 students 表
    await pool.query(`
      CREATE TABLE students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        grade TEXT,
        avatar TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    console.log('✅ students 表已创建')

    // 创建 tasks 表
    await pool.query(`
      CREATE TABLE tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID REFERENCES students(id) ON DELETE CASCADE,
        image_url TEXT,
        original_name TEXT,
        status TEXT DEFAULT 'pending',
        result JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await pool.query('CREATE INDEX idx_tasks_student_id ON tasks(student_id)')
    await pool.query('CREATE INDEX idx_tasks_status ON tasks(status)')
    console.log('✅ tasks 表已创建')

    // 创建 questions 表
    await pool.query(`
      CREATE TABLE questions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
        student_id UUID REFERENCES students(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        question_type TEXT,
        subject TEXT,
        options JSONB,
        answer TEXT,
        analysis TEXT,
        status TEXT DEFAULT 'pending',
        is_suspicious BOOLEAN DEFAULT FALSE,
        is_correct BOOLEAN DEFAULT FALSE,
        confidence DECIMAL(3,2) DEFAULT 0.00,
        student_answer TEXT,
        ai_answer TEXT,
        answer_source TEXT DEFAULT 'recognized',
        image_url TEXT,
        ai_tags JSONB DEFAULT '[]',
        manual_tags JSONB DEFAULT '[]',
        tags_source TEXT DEFAULT 'ai',
        block_coordinates JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await pool.query('CREATE INDEX idx_questions_student_id ON questions(student_id)')
    await pool.query('CREATE INDEX idx_questions_status ON questions(status)')
    await pool.query('CREATE INDEX idx_questions_task_id ON questions(task_id)')
    console.log('✅ questions 表已创建')

    // 创建 wrong_questions 表
    await pool.query(`
      CREATE TABLE wrong_questions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
        student_id UUID REFERENCES students(id) ON DELETE CASCADE,
        subject TEXT,
        error_count INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending',
        added_at TIMESTAMPTZ DEFAULT NOW(),
        mastered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await pool.query('CREATE INDEX idx_wrong_questions_student_id ON wrong_questions(student_id)')
    await pool.query('CREATE INDEX idx_wrong_questions_status ON wrong_questions(status)')
    console.log('✅ wrong_questions 表已创建')

    // 创建 generated_exams 表
    await pool.query(`
      CREATE TABLE generated_exams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID REFERENCES students(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        question_ids JSONB,
        status TEXT DEFAULT 'ungraded',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await pool.query('CREATE INDEX idx_generated_exams_student_id ON generated_exams(student_id)')
    await pool.query('CREATE INDEX idx_generated_exams_status ON generated_exams(status)')
    console.log('✅ generated_exams 表已创建')

    // 插入测试学生数据
    const { rows } = await pool.query(`
      INSERT INTO students (id, name, grade) VALUES
        ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', '诸葛亮', '高三·1班'),
        ('b2c3d4e5-f6a7-8901-bcde-f12345678901', '周瑜', '高三·2班')
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `)
    console.log(`✅ 已插入 ${rows.length} 个测试学生`)

    // 验证所有表
    const { rows: tables } = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('students', 'tasks', 'questions', 'wrong_questions', 'generated_exams')
      ORDER BY table_name
    `)
    
    console.log('\n📊 数据库初始化完成！')
    console.log('已创建的表:')
    tables.forEach(t => console.log(`  - ${t.table_name}`))

  } catch (error) {
    console.error('❌ 数据库初始化失败:', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

initDatabase()
