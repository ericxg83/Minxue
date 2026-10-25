/**
 * 修复「OCR 丢根号参数括号 → 数学等值答案被判错 + 假错入册」的存量（2026-10-25）。
 *
 * 事故（负责人截图 #20，题 eb09599c，task d17eedd8，第 20 题）：
 *   题面：计算 √(0.5y) + (2/y)√(2y³) - y√(72/y)
 *   学生：`解：原式=√(1/2y)+2√2y-√72y =√2y/2 + 2√2y - 6√2y =-7√2y/2`  ← **做对了**
 *   参考：`-7/2√(2y)`（OCR 抄来，answer_source='recognized'）
 *   判定：is_correct = false，**且已入错题本**（假错入册）。
 *
 * ── 根因链 ──
 * ① OCR 把学生手写的 `√(2y)` 识别成 `√2y`（**丢括号**，同一份卷子的另一个实例
 *    7f55ba20 保留了括号 → 判对，可见这是 OCR 的偶发不稳定，不是判题逻辑错）。
 * ② judgeService.convertSqrtToPower 明确按**严格数学语义**读无括号根号：
 *    「√ 后面不带括号时只吃数字（"√2m" 仍是 √2·m，不是 √(2m)）」。
 *    ⇒ 学生 `√2y` 读成 √2·y，参考 `√(2y)` 读成 √(2y)，代数不等 ⇒ 判错。
 *    ⛔ 这条语义**故意不能改**：改了会把 `√2m`（真义 √2·m）误读成 √(2m) ⇒ 放水。
 * ③ answerConsensus.answersEquivalent 的数值通道 parseNumericValues 遇到变量字母
 *    直接抛 unsupported token ⇒ 返回 null ⇒ 只能靠字符串比对 ⇒ 把 `-7/2√(2y)` 与
 *    `-7√(2y)/2`（**同一个数**）当成「2 种答案」，发出 2:1 分歧提示。
 *
 * ── 修法（只改数据，不动判题语义）──
 * 把参考答案从 `-7/2√(2y)` 改成与学生/AI 答案**同形态**的 `-7√(2y)/2`（数学等值），
 * 于是 judgeAnswer 判对；再走 finalizeRejudgeResult 结算（错题本 + 掌握度 + 审计同步），
 * 假错入册的那行会被正确处理。
 *
 * ⚠️ 为什么改参考答案而不是改判题器：
 *   · 改 convertSqrtToPower = 放宽根号语义 ⇒ 放水（真会判错的题被放过）⇒ 绝不做。
 *   · 改 answersEquivalent 支持变量代数求值 = 改核心判题流程 ⇒ 需负责人确认，
 *     且全库仅此 1 例，收益不抵风险 ⇒ 本轮不做（留作后续议题）。
 *
 * 判据刻意收窄：只处理「学生答案补上根号括号后与参考答案数学等值」的题。
 * 补括号后仍不等 ⇒ 真错，不动。天然幂等，跑第二遍命中 0 条。
 *
 * 用法：node server/scripts/fix-sqrt-paren-answer-20261025.mjs [--apply]
 */
import '../loadEnv.js'
import { getPool } from '../config/neon.js'
import { judgeAnswer } from '../services/judgeService.js'
import { finalizeRejudgeResult } from '../services/gradingFinalizer.js'

const APPLY = process.argv.includes('--apply')
const pool = getPool()

/**
 * 把 `√<数字><字母/标识符>` 补成 `√(<数字><字母/标识符>)`。
 * 只处理「根号 + 数字 + 至少一个字母」的连续片段；已有括号的不动。
 * ⛔ 绝不碰 `√2`（纯数字）—— 它的语义无歧义，补括号无意义。
 */
function addSqrtParens(s) {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] !== '√') { out += s[i]; i++; continue }
    let j = i + 1
    while (j < s.length && /\s/.test(s[j])) j++
    if (s[j] === '(') { out += s[i]; i++; continue } // 已有括号，原样保留
    const m = /^[0-9]+(?:\.[0-9]+)?[a-zA-Z][a-zA-Z0-9]*/.exec(s.slice(j))
    if (m) {
      out += '√(' + m[0] + ')'
      i = j + m[0].length
      continue
    }
    out += s[i]; i++
  }
  return out
}

/**
 * 从学生答案的**推导链**里取出「最终结果那一行」作为候选参考答案。
 * 学生的推导形如 `解：原式=… =√2y/2 + 2√2y - 6√2y =-7√2y/2`，
 * 补括号后最后一行变成 `-7√(2y)/2` —— 这就是等值于 `-7/2√(2y)` 的写法。
 * ⚠️ 只在「补括号后能通过 judgeAnswer 的数学等价判定」时采用，绝不凭字面猜。
 */
function deriveEquivalentReference(studentAnswer, referenceAnswer, questionType) {
  const patched = addSqrtParens(studentAnswer)
  if (patched === studentAnswer) return null
  // 用整串判：补括号后的学生答案与原参考答案数学等值？
  if (judgeAnswer(patched, referenceAnswer, questionType).isCorrect !== true) return null
  // 从补括号后的学生答案里取「最后一个 = 右侧」作为新参考答案（去掉推导过程）
  const idx = patched.lastIndexOf('=')
  if (idx < 0) return null
  let final = patched.slice(idx + 1).trim()
  // 去掉行首行尾的推导残留与标点
  final = final.split('\n').map(s => s.trim()).filter(Boolean).pop() || ''
  if (!final) return null
  // 候选必须仍是纯数学形态（不含中文叙述），否则说明取错了位置
  if (/[\u4e00-\u9fff]/.test(final)) return null
  if (!/\d/.test(final)) return null
  // 候选自己也要与原参考数学等值
  if (judgeAnswer(final, referenceAnswer, questionType).isCorrect !== true) return null
  return { patched, final }
}

const r = await pool.query(`
  SELECT id, task_id, student_id, answer, analysis, student_answer, is_correct,
         review_status, status, question_type, content, confidence, cache_id,
         ai_answer_risk_reason
  FROM questions
  WHERE deleted_at IS NULL
    AND is_correct = false
    AND answer IS NOT NULL AND btrim(answer) <> ''
    AND student_answer IS NOT NULL AND btrim(student_answer) <> ''
    AND student_answer LIKE '%√%'
    AND answer LIKE '%√%'
  ORDER BY created_at DESC
`)

const plan = []
for (const row of r.rows) {
  // 老师已人工复核过的行不自动改判（人工结论优先）。
  if (row.review_status != null) continue
  const derived = deriveEquivalentReference(row.student_answer, row.answer, row.question_type)
  if (!derived) continue
  // 改完答案后必须真的判对，才进计划
  if (judgeAnswer(row.student_answer, derived.final, row.question_type).isCorrect !== true) continue
  plan.push({ ...row, newAnswer: derived.final, patched: derived.patched })
}

console.log(`扫描 ${r.rows.length} 条「判错 + 两侧含√」→ 根号括号丢失导致误判 ${plan.length} 条\n`)
for (const p of plan) {
  console.log('-'.repeat(84))
  console.log(`题 ${p.id.slice(0, 8)} | task ${p.task_id.slice(0, 8)} | ${String(p.content).replace(/\s+/g, ' ').slice(0, 46)}`)
  console.log(`  原参考答案：${p.answer}`)
  console.log(`  新参考答案：${p.newAnswer}   ← 数学等值，形态与学生答案一致`)
  console.log(`  学生答案  ：${String(p.student_answer || '').replace(/\s+/g, ' ').slice(0, 76)}`)
  console.log(`  存疑标注  ：${(p.ai_answer_risk_reason || '(无)').slice(0, 110)}`)
}

if (!APPLY) {
  console.log('\n[dry-run] 未写库。加 --apply 执行。')
  await pool.end()
  process.exit(0)
}

let settled = 0, failed = 0
for (const p of plan) {
  if (!p.student_id) continue
  try {
    // ① 先改参考答案（人工改写参考答案会清掉存疑标注，走系统既有语义）
    await pool.query(
      `UPDATE questions SET answer = $2, answer_source = 'manual', updated_at = NOW() WHERE id = $1`,
      [p.id, p.newAnswer]
    )
    // ② 再走重判结算：questions.is_correct + 错题本 + 掌握度 + judgements 审计一次同步
    await finalizeRejudgeResult({
      question: { ...p, answer: p.newAnswer },
      isCorrect: true,
      oldIsCorrect: p.is_correct,
      source: 'sqrt_paren_equivalent_fix',
      manualOverride: false,
      confidence: p.confidence
    })
    settled += 1
  } catch (e) {
    failed += 1
    console.error(`  结算失败 q=${p.id.slice(0, 8)}: ${e.message}`)
  }
}
console.log(`\n重判结算：${settled} 条（失败 ${failed}）`)

if (plan.length) {
  const cleared = await pool.query(`
    UPDATE questions SET ai_answer_risk_reason = NULL, updated_at = NOW()
    WHERE id = ANY($1::uuid[])
    RETURNING id
  `, [plan.map(p => p.id)])
  console.log(`清除「参考答案存疑」标注：${cleared.rowCount} 条`)
}

await new Promise(r2 => setTimeout(r2, 1500))
await pool.end()
