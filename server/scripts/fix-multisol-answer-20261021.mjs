/**
 * 修复「参考答案被截断成单个根」的历史数据（2026-10-21）。
 *
 * 事故：用户截图题 (x+5)²-2(x+5)=8，解析写「所以 x = -1 或 x = -7」，参考答案却只有 `-7`。
 * 根因：`extractFinalAnswerFromAnalysis` 的 fallback 把解析末句「x = -1 或 x = -7」
 *       按「最后一个等号右侧」抓成 `-7` 写进 questions.answer（已在代码侧修复）。
 *
 * 本脚本修历史存量：
 *   ① 找出「解析末句给出同一变量的多个解、answer 只存了其中一个」的题；
 *   ② 把 answer 补成完整解集（questions + question_cache 同步，否则指纹命中又写回）；
 *   ③ 未复核（review_status IS NULL）的题按新答案重判，走 finalizeRejudgeResult
 *      同步错题本 / 掌握度 / judgements 审计；
 *   ④ 清掉因此失效的「参考答案存疑：多路求解…」风险标注。
 *
 * 用法：
 *   node server/scripts/fix-multisol-answer-20261021.mjs            # dry-run
 *   node server/scripts/fix-multisol-answer-20261021.mjs --apply    # 写库
 *   node server/scripts/fix-multisol-answer-20261021.mjs --rollback # 从备份表恢复
 */
import '../loadEnv.js'
import { getPool } from '../config/neon.js'
import { judgeAnswer } from '../services/judgeService.js'
import { finalizeRejudgeResult } from '../services/gradingFinalizer.js'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const BAK_Q = 'questions_bak_20261021_multisol'
const BAK_C = 'question_cache_bak_20261021_multisol'
const pool = getPool()

const isSingleValue = (a) => {
  const s = String(a ?? '').trim()
  if (!s) return false
  return !/[，,;；]|或/.test(s)
}

/**
 * 从解析尾部抽「同变量多解声明」。
 * 返回 { variable, values, sentence, full } —— full 是可直接入库的完整解集文本。
 */
function extractMultiSolution(text) {
  const s = String(text ?? '')
  const tail = s.slice(-260)
  const lastSentence = tail.split(/[。\n]/).filter(Boolean).pop() || tail
  if (!/或/.test(lastSentence)) return null
  const re = /([a-zA-Z])\s*=\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|[±]?[√∛]\s*\d+(?:\s*\/\s*\d+)?)/g
  const hits = [...lastSentence.matchAll(re)]
  if (hits.length < 2) return null
  const byVar = new Map()
  for (const h of hits) {
    const v = h[1]
    const val = h[2].replace(/\s+/g, '')
    if (!byVar.has(v)) byVar.set(v, [])
    if (!byVar.get(v).includes(val)) byVar.get(v).push(val)
  }
  for (const [v, vals] of byVar) {
    if (vals.length < 2) continue
    // 保真取原句：从第一个 `v =` 到句末，去掉句首「所以/因此/故」等脚手架
    const idx = lastSentence.search(new RegExp(`${v}\\s*=`))
    if (idx < 0) continue
    const full = lastSentence.slice(idx).trim().replace(/[。.]$/, '')
    return { variable: v, values: vals, sentence: lastSentence, full }
  }
  return null
}

async function tableExists(name) {
  const r = await pool.query(`SELECT to_regclass($1) AS t`, [`public.${name}`])
  return Boolean(r.rows[0]?.t)
}

async function rollback() {
  if (!(await tableExists(BAK_Q))) {
    console.log('没有备份表可回滚:', BAK_Q)
    return
  }
  const r = await pool.query(`
    UPDATE questions q
    SET answer = b.answer, is_correct = b.is_correct, status = b.status,
        review_status = b.review_status, ai_answer_risk_reason = b.ai_answer_risk_reason,
        updated_at = NOW()
    FROM ${BAK_Q} b
    WHERE q.id = b.id
    RETURNING q.id
  `)
  const c = await pool.query(`
    UPDATE question_cache c
    SET answer = b.answer, updated_at = NOW()
    FROM ${BAK_C} b
    WHERE c.id = b.id
    RETURNING c.id
  `)
  console.log(`回滚完成：questions ${r.rowCount} 条，question_cache ${c.rowCount} 条`)
  console.log('⚠️ 回滚只还原字段，错题本/掌握度侧已产生的副作用需另行核对')
}

async function main() {
  if (ROLLBACK) { await rollback(); return }
  const r = await pool.query(`
    SELECT q.id, q.task_id, q.student_id, q.answer, q.analysis, q.student_answer, q.ai_answer,
           q.is_correct, q.review_status, q.status, q.question_type, q.content, q.cache_id,
           q.answer_source, q.confidence, q.ai_answer_risk_reason, q.created_at
    FROM questions q
    WHERE q.deleted_at IS NULL
      AND coalesce(q.answer,'') <> ''
      AND q.analysis LIKE '%或%'
    ORDER BY q.created_at DESC
  `)

  const hits = []
  for (const row of r.rows) {
    if (!isSingleValue(row.answer)) continue
    const multi = extractMultiSolution(row.analysis)
    if (!multi) continue
    const ans = String(row.answer).trim().replace(/^[a-zA-Z]\s*=\s*/, '')
    if (!multi.values.includes(ans)) continue
    hits.push({ ...row, multi })
  }

  console.log(`扫描 ${r.rows.length} 条含「或」解析 → 命中 ${hits.length} 条「解析多解、答案单值」`)
  if (!hits.length) return

  // 计算重判结论（先算，dry-run 也能看到）
  const plan = []
  for (const h of hits) {
    const newAnswer = h.multi.full
    if (String(newAnswer).trim() === String(h.answer).trim()) continue
    const judged = judgeAnswer(h.student_answer || '', newAnswer, h.question_type)
    plan.push({ ...h, newAnswer, judged })
  }

  console.log(`实际需修改 ${plan.length} 条\n`)
  for (const p of plan) {
    const before = await judgeAnswer(p.student_answer || '', p.answer, p.question_type)
    console.log('-'.repeat(84))
    console.log(`题 ${p.id.slice(0, 8)} | ${String(p.content).replace(/\s+/g, ' ').slice(0, 50)}`)
    console.log(`  答案：${p.answer}  →  ${p.newAnswer}`)
    console.log(`  学生：${String(p.student_answer || '').replace(/\s+/g, ' ').slice(0, 70)}`)
    console.log(`  判定：${String(before.isCorrect)}  →  ${String(p.judged.isCorrect)}  (review_status=${p.review_status ?? 'null'})`)
  }

  if (!APPLY) {
    console.log('\n[dry-run] 未写库。加 --apply 执行。')
    return
  }

  // ── 备份 ────────────────────────────────────────────────────────────────
  await pool.query(`DROP TABLE IF EXISTS ${BAK_Q}`)
  await pool.query(`CREATE TABLE ${BAK_Q} AS
    SELECT id, answer, is_correct, status, review_status, ai_answer_risk_reason
    FROM questions WHERE id = ANY($1::uuid[])`, [plan.map(p => p.id)])
  await pool.query(`DROP TABLE IF EXISTS ${BAK_C}`)
  const cacheIds = [...new Set(plan.map(p => p.cache_id).filter(Boolean))]
  if (cacheIds.length) {
    await pool.query(`CREATE TABLE ${BAK_C} AS
      SELECT id, answer FROM question_cache WHERE id = ANY($1::uuid[])`, [cacheIds])
  } else {
    await pool.query(`CREATE TABLE ${BAK_C} (id uuid, answer text)`)
  }
  console.log(`已备份：${BAK_Q} / ${BAK_C}`)

  // ── 修答案（questions + cache 同步）──────────────────────────────────────
  let cacheFixed = 0
  for (const id of cacheIds) {
    const owner = plan.find(p => p.cache_id === id)
    await pool.query(`UPDATE question_cache SET answer = $1, updated_at = NOW() WHERE id = $2`, [owner.newAnswer, id])
    cacheFixed += 1
  }
  for (const p of plan) {
    await pool.query(`UPDATE questions SET answer = $1, updated_at = NOW() WHERE id = $2`, [p.newAnswer, p.id])
  }
  console.log(`答案已更新：questions ${plan.length} 条 / question_cache ${cacheFixed} 条`)

  // ── 重判（只动未复核的行）───────────────────────────────────────────────
  let settled = 0, skippedReviewed = 0, unchanged = 0
  for (const p of plan) {
    if (p.review_status != null) { skippedReviewed += 1; continue }
    if (p.judged.isCorrect === p.is_correct) { unchanged += 1; continue }
    if (!p.student_id) { unchanged += 1; continue }
    try {
      await finalizeRejudgeResult({
        question: { ...p, answer: p.newAnswer },
        isCorrect: p.judged.isCorrect,
        oldIsCorrect: p.is_correct,
        source: 'multisol_answer_fix',
        manualOverride: false,
        confidence: p.confidence
      })
      settled += 1
    } catch (e) {
      console.error(`  结算失败 q=${p.id.slice(0, 8)}: ${e.message}`)
    }
  }
  console.log(`重判结算：${settled} 条（结论未变 ${unchanged}，已复核跳过 ${skippedReviewed}）`)

  // ── 清失效的风险标注 ────────────────────────────────────────────────────
  const cleared = await pool.query(`
    UPDATE questions SET ai_answer_risk_reason = NULL, updated_at = NOW()
    WHERE id = ANY($1::uuid[]) AND ai_answer_risk_reason LIKE '%多路求解%'
    RETURNING id
  `, [plan.map(p => p.id)])
  console.log(`清除「多路求解存疑」标注：${cleared.rowCount} 条`)
}

await main()
await pool.end()
