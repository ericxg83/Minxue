/**
 * wrong_questions 按 question 内容指纹合并（默认精确匹配）
 *
 * 背景（2026-09-02）：
 *   上次双 task 合并只合了 questions.task_id，但 wrong_questions 各自还指向
 *   原 task 的 question_id。同题被识别为两道错题，错题本视觉重复。
 *   之前的 dedupe-wrong-questions.mjs 走 (student, worksheet_id, question_no)
 *   自然键——本场景这些列都 NULL，全漏。
 *
 * 合并策略：
 *   1. JOIN questions 拿到每条 wrong_questions 的题干 content
 *   2. 按 md5(content) 精确分组（默认）：保留 earliest added_at 的行，
 *      error_count = SUM，student_answer 取最新非空
 *   3. --fuzzy 模式额外按"前导空格差异"分组：把 (2)如果放养... 和 (2) 如果放养...
 *      这种视为同题
 *
 * 用法：
 *   node scripts/dedupe-wrong-questions-by-content.mjs            # dry-run 精确匹配
 *   node scripts/dedupe-wrong-questions-by-content.mjs --apply    # 真正合并
 *   node scripts/dedupe-wrong-questions-by-content.mjs --fuzzy --apply
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const APPLY = process.argv.includes('--apply')
const FUZZY = process.argv.includes('--fuzzy')

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

if (!APPLY) {
  console.log('🔍 DRY-RUN 模式（不删数据）。加 --apply 才会执行。\n')
} else {
  console.log('⚠️  APPLY 模式：以下操作会真实删除 wrong_questions 重复行。\n')
}
console.log(`合并模式: ${FUZZY ? 'fuzzy（精确+前导空格差异）' : 'exact（仅 md5 完全相同）'}\n`)

const fmt = (n) => String(n).padStart(4, ' ')

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // 1. 拿出所有 wrong_questions JOIN questions 的 (id, content)
  const allRows = await client.query(`
    SELECT wq.id as wq_id, wq.student_id, wq.question_id, wq.error_count,
           wq.added_at, wq.student_answer,
           q.content, q.task_id, q.page_number
    FROM wrong_questions wq
    JOIN questions q ON q.id = wq.question_id
    WHERE q.deleted_at IS NULL AND q.content IS NOT NULL AND LENGTH(q.content) > 0
    ORDER BY wq.student_id, q.content
  `)

  if (allRows.rowCount === 0) {
    console.log('没有 wrong_questions 关联到有效 question。')
    await client.query('ROLLBACK')
    process.exit(0)
  }

  // 2. 按 (student_id, content_normalized) 分组
  const groups = new Map()
  for (const r of allRows.rows) {
    const key = r.content  // exact 模式
    // fuzzy 模式：去掉所有空白字符（空格、全角空格、Tab、换行）。
    // 这样 "(3) 若每放养..." 和 "(3)若每放养..." 视为同一题。
    // 同时去掉零宽空格（U+200B 等 OCR 偶发引入）。
    const normalizedKey = r.content.replace(/[\s　​-‍﻿]/g, '')
    const groupKey = FUZZY
      ? `${r.student_id}||${normalizedKey}`
      : `${r.student_id}||${key}`
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        studentId: r.student_id,
        content: r.content,
        normalizedContent: normalizedKey,
        rows: []
      })
    }
    groups.get(groupKey).rows.push(r)
  }

  // 3. 过滤出重复组
  const dupGroups = [...groups.values()].filter(g => g.rows.length >= 2)
  console.log(`═══════════════════════════════════════════════════════`)
  console.log(`📊 wrong_questions 内容重复诊断`)
  console.log(`═══════════════════════════════════════════════════════\n`)
  console.log(`总 wrong_questions 行: ${fmt(allRows.rowCount)}`)
  console.log(`内容重复组: ${fmt(dupGroups.length)} 组\n`)

  if (dupGroups.length === 0) {
    console.log('✅ 没有内容重复，无需合并。')
    await client.query('ROLLBACK')
    process.exit(0)
  }

  // 4. 输出每组详情
  let totalKeep = 0
  let totalDelete = 0
  const mergePlan = []

  for (const g of dupGroups) {
    // 保留 earliest added_at 的行
    const sorted = [...g.rows].sort((a, b) => new Date(a.added_at) - new Date(b.added_at))
    const keepRow = sorted[0]
    const deleteRows = sorted.slice(1)
    const sumError = sorted.reduce((acc, r) => acc + parseInt(r.error_count, 10), 0)

    console.log(`  student=${g.studentId.slice(0,8)}..  n=${sorted.length}  "${g.content.slice(0, 60)}..."`)
    console.log(`    保留 → wq=${keepRow.wq_id.slice(0,8)}.. (added=${new Date(keepRow.added_at).toISOString().slice(0,19)})`)
    for (const d of deleteRows) {
      console.log(`    删除 → wq=${d.wq_id.slice(0,8)}.. (added=${new Date(d.added_at).toISOString().slice(0,19)})`)
    }
    console.log('')

    totalKeep++
    totalDelete += deleteRows.length
    mergePlan.push({ keepId: keepRow.wq_id, deleteIds: deleteRows.map(r => r.wq_id), sumError })
  }

  console.log(`📊 计划：保留 ${fmt(totalKeep)} 条，删除 ${fmt(totalDelete)} 条\n`)

  if (!APPLY) {
    console.log('💡 加 --apply 真正执行。建议先在生产库备份：')
    console.log('   CREATE TABLE wrong_questions_backup_20260902 AS SELECT * FROM wrong_questions;')
    if (dupGroups.some(g => g.content !== g.normalizedContent)) {
      console.log('   ⚠️  发现 fuzzy 可合并组（仅前导空格差）。加 --fuzzy --apply 合并这些。')
    }
    await client.query('ROLLBACK')
    process.exit(0)
  }

  // 5. 真实合并
  console.log('⏳ 开始合并...\n')
  let mergedCount = 0
  for (const { keepId, deleteIds, sumError } of mergePlan) {
    if (deleteIds.length === 0) continue

    // 5a. UPDATE 保留行：error_count 累加
    await client.query(`
      UPDATE wrong_questions
      SET error_count = $2,
          last_wrong_at = GREATEST(last_wrong_at, COALESCE(
            (SELECT MAX(last_wrong_at) FROM wrong_questions WHERE id = ANY($3)),
            last_wrong_at
          )),
          updated_at = NOW()
      WHERE id = $1
    `, [keepId, sumError, deleteIds])

    // 5b. DELETE 其余行
    await client.query(`DELETE FROM wrong_questions WHERE id = ANY($1)`, [deleteIds])
    mergedCount++
  }

  console.log(`✅ 已合并 ${fmt(mergedCount)} 组（共删除 ${fmt(totalDelete)} 条）`)

  // 6. 验证
  const after = await client.query(`
    SELECT COUNT(*)::int as n FROM (
      SELECT 1 FROM wrong_questions wq
      JOIN questions q ON q.id = wq.question_id
      WHERE q.deleted_at IS NULL AND q.content IS NOT NULL AND LENGTH(q.content) > 0
      GROUP BY wq.student_id, ${FUZZY ? `REGEXP_REPLACE(q.content, '[\\s\\u3000\\u200B-\\u200D\\uFEFF]', '', 'g')` : 'q.content'}
      HAVING COUNT(*) >= 2
    ) t
  `)
  console.log(`\n📋 合并后剩余内容重复组: ${after.rows[0].n}（应为 0）`)

  if (APPLY) {
    await client.query('COMMIT')
    console.log('\n✅ 已提交。')
    console.log('📌 注意：被删 wrong_questions 的 question_id 仍指向原 question（题不会被删）。')
  } else {
    await client.query('ROLLBACK')
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('\n❌ 失败:', err.message)
  console.error(err.stack)
  process.exit(1)
} finally {
  client.release()
  await pool.end()}
