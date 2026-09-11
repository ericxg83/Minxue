/**
 * 「已判错但没入错题本」历史漏网 backfill
 *
 * 背景（2026-09-11 复核页「让加入又说已在」事故沉淀）：
 *   AI 判错的题绝大多数会自动入错题本，但实测有一小撮「已判错 + 参考答案已就绪」却不在册，成因：
 *     ① 答案是异步补齐的：OCR 先判题、答案后到；判错那一刻 answer 为空被入册过滤挡掉，
 *        等答案补齐时结算已幂等跳过（settlement_key），无人再补一次；
 *     ② 结算（finalizeGradingBatch）是 fire-and-forget，入册那一步抛错会连带中断，且无重试。
 *   写入侧的防新增由 services/wrongBookCompensation.js 接入结算负责（self-healing）；
 *   本脚本负责把存量一次性补上。
 *
 * 入册条件（全部满足才补，口径与线上入册完全一致）：
 *   1. is_correct = false（AI 明确判错）或 answer_source = 'blank'（学生未作答，等同"不会"）
 *   2. answer 非空且非占位（'待人工补充' / '此为主观题，无唯一标准答案'）
 *   3. **无终态复核结论**：review_status 为空，或为 'wrong'
 *      （correct / exclude / wrong_no_book 是老师已拍板的口径，绝不能被自动补入拉回错题本）
 *   4. 题目与所属 task 均未软删（deleted_at IS NULL）
 *   5. wrong_questions 中不存在（普通题按 question_id；练习册题按 worksheet_id + question_no）
 *   6. 置信度 ≥ CONFIDENCE_THRESHOLD（默认 0.8）——**不跳过置信度闸**：
 *      低置信题由老师在复核页拍板，不自动入册（与「低置信度不该入」的产品口径一致）
 *
 * 说明：练习册（answer_source='worksheet'）错题走自包含定位键 (worksheet_id, question_no)，
 *   与普通错题的 question_id 模型不同（见 AGENTS.md 第 4/6 条）。本脚本只列清单不自动写，
 *   避免用错模型生成重复行；实测当前练习册漏网为 0 条。
 *
 * 用法：
 *   node scripts/backfill-missed-wrong-questions.mjs                # 默认 dry-run，只列清单
 *   node scripts/backfill-missed-wrong-questions.mjs --apply        # 真正补入
 *   node scripts/backfill-missed-wrong-questions.mjs --student=<id> # 只处理某个学生
 *
 * ⚠️ 生产库执行前必须先 dry-run 核对清单规模与内容。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { query } from '../config/neon.js'
import { addWrongQuestions } from '../services/neonService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '..', '.env') })

const APPLY = process.argv.includes('--apply')
const STUDENT_FILTER = (process.argv.find(a => a.startsWith('--student=')) || '').split('=')[1] || null

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.8

const findCandidates = async () => {
  const params = []
  const extra = []
  if (STUDENT_FILTER) {
    params.push(STUDENT_FILTER)
    extra.push(`AND q.student_id = $${params.length}`)
  }
  const { rows } = await query(
    `SELECT q.id, q.student_id, s.name AS student_name, q.question_number,
            q.confidence, q.content, q.options, q.answer, q.question_type,
            q.geometry_image_url, q.answer_source, q.is_correct, q.review_status,
            t.worksheet_id, t.task_type
       FROM questions q
       LEFT JOIN students s ON s.id = q.student_id
       LEFT JOIN tasks t ON t.id = q.task_id
      WHERE (q.is_correct = false OR q.answer_source = 'blank')
        AND q.deleted_at IS NULL
        AND q.answer IS NOT NULL AND btrim(q.answer) <> ''
        AND q.answer NOT IN ('待人工补充', '此为主观题，无唯一标准答案')
        AND (q.review_status IS NULL OR q.review_status = 'wrong')
        AND (t.id IS NULL OR t.deleted_at IS NULL)
        ${extra.join('\n        ')}
        AND NOT EXISTS (
          SELECT 1 FROM wrong_questions w
           WHERE w.student_id = q.student_id
             AND (
               w.question_id = q.id
               OR (t.worksheet_id IS NOT NULL AND w.worksheet_id = t.worksheet_id AND w.question_no = q.question_number)
             )
        )
      ORDER BY s.name NULLS LAST, q.created_at`,
    params
  )
  return rows
}

const groupByStudent = (rows) => {
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.student_id)) map.set(r.student_id, { name: r.student_name || '(未知)', rows: [] })
    map.get(r.student_id).rows.push(r)
  }
  return map
}

const run = async () => {
  console.log(`\n[backfill-missed-wrong-questions] ${APPLY ? '★ APPLY 模式（会写库）' : 'DRY-RUN 模式（只读）'}`)
  console.log(`  置信度阈值: ${CONFIDENCE_THRESHOLD}（低置信题不补，留老师复核）`)
  if (STUDENT_FILTER) console.log(`  限定学生: ${STUDENT_FILTER}`)

  const candidates = await findCandidates()
  const general = candidates.filter(r => r.answer_source !== 'worksheet')
  const worksheet = candidates.filter(r => r.answer_source === 'worksheet')

  const byStudent = groupByStudent(general)
  console.log(`\n  候选合计 ${candidates.length} 条（普通题 ${general.length} / 练习册题 ${worksheet.length}），涉及 ${byStudent.size} 名学生\n`)

  let totalAdded = 0
  let totalSkipped = 0
  let totalFailed = 0

  for (const [studentId, { name, rows }] of byStudent) {
    console.log(`  ${name} (${studentId.slice(0, 8)}): ${rows.length} 条`)
    for (const q of rows) {
      console.log(`    - q${q.question_number ?? '-'} ${q.id.slice(0, 8)} src=${q.answer_source} conf=${q.confidence} ans="${String(q.answer).slice(0, 20)}"`)
    }
    if (!APPLY) continue

    // 复用入册口径：questionMap 带上 answer_source/options/geometry_image_url，
    // addWrongQuestions 内部会走置信度闸 + 完整性闸 + 空答语义 + UNIQUE 去重。
    const questionMap = new Map(rows.map(q => [q.id, q]))
    const confidenceMap = new Map(rows.map(q => [q.id, q.confidence]))
    try {
      const added = await addWrongQuestions(studentId, rows.map(q => q.id), confidenceMap, questionMap)
      totalAdded += added.length
      totalSkipped += rows.length - added.length
      console.log(`    ✓ 入册 ${added.length}/${rows.length}`)
    } catch (e) {
      totalFailed += 1
      console.error(`    ✗ ${name} 入册失败: ${e.message}`)
    }
  }

  if (worksheet.length > 0) {
    console.log(`\n  ⚠️ 练习册错题 ${worksheet.length} 条（不在自动补入范围，需按自包含模型处理）：`)
    for (const q of worksheet.slice(0, 20)) {
      console.log(`    - ws=${String(q.worksheet_id).slice(0, 8)} q${q.question_number} ${q.id.slice(0, 8)}`)
    }
    if (worksheet.length > 20) console.log(`    … 其余 ${worksheet.length - 20} 条略`)
  }

  console.log('\n[汇总]')
  console.log(`  候选（普通题）: ${general.length}`)
  console.log(`  实际入册    : ${totalAdded}`)
  if (totalSkipped) console.log(`  跳过(置信度<${CONFIDENCE_THRESHOLD}/完整性): ${totalSkipped}`)
  if (totalFailed) console.log(`  失败: ${totalFailed}`)
  if (!APPLY) console.log(`\n  Dry-run，未写库。确认清单无误后加 --apply 执行。`)
}

run()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('[backfill-missed-wrong-questions] 失败:', e)
    process.exit(1)
  })
