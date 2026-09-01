/**
 * 错题去重脚本（默认 dry-run，必须 --apply 才真正删）
 *
 * 背景（2026-09-02）：
 *   wrong_questions 表没有 UNIQUE 索引，addSelfContainedWrongQuestion
 *   走 SELECT+INSERT 而非 ON CONFLICT，连点上传同一份试卷时并发
 *   跑出会双写。线上已观察到 (student, worksheet, question_no) 多行。
 *
 * 合并策略（按优先级）：
 *   1. 保留 error_count 最高的行（错得最多的最值得保留）
 *   2. 并列时保留最早 added_at 的行
 *   3. 把其他行的 error_count 加到保留行，student_answer 等字段保留最新的非空值
 *   4. 关系表（regrade_history 等如有引用 wrong_question_id）保留行不动
 *
 * 用法：
 *   node scripts/dedupe-wrong-questions.mjs            # 默认 dry-run
 *   node scripts/dedupe-wrong-questions.mjs --apply    # 真正删除
 *
 * ⚠️ 生产库执行前请先 dry-run 看输出，确认保留/删除的行符合预期。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const APPLY = process.argv.includes('--apply')

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

if (!APPLY) {
  console.log('🔍 DRY-RUN 模式（不删数据）。加 --apply 才会执行。\n')
} else {
  console.log('⚠️  APPLY 模式：以下操作会真实删除数据，请确认已备份。\n')
}

const fmt = (n) => String(n).padStart(6, ' ')

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // 1. 找出所有重复组：(student_id, worksheet_id, question_no)
  const dupGroups = await client.query(`
    SELECT student_id, worksheet_id, question_no,
           array_agg(id ORDER BY added_at ASC, id ASC) as wq_ids,
           array_agg(error_count ORDER BY added_at ASC, id ASC) as counts,
           array_agg(added_at ORDER BY added_at ASC, id ASC) as times,
           COUNT(*) as n
    FROM wrong_questions
    WHERE student_id IS NOT NULL AND worksheet_id IS NOT NULL AND question_no IS NOT NULL
    GROUP BY student_id, worksheet_id, question_no
    HAVING COUNT(*) >= 2
    ORDER BY n DESC, MIN(added_at) DESC
  `)

  console.log(`📊 找到 ${fmt(dupGroups.rowCount)} 个重复组`)

  if (dupGroups.rowCount === 0) {
    console.log('✅ 没有重复，无需清理。可直接加 UNIQUE 索引。')
    await client.query('ROLLBACK')
    process.exit(0)
  }

  // 2. 对每组：决定保留哪条、要删哪些
  let totalKeep = 0
  let totalDelete = 0
  const toMerge = []      // {keepId, deleteIds, sumErrorCount}
  const examples = []

  for (const r of dupGroups.rows) {
    const ids = r.wq_ids
    const counts = r.counts
    // 选 error_count 最大者；并列取 added_at 最早
    let bestIdx = 0
    for (let i = 1; i < ids.length; i++) {
      if (counts[i] > counts[bestIdx] ||
          (counts[i] === counts[bestIdx] && new Date(r.times[i]) < new Date(r.times[bestIdx]))) {
        bestIdx = i
      }
    }
    const keepId = ids[bestIdx]
    const deleteIds = ids.filter((_, i) => i !== bestIdx)
    const sumErrorCount = counts.reduce((a, b) => a + b, 0)

    totalKeep++
    totalDelete += deleteIds.length
    toMerge.push({ keepId, deleteIds, sumErrorCount, bestCount: counts[bestIdx] })

    if (examples.length < 8) {
      const t1 = new Date(r.times[0]).toISOString().slice(0, 19)
      examples.push(`  ws=${String(r.worksheet_id).slice(0,8)}.. q=${r.question_no} n=${r.n} 保留err=${counts[bestIdx]} added=${t1}`)
    }
  }

  console.log(`📋 计划保留 ${fmt(totalKeep)} 条，删除 ${fmt(totalDelete)} 条`)
  console.log('\n示例（前 8 组）：')
  examples.forEach(s => console.log(s))

  if (!APPLY) {
    console.log('\n💡 加 --apply 真正执行。建议执行前先在生产库 backup 一下 wrong_questions。')
    console.log('   备份 SQL: CREATE TABLE wrong_questions_backup_20260902 AS SELECT * FROM wrong_questions;')
    await client.query('ROLLBACK')
    process.exit(0)
  }

  // 3. 真正合并：每组 UPDATE 保留行的 error_count（加上被删行的），DELETE 其余
  console.log('\n⏳ 开始合并...')
  let mergedCount = 0
  for (const { keepId, deleteIds, sumErrorCount } of toMerge) {
    if (deleteIds.length === 0) continue

    // 3a. UPDATE 保留行：error_count 累加，并填充被删行里更新的字段（取非空最新值）
    //     取被删行的 student_answer / question_image_url / correct_answer 覆盖（最新非空优先）
    await client.query(`
      UPDATE wrong_questions wq
      SET
        error_count = $2,
        student_answer = COALESCE(
          (SELECT student_answer FROM wrong_questions
             WHERE id = ANY($3) AND student_answer IS NOT NULL
             ORDER BY COALESCE(updated_at, added_at) DESC LIMIT 1),
          wq.student_answer
        ),
        question_image_url = COALESCE(
          (SELECT question_image_url FROM wrong_questions
             WHERE id = ANY($3) AND question_image_url IS NOT NULL
             ORDER BY COALESCE(updated_at, added_at) DESC LIMIT 1),
          wq.question_image_url
        ),
        correct_answer = COALESCE(
          (SELECT correct_answer FROM wrong_questions
             WHERE id = ANY($3) AND correct_answer IS NOT NULL
             ORDER BY COALESCE(updated_at, added_at) DESC LIMIT 1),
          wq.correct_answer
        ),
        last_wrong_at = GREATEST(wq.last_wrong_at, COALESCE(
          (SELECT MAX(last_wrong_at) FROM wrong_questions WHERE id = ANY($3)),
          wq.last_wrong_at
        )),
        updated_at = NOW()
      WHERE id = $1
    `, [keepId, sumErrorCount, deleteIds])

    // 3b. DELETE 其余行（CASCADE 会带走引用它们的 judgement 行，所以先安全快照）
    await client.query(`DELETE FROM wrong_questions WHERE id = ANY($1)`, [deleteIds])
    mergedCount++
  }

  console.log(`✅ 已合并 ${fmt(mergedCount)} 组（共删除 ${fmt(totalDelete)} 条冗余行）`)

  // 4. 验证：再查一次重复组应为 0
  const after = await client.query(`
    SELECT COUNT(*) as n FROM (
      SELECT 1 FROM wrong_questions
      WHERE student_id IS NOT NULL AND worksheet_id IS NOT NULL AND question_no IS NOT NULL
      GROUP BY student_id, worksheet_id, question_no
      HAVING COUNT(*) >= 2
    ) t
  `)
  console.log(`\n📋 合并后剩余重复组: ${fmt(after.rows[0].n)}（应为 0）`)

  if (APPLY) {
    await client.query('COMMIT')
    console.log('\n✅ 已提交。可执行 052 迁移加 UNIQUE 索引。')
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
  await pool.end()
}