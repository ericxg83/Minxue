import { query, transaction } from '../config/neon.js'

/**
 * 数据库迁移：补完迁移028未完成的部分（幂等）
 *
 * 迁移028的遗留问题：
 * 1. worksheet_answers 视图创建失败 —— 028 只重命名了 worksheets 表，
 *    没有重命名 worksheet_answers 表，CREATE VIEW 因同名表存在而报错，
 *    且错误被 catch 吞掉。结果：worksheet_answers 至今仍是旧实表，
 *    写入 resource_answers 的答案对读取方（旧表）不可见。
 * 2. 旧表中的答案若其练习册行已从 resources 消失（如经由视图 DELETE 级联），
 *    迁移时会因 FK 失败 —— 需先从 worksheets_legacy 恢复父行。
 * 3. tasks.worksheet_id 与 student_worksheet_settings.default_worksheet_id
 *    的外键仍指向 worksheets_legacy（重命名时外键跟随实表），
 *    导致新建练习册无法关联任务/设为学生默认。
 *
 * 本迁移：
 * 1. 若 worksheet_answers 仍是实表：
 *    a. 从 worksheets_legacy 恢复被答案引用但 resources 缺失的练习册行
 *    b. 旧表答案迁入 resource_answers（official_verified）
 *    c. 旧表重命名为 worksheet_answers_legacy（保留原始数据）
 *    d. 创建 worksheet_answers 视图（同028原计划）
 * 2. 上述两个外键改指 resources(id)
 */
export const migrateCompleteResources = async () => {
  try {
    console.log('📦 [迁移030] 开始补完统一资源迁移...')

    const { rows: waKind } = await query(`
      SELECT table_type FROM information_schema.tables
      WHERE table_name = 'worksheet_answers'
    `)

    if (waKind[0]?.table_type === 'BASE TABLE') {
      await transaction(async (client) => {
        // a. 恢复被答案引用但 resources 里缺失的练习册（父行没了答案就是孤儿，且级联删过的答案不会留在旧表里）
        const { rowCount: restored } = await client.query(`
          INSERT INTO resources (id, resource_type, name, subject, grade, status, pdf_url, parse_status, parse_count, parse_warning, parse_error, answer_status, created_at)
          SELECT wl.id, 'worksheet', wl.name, wl.subject, wl.grade, COALESCE(wl.status, 'published'),
                 wl.pdf_url, COALESCE(wl.parse_status, 'idle'), COALESCE(wl.parse_count, 0),
                 wl.parse_warning, wl.parse_error, 'official_verified', wl.created_at
          FROM worksheets_legacy wl
          WHERE wl.id IN (SELECT DISTINCT worksheet_id FROM worksheet_answers)
          ON CONFLICT (id) DO NOTHING
        `)
        if (restored > 0) console.log(`  ✅ 已从 worksheets_legacy 恢复 ${restored} 个被答案引用的练习册`)

        // b. 旧表答案迁入 resource_answers
        const { rowCount: migrated } = await client.query(`
          INSERT INTO resource_answers (resource_id, question_no, answer, answer_type, section, content, answer_status, confidence, source, created_at)
          SELECT wa.worksheet_id, wa.question_no, wa.answer, wa.answer_type, wa.section, wa.content,
                 'official_verified', wa.confidence, wa.source, wa.created_at
          FROM worksheet_answers wa
          WHERE EXISTS (SELECT 1 FROM resources r WHERE r.id = wa.worksheet_id)
          ON CONFLICT (resource_id, section, question_no) DO NOTHING
        `)
        console.log(`  ✅ 已迁移 ${migrated} 条答案到 resource_answers`)

        // c+d. 旧表让位，创建视图
        await client.query(`ALTER TABLE worksheet_answers RENAME TO worksheet_answers_legacy`)
        await client.query(`
          CREATE VIEW worksheet_answers AS
          SELECT id, resource_id AS worksheet_id, question_no, answer, answer_type, section, confidence, source, content, metadata, created_at
          FROM resource_answers
          WHERE answer_status = 'official_verified'
        `)
        console.log('  ✅ worksheet_answers 视图已创建（旧表保留为 worksheet_answers_legacy）')
      })
    } else if (waKind.length > 0) {
      console.log('  ✅ worksheet_answers 已是视图，跳过')
    }

    // 2. 外键改指 resources（重命名后外键仍挂在 worksheets_legacy 上）
    const repointFk = async (table, column, constraint) => {
      const { rows } = await query(`
        SELECT confrelid::regclass::text AS ref
        FROM pg_constraint
        WHERE conname = $1 AND conrelid = $2::regclass
      `, [constraint, table])
      if (rows[0]?.ref === 'resources') {
        console.log(`  ✅ ${table}.${column} 外键已指向 resources，跳过`)
        return
      }
      await query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`)
      await query(`
        ALTER TABLE ${table} ADD CONSTRAINT ${constraint}
        FOREIGN KEY (${column}) REFERENCES resources(id) ON DELETE SET NULL
      `)
      console.log(`  ✅ ${table}.${column} 外键已改指 resources(id)`)
    }
    await repointFk('tasks', 'worksheet_id', 'tasks_worksheet_id_fkey')
    await repointFk('student_worksheet_settings', 'default_worksheet_id', 'student_worksheet_settings_default_worksheet_id_fkey')

    console.log('✅ [迁移030] 统一资源迁移补完')
  } catch (error) {
    console.error('❌ [迁移030] 失败:', error.message)
    throw error
  }
}
