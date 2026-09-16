/**
 * 按答案库重新对齐某个 workbook 任务的「参考答案」——不重跑 OCR、不删题
 *
 * 使用场景（2026-09-15）：
 *   答案库本身被修好了（27.2(3) 单元重建、27.2(2) 被覆盖的答案补回），
 *   但已入库的 questions.answer 还是旧的错值。此时**不该重跑**：
 *   重跑会 deleteQuestionsByTaskId 删题重建 —— 既可能因 OCR 波动丢题
 *   （实测 13 题 → 7 题），又会抹掉老师的 review_status。
 *
 * 本脚本只做两件事：
 *   1. 按该任务**已锚定的单元**（result.sectionMatch.pages[].matched_unit）
 *      从 resource_answers 取回正确答案，写回 questions.answer；
 *   2. 对**老师没有复核结论**的行（review_status IS NULL），用 judgeAnswer 重算 is_correct。
 *      老师已复核的行一律不动 —— 人工结论优先。
 *
 * 用法：
 *   node server/scripts/realign-task-answers-from-bank.mjs --task=da0b3d35
 *   node server/scripts/realign-task-answers-from-bank.mjs --task=da0b3d35 --apply
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import { judgeAnswer } from '../services/judgeService.js'

const arg = (n) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(`--${n}=`.length) || null
const APPLY = process.argv.includes('--apply')
const TASK = arg('task')
const FORCE_UNIT = arg('unit')
if (!TASK) { console.error('❌ 需要 --task=<前缀> [--unit=<unit_key>]'); process.exit(1) }

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await pool.query(s, p)).rows

const tasks = await q(`SELECT id, worksheet_id, result FROM tasks WHERE id::text LIKE $1`, [TASK + '%'])
if (tasks.length !== 1) { console.error(`❌ 前缀 ${TASK} 匹配 ${tasks.length} 条`); process.exit(1) }
const task = tasks[0]
if (!task.worksheet_id) { console.error('❌ 该任务没有 worksheet_id'); process.exit(1) }

// 页号 → 该页锚定的单元
const pageUnit = new Map()
for (const p of (task.result?.sectionMatch?.pages || [])) {
  if (p.page_number != null && p.matched_unit) pageUnit.set(Number(p.page_number), p.matched_unit)
}
console.log('\n该任务的页级锚定：')
for (const [pg, u] of pageUnit) console.log(`  第 ${pg} 页 → ${u}`)
// 兜底单元：显式指定优先；否则当所有页都锚到同一个单元时用它。
// （回滚脚本只恢复 questions/wrong/judgements，不动 tasks.result，
//   所以 result 里可能残留“上次重跑”的不完整页级锚定，导致部分题找不到单元。）
const uniqUnits = new Set(pageUnit.values())
const defaultUnit = FORCE_UNIT || (uniqUnits.size === 1 ? [...uniqUnits][0] : null)
if (defaultUnit) console.log(`  兜底单元：${defaultUnit}${FORCE_UNIT ? '（人工指定）' : '（全卷唯一单元）'}`)
if (!pageUnit.size && !defaultUnit) { console.error('❌ 没有可用的单元信息，请用 --unit= 指定'); await pool.end(); process.exit(1) }

// 构建 unit_key → 'qno|sub' → answer
const rows = await q(`
  SELECT ru.unit_key, ra.question_no, ra.sub_no, ra.answer
  FROM resource_answers ra JOIN resource_units ru ON ru.id = ra.unit_id
  WHERE ra.resource_id = $1::uuid`, [task.worksheet_id])
const bank = new Map()
for (const r of rows) {
  const key = `${Number(r.question_no)}|${(r.sub_no ?? '').toString().trim()}`
  if (!bank.has(r.unit_key)) bank.set(r.unit_key, new Map())
  bank.get(r.unit_key).set(key, r.answer)
}
console.log(`\n答案库已加载 ${rows.length} 条，覆盖 ${bank.size} 个单元`)

const questions = await q(
  `SELECT id, question_number, sub_no, page_number, question_type, student_answer, answer, is_correct, review_status
   FROM questions WHERE task_id=$1 ORDER BY question_number::int, sub_no NULLS FIRST`, [task.id])

console.log('\n===== 逐题对齐 =====')
const changes = []
for (const qq of questions) {
  const unit = pageUnit.get(Number(qq.page_number)) || defaultUnit
  if (!unit) { console.log(`  题${qq.question_number} 无页级单元，跳过`); continue }
  const unitMap = bank.get(unit)
  if (!unitMap) { console.log(`  题${qq.question_number} 单元 ${unit} 不在答案库里，跳过`); continue }
  const key = `${Number(qq.question_number)}|${(qq.sub_no ?? '').toString().trim()}`
  let next = unitMap.get(key)
  if (next == null && qq.sub_no) {
    // 题是小问、库里只按整题存 → 用整题答案（整题答案本就含各小问）—— 合理反向兜底。
    next = unitMap.get(`${Number(qq.question_number)}|`)
  }
  // ⚠️ 禁止反向兜底：题是整题、库里只有小问行时**不得**拿某一条小问答案顶上。
  //    实测（2026-09-15 da0b3d35 题4）：卷面题 4 被 OCR 拆成两条 sub_no=null 的记录
  //    （分别对应原卷 (1)(2)），库里则是 4(1)/4(2) 两条小问行；
  //    若拿 4(1) 的答案去顶第一条整题行，第二条整题行会被改成 (1) 的答案 —— 张冠李戴。
  if (next == null) { console.log(`  题${qq.question_number}(${qq.sub_no ?? '整题'}) 库中无对应答案，跳过`); continue }

  const oldAnswer = qq.answer
  const answerChanged = String(oldAnswer ?? '') !== String(next)
  // 老师已复核的行一律不动判定；未复核的行按新答案重算
  let nextCorrect = qq.is_correct
  let correctChanged = false
  if (qq.review_status == null && qq.student_answer) {
    try {
      const j = judgeAnswer(qq.student_answer, next, qq.question_type)
      nextCorrect = j?.isCorrect ?? null
      correctChanged = nextCorrect !== qq.is_correct
    } catch { /* 判等异常保持原判定 */ }
  }
  if (!answerChanged && !correctChanged) continue

  changes.push({ id: qq.id, no: qq.question_number, sub: qq.sub_no, unit, oldAnswer, next, oldCorrect: qq.is_correct, nextCorrect, studentBlank: !(qq.student_answer && String(qq.student_answer).trim()) })
  const flag = answerChanged ? '答案' : ''
  const flag2 = correctChanged ? '判定' : ''
  console.log(`  题${qq.question_number}(${qq.sub_no ?? '整题'}) [${unit}] 改${flag}${flag2}`)
  if (answerChanged) console.log(`     答案: ${String(oldAnswer ?? '').slice(0, 40)} → ${String(next).slice(0, 40)}`)
  if (correctChanged) console.log(`     判定: ${qq.is_correct} → ${nextCorrect}`)
}

console.log(`\n共 ${changes.length} 处变化`)

if (!APPLY) { console.log('\n-- dry-run：确认无误后加 --apply 执行。'); await pool.end(); process.exit(0) }
if (!changes.length) { console.log('无变化'); await pool.end(); process.exit(0) }

const c = await pool.connect()
try {
  await c.query('BEGIN')
  for (const ch of changes) {
    // answer_source 语义必须保留：`blank` 表示"学生未作答"，是分桶统计（emptyCount）
    // 与错题本判定的输入之一。无脑写 'worksheet' 会把"未作答"洗成"已作答"，
    // 于是 computeTaskStats 把它从 empty 桶挪进 pending 桶（实测 2026-09-16
    // 三份卷的 emptyCount 2/2/3 被洗成 0/0/0，界面「作答 N」凭空消失）。
    await c.query(
      `UPDATE questions SET answer=$1, is_correct=$2,
         answer_source = CASE WHEN $4 THEN 'blank' ELSE 'worksheet' END,
         updated_at=NOW() WHERE id=$3`,
      [ch.next, ch.nextCorrect, ch.id, ch.studentBlank])
  }
  await c.query('COMMIT')
  console.log(`\n✅ 已更新 ${changes.length} 行（未触碰老师已复核行的判定；未作答行的 answer_source 保持 blank）`)
} catch (e) {
  await c.query('ROLLBACK')
  console.error('❌ 失败已回滚:', e.message)
} finally { c.release() }

await pool.end()
