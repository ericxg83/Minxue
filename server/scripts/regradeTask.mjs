/**
 * 就地重判：对指定 task 的每题，用最新逻辑让 AI 从题干重新解出标准答案
 * (generateAnswerForQuestion + validateAIAnswer + extractAnswerFromAnalysis)，
 * 再用 judgeAnswer 重判 is_correct，并通过 finalizeRejudgeResult 同步错题/掌握度。
 * 不重新 OCR、不改 tasks.resource_id —— 绕开"答案库路由"，精准修脏标准答案。
 *
 * 用法:
 *   dry-run(默认,不写库):  node server/scripts/regradeTask.mjs <taskId>
 *   真正写库:              node server/scripts/regradeTask.mjs <taskId> --apply
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })

const APPLY = process.argv.includes('--apply')
// --only-unsettled（2026-09-22 新增，可选）：只重判「答案空 或 is_correct 仍为 NULL」的题，
//   跳过已落定的题，避免用降级通道答案覆盖已有答案。默认不加则维持原行为（全量重判）。
const ONLY_UNSETTLED = process.argv.includes('--only-unsettled')
const taskId = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!taskId) {
  console.error('用法: node server/scripts/regradeTask.mjs <taskId> [--apply]')
  process.exit(1)
}

const { query } = await import('../config/neon.js')
const { updateQuestionAnswer } = await import('../services/neonService.js')
const { formatOptionsForPrompt } = await import('../utils/optionText.js')
const { generateAnswerForQuestion, extractAnswerFromAnalysis, validateAIAnswer } = await import('../worker.js')
const { judgeAnswer, isGradingCommentAnswer } = await import('../services/judgeService.js')
const { finalizeRejudgeResult } = await import('../services/gradingFinalizer.js')

const whereUnsettled = ONLY_UNSETTLED ? ` AND (answer IS NULL OR answer = '' OR is_correct IS NULL)` : ''
const { rows: qs } = await query(
  `SELECT id, question_number, content, parent_stem, options, answer, student_answer, question_type,
          student_id, is_correct
   FROM questions WHERE task_id = $1${whereUnsettled} ORDER BY question_number`,
  [taskId]
)
console.log(`\n===== ${APPLY ? '应用重判' : 'DRY-RUN(不写库)'}${ONLY_UNSETTLED ? ' [仅未落定]' : ''} | ${qs.length} 题 =====\n`)

let ansChanged = 0, judgeChanged = 0, errCount = 0
for (const q of qs) {
  let options = []
  try { options = q.options ? (typeof q.options === 'string' ? JSON.parse(q.options) : q.options) : [] } catch { options = [] }
  // ⚠️ 2026-09-20 与 worker.js:2002 对齐：多小问大题的公共条件只在 parent_stem，
  //    只喂 content 会让答案引擎判「缺少条件」（9-18 第03周 题24/25 事故）。
  const content = [q.parent_stem, q.content].filter(s => s && String(s).trim()).join('\n')
  const fullContent = options.length ? `${content}\n选项：${formatOptionsForPrompt(options)}` : content
  if (!fullContent.trim()) { console.log(`  #${q.question_number} ⏭️ 空题干`); continue }

  let gen
  try {
    gen = await generateAnswerForQuestion(fullContent)
  } catch (e) {
    console.log(`  #${q.question_number} ❌ 生成失败: ${e.message}`); errCount++; continue
  }
  // ⛔ 安全闸（2026-09-22）：只接受真模型答案（SenseNova / Huihuiyun / BigModel…），
  //    拒写「通用文本链兜底」(fallback-text-chain) 或引擎彻底失败(engine-failed) 的答案——
  //    避免把污染答案写进题目；被拒的题目保留 NULL，等下一个 5h 窗口再补。
  if (gen.engine === 'fallback-text-chain' || gen.source === 'engine-failed') {
    console.log(`  #${q.question_number} ⛔ 通用文本链/引擎失败，拒写(留 NULL 待下窗口)`); errCount++; continue
  }
  const validation = validateAIAnswer(gen.answer, gen.analysis)
  let newAnswer = extractAnswerFromAnalysis(gen.answer, gen.analysis, options) || ''
  if (isGradingCommentAnswer(newAnswer, q.question_type)) newAnswer = ''
  newAnswer = newAnswer.trim()
  if (!newAnswer) { console.log(`  #${q.question_number} ⚠️ 未得干净答案(${validation.reason||'空'}), 保留原值`); errCount++; continue }

  const { isCorrect: newCorrect } = judgeAnswer(q.student_answer, newAnswer, q.question_type)
  const oldAnswer = (q.answer || '').trim()
  const aChg = newAnswer !== oldAnswer
  const jChg = newCorrect !== q.is_correct

  console.log(
    `  ${aChg ? '✏️' : '  '}${jChg ? '⚖️' : '  '} #${q.question_number}` +
    `  答案 ${JSON.stringify(oldAnswer)} → ${JSON.stringify(newAnswer)}` +
    `  判定 ${q.is_correct} → ${newCorrect}`
  )

  if (APPLY && (aChg || jChg)) {
    if (aChg) {
      await updateQuestionAnswer(q.id, newAnswer, gen.analysis || null, true)
      // 答案就绪 → 清「答案异常」存根（与 fix-week03-final-20260920 / _apply_rerun_0921 同口径）：
      //   answer_exception 语义是「AI 没给出正误结论」，答案补齐后该标记必须清零，否则页面自相矛盾。
      await query(
        `UPDATE questions SET answer_exception = false, answer_exception_reason = NULL, updated_at = NOW() WHERE id = $1`,
        [q.id]
      )
    }
    await finalizeRejudgeResult({
      question: { ...q, answer: newAnswer },
      isCorrect: newCorrect,
      oldIsCorrect: q.is_correct,
      source: 'regrade_script'
    })
    if (aChg) ansChanged++
    if (jChg) judgeChanged++
  }
  await new Promise((r) => setTimeout(r, 400))
}

console.log(
  `\n${APPLY
    ? `✅ 已写库：答案更新 ${ansChanged} 题，判定修正 ${judgeChanged} 题，未完成 ${errCount} 题`
    : `（dry-run：未写库。共 ${ansChanged}/${judgeChanged} 占位，加 --apply 执行）`}`
)
process.exit(0)
