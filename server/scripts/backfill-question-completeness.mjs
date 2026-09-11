/**
 * 按动态口径重算并回填 questions.is_complete
 *
 * 背景（2026-09-11 复核页「⚠ 缺图」误报事故）：
 *   questions.is_complete 是 checkQuestionCompleteness() 的反范式缓存列，建题那一刻
 *   按当时字段算一次就落库。OCR 阶段答案为空 → 落 false；答案解析、题型、选项、配图
 *   后续被异步补齐时无人回写，列值长期偏旧。而 GET 错题列表 / 周报 / 讲义 / 学情
 *   都按 `q.is_complete = TRUE` 过滤，于是出现「已入册但列表看不见」。
 *   实测：396 条已入册记录隐藏 112 条，其中 102 条字段其实齐全（13 名学生）。
 *
 *   本脚本一次性把全表对齐到动态真值。写入侧的防漂移由
 *   services/questionCompletenessSync.js 负责（已接入批改结算、重判、PC 编辑、
 *   练习册答案同步、入册前自愈）。
 *
 * 判定口径：直接复用 server/utils/questionCompleteness.js，不在脚本里另写一份规则。
 *
 * 用法：
 *   node scripts/backfill-question-completeness.mjs                    # dry-run，只报差异
 *   node scripts/backfill-question-completeness.mjs --apply            # 真正回写
 *   node scripts/backfill-question-completeness.mjs --task=<taskId>    # 只扫某个 task
 *   node scripts/backfill-question-completeness.mjs --since-days=7     # 只扫最近 N 天建的题
 *   node scripts/backfill-question-completeness.mjs --only-wrong-book  # 只扫已入册错题（修复「隐藏」最快）
 *
 * ⚠️ 生产库执行前必须先 dry-run 看差异规模。true→false 会让题重新被错题本挡住，
 *    属于预期行为（老师删了配图/清空了答案），但请确认规模合理再 --apply。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'
import { checkQuestionCompleteness } from '../utils/questionCompleteness.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '..', '.env') })

const argv = process.argv.slice(2)
const has = (flag) => argv.some(a => a === flag || a.startsWith(`${flag}=`))
const valueOf = (flag) => {
  const hit = argv.find(a => a.startsWith(`${flag}=`))
  return hit ? hit.slice(flag.length + 1) : null
}

const APPLY = has('--apply')
const ONLY_WRONG_BOOK = has('--only-wrong-book')
const TASK_ID = valueOf('--task')
const SINCE_DAYS = valueOf('--since-days')
const BATCH = 500

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL })

const buildWhere = (offsetParams) => {
  const conds = ['q.deleted_at IS NULL']
  if (TASK_ID) {
    offsetParams.push(TASK_ID)
    conds.push(`q.task_id = $${offsetParams.length}`)
  }
  if (SINCE_DAYS) {
    offsetParams.push(Number(SINCE_DAYS))
    conds.push(`q.created_at > NOW() - ($${offsetParams.length} || ' days')::interval`)
  }
  if (ONLY_WRONG_BOOK) {
    conds.push(`EXISTS (SELECT 1 FROM wrong_questions wq WHERE wq.question_id = q.id)`)
  }
  return conds.join(' AND ')
}

const countAll = async () => {
  const params = []
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM questions q WHERE ${buildWhere(params)}`,
    params
  )
  return rows[0]?.n ?? 0
}

const fetchBatch = async (lastCreatedAt, lastId) => {
  const params = []
  let paging = ''
  if (lastCreatedAt && lastId) {
    params.push(lastCreatedAt, lastId)
    paging = ` AND (q.created_at, q.id) > ($1, $2)`
  }
  const where = buildWhere(params)
  const { rows } = await pool.query(
    `SELECT q.id, q.created_at, q.is_complete, q.content, q.geometry_image_url,
            q.question_type, q.options, q.answer
     FROM questions q
     WHERE ${where}${paging}
     ORDER BY q.created_at, q.id
     LIMIT ${BATCH}`,
    params
  )
  return rows
}

const applyBatch = async (toTrue, toFalse) => {
  let updated = 0
  if (toTrue.length > 0) {
    const r = await pool.query(
      `UPDATE questions SET is_complete = TRUE, updated_at = NOW()
       WHERE id = ANY($1) AND is_complete IS DISTINCT FROM TRUE`,
      [toTrue]
    )
    updated += r.rowCount || 0
  }
  if (toFalse.length > 0) {
    const r = await pool.query(
      `UPDATE questions SET is_complete = FALSE, updated_at = NOW()
       WHERE id = ANY($1) AND is_complete IS DISTINCT FROM FALSE`,
      [toFalse]
    )
    updated += r.rowCount || 0
  }
  return updated
}

const run = async () => {
  const total = await countAll()
  const scope = [
    TASK_ID ? `task=${TASK_ID}` : null,
    SINCE_DAYS ? `最近 ${SINCE_DAYS} 天` : null,
    ONLY_WRONG_BOOK ? '仅已入册错题' : null
  ].filter(Boolean).join(' / ') || '全表'

  console.log(`\n[backfill-is_complete] ${APPLY ? 'APPLY 模式' : 'DRY-RUN 模式'}`)
  console.log(`  范围: ${scope}`)
  console.log(`  待扫题目: ${total} 道\n`)

  let scanned = 0
  let flipToTrue = 0
  let flipToFalse = 0
  let consistent = 0
  let lastCreatedAt = null
  let lastId = null
  const samplesToTrue = []

  for (;;) {
    const rows = await fetchBatch(lastCreatedAt, lastId)
    if (rows.length === 0) break

    const toTrue = []
    const toFalse = []
    for (const row of rows) {
      const { isComplete } = checkQuestionCompleteness(row)
      const persisted = row.is_complete
      if (isComplete && persisted !== true) {
        toTrue.push(row.id)
        if (samplesToTrue.length < 8) {
          samplesToTrue.push({
            id: row.id.slice(0, 8),
            content: String(row.content || '').replace(/\s+/g, ' ').slice(0, 34)
          })
        }
      } else if (!isComplete && persisted !== false) {
        toFalse.push(row.id)
      } else {
        consistent++
      }
    }

    flipToTrue += toTrue.length
    flipToFalse += toFalse.length
    if (APPLY) await applyBatch(toTrue, toFalse)

    scanned += rows.length
    lastCreatedAt = rows[rows.length - 1].created_at
    lastId = rows[rows.length - 1].id
    if (rows.length < BATCH) break
  }

  console.log('[扫描结果]')
  console.log(`  已扫: ${scanned}`)
  console.log(`  一致（无需改动）: ${consistent}`)
  console.log(`  false → true（解除隐藏，错题本/周报/讲义重新可见）: ${flipToTrue}`)
  console.log(`  true → false（重新挡住，通常是老师删了配图或清空了答案）: ${flipToFalse}`)

  if (samplesToTrue.length > 0) {
    console.log('\n[false→true 样本]')
    console.table(samplesToTrue)
  }

  if (!APPLY) {
    console.log(`\n  Dry-run，未写入。确认规模后加 --apply 真正回写。\n`)
  } else {
    console.log(`\n  已回写 ${flipToTrue + flipToFalse} 题。\n`)
  }

  await pool.end()
}

run().catch(async e => {
  console.error('[backfill-is_complete] 失败:', e)
  await pool.end().catch(() => {})
  process.exit(1)
})
