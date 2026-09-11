/**
 * 低置信度错题入册稽核（audit / cleanup）
 *
 * ⚠️ 口径（2026-09-11 用户确认，勿改）：
 *   「低置信度错题**一定不能**自动进入错题本。」
 *   · AI 判错且 conf < CONFIDENCE_THRESHOLD → 一律不入册，留给老师复核拍板；
 *   · 唯一例外是**老师人工复核**（review_status='wrong'，skipConfidence=true，人工是 ground truth）。
 *   · `answer_source='blank'`（学生未作答）**不受置信度约束**——未作答等同「不会」，
 *     其 confidence 结构性为 0，用阈值卡它会永远入不了册。这类题该入。
 *
 * 历史背景：
 *   本文件前身是 `backfill-lowconf-wrong-questions.mjs`（2026-09-04），
 *   它用 `addWrongQuestions(..., { skipConfidence: true })` 把历史上被置信度闸
 *   挡下的 AI 低置信错题**强灌**进错题本。该行为与现行口径直接冲突，已废弃删除。
 *   本脚本是它的替代品，职责**反转为稽核/清理**，不做任何「强入」。
 *
 * 稽核分类（仅覆盖 `question_id` 定位模型；练习册自包含模型见文末「盲区」）：
 *   · backed —— review_status='wrong'：老师人工标错，合法保留，**不动**；
 *   · leaked —— review_status 为空 + answer_source<>'blank' + conf<阈值：
 *               AI 低置信误入，违反口径，应清理；
 *   · stale  —— review_status ∈ {correct, exclude, wrong_no_book}：
 *               老师已改判为「非错 / 排除 / 不入册」，按 PUT /questions/:id 的语义
 *               本应被 DELETE，却仍残留在册，应清理；
 *   · blank  —— review_status 为空 + answer_source='blank'：未作答，口径内合法保留。
 *
 * 用法：
 *   node scripts/audit-lowconf-wrong-questions.mjs                  # 默认只读报告
 *   node scripts/audit-lowconf-wrong-questions.mjs --student=<uuid> # 限定学生
 *   node scripts/audit-lowconf-wrong-questions.mjs --apply         # 删除 leaked + stale（删前自动备份）
 *   node scripts/audit-lowconf-wrong-questions.mjs --apply --only=leaked
 *
 * 删除前会把整行快照写到 `scripts/logs/lowconf-cleanup-<时间戳>.json`，可据此回滚。
 *
 * ⚠️ 盲区：`wrong_questions` 里 `worksheet_id` 有值但 `question_id` 为空的练习册自包含行
 *    无法评估置信度（该写入路径 addSelfContainedWrongQuestion 本就无闸门）。脚本只统计数量提示。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { Pool } from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '..', '.env') })

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || null
const STUDENT = (process.argv.find(a => a.startsWith('--student=')) || '').split('=')[1] || null
const THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.8

const NON_WRONG_REVIEW_STATUS = ['correct', 'exclude', 'wrong_no_book']

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL })

const classify = (row) => {
  const rs = row.review_status
  if (rs === 'wrong') return 'backed'
  if (NON_WRONG_REVIEW_STATUS.includes(rs)) return 'stale'
  if (rs === null || rs === undefined) {
    // 未作答不受置信度约束：口径内合法保留
    if (row.answer_source === 'blank') return 'blank'
    return 'leaked'
  }
  return 'stale' // 未知取值：归入待清理，报告原样打印 review_status 供人工核对
}

const findLeaks = async () => {
  const params = [THRESHOLD]
  let scope = ''
  if (STUDENT) {
    params.push(STUDENT)
    scope = ` AND wq.student_id = $${params.length}`
  }
  const r = await pool.query(
    `SELECT wq.id AS wq_id, wq.student_id, s.name AS student_name,
            q.id AS question_id, q.question_number, q.confidence, q.answer_source,
            q.review_status, q.is_correct, q.content
       FROM wrong_questions wq
       JOIN questions q ON q.id = wq.question_id
       LEFT JOIN students s ON s.id = wq.student_id
      WHERE q.confidence IS NOT NULL
        AND q.confidence < $1
        AND q.deleted_at IS NULL
        ${scope}
      ORDER BY s.name, wq.created_at`,
    params
  )
  return r.rows.map(row => ({ ...row, kind: classify(row) }))
}

const countBlindSpot = async () => {
  const params = []
  let scope = ''
  if (STUDENT) {
    params.push(STUDENT)
    scope = ` AND student_id = $1`
  }
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM wrong_questions
      WHERE worksheet_id IS NOT NULL AND question_id IS NULL${scope}`,
    params
  )
  return r.rows[0].n
}

const run = async () => {
  const rows = await findLeaks()
  const backed = rows.filter(r => r.kind === 'backed')
  const leaked = rows.filter(r => r.kind === 'leaked')
  const stale = rows.filter(r => r.kind === 'stale')
  const blank = rows.filter(r => r.kind === 'blank')
  const targets = [...leaked, ...stale]

  console.log(`\n[audit-lowconf] ${APPLY ? 'APPLY 模式' : 'DRY-RUN 模式'}  阈值 conf<${THRESHOLD}${STUDENT ? `  学生=${STUDENT.slice(0, 8)}` : ''}`)
  console.log(`  低置信题在册合计: ${rows.length} 条`)
  console.log(`    · backed(老师标错，合法保留):     ${backed.length}`)
  console.log(`    · blank (未作答，口径内合法保留): ${blank.length}`)
  console.log(`    · leaked(AI 低置信误入):          ${leaked.length}`)
  console.log(`    · stale (老师已改非错仍残留):     ${stale.length}`)

  const printGroup = (title, list) => {
    if (!list.length) return
    console.log(`\n  ── ${title} ──`)
    for (const r of list) {
      const name = r.student_name || String(r.student_id).slice(0, 8)
      console.log(`    q${r.question_number ?? '-'} ${String(r.question_id).slice(0, 8)} conf=${r.confidence} src=${r.answer_source} review=${r.review_status === null ? 'null' : r.review_status}  ${name}  ${(r.content || '').slice(0, 22)}…`)
    }
  }
  printGroup('backed（保留）', backed)
  printGroup('blank（保留）', blank)
  printGroup('leaked（待清理）', leaked)
  printGroup('stale（待清理）', stale)

  const blind = await countBlindSpot()
  console.log(`\n  盲区提示：练习册自包含错题（worksheet_id 有值、question_id 为空）共 ${blind} 条，该写入路径无闸门、无法评估置信度，本脚本不动它们。`)

  if (!APPLY) {
    console.log(`\n  Dry-run,未写入。要清理 leaked/stale 请加 --apply（可加 --only=leaked）`)
    return
  }

  if (ONLY && !['leaked', 'stale'].includes(ONLY)) {
    console.error(`  ✗ --only 只接受 leaked | stale`)
    return
  }
  const toDelete = ONLY ? rows.filter(r => r.kind === ONLY) : targets
  if (toDelete.length === 0) {
    console.log(`\n  无可清理项。`)
    return
  }

  const ids = toDelete.map(r => r.wq_id)

  // 删除前：整行快照落盘，便于回滚
  const backup = await pool.query(
    `SELECT * FROM wrong_questions WHERE id = ANY($1::uuid[])`, [ids]
  )
  const logDir = join(__dirname, 'logs')
  mkdirSync(logDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(logDir, `lowconf-cleanup-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify({ deletedAt: new Date().toISOString(), threshold: THRESHOLD, rows: backup.rows }, null, 2), 'utf8')
  console.log(`\n  备份已写入: ${backupPath}（${backup.rows.length} 行）`)

  const del = await pool.query(`DELETE FROM wrong_questions WHERE id = ANY($1::uuid[])`, [ids])
  console.log(`  ✓ 已删除 ${del.rowCount} 条低置信违规入册记录（保留 backed ${backed.length} + blank ${blank.length} 条）`)
}

run()
  .then(async () => { await pool.end(); process.exit(0) })
  .catch(async e => {
    console.error('[audit-lowconf] 失败:', e.message)
    await pool.end().catch(() => {})
    process.exit(1)
  })
