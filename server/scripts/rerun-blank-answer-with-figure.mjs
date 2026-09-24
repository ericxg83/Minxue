/**
 * 存量重跑：「带配图 + 参考答案为空」的题，用当前答案引擎重新求解（2026-09-24）
 *
 * ── 为什么需要 ──
 * 实测（见 `_配图题答案可解性-实测报告-20260924.md`）：全库 51 道「有配图 且 answer 为空」
 * 的题里，**47% 用当前引擎的纯文字链路当场就能解对**（抽查 15+ 题全对，多题与库中真值逐字吻合），
 * 另有约 22% 给足 150s 也能解出。它们当初落空的原因是批改时的引擎配置弱 / 45s 超时太紧，
 * **不是「缺图」** —— 所以正确处置是**重跑**，而不是给链路加读图
 * （读图只覆盖 20% 的真依赖图题，且引入「读错图写错答案」风险）。
 *
 * ── 与「AI 重解析」按钮的区别 ──
 * 按钮是同步单题、45s 超时（交互场景不能让人等 3 分钟）；
 * 本脚本是离线批量、可配 150s+ 超时，且逐题过闸后才落库。
 *
 * ── 安全约束 ──
 *   · 默认 dry-run（只统计 + 打印样例），`--apply` 才写库
 *   · **只处理 answer 为空（NULL 或空串）的题 —— 绝不覆盖已有答案**
 *   · 必须过 validateAIAnswer（拦「待人工补充」/ 主观题 / 「-」/ 纯空白）
 *   · 客观题数值答案过 validateArithmeticAnswer 验算
 *   · 叙述残句过 isNarrativeAnswer 拦截
 *   · 写库只改 `answer` + 清 `answer_exception_reason`，**不动 analysis / 判定 / 错题本 / 掌握度**
 *
 * ⚠️ 实测已发现：在「真依赖图」的题上给足时间会诱导模型编答案
 *    （同一道题两次运行，一次答「待人工补充」、一次给出具体值；另有题输出「四个选项全选」）。
 *    故本脚本只自动采纳**能过闸**的答案，且强烈建议 `--apply` 前先人工过一遍 dry-run 清单。
 *
 * 用法:
 *   node server/scripts/rerun-blank-answer-with-figure.mjs                     # dry-run
 *   node server/scripts/rerun-blank-answer-with-figure.mjs --limit 10          # 限量试跑
 *   node server/scripts/rerun-blank-answer-with-figure.mjs --timeout 150000 --conc 4
 *   node server/scripts/rerun-blank-answer-with-figure.mjs --apply             # 落库
 *   node server/scripts/rerun-blank-answer-with-figure.mjs --out /d/tmp/x.json # 明细落盘
 */
import '../loadEnv.js'
import pg from 'pg'
import fs from 'node:fs'
import { callAnswerEngineCompletion, buildAnswerGenerationPrompt } from '../config/ai.js'
import { formatOptionsForPrompt } from '../utils/optionText.js'
import { extractFinalAnswerFromAnalysis, isNarrativeAnswer } from '../utils/aiParseSelfCheck.js'
import { validateArithmeticAnswer } from '../utils/arithmeticAnswerValidator.js'
import { extractChoiceLetters, stripAnswerScaffolding } from '../services/judgeService.js'

// AI 调用必须关代理（否则被网关拦成 400，看起来像模型不存在）
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}

const APPLY = process.argv.includes('--apply')
const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }
const LIMIT = Number(argOf('--limit') || 100000)
const TIMEOUT = Number(argOf('--timeout') || 150000)
const CONC = Number(argOf('--conc') || 3)
const VENDOR = argOf('--vendor') || 'Bailian'
const MODEL = argOf('--model') || 'qwen3.8-flash'
const DAYS = Number(argOf('--days') || 3650)
const OUT = argOf('--out') || null
// --exclude <id,id,...>  落库时排除指定题目（用于挡掉人工复核发现的可疑答案）
const EXCLUDE = argOf('--exclude') || null
// --ids <id,id,...>  只跑指定题目（用于精确重跑某类子集，如「静默空」那批）
const IDS = argOf('--ids') || null
// --commit <plan.json>   从 dry-run 产出的明细文件落库，**不再调用任何 AI**
//   （两阶段：先 --out 出清单 → 人工过一遍 → --commit 落库，避免重复烧额度）
const COMMIT = argOf('--commit') || null

/**
 * 逐字复刻 `worker.js:1952 validateAIAnswer`。
 * ⚠️ 刻意不 import worker.js：它会连带加载 queue.js 建立 Redis 连接，
 *    有抢生产队列的风险（见 .workbuddy-ai/memory/topics/local-dev-process.md）。
 *    改动 worker 里这个函数时，必须同步改这里。
 */
const validateAIAnswer = (answer, analysis) => {
  if (!answer || answer.trim() === '') return { isValid: false, reason: '答案为空' }
  const trimmed = answer.trim()
  if (trimmed === '待人工补充' || trimmed === '此为主观题，无唯一标准答案' || trimmed === '-') {
    return { isValid: false, reason: 'AI标记需要人工补充' }
  }
  if (analysis && analysis.length < 10 && answer.length > 100) {
    return { isValid: false, reason: '答案过长且解析过短，疑似异常' }
  }
  if (/^[\s_]+$/.test(answer)) return { isValid: false, reason: '答案仅包含空白或下划线' }
  return { isValid: true }
}

const buildEngineInput = (q) => {
  const stem = [q.parent_stem, q.content].filter(s => s && String(s).trim()).join('\n')
  const options = Array.isArray(q.options) ? q.options : []
  const optText = options.length ? formatOptionsForPrompt(options) : ''
  return optText ? `${stem}\n选项：${optText}` : stem
}

const stripFence = (s) => String(s || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
const isObjective = (t) => ['choice', 'fill', 'judge'].includes(String(t || '').toLowerCase())
// ⚠️ extractChoiceLetters 只能用于 choice 题：填空题的答案可能是单个字母表达式（如化简结果 `b`），
//    对它做字母提取会误转成大写 `B`，污染答案。生产 normalizeGeneratedAnswer 也是只在 choice 分支用它。
const isChoice = (t) => String(t || '').toLowerCase() === 'choice'

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
})

let rows = (await pool.query(
  `SELECT id, task_id, question_number, question_type, parent_stem, content, options, answer
   FROM questions
   WHERE deleted_at IS NULL
     AND geometry_image_url IS NOT NULL AND btrim(geometry_image_url) <> ''
     AND (answer IS NULL OR btrim(answer) = '')
     AND updated_at > NOW() - $1 * INTERVAL '1 day'
   ORDER BY updated_at DESC
   LIMIT $2`,
  [DAYS, LIMIT]
)).rows

const wantSet = new Set((IDS || '').split(',').map(s => s.trim()).filter(Boolean))
if (wantSet.size) rows = rows.filter(r => wantSet.has(r.id))

const banSet = new Set((EXCLUDE || '').split(',').map(s => s.trim()).filter(Boolean))
if (banSet.size) rows = rows.filter(r => !banSet.has(r.id))

// ── --commit 模式：从 dry-run 明细落库，**零 AI 调用** ──
if (COMMIT) {
  const plan = JSON.parse(fs.readFileSync(COMMIT, 'utf8'))
  const okRows = plan.filter(r => r.status === 'ok' && !banSet.has(r.id))
  console.log(`[rerun-blank-figure] --commit ${COMMIT}：待落库 ${okRows.length} 条（排除名单 ${banSet.size} 条）`)
  let applied = 0, skipped = 0
  for (const r of okRows) {
    const res = await pool.query(
      `UPDATE questions SET answer = $1, answer_exception_reason = NULL, updated_at = NOW()
       WHERE id = $2 AND (answer IS NULL OR btrim(answer) = '')`,
      [r.answer, r.id]
    )
    if (res.rowCount > 0) {
      applied++
      console.log(`  ✅ q#${r.qno ?? '?'} [${r.type}] = ${JSON.stringify(String(r.answer).slice(0, 60))}`)
    } else {
      skipped++
      console.log(`  ⏭️  q#${r.qno ?? '?'} 跳过（已有答案 / 题不存在）`)
    }
  }
  await pool.end()
  console.log(`\n==== --commit 完成：写入 ${applied}，跳过 ${skipped} ====`)
  process.exit(0)
}

console.log(`[rerun-blank-figure] 候选 ${rows.length} 题 | 通道 ${VENDOR}:${MODEL} | timeout=${TIMEOUT}ms conc=${CONC} | ${APPLY ? '⚠️ APPLY 落库' : 'dry-run'}`)

const solveOne = async (q) => {
  const input = buildEngineInput(q)
  const base = { id: q.id, qno: q.question_number, type: q.question_type, input: input.slice(0, 160) }
  if (!input.trim()) return { ...base, status: 'skip', why: 'no_stem' }

  const t0 = Date.now()
  let parsed = null
  let provider = null
  try {
    const r = await callAnswerEngineCompletion({
      systemContent: buildAnswerGenerationPrompt(),
      userContent: `请计算以下题目的标准答案：\n\n${input}`,
      temperature: 0.2,
      maxTokens: 4096,
      vendorOverride: VENDOR,
      model: MODEL,
      timeoutMs: TIMEOUT,
      strictPrimary: true,
      fallback: false,
    })
    provider = r.provider
    try { parsed = JSON.parse(stripFence(r.content)) } catch { parsed = null }
  } catch (e) {
    return { ...base, status: 'skip', why: `${e.name}:${String(e.message).slice(0, 80)}`, ms: Date.now() - t0 }
  }
  if (!parsed) return { ...base, status: 'skip', why: 'json_parse_failed', ms: Date.now() - t0 }

  const analysis = String(parsed.analysis || '')
  let answer = String(parsed.answer || '').trim()

  // 闸 1：引擎自述不会（「待人工补充」等）→ 绝不落库，保持转人工
  const v1 = validateAIAnswer(answer, analysis)
  if (!v1.isValid) {
    // 还有一线机会：从 analysis 里抽（与 worker 主链路同口径）
    const rescued = extractFinalAnswerFromAnalysis(analysis)
    if (!rescued) return { ...base, status: 'skip', why: `validate:${v1.reason}`, ms: Date.now() - t0, analysis: analysis.slice(0, 100) }
    answer = rescued
  }

  // 闸 2：形态归一（与生产同口径）
  answer = isChoice(q.question_type)
    ? (extractChoiceLetters(answer) || stripAnswerScaffolding(answer))
    : stripAnswerScaffolding(answer)
  answer = String(answer || '').trim()
  if (!answer) return { ...base, status: 'skip', why: 'empty_after_normalize', ms: Date.now() - t0 }

  // 闸 3：叙述残句（「应包含10」这类元话语）不得当答案
  if (isNarrativeAnswer(answer)) return { ...base, status: 'skip', why: 'narrative', ms: Date.now() - t0, cand: answer.slice(0, 60) }

  // 闸 4：数值答案验算
  if (isObjective(q.question_type) && /[0-9]/.test(answer)) {
    try {
      const v = validateArithmeticAnswer(input, answer)
      if (v && v.applicable && !v.isValid) {
        return { ...base, status: 'skip', why: `arithmetic:${v.reason}`, ms: Date.now() - t0, cand: answer.slice(0, 60) }
      }
    } catch { /* 验算出错保守放行，与生产同口径 */ }
  }

  return { ...base, status: 'ok', answer, analysis: analysis.slice(0, 200), provider, ms: Date.now() - t0 }
}

const results = []
let idx = 0
await Promise.all(Array.from({ length: CONC }, async () => {
  while (idx < rows.length) {
    const q = rows[idx++]
    const r = await solveOne(q)
    results.push(r)
    const tag = r.status === 'ok' ? 'OK  ' : 'SKIP'
    console.log(`[${String(results.length).padStart(2)}/${rows.length}] ${tag} ${String(r.ms ?? 0).padStart(6)}ms q#${r.qno ?? '?'} ${r.status === 'ok' ? JSON.stringify(r.answer.slice(0, 60)) : '<' + r.why + '>'}`)
    await new Promise(res => setTimeout(res, 300))
  }
}))

const okRows = results.filter(r => r.status === 'ok')
let applied = 0
if (APPLY) {
  for (const r of okRows) {
    await pool.query(
      `UPDATE questions SET answer = $1, answer_exception_reason = NULL, updated_at = NOW() WHERE id = $2 AND (answer IS NULL OR btrim(answer) = '')`,
      [r.answer, r.id]
    )
    applied++
  }
}
await pool.end()

const byWhy = {}
for (const r of results.filter(x => x.status === 'skip')) byWhy[r.why] = (byWhy[r.why] || 0) + 1

console.log(`\n==== 存量重跑统计（${APPLY ? 'APPLY 已落库' : 'dry-run'}）====`)
console.log(`候选: ${results.length} ｜ 可救回(过全部闸): ${okRows.length} ｜ 跳过: ${results.length - okRows.length}`)
console.log('跳过原因分布:')
for (const [k, v] of Object.entries(byWhy).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`)
if (APPLY) console.log(`已写入 answer: ${applied}`)
console.log('\n可救回清单:')
for (const r of okRows) console.log(`  q#${String(r.qno ?? '?').padStart(3)} [${r.type}] ${JSON.stringify(r.answer.slice(0, 70))}`)
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); console.log(`\n明细 → ${OUT}`) }
process.exit(0)
