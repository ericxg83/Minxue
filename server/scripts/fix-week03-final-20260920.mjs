/**
 * 2026-09-20 最终回填：第03周 九上练习卷2 题24/25 六条参考答案（apply 一次到位）。
 *
 * 拆分策略（DRY-RUN 两轮实测 + 逐条数学验算后定稿）：
 *   A. 引擎自动（4 条）：24(1)(2)(3)、25(1) —— 修复后口径（parent_stem+content）跑答案引擎，
 *      提取值已逐条验算正确，直接写库。
 *   B. 人工定点（2 条）：25(2)、25(3) —— 答案引擎（deepseek-v4-flash 兜底）两轮输出均不可靠：
 *      25(2) 给出 y=-x²+2x（顶点(1,1) 不满足 y=2x，错误）；25(3) answer 字段与自身分析矛盾。
 *      以下为逐条数学推导的正确值（附推导，供复核页人工核对）：
 *
 *   25(2) 推导：y=-x²+bx+c 顶点 (b/2, b²/4+c) 是友好点 → b²/4+c = 2·(b/2) = b → c = b - b²/4；
 *        与 y 轴交点 (0,c) 是友好点 → c = 0 → b(1-b/4)=0 → b=0 或 b=4。
 *        答案：y=-x² 或 y=-x²+4x。
 *   25(3) 推导：y=1/4(x-h)²+2h（顶点 (h,2h), h>0）过 (-2,8) → h=2 → y=1/4(x-2)²+4，
 *        对称轴 x=2，区间 [m-1,m] 长度 1：
 *          m ≤ 2    : d = y(m-1)-y(m) = -1/2m + 5/4
 *          2<m≤2.5  : d = y(m-1)-4 = 1/4(m-3)²
 *          2.5<m<3  : d = y(m)-4 = 1/4(m-2)²
 *          m ≥ 3    : d = y(m)-y(m-1) = 1/2m - 5/4
 *        边界验算：m=1→0.75、m=2→0.25、m=2.5→1/16、m=3→0.25，均与直接代值吻合。
 *
 * 用法：node scripts/fix-week03-final-20260920.mjs --apply   # 写库（先 dry-run 校验后执行）
 *       node scripts/fix-week03-final-20260920.mjs            # dry-run
 */
import dotenv from 'dotenv'
import fs from 'node:fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const APPLY = process.argv.includes('--apply')
const TASK_ID = '73b753c5-20d4-4f8c-bf2b-df347354c4d3'

const { query } = await import('../config/neon.js')
const { updateQuestionAnswer } = await import('../services/neonService.js')
const { formatOptionsForPrompt } = await import('../utils/optionText.js')
const { generateAnswerForQuestion, extractAnswerFromAnalysis, validateAIAnswer } = await import('../worker.js')
const { syncQuestionCompleteness } = await import('../services/questionCompletenessSync.js')

// 人工定点答案（24(2)/25(2)/25(3)），带推导说明作 analysis
// 24(2) 也定点：引擎提取值带截断尾巴「S = -m²-4m+4（-4<m<」，主体验算正确但写库会显示半截。
const MANUAL_ANSWERS = new Map([
  ['题24(2)', {
    answer: 'S = -m²-4m+4（-4 < m < 0）',
    analysis: 'a=-1/2 → 抛物线 y=-1/2x²-3/2x+2，C(0,2)。' +
      'D(m,n) 第二象限在抛物线上：n=-1/2m²-3/2m+2。' +
      '四边形 OCDA 面积 = △OCD + △OAD？经鞋带公式/分割：S = 2n - m = -m²-3m+4-m = -m²-4m+4。' +
      'D 在第二象限且抛物线与 x 轴交于 A(-4,0)、B(1,0) → -4<m<0。' +
      '（2026-09-20 人工定点：引擎提取值截断于「-4<m<」）',
  }],
  ['题25(2)', {
    answer: 'y=-x² 或 y=-x²+4x',
    analysis: '设 y=-x²+bx+c，顶点 (b/2, b²/4+c) 为友好点 → b²/4+c=2·(b/2)=b，即 c=b-b²/4；' +
      '与 y 轴交点 (0,c) 也是友好点 → c=0；故 b(1-b/4)=0 → b=0 或 b=4。' +
      '答案：y=-x² 或 y=-x²+4x。（2026-09-20 人工定点，答案引擎两轮输出均误判 y=-x²+2x）',
  }],
  ['题25(3)', {
    answer: 'd = -1/2m+5/4 (m≤2)；d = 1/4(m-3)² (2<m≤2.5)；d = 1/4(m-2)² (2.5<m<3)；d = 1/2m-5/4 (m≥3)',
    analysis: 'y=1/4(x-h)²+2h（顶点 (h,2h), h>0）过 (-2,8)：8=1/4(h+2)²+2h → h²+12h-28=0 → h=2。' +
      'y=1/4(x-2)²+4，对称轴 x=2，区间 [m-1,m] 长 1。' +
      'm≤2（含端点 m=2）：递减段，d=y(m-1)-y(m)=-1/2m+5/4；' +
      '2<m≤2.5：含对称轴且左端点更远，d=y(m-1)-4=1/4(m-3)²；' +
      '2.5<m<3：含对称轴且右端点更远，d=y(m)-4=1/4(m-2)²；' +
      'm≥3：递增段，d=y(m)-y(m-1)=1/2m-5/4。' +
      '边界验算：m=1→0.75、m=2→0.25、m=2.5→1/16、m=3→0.25。（2026-09-20 人工定点）',
  }],
])

const { rows } = await query(
  `SELECT id, question_number, sub_no, parent_stem, content, options, question_type,
          answer, answer_exception, answer_exception_reason, ai_answer_risk_reason
   FROM questions WHERE task_id = $1 AND deleted_at IS NULL
     AND question_number IN (24, 25)
   ORDER BY question_number, sub_no`, [TASK_ID])

console.log('='.repeat(72))
console.log(`🔧 第03周 题24/25 最终回填 mode=${APPLY ? 'APPLY 写库' : 'DRY-RUN'} | ${rows.length} 条`)
console.log('='.repeat(72))

const snapshot = { ts: new Date().toISOString(), apply: APPLY, items: [] }
let autoOk = 0, manualOk = 0, fail = 0

for (const q of rows) {
  const label = `题${q.question_number}(${q.sub_no})`
  const manual = MANUAL_ANSWERS.get(label)
  const before = { answer: q.answer, exc: q.answer_exception, excReason: q.answer_exception_reason, risk: q.ai_answer_risk_reason }

  if (manual) {
    // ── B. 人工定点 ──
    console.log(`\n── ${label} ${q.id.slice(0,8)} [人工定点]`)
    console.log(`   答案: ${JSON.stringify(manual.answer.slice(0, 100))}`)
    snapshot.items.push({ qid: q.id, mode: 'manual', before, after: { answer: manual.answer, analysis: manual.analysis } })
    if (APPLY) {
      await updateQuestionAnswer(q.id, manual.answer, manual.analysis, true)
      await query(
        `UPDATE questions SET answer_exception = false, answer_exception_reason = NULL,
                ai_answer_risk_reason = NULL, updated_at = NOW()
         WHERE id = $1`, [q.id])
      console.log(`   ✅ 已写库 + 清异常标记`)
    }
    manualOk++
    continue
  }

  // ── A. 引擎自动 ──
  let options = []
  try { options = q.options ? (typeof q.options === 'string' ? JSON.parse(q.options) : q.options) : [] } catch { options = [] }
  const content = [q.parent_stem, q.content].filter(s => s && String(s).trim()).join('\n')
  const fullContent = options.length > 0 ? `${content}\n选项：${formatOptionsForPrompt(options)}` : content

  console.log(`\n── ${label} ${q.id.slice(0,8)} [引擎] | 输入 ${fullContent.length} 字`)
  let result
  try { result = await generateAnswerForQuestion(fullContent) } catch (e) {
    console.log(`   ❌ 引擎异常: ${e.message}`); fail++; continue
  }
  const validation = validateAIAnswer(result.answer, result.analysis)
  let finalAnswer = extractAnswerFromAnalysis(result.answer, result.analysis, options)
  if (finalAnswer === '-') finalAnswer = ''
  finalAnswer = String(finalAnswer || '').trim()
  console.log(`   引擎: ${result.engine || '?'} | validate: ${validation.isValid ? '✅' : '❌ ' + validation.reason}`)
  console.log(`   提取后: ${JSON.stringify(finalAnswer.slice(0, 160))}`)

  if (!validation.isValid || !finalAnswer) {
    console.log(`   ⚠️ 未得干净答案，保留原值`); fail++; continue
  }
  snapshot.items.push({ qid: q.id, mode: 'engine', before, after: { answer: finalAnswer } })
  if (APPLY) {
    await updateQuestionAnswer(q.id, finalAnswer, result.analysis || null, true)
    await query(
      `UPDATE questions SET answer_exception = false, answer_exception_reason = NULL,
              ai_answer_risk_reason = NULL, updated_at = NOW()
       WHERE id = $1`, [q.id])
    console.log(`   ✅ 已写库 + 清异常标记`)
  }
  autoOk++
  await new Promise(r => setTimeout(r, 600))
}

if (APPLY && snapshot.items.length) {
  await syncQuestionCompleteness(snapshot.items.map(i => i.qid))
  console.log('\n🔄 已重算 is_complete')
  fs.mkdirSync(resolve(__dirname, 'logs'), { recursive: true })
  const p = resolve(__dirname, `logs/week03-final-${Date.now()}.json`)
  fs.writeFileSync(p, JSON.stringify(snapshot, null, 2))
  console.log(`💾 回滚快照: ${p}`)
}

console.log('\n' + '='.repeat(72))
console.log(`📊 ${APPLY ? '执行完成' : 'DRY-RUN'}：引擎 ${autoOk} / 人工定点 ${manualOk} / 失败 ${fail}`)
console.log('='.repeat(72))
process.exit(0)