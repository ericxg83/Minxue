/**
 * 清理「从未做错过」的错题行（`error_count = 0`）—— dry-run 默认，`--apply` 才真删
 *
 * 背景（2026-10-15，负责人转述学生反馈「错题里记录的错题，我没有错过」）：
 *   `finalizeGeneratedExamResults` 旧版本在「错题行不存在」时无条件 INSERT，且
 *   `errorCount = isCorrect ? 0 : 1`。于是学生**答对**的题被凭空记成一条
 *   `error_count = 0` 的错题。真实事故链：老师复核重练卷判「对」→
 *   `finalizeRejudgeResult` 删掉整行 → 11 秒后结算按卷面题单逐题跑，发现行没了
 *   → 重新 INSERT，error_count = 0。全库实测 47 条。
 *   代码侧已修（`services/retrySettlementDecision.js` 的「答对 + 不在册 ⇒ skip」守卫，
 *   锁 `test/retrySettlementEnrollGuard.test.mjs`）；本脚本处理存量。
 *
 * 判定（干净可解释，两条同时成立）：
 *   ① `error_count = 0` —— 从未记录过任何一次做错（`error_count` 只在真做错时才 +1；
 *      全库只有旧结算的 INSERT 分支能写出 0，其余四条入册路径都写死 1）；
 *   ② 该题**最近一条 judgement 不是「判错」** —— 按项目既有存量收口口径
 *      「以最近一条 judgement 的结论为准」。若最近一条仍判错，说明「做错过」有据，
 *      一律**保留不动**并单独列出，交人工看（fail-closed，不猜）。
 *
 * 删除的只是 wrong_questions 行（学生错题记录）；不动 questions 表、不动 judgements 审计。
 * 删除前先把命中的行整表备份到 `wrong_questions_backup_zeroerr_<YYYYMMDD>`。
 *
 * 用法：
 *   node scripts/cleanup-zero-error-wrong-questions.mjs              # dry-run
 *   node scripts/cleanup-zero-error-wrong-questions.mjs --apply      # 备份后真删
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const APPLY = process.argv.includes('--apply')
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const BACKUP_TABLE = `wrong_questions_backup_zeroerr_${STAMP}`

console.log(`🔧 ${APPLY ? 'APPLY 模式（备份后真删）' : 'DRY-RUN 模式（不删）'}\n`)

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const fmt = (n) => String(n).padStart(5, ' ')

const client = await pool.connect()
try {
  // ── 1. 候选：error_count = 0 的错题行 + 其最近一条 judgement 结论 ──────────
  const { rows: candidates } = await client.query(`
    SELECT wq.id, wq.student_id, s.name AS student_name,
           wq.question_id, wq.lifecycle_status, wq.status, wq.added_at,
           wq.practice_count, wq.last_wrong_at,
           q.is_correct, q.review_status, q.question_number,
           t.original_name AS task_name,
           lj.is_correct AS last_judge_is_correct,
           lj.source     AS last_judge_source,
           lj.created_at AS last_judge_at
      FROM wrong_questions wq
      LEFT JOIN students s ON s.id = wq.student_id
      LEFT JOIN questions q ON q.id = wq.question_id
      LEFT JOIN tasks t ON t.id = q.task_id
      LEFT JOIN LATERAL (
        SELECT j.is_correct, j.source, j.created_at
          FROM judgements j
         WHERE j.question_id = wq.question_id::text
         ORDER BY j.created_at DESC
         LIMIT 1
      ) lj ON TRUE
     WHERE wq.error_count = 0
     ORDER BY wq.added_at
  `)

  const deletable = candidates.filter((r) => r.last_judge_is_correct !== false)
  const held = candidates.filter((r) => r.last_judge_is_correct === false)

  console.log(`📊 命中 error_count = 0 的错题行：${candidates.length} 条`)
  console.log(`   ├─ 可清理（最近一条 judgement 不是「判错」）：${deletable.length} 条`)
  console.log(`   └─ 保留待人工看（最近一条仍判错）：${held.length} 条\n`)

  if (deletable.length > 0) {
    console.log('── 可清理明细 ──────────────────────────────────────────────')
    for (const [i, r] of deletable.entries()) {
      console.log(
        `${fmt(i + 1)} ${String(r.student_name || '(无学生)').padEnd(5, '　')} `
        + `题${String(r.question_number ?? '-').padStart(3)} `
        + `lc=${String(r.lifecycle_status || '-').padEnd(9)} `
        + `最近判定=${r.last_judge_is_correct === null ? 'NULL' : r.last_judge_is_correct} `
        + `(${r.last_judge_source || '-'} @ ${r.last_judge_at ? r.last_judge_at.toISOString().slice(0, 16) : '-'}) `
        + `入册=${r.added_at ? r.added_at.toISOString().slice(0, 10) : '-'} `
        + `| ${String(r.task_name || '').slice(0, 22)}`
      )
    }
    console.log('')
  }

  if (held.length > 0) {
    console.log('── ⚠️ 保留待人工看（最近一条 judgement 判错，不做删除）────────')
    for (const r of held) {
      console.log(
        `    ${String(r.student_name || '(无学生)').padEnd(5, '　')} `
        + `题${String(r.question_number ?? '-').padStart(3)} `
        + `(${r.last_judge_source || '-'} @ ${r.last_judge_at ? r.last_judge_at.toISOString().slice(0, 16) : '-'}) `
        + `| ${String(r.task_name || '').slice(0, 22)}`
      )
    }
    console.log('')
  }

  if (deletable.length === 0) {
    console.log('✅ 没有需要清理的行，退出。')
    process.exit(0)
  }

  if (!APPLY) {
    console.log(`ℹ️  DRY-RUN：未做任何修改。加 --apply 执行（会先备份到 ${BACKUP_TABLE}）。`)
    process.exit(0)
  }

  // ── 2. 备份 → 删除（同一事务）─────────────────────────────────────────
  const ids = deletable.map((r) => r.id)
  await client.query('BEGIN')
  try {
    await client.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`)
    await client.query(`CREATE TABLE ${BACKUP_TABLE} AS SELECT * FROM wrong_questions WHERE id = ANY($1::uuid[])`, [ids])
    const { rows: bk } = await client.query(`SELECT count(*)::int AS n FROM ${BACKUP_TABLE}`)
    if (bk[0].n !== ids.length) {
      throw new Error(`备份行数不符：备份 ${bk[0].n} 条，预期 ${ids.length} 条`)
    }
    const del = await client.query(`DELETE FROM wrong_questions WHERE id = ANY($1::uuid[])`, [ids])
    if (del.rowCount !== ids.length) {
      throw new Error(`删除行数不符：删了 ${del.rowCount} 条，预期 ${ids.length} 条`)
    }
    await client.query('COMMIT')
    console.log(`✅ 已备份 ${bk[0].n} 条到 ${BACKUP_TABLE}，删除 ${del.rowCount} 条错题行。`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(`❌ 已回滚，未做任何修改：${e.message}`)
    process.exit(1)
  }

  // ── 3. 复验 ────────────────────────────────────────────────────────────
  const { rows: after } = await client.query(`SELECT count(*)::int AS n FROM wrong_questions WHERE error_count = 0`)
  const { rows: total } = await client.query(`SELECT count(*)::int AS n FROM wrong_questions`)
  console.log(`🔍 复验：error_count = 0 剩余 ${after[0].n} 条（应为 0）；错题总行数 ${total[0].n}`)
  if (after[0].n !== 0) {
    console.error('⚠️ 仍有 error_count = 0 的行，请复查（可能本轮被 --apply 之外的因素新增）。')
    process.exit(2)
  }
  console.log('✅ 完成。')
} finally {
  client.release()
  await pool.end()
}
