/**
 * 血压题参考答案误读修复（2026-10-27，负责人截图：−20 被看成 −25）
 *
 * 题 0b4eb422（task 9bf95bc5 #7，填空）：题干表格（chart_image 资产，裁剪 725×125 实测清晰）
 * 为 +20 / −30 / −20 / +15 / +30，正确答案 +20−30−20+15+30=+15 → 120+15=135。
 * 批改时视觉答案引擎把 −20 误读成 −25（纯模型识别失误；表格数值只存在于图片里，
 * 题干文本/资产均无表格 OCR 文本，验算闸只能验证 "+20-30-25+15+30=+10" 内部自洽，
 * 没有任何闸能发现 −25 不在图里）⇒ 参考答案 130，学生答 135 被判错入册。
 *
 * 本脚本（dryRun 默认，--apply 才写库，先备份到 server/_backup/）：
 *   1. 修参考：questions.answer / ai_answer → '135'，analysis 改写为正确算式（保持原句式）；
 *   2. 改判：finalizeRejudgeResult(pc_rejudge, manualOverride=true) —— 老师当时的"标记错误"
 *      是基于错误参考做的，判对回滚 review_status、删除幻觉错因（"审题错误"）的错题本行、
 *      掌握度同步、judgements 审计落痕。
 */
import '../loadEnv.js'
import fs from 'node:fs'
import { getPool } from '../config/neon.js'
import { finalizeRejudgeResult } from '../services/gradingFinalizer.js'

const APPLY = process.argv.includes('--apply')
const QID = '0b4eb422-6bc1-4e44-b08d-7f6812626d86'
const FIXED_ANALYSIS = '以上周日120mmHg为基准，将周一到周五的变化量累加：+20-30-20+15+30=+15，所以周五收缩压为120+15=135mmHg。答案为 135'

const pool = getPool()
const q = async (sql, params) => (await pool.query(sql, params)).rows

const run = async () => {
  const before = {
    question: (await q('SELECT * FROM questions WHERE id = $1', [QID]))[0],
    wrong_questions: await q('SELECT * FROM wrong_questions WHERE question_id = $1', [QID]),
    question_knowledge: await q('SELECT * FROM question_knowledge WHERE question_id = $1', [QID])
  }
  const row = before.question
  if (!row) throw new Error('题目不存在')
  console.log('=== 修复前 ===')
  console.log('answer:', row.answer, '| ai_answer:', row.ai_answer, '| is_correct:', row.is_correct, '| review:', row.review_status)
  console.log('analysis:', row.analysis)
  console.log('wrong_questions:', before.wrong_questions.map(w => ({ lifecycle: w.lifecycle_status, type: w.error_type })))

  if (row.answer !== '130') {
    console.log('[skip] answer 已不是 130，疑似已修，不重复处理')
    await pool.end()
    return
  }

  const dir = new URL('../_backup/', import.meta.url)
  fs.mkdirSync(dir, { recursive: true })
  const file = new URL(`q_${QID}_${Date.now()}.json`, dir)
  fs.writeFileSync(file, JSON.stringify(before, null, 2), 'utf8')
  console.log('已备份:', decodeURIComponent(file.pathname))

  if (!APPLY) {
    console.log('dryRun（未写库）。加 --apply 执行。')
    await pool.end()
    return
  }

  await q(
    `UPDATE questions SET answer = '135', ai_answer = '135', analysis = $2, updated_at = NOW()
      WHERE id = $1 AND answer = '130'`,
    [QID, FIXED_ANALYSIS]
  )

  const fresh = (await q('SELECT * FROM questions WHERE id = $1', [QID]))[0]
  const settlement = await finalizeRejudgeResult({
    question: fresh,
    isCorrect: true,
    oldIsCorrect: fresh.is_correct,
    source: 'pc_rejudge',
    manualOverride: true
  })
  console.log('finalizeRejudgeResult:', JSON.stringify(settlement))

  const after = {
    question: (await q('SELECT id, answer, ai_answer, analysis, is_correct, status, review_status FROM questions WHERE id = $1', [QID]))[0],
    wrong_questions: await q('SELECT id FROM wrong_questions WHERE question_id = $1', [QID])
  }
  console.log('=== 修复后 ===')
  console.log(JSON.stringify(after, null, 1))
  await pool.end()
}

run().catch(async (e) => {
  console.error('[fatal]', e)
  try { await pool.end() } catch {}
  process.exitCode = 1
})
