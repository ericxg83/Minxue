// ============================================
// 清空 Supabase 数据库所有数据脚本
// 运行方式: node clear_supabase_data.cjs
// ⚠️ 注意：此操作不可恢复！
// ============================================

const { createClient } = require('@supabase/supabase-js')

// 从 .env.production 读取配置
const supabaseUrl = 'https://wdwlxbtntuurjtlirwew.supabase.co'
const supabaseKey = 'sb_publishable_vYdDhMLLgSKqsoBIvYBZJA_JBy2JLDh'

const supabase = createClient(supabaseUrl, supabaseKey)

const TABLES = [
  'training_logs',
  'wrong_questions',
  'questions',
  'tasks',
  'students'
]

async function clearDatabase() {
  console.log('️  即将清空数据库所有数据，此操作不可恢复！')
  console.log('')
  
  for (const table of TABLES) {
    console.log(`正在清空表: ${table}...`)
    
    const { data, error } = await supabase
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // 删除所有记录
    
    if (error) {
      console.error(`❌ 清空 ${table} 失败:`, error.message)
    } else {
      console.log(`✅ 已清空 ${table}`)
    }
  }
  
  console.log('')
  console.log('================================')
  console.log('数据库清空完成！')
  console.log('================================')
  
  // 验证清空结果
  console.log('')
  console.log('验证数据:')
  for (const table of TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
    
    if (error) {
      console.log(`  ${table}: 查询失败 - ${error.message}`)
    } else {
      console.log(`  ${table}: ${count || 0} 条记录`)
    }
  }
}

clearDatabase().catch(console.error)
