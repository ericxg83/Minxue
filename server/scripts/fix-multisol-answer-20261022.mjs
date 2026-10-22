/**
 * 扫描「解析给出同变量多解、参考答案只存其中一个根」的题（2026-10-22）。
 *
 * 事故（用户截图）：
 *   #13 x²-4x+2=0       解析末句「所以 x1=2+√2, x2=2-√2」→ 参考答案只有 `2-√2`
 *   #10 3x(x-2)=10-5x   解析末句「所以 x₁=2, x₂=-5/3」  → 参考答案只有 `-5/3`
 *   ⇒ 同一份正确解按不同顺序书写，一条判对一条判错
 *     （id=383820e1 `x₁=2, x₂=-5/3` 判对；id=d81b6335 `x₁=-5/3, x₂=2` 判错）。
 *
 * 代码侧根因已在 eb6bfb1 修复（extractFinalAnswerFromAnalysis 不再把多解行截成单值），
 * 本草稿负责找出**修复前**留下的存量脏数据。
 *
 * 用法：
 *   node server/scripts/fix-multisol-answer-20261022.mjs            # dry-run
 *   node server/scripts/fix-multisol-answer-20261022.mjs --apply    # 写库
 *   node server/scripts/fix-multisol-answer-20261022.mjs --rollback # 从备份表恢复
 */
import '../loadEnv.js'
import { getPool } from '../config/neon.js'
import { judgeAnswer } from '../services/judgeService.js'
import { finalizeRejudgeResult } from '../services/gradingFinalizer.js'
import { answersEquivalent } from '../utils/answerConsensus.js'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0)
const BAK_Q = 'questions_bak_20261022_multisol'
const BAK_C = 'question_cache_bak_20261022_multisol'
const pool = getPool()

const SUB = { '1': '₁', '2': '₂', '₀': '₀', '₁': '₁', '₂': '₂' }
const VALUE_RE = '[^\\s=，,;；。\\n）)]+'

/** 取某个变量第 n 个根的**最后一次**声明（终值），抓不到返回 null */
function lastRootDecl(text, variable, rootNo) {
  const re = new RegExp(`([a-zA-Z])\\s*_?${rootNo === 1 ? '[1₁]' : '[2₂]'}\\s*=\\s*(${VALUE_RE})`, 'g')
  let hit = null, m
  while ((m = re.exec(text)) !== null) {
    // 排除复合下标：解析里「x₁x₂=c/a」「x₁+x₂=-b/a」是韦达定理的积与和，
    // 不是第二个根。判据是匹配起点前一个字符不能是下标/字母/正负号。
    // 实测误伤 82ed165b：`x₁x₂=-4/1=-4` 被读成 x₂=-4/1，答案差点被改成 `x₂=-4/1`。
    const prev = text[m.index - 1] || ''
    if (/[0-9₁₂₁₂a-zA-Z+＋\-−]/.test(prev)) continue
    hit = m
  }
  if (!hit) return null
  if (hit[1] !== variable) return null
  const v = hit[2].replace(/[。.，,；;]+$/, '').replace(/\$+/g, '')
  if (!v || v.length > 28) return null
  if ((v.match(/\(/g) || []).length !== (v.match(/\)/g) || []).length) return null
  if ((v.match(/\{/g) || []).length !== (v.match(/\}/g) || []).length) return null
  // 值必须是**纯数值/根式**：`x₂=k` 这类是解析里的过程式（题问的是 k 的值），
  // 不是根。实测误伤：「(x-2)(x-k)=0 有两个相等的实数根，则 k=___」答案 2，
  // 解析写「所以 x₁=2, x₂=k」—— 不过滤就会把参考答案改成 `x₁=2, x₂=k`。
  // LaTeX 命令（\frac / \sqrt）本身由反斜杠开头，先剥掉再判剩余是否含字母。
  const bare = v.replace(/\\[a-zA-Z]+/g, '')
  if (/[a-zA-Z]/.test(bare)) return null
  return v
}

/**
 * 从解析文本抽「同变量多解终值」。
 * 形态一（主）：x₁=A … x₂=B 的下标声明，各取最后一次出现；
 * 形态二：末句 `x = A 或 x = B` / `x=A，x=B`（无下标）。
 * 返回 { variable, values: [A, B] } 或 null。
 */
export function extractRootPair(analysis) {
  const text = String(analysis || '')
  if (!text) return null
  const tail = text.slice(-300)

  for (const variable of ['x', 'y', 'm', 'n', 'a', 'k']) {
    const v1 = lastRootDecl(tail, variable, 1)
    const v2 = lastRootDecl(tail, variable, 2)
    if (v1 && v2 && !answersEquivalent(v1, v2)) return { variable, values: [v1, v2] }
  }

  // 无下标形态：末句里同一变量两次赋值，用「或」或逗号分隔
  const lastLine = text.split(/[\n。]/).filter(s => s.trim()).pop() || tail
  if (!/或/.test(lastLine)) return null
  const re = new RegExp(`([a-zA-Z])\\s*=\\s*(${VALUE_RE})`, 'g')
  const hits = [...lastLine.matchAll(re)]
  const byVar = new Map()
  for (const h of hits) {
    if (!byVar.has(h[1])) byVar.set(h[1], [])
    const v = h[2].replace(/[。.，,；;]+$/, '')
    if (v && !byVar.get(h[1]).some(x => answersEquivalent(x, v))) byVar.get(h[1]).push(v)
  }
  for (const [variable, values] of byVar) {
    if (values.length >= 2) return { variable, values }
  }
  return null
}

/** answer 是否是「单值」（不含多空分隔符） */
function isSingleValue(a) {
  const s = String(a ?? '').trim()
  if (!s) return false
  return !/[，,;；]|或/.test(s)
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
  console.log('回滚只还原字段；错题本/掌握度侧已产生的副作用需另行核对')
}

async function main() {
  if (ROLLBACK) { await rollback(); return }

  const r = await pool.query(`
    SELECT q.id, q.task_id, q.student_id, q.answer, q.analysis, q.student_answer,
           q.is_correct, q.review_status, q.status, q.question_type, q.content, q.cache_id,
           q.answer_source, q.confidence, q.ai_answer_risk_reason, q.created_at
    FROM questions q
    WHERE q.deleted_at IS NULL
      AND coalesce(q.answer,'') <> ''
      AND coalesce(q.analysis,'') <> ''
      AND length(q.answer) <= 40
      AND q.answer NOT LIKE '%，%' AND q.answer NOT LIKE '%,%'
      AND q.answer NOT LIKE '%;%' AND q.answer NOT LIKE '%；%'
      AND q.answer NOT LIKE '%或%'
    ORDER BY q.created_at DESC
  `)

  const hits = []
  for (const row of r.rows) {
    if (!isSingleValue(row.answer)) continue
    const pair = extractRootPair(row.analysis)
    if (!pair) continue
    const ans = String(row.answer).trim()
    const matched = pair.values.filter(v => answersEquivalent(v, ans))
    if (matched.length !== 1) continue
    hits.push({ ...row, pair })
  }

  console.log(`扫描 ${r.rows.length} 条单值答案 → 命中 ${hits.length} 条「解析多解、答案单值」`)
  if (!hits.length) return

  const plan = []
  for (const h of hits) {
    const [v1, v2] = h.pair.values
    const v = h.pair.variable
    const newAnswer = `${v}₁=${v1}, ${v}₂=${v2}`
    if (String(newAnswer).trim() === String(h.answer).trim()) continue
    const before = judgeAnswer(h.student_answer || '', h.answer, h.question_type)
    const after = judgeAnswer(h.student_answer || '', newAnswer, h.question_type)
    plan.push({ ...h, newAnswer, before, after })
  }

  const flips = plan.filter(p => p.before.isCorrect !== p.after.isCorrect)
  console.log(`需修改 ${plan.length} 条，其中重判结论变化 ${flips.length} 条\n`)

  const show = LIMIT > 0 ? plan.slice(0, LIMIT) : plan
  for (const p of show) {
    console.log('-'.repeat(88))
    console.log(`题 ${p.id.slice(0, 8)} | ${String(p.content).replace(/\s+/g, ' ').slice(0, 46)}`)
    console.log(`  答案：${p.answer}  →  ${p.newAnswer}   (${p.answer_source}, ${p.created_at.toISOString().slice(0, 16)})`)
    console.log(`  学生：${String(p.student_answer || '').replace(/\s+/g, ' ').slice(0, 64)}`)
    console.log(`  判定：${String(p.before.isCorrect)}  →  ${String(p.after.isCorrect)}   review_status=${p.review_status ?? 'null'}`)
  }

  if (!APPLY) {
    console.log('\n[dry-run] 未写库。加 --apply 执行。')
    return
  }

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
  console.log(`\n已备份：${BAK_Q} / ${BAK_C}`)

  let cacheFixed = 0
  for (const id of cacheIds) {
    const owner = plan.find(p => p.cache_id === id)
    if (!owner) continue
    await pool.query(`UPDATE question_cache SET answer = $1, updated_at = NOW() WHERE id = $2`, [owner.newAnswer, id])
    cacheFixed += 1
  }
  for (const p of plan) {
    await pool.query(`UPDATE questions SET answer = $1, updated_at = NOW() WHERE id = $2`, [p.newAnswer, p.id])
  }
  console.log(`答案已更新：questions ${plan.length} 条 / question_cache ${cacheFixed} 条`)

  let settled = 0, skippedReviewed = 0, unchanged = 0, failed = 0
  for (const p of plan) {
    if (p.review_status != null) { skippedReviewed += 1; continue }
    if (p.after.isCorrect === p.is_correct) { unchanged += 1; continue }
    if (!p.student_id) { unchanged += 1; continue }
    try {
      await finalizeRejudgeResult({
        question: { ...p, answer: p.newAnswer },
        isCorrect: p.after.isCorrect,
        oldIsCorrect: p.is_correct,
        source: 'multisol_answer_fix',
        manualOverride: false,
        confidence: p.confidence
      })
      settled += 1
    } catch (e) {
      failed += 1
      console.error(`  结算失败 q=${p.id.slice(0, 8)}: ${e.message}`)
    }
  }
  console.log(`重判结算：${settled} 条（结论未变 ${unchanged}，已复核跳过 ${skippedReviewed}，失败 ${failed}）`)

  const cleared = await pool.query(`
    UPDATE questions SET ai_answer_risk_reason = NULL, updated_at = NOW()
    WHERE id = ANY($1::uuid[]) AND ai_answer_risk_reason LIKE '%多路求解%'
    RETURNING id
  `, [plan.map(p => p.id)])
  console.log(`清除「多路求解存疑」标注：${cleared.rowCount} 条`)
}

await main()
await pool.end()
