/**
 * 存量回填：把「被门禁自动记 wrong_no_book 卡住」的错题补进错题本
 *
 * 背景（2026-09-24「补全即补入」交接）：
 *   P2 门禁分层把系统侧缺项（缺图/缺选项/缺答案/题型非法）的错题自动记成
 *   review_status='wrong_no_book' 换取不拦卷；而 wrong_no_book 在
 *   src/utils/reviewDecision.js 里是终态，且当时没有「补全后自动补入」机制
 *   ⇒ 老师补完元素也永远进不了错题本。机制已由
 *   server/services/wrongGateRequeue.js 修好（PUT 时自动补入）；
 *   本脚本负责把机制上线**之前**已经卡住的存量题一次性补上。
 *
 * 候选口径（全部满足才补）：
 *   1. q.review_status = 'wrong_no_book' 且近 N 天（默认 14）更新过、未软删
 *   2. 最新一条 judgement 的 metadata.skipReason = 'recognition_error'
 *      —— ⚠️ 存量记录没有 gateAuto 标记（该标记 2026-09-24 才引入），
 *         只能退化为「只看 skipReason」。而手动弹窗的「不加入原因」下拉里
 *         也有 recognition_error，**所以脚本把 judgement 证据一并打印，
 *         必须人工核对**；加 --strict 可只处理带 gateAuto 标记的新记录。
 *   3. 现算 checkQuestionCompleteness().isComplete（JS 侧，与入册闸同源）
 *   4. 不在 wrong_questions
 *   5. is_correct = false 或 answer_source = 'blank'
 *
 * 入册一律复用 addWrongQuestions（置信度闸 + 完整性闸 + ON CONFLICT 幂等），
 * **不跳过置信度闸**：低置信题（conf < CONFIDENCE_THRESHOLD）按产品口径留老师拍板，
 * 脚本单列出来而不是硬塞。
 *
 * 用法：
 *   node scripts/backfill-gate-wrong-book.mjs                  # 默认 dry-run，只列清单
 *   node scripts/backfill-gate-wrong-book.mjs --apply          # 真正补入
 *   node scripts/backfill-gate-wrong-book.mjs --student=<id>   # 只处理某个学生
 *   node scripts/backfill-gate-wrong-book.mjs --days=30        # 放宽时间窗（默认 14）
 *   node scripts/backfill-gate-wrong-book.mjs --strict         # 只处理带 gateAuto 标记的
 *
 * ⚠️ 生产库执行前必须先 dry-run 核对清单规模与内容。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { query } from '../config/neon.js'
import {
  decideGateRequeue,
  isAutoGateSkip,
  isJudgedWrongForWrongBook,
  GATE_REQUEUE_CODES
} from '../utils/wrongGateRequeue.js'
import { requeueGateSkippedQuestion } from '../services/wrongGateRequeue.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '..', '.env') })

const APPLY = process.argv.includes('--apply')
const STRICT = process.argv.includes('--strict')
const STUDENT_FILTER = (process.argv.find(a => a.startsWith('--student=')) || '').split('=')[1] || null
const DAYS = Number((process.argv.find(a => a.startsWith('--days=')) || '').split('=')[1]) || 14
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.8

const CODE_LABEL = {
  [GATE_REQUEUE_CODES.OK]: '可补入',
  [GATE_REQUEUE_CODES.MANUAL_SKIP]: '手动否决（不补）',
  [GATE_REQUEUE_CODES.NOT_JUDGED_WRONG]: '最新判定为正确（不补）',
  [GATE_REQUEUE_CODES.ALREADY_IN_BOOK]: '已在错题本',
  [GATE_REQUEUE_CODES.INCOMPLETE]: '元素仍不完整（不补）',
  [GATE_REQUEUE_CODES.NOT_WRONG_NO_BOOK]: '非 wrong_no_book',
  [GATE_REQUEUE_CODES.NO_QUESTION]: '题目缺失'
}

/**
 * 拉全部 wrong_no_book（含「手动否决」与「已判对」），分类交给 JS，
 * 这样每一类都能打印出来给负责人看 —— 只按 is_correct=false 过滤会把
 * 「已判对却被标 wrong_no_book」的题（本次 #5）静默吞掉。
 */
const findCandidates = async () => {
  const params = [String(DAYS)]
  const extra = []
  if (STUDENT_FILTER) {
    params.push(STUDENT_FILTER)
    extra.push(`AND q.student_id = $${params.length}`)
  }
  const { rows } = await query(
    `SELECT q.id, q.student_id, s.name AS student_name, q.task_id, q.question_number,
            q.question_type, q.options, q.answer, q.geometry_image_url, q.content,
            q.parent_stem, q.answer_source, q.is_correct, q.confidence, q.review_status,
            q.answer_exception, q.answer_exception_reason, q.updated_at,
            t.deleted_at AS task_deleted_at,
            j.metadata->>'skipReason' AS skip_reason,
            j.metadata->>'gateAuto'   AS gate_auto,
            j.metadata->>'oldReviewStatus' AS j_old_review_status,
            j.source AS j_source,
            j.created_at AS j_at,
            EXISTS (SELECT 1 FROM wrong_questions w WHERE w.question_id = q.id) AS in_book
       FROM questions q
       LEFT JOIN students s ON s.id = q.student_id
       LEFT JOIN tasks t ON t.id = q.task_id
       LEFT JOIN LATERAL (
          SELECT metadata, source, created_at FROM judgements jj
           WHERE jj.question_id = q.id::text
           ORDER BY jj.created_at DESC LIMIT 1
       ) j ON TRUE
      WHERE q.review_status = 'wrong_no_book'
        AND q.deleted_at IS NULL
        AND q.updated_at >= now() - ($1 || ' days')::interval
        ${extra.join('\n        ')}
      ORDER BY s.name NULLS LAST, q.updated_at DESC`,
    params
  )
  return rows
}

const short = (v, n = 26) => String(v ?? '').slice(0, n)

const run = async () => {
  console.log(`\n[backfill-gate-wrong-book] ${APPLY ? '★ APPLY 模式（会写库）' : 'DRY-RUN 模式（只读）'}`)
  console.log(`  时间窗: 近 ${DAYS} 天 | 置信度阈值: ${CONFIDENCE_THRESHOLD}（低置信不补，留老师拍板）`)
  console.log(`  skip 判据: ${STRICT ? '严格（必须带 gateAuto 标记）' : '存量兼容（只看 skipReason=recognition_error，需人工核对证据）'}`)
  if (STUDENT_FILTER) console.log(`  限定学生: ${STUDENT_FILTER}`)

  const rows = await findCandidates()
  console.log(`\n  wrong_no_book 存量: ${rows.length} 条\n`)

  const buckets = { add: [], lowConf: [], notWrong: [], manual: [], other: [] }
  for (const q of rows) {
    const skipMeta = { skipReason: q.skip_reason ?? null, gateAuto: q.gate_auto === 'true' }
    const decision = decideGateRequeue({
      question: q,
      skipMeta,
      inWrongBook: q.in_book === true,
      allowLegacySkip: !STRICT
    })
    const conf = q.confidence === null ? null : Number(q.confidence)
    const item = { q, decision, conf, confBlocked: conf !== null && conf < CONFIDENCE_THRESHOLD }

    // 分类顺序即判据优先级：先分「是否自动放行」（红线），再分「是否仍判错」，
    // 最后才是完整性 / 置信度。顺序错了会把「手动否决」混进「可补入」。
    if (!isAutoGateSkip(skipMeta, { allowLegacy: !STRICT })) buckets.manual.push(item)
    else if (!isJudgedWrongForWrongBook(q)) buckets.notWrong.push(item)
    else if (!decision.requeue) buckets.other.push(item)
    else if (item.confBlocked) buckets.lowConf.push(item)
    else buckets.add.push(item)
  }

  const line = (q) =>
    `${q.id} ${q.student_name || ''} 第${q.question_number ?? '-'}题 type=${q.question_type} `
    + `conf=${q.confidence ?? 'null'} is_correct=${q.is_correct} answer="${short(q.answer, 20)}"`

  console.log('  ── ① 可补入（判据通过 + 置信度达标）─────────────────────')
  if (buckets.add.length === 0) console.log('    （无）')
  for (const { q } of buckets.add) console.log(`    ✓ ${line(q)}`)

  console.log('\n  ── ② 判据通过但被置信度闸挡下（低置信，按口径留老师拍板）──')
  if (buckets.lowConf.length === 0) console.log('    （无）')
  for (const { q } of buckets.lowConf) {
    console.log(`    ⚠ ${line(q)}`)
    console.log(`        answer_exception=${q.answer_exception} reason="${short(q.answer_exception_reason, 34)}"`)
    console.log('        → conf=0 多来自 answer_exception（系统侧「答案不可用/不匹配」），'
      + '不是「AI 判了但不确定」；建议先核/补参考答案，再决定是否手动标错强入')
  }

  console.log('\n  ── ③ 曾被自动放行但最新判定已非「错」（疑似误标，勿盲目补入）──')
  if (buckets.notWrong.length === 0) console.log('    （无）')
  for (const { q, decision } of buckets.notWrong) {
    console.log(`    ✗ ${line(q)} → ${CODE_LABEL[decision.code] || decision.code}`)
    console.log(`        judgement: source=${q.j_source} oldReviewStatus=${q.j_old_review_status} `
      + `skipReason=${q.skip_reason} gateAuto=${q.gate_auto} @${q.j_at ? new Date(q.j_at).toISOString().slice(0, 16) : '-'}`)
  }

  console.log('\n  ── ④ 老师手动「本次不加入」（红线：绝不自动拉回）──────────')
  if (buckets.manual.length === 0) console.log('    （无）')
  for (const { q } of buckets.manual) {
    console.log(`    ⊘ ${line(q)}`)
    console.log(`        judgement: source=${q.j_source} oldReviewStatus=${q.j_old_review_status} `
      + `skipReason=${q.skip_reason} gateAuto=${q.gate_auto} @${q.j_at ? new Date(q.j_at).toISOString().slice(0, 16) : '-'}`)
  }

  console.log('\n  ── ⑤ 其他判据不通过 ─────────────────────────────────')
  if (buckets.other.length === 0) console.log('    （无）')
  for (const { q, decision } of buckets.other) {
    console.log(`    ✗ ${line(q)} → ${CODE_LABEL[decision.code] || decision.code}`
      + (decision.issues?.length ? ` [${decision.issues.join('、')}]` : ''))
  }

  if (!STRICT) {
    console.log('\n  ⚠️ 存量兼容模式：2026-09-24 之前的记录没有 gateAuto 标记，判据退化为'
      + '「只看 skipReason=recognition_error」。')
    console.log('     手动弹窗的「不加入原因」下拉里也有这个码 —— 请对照 ③④ 的 judgement 证据人工确认：')
    console.log('     自动放行的特征是 oldReviewStatus=null（该题此前从未复核过）、与批改完成时间同批。')
  }

  let added = 0
  let failed = 0
  if (APPLY) {
    console.log('\n  ── 执行补入 ────────────────────────────────────────')
    if (buckets.add.length === 0) console.log('    没有可补入的题。')
    for (const { q } of buckets.add) {
      try {
        const res = await requeueGateSkippedQuestion({
          question: q,
          allowLegacySkip: !STRICT,
          logTag: 'backfill-gate-wrong-book'
        })
        if (res.status === 'added') {
          added += 1
          console.log(`    ✓ 已入册 ${q.id.slice(0, 8)} ${q.student_name || ''} 第${q.question_number ?? '-'}题`)
        } else if (res.status === 'already_exists') {
          console.log(`    = 已在册 ${q.id.slice(0, 8)}`)
        } else {
          console.log(`    ⚠ 未入册 ${q.id.slice(0, 8)} → ${res.code}：${res.message}`)
        }
      } catch (e) {
        failed += 1
        console.error(`    ✗ ${q.id.slice(0, 8)} 入册失败: ${e.message}`)
      }
    }
  }

  console.log('\n[汇总]')
  console.log(`  wrong_no_book 存量: ${rows.length}`)
  console.log(`  ① 可补入          : ${buckets.add.length}`)
  console.log(`  ② 低置信待拍板    : ${buckets.lowConf.length}`)
  console.log(`  ③ 疑似误标（已判对）: ${buckets.notWrong.length}`)
  console.log(`  ④ 手动否决（红线）: ${buckets.manual.length}`)
  console.log(`  ⑤ 其他不通过      : ${buckets.other.length}`)
  if (APPLY) {
    console.log(`  实际入册          : ${added}`)
    if (failed) console.log(`  失败              : ${failed}`)
  } else {
    console.log('\n  Dry-run，未写库。确认清单无误后加 --apply 执行。')
  }
}

run()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('[backfill-gate-wrong-book] 失败:', e)
    process.exit(1)
  })
