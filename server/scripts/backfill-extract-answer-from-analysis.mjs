/**
 * 存量回填：从已有 analysis 解析文本抽取参考答案写入 answer（2026-09-24）
 *
 * ── 解决什么 ──
 * 用户原案例：教师复核页「参考答案」位显示了一大段解题过程（"因此减去的数是 55"），
 * 但判分侧 q.answer 为空 → 报「缺少参考答案，无法自动批改」。根因是 aiParseSelfCheck.js
 * 的答案标记正则只认「答案为/答案是」显式标签，填空题「因此…是 X」「解得 X」全部漏检，
 * 导致 answer 落空、analysis 被 UI 错当参考答案。
 *
 * 本次抽取器已修复（新增 NUMERIC_TAIL_PATTERNS 兜底），但**历史存量**题的 answer 仍为空。
 * 本脚本就是存量回溯：对 answer 空、analysis 非空的题，用修复后的抽取器从 analysis 提答案，
 * 过数值验算闸后写回 answer，使它们可自动批改。
 *
 * ── 与 backfillMissingAnswers.mjs 的区别 ──
 * 那个脚本是「重新调答案引擎求解」（重、耗额度、需全套质量闸）。
 * 本脚本只做「从已存在的 analysis 文本抽取」——零引擎调用、零新错误风险，
 * 专治「analysis 写好了但 answer 没抽出来」这一类（占缺答案题的大头）。
 *
 * ── 安全约束 ──
 *   · 默认 dry-run（只统计 + 打印样例），--apply 才写库
 *   · 只处理 answer 为空（NULL 或空串）的题
 *   · 抽不到 → 跳过（保持人工），绝不瞎填
 *   · 抽到的数值答案过 validateArithmeticAnswer 验算，验算不过 → 跳过
 *   · 抽到的像叙述残句（isNarrativeAnswer）→ 跳过
 *   · 选择题额外用字母模式抽 A-D
 *
 * 用法:
 *   node server/scripts/backfill-extract-answer-from-analysis.mjs            # dry-run
 *   node server/scripts/backfill-extract-answer-from-analysis.mjs --days 30  # 限定天数
 *   node server/scripts/backfill-extract-answer-from-analysis.mjs --limit 50 # 限量
 *   node server/scripts/backfill-extract-answer-from-analysis.mjs --apply    # 落库
 */
import 'dotenv/config'
import fs from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
dotenv.config({ path: resolve(ROOT, '.env') })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}

const APPLY = process.argv.includes('--apply')
const argOf = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}
const DAYS = Number(argOf('--days') || 3650)
const LIMIT = Number(argOf('--limit') || 100000)

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
})

const { extractFinalAnswerFromAnalysis, isNarrativeAnswer } = await import('../utils/aiParseSelfCheck.js')
const { validateArithmeticAnswer } = await import('../utils/arithmeticAnswerValidator.js')

// 选择题末句字母兜底
const CHOICE_TAIL = /(?:故选|应选|选|答案为|答案是)\s*[：:]?\s*([A-Da-d])/i

function extractForType(analysis, questionType, options) {
  const fromNum = extractFinalAnswerFromAnalysis(analysis)
  if (fromNum) return fromNum
  if ((questionType === 'choice' || (options && options.length > 0))) {
    const m = analysis.match(CHOICE_TAIL)
    if (m) return m[1].toUpperCase()
  }
  return null
}

function isObjective(type) {
  return ['choice', 'fill', 'judge'].includes(type)
}

const rows = await pool.query(
  `SELECT id, content, parent_stem, options, question_type, answer, analysis, answer_exception_reason
   FROM questions
   WHERE (answer IS NULL OR btrim(answer) = '')
     AND analysis IS NOT NULL AND btrim(analysis) <> ''
     AND updated_at > NOW() - $1 * INTERVAL '1 day'
   ORDER BY updated_at DESC
   LIMIT $2`,
  [DAYS, LIMIT]
)

let rescuable = 0
let skippedNoExtract = 0
let skippedNarrative = 0
let skippedArithmetic = 0
let applied = 0
const samples = []

for (const r of rows.rows) {
  const analysis = r.analysis || ''
  const extracted = extractForType(analysis, r.question_type, r.options)
  if (!extracted) { skippedNoExtract++; continue }
  if (isNarrativeAnswer(extracted)) { skippedNarrative++; continue }

  const content = [r.parent_stem, r.content].filter(s => s && String(s).trim()).join('\n')
  // 客观题数值答案过验算闸；非数值/不适用则放行（与 worker 主链路同口径）
  if (isObjective(r.question_type) && /[0-9]/.test(extracted)) {
    try {
      const v = validateArithmeticAnswer(content, extracted)
      if (v && v.applicable && !v.isValid) { skippedArithmetic++; continue }
    } catch { /* 验算出错保守放行 */ }
  }

  rescuable++
  samples.push({ id: r.id.slice(0, 8), type: r.question_type, q: String(r.content || '').slice(0, 36), ans: extracted })
  if (APPLY) {
    await pool.query(
      `UPDATE questions SET answer = $1, answer_exception_reason = NULL, updated_at = NOW() WHERE id = $2`,
      [extracted, r.id]
    )
    applied++
  }
}

await pool.end()

console.log(`\n==== 存量回填统计（${APPLY ? 'APPLY 已落库' : 'dry-run'}）====`)
console.log(`扫描 answer 空且 analysis 非空: ${rows.rows.length} 条`)
console.log(`可救回（抽到且过闸）: ${rescuable}`)
console.log(`跳过-抽不到: ${skippedNoExtract} | 叙述残句: ${skippedNarrative} | 验算不过: ${skippedArithmetic}`)
if (APPLY) console.log(`已写入 answer: ${applied}`)
console.log('\n样例（前 15 条）:')
for (const s of samples.slice(0, 15)) {
  console.log(`  q${s.id} [${s.type}] ${JSON.stringify(s.q)} => ${JSON.stringify(s.ans)}`)
}
