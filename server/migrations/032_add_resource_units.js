import { query, transaction } from '../config/neon.js'

/**
 * 数据库迁移：练习单元（练习册答案定位粒度从「章」下沉到「练习单元」）
 *
 * 背景：练习册的题号作用域是「练习单元」（堂堂练① 19.1(1) 算术平方根），
 * 每个单元从 1 重新编号。旧模型只有 (section, question_no) 两级坐标，
 * 几十个单元的「第1题」全部撞进同一个 key，被 UNIQUE 约束静默丢弃。
 * 实测 73 页练习册仅存活 650 条答案、5 个 section（其中含幻觉章节）。
 *
 * 本迁移建立：
 *   resource_units      练习单元表（答案/题目两份 PDF 的对齐锚点）
 *   resource_questions  题目清册表（阶段 2 才写入，此处先建空表避免二次迁移）
 *   resource_answers    加 unit_id / sub_no，唯一约束改为 (resource_id, unit_id, question_no, sub_no)
 *   resources           加 question_parse_* 三列（必须独立于 parse_status，
 *                       否则题目 PDF 解析会和答案 PDF 解析抢同一个幂等锁）
 *
 * 注意：worksheets / worksheet_answers 是视图，不能作 FK 目标，故 FK 指向 resources。
 * 幂等：全部先查 information_schema / pg_constraint，缺失才建。
 */

const tableExists = async (table) => {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public'`,
    [table]
  )
  return rows.length > 0
}

const columnExists = async (table, column) => {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  )
  return rows.length > 0
}

const constraintExists = async (table, constraint) => {
  const { rows } = await query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`,
    [constraint, table]
  )
  return rows.length > 0
}

// resources 是基础表，worksheets 是它的视图。给 resources 加列后必须重建视图，
// 否则视图不含新列（视图列在 CREATE 时固化）。逻辑与 031 保持一致。
const rebuildWorksheetsView = async () => {
  const { rows: allCols } = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'resources' AND column_name NOT IN ('resource_type', 'metadata', 'exam_date', 'answer_status')
     ORDER BY ordinal_position`
  )
  const colNames = allCols.map(r => r.column_name).join(', ')
  await query('DROP VIEW IF EXISTS worksheets')
  await query(
    `CREATE VIEW worksheets AS SELECT ${colNames} FROM resources WHERE resource_type = 'worksheet'`
  )
}

const createResourceUnits = async () => {
  if (await tableExists('resource_units')) {
    console.log('  ✅ resource_units 已存在，跳过')
    return
  }
  await query(`
    CREATE TABLE resource_units (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      unit_key TEXT NOT NULL,
      unit_title TEXT,
      unit_seq INTEGER,
      lesson_code TEXT,
      ordinal INTEGER,
      answer_page_start INTEGER,
      answer_page_end INTEGER,
      question_page_start INTEGER,
      question_page_end INTEGER,
      expected_question_count INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (resource_id, unit_key)
    )
  `)
  await query(`CREATE INDEX idx_resource_units_resource ON resource_units(resource_id, unit_seq)`)
  await query(`CREATE INDEX idx_resource_units_lesson ON resource_units(resource_id, lesson_code)`)
  console.log('  ✅ 已创建 resource_units')
}

const createResourceQuestions = async () => {
  if (await tableExists('resource_questions')) {
    console.log('  ✅ resource_questions 已存在，跳过')
    return
  }
  // sub_no 用空串表示「整题」，避免 NULL 参与唯一约束时的 NULLS DISTINCT 语义
  await query(`
    CREATE TABLE resource_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      unit_id UUID REFERENCES resource_units(id) ON DELETE CASCADE,
      question_no INTEGER,
      sub_no TEXT NOT NULL DEFAULT '',
      content TEXT,
      question_type TEXT,
      options JSONB,
      page_no INTEGER,
      bbox JSONB,
      image_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE NULLS NOT DISTINCT (resource_id, unit_id, question_no, sub_no)
    )
  `)
  await query(`CREATE INDEX idx_resource_questions_unit ON resource_questions(unit_id, question_no)`)
  console.log('  ✅ 已创建 resource_questions')
}

const alterResourceAnswers = async () => {
  if (!(await columnExists('resource_answers', 'unit_id'))) {
    await query(`ALTER TABLE resource_answers ADD COLUMN unit_id UUID REFERENCES resource_units(id) ON DELETE CASCADE`)
    console.log('  ✅ 已添加 resource_answers.unit_id')
  } else {
    console.log('  ✅ resource_answers.unit_id 已存在，跳过')
  }

  if (!(await columnExists('resource_answers', 'sub_no'))) {
    await query(`ALTER TABLE resource_answers ADD COLUMN sub_no TEXT NOT NULL DEFAULT ''`)
    console.log('  ✅ 已添加 resource_answers.sub_no')
  } else {
    console.log('  ✅ resource_answers.sub_no 已存在，跳过')
  }

  const OLD_UQ = 'resource_answers_resource_id_section_question_no_key'
  const NEW_UQ = 'resource_answers_unit_question_key'

  if (await constraintExists('resource_answers', NEW_UQ)) {
    console.log('  ✅ 新唯一约束已存在，跳过')
    return
  }

  // 唯一约束换列 → worksheet_answers 视图依赖 resource_answers，先拆再建。
  // 视图定义照抄 030_complete_resources_migration.js:62-66，并补上新列。
  //
  // 为什么保留 section：存量 901 条答案的 unit_id 全为 NULL，若键里去掉 section，
  // 「第十九章 第1题」与「第一章阶段练1 第1题」会撞成同一行导致建约束失败。
  // 新数据由 unit_id 区分，section 冗余但无害；存量数据行为与旧约束完全一致。
  await transaction(async (client) => {
    await client.query('DROP VIEW IF EXISTS worksheet_answers')
    if (await constraintExists('resource_answers', OLD_UQ)) {
      await client.query(`ALTER TABLE resource_answers DROP CONSTRAINT ${OLD_UQ}`)
    }
    await client.query(`
      ALTER TABLE resource_answers
      ADD CONSTRAINT ${NEW_UQ} UNIQUE NULLS NOT DISTINCT (resource_id, unit_id, section, question_no, sub_no)
    `)
    await client.query(`
      CREATE VIEW worksheet_answers AS
      SELECT id, resource_id AS worksheet_id, question_no, answer, answer_type, section,
             unit_id, sub_no, confidence, source, content, metadata, created_at
      FROM resource_answers
      WHERE answer_status = 'official_verified'
    `)
  })
  console.log('  ✅ 唯一约束已改为 (resource_id, unit_id, section, question_no, sub_no)，worksheet_answers 视图已重建')
}

const alterResources = async () => {
  const cols = [
    ['question_parse_status', "TEXT DEFAULT 'idle'"],
    ['question_parse_total_pages', 'INTEGER'],
    ['question_parse_done_pages', 'INTEGER']
  ]
  let added = 0
  for (const [name, def] of cols) {
    if (await columnExists('resources', name)) {
      console.log(`  ✅ resources.${name} 已存在，跳过`)
      continue
    }
    await query(`ALTER TABLE resources ADD COLUMN ${name} ${def}`)
    console.log(`  ✅ 已添加 resources.${name}`)
    added++
  }
  if (added > 0) {
    await rebuildWorksheetsView()
    console.log('  ✅ 已重建 worksheets 视图（含新增列）')
  }
}

export const migrateResourceUnits = async () => {
  try {
    console.log('📦 [迁移032] 开始建立练习单元数据模型...')
    await createResourceUnits()
    await createResourceQuestions()
    await alterResourceAnswers()
    await alterResources()
    console.log('✅ [迁移032] 练习单元数据模型建立完成')
  } catch (error) {
    console.error('❌ [迁移032] 失败:', error.message)
  }
}
