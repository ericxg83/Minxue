import { query } from '../config/neon.js'

const columnExists = async (table, column) => {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  )
  return rows.length > 0
}

const tableExists = async (table) => {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [table]
  )
  return rows.length > 0
}

// 做错（非空题）的错误原因库。空题（is_blank）不在此列——空题不分析错因。
export const ERROR_TYPE_CATEGORIES = [
  { name: '计算错误', category: '运算' },
  { name: '审题错误', category: '审题' },
  { name: '公式记忆错误', category: '知识' },
  { name: '概念不理解', category: '知识' },
  { name: '步骤遗漏', category: '过程' },
  { name: '单位错误', category: '过程' },
  { name: '方法选择错误', category: '方法' },
  { name: '不会分析', category: '方法' },
  { name: '抄写错误', category: '习惯' },
  { name: '粗心', category: '习惯' },
]

export const migrateErrorAnalysis = async () => {
  try {
    console.log('📦 [迁移035] 开始建立教学诊断数据层（错误原因库 + wrong_questions 分析字段）...')

    // 1. 创建 error_types 表
    if (!(await tableExists('error_types'))) {
      await query(`CREATE TABLE error_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`)
      console.log('  ✅ 已创建 error_types 表')
    } else {
      console.log('  ℹ️ error_types 表已存在，跳过')
    }

    // 2. 预置错因大类（幂等 upsert）
    const existing = await query(`SELECT name FROM error_types`)
    const existingNames = new Set(existing.rows.map(r => r.name))
    let inserted = 0
    for (const [i, item] of ERROR_TYPE_CATEGORIES.entries()) {
      if (existingNames.has(item.name)) continue
      await query(
        `INSERT INTO error_types (name, category, sort_order) VALUES ($1, $2, $3)`,
        [item.name, item.category, i]
      )
      inserted++
    }
    if (inserted > 0) console.log(`  ✅ 预置 ${inserted} 个错因大类`)

    // 3. wrong_questions 加分析字段
    const wqCols = [
      ['is_blank', 'BOOLEAN DEFAULT FALSE'],
      ['error_type', 'TEXT'],
      ['error_reason', 'TEXT'],
      ['ai_confidence', 'NUMERIC'],
    ]
    let added = 0
    for (const [name, def] of wqCols) {
      if (await columnExists('wrong_questions', name)) {
        console.log(`  ℹ️ wrong_questions.${name} 已存在，跳过`)
        continue
      }
      await query(`ALTER TABLE wrong_questions ADD COLUMN ${name} ${def}`)
      console.log(`  ✅ 已添加 wrong_questions.${name}`)
      added++
    }

    // 4. 索引：按分析状态扫描（回填任务/诊断聚合）
    await query(`CREATE INDEX IF NOT EXISTS idx_wrong_questions_error_type ON wrong_questions(error_type)`)
    await query(`CREATE INDEX IF NOT EXISTS idx_wrong_questions_is_blank ON wrong_questions(is_blank)`)
    console.log('  ✅ 索引已创建')

    console.log('✅ [迁移035] 教学诊断数据层迁移完成')
  } catch (error) {
    console.error('❌ [迁移035] 失败:', error.message)
  }
}
