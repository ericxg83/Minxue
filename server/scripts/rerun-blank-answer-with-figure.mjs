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
 * 本脚本是离线批量、可配 240s+ 超时，且逐题过闸后才落库。
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
 *   node server/scripts/rerun-blank-answer-with-figure.mjs --timeout 240000 --conc 4
 *   node server/scripts/rerun-blank-answer-with-figure.mjs --apply             # 落库
 *   node server/scripts/rerun-blank-answer-with-figure.mjs --out /d/tmp/x.json # 明细落盘
 *   # 测限流敏感的通道（SenseNova:kimi-k3 等）必须 --conc 1 + --gap 6000，否则全是 429 假失败
 *   node server/scripts/rerun-blank-answer-with-figure.mjs --vendor SenseNova --model kimi-k3 \
 *     --conc 1 --gap 6000 --timeout 90000 --ids <id,id> --out /d/tmp/x.json
 */
import '../loadEnv.js'
import pg from 'pg'
import fs from 'node:fs'
import { callAnswerEngineCompletion, buildAnswerGenerationPrompt } from '../config/ai.js'
import { formatOptionsForPrompt } from '../utils/optionText.js'
import { extractFinalAnswerFromAnalysis, isNarrativeAnswer } from '../utils/aiParseSelfCheck.js'
import { validateArithmeticAnswer } from '../utils/arithmeticAnswerValidator.js'
import { extractChoiceLetters, stripAnswerScaffolding } from '../services/judgeService.js'
import { isSameAnswerSemantic } from '../utils/mathExprNormalize.js'

// AI 调用必须关代理（否则被网关拦成 400，看起来像模型不存在）
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}

const APPLY = process.argv.includes('--apply')
const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }
const LIMIT = Number(argOf('--limit') || 100000)
// ⚠️ 默认超时 150s → 240s（2026-09-24 放宽）
//    150s 是脚本作者（我）为「离线批量」设的经验值，**不是模型上限**。
//    用户指出 `Bailian:qwen3.8-flash` 是**收费**模型，不该被过紧的超时掐死。
//    实测：离线 3 并发下 23 题里 7 题卡在 150s（严格模式不降级 ⇒ 整题判死）。
//    放宽只增加等待时长，**不增加费用**（按 token 计费）；仍可用 `--timeout <ms>` 覆盖。
const TIMEOUT = Number(argOf('--timeout') || 240000)
const CONC = Number(argOf('--conc') || 3)
const VENDOR = argOf('--vendor') || 'Bailian'
const MODEL = argOf('--model') || 'qwen3.8-flash'
const DAYS = Number(argOf('--days') || 3650)
const OUT = argOf('--out') || null
// --any  不限制「必须带配图」，跑全部 answer 为空且 analysis 非空的题。
//   为什么需要（2026-09-24）：本脚本原设计只针对「带配图」那批（当时假设缺答案是配图题特有）。
//   全库复查后发现缺答案的 127 条里 **105 条根本没有配图** —— 它们落空的原因是当初引擎配置弱 /
//   超时紧 / 题干不全，与配图无关。加此开关才能覆盖全量。
const ANY_Q = process.argv.includes('--any')
// --exclude <id,id,...>  落库时排除指定题目（用于挡掉人工复核发现的可疑答案）
const EXCLUDE = argOf('--exclude') || null
// --ids <id,id,...>  只跑指定题目（用于精确重跑某类子集，如「静默空」那批）
//   ⚠️ 支持**前缀匹配**：传 8 位短 id 即可（2026-09-24 改）。原先只认完整 uuid，
//      从日志/清单里复制短 id 会静默筛成 0 条，白跑一轮还查不出原因。
const IDS = argOf('--ids') || null
// --chain  走**完整生产答案引擎链**（不点名单一通道、不锁严格模式）。
//   为什么需要（2026-09-24）：本脚本原先硬编码 `Bailian:qwen3.8-flash` + strictPrimary，
//   而该通道在离线 3 并发下大面积 150s 超时（实测 23 题里 7 题），超时即整题判死。
//   生产链（SenseNova 模型池 × 双 Key → 备用供应商）有降级能力，不会因单通道抖动全灭。
//   代价：首跳模型是 deepseek-flash（实测可判正确率低于 qwen3.8-flash），
//   故**默认仍用点名通道**，只在点名通道整体不可用时才用 --chain 兜底。
const CHAIN = process.argv.includes('--chain')
// --parent-fixable  只跑「parent_stem 非空、且 parent_stem 本身不是纯引导语」的题。
//   为什么需要（2026-09-24）：全库统计出 43 条「parent_stem 非空 + AI 自述解不出」的题，
//   但其中一部分 parent_stem 也只是引导语（如 `列式计算。` / `运用适当方法计算。`），
//   真正的题目内容在更上一层 —— 这类重跑同样解不出，必须先修题面，不属于本开关的目标。
const PARENT_FIXABLE = process.argv.includes('--parent-fixable')
// 整段只有指令词、没有任何可解内容（与 diagnose-blank-answers.mjs 同口径）
// ⚠️ 2026-09-24 扩展：原版漏掉了 `用分数表示下列除法所得的数。` / `将下列分数表示成两个整数相除的式子。`
//    / `在数轴下方的空格内填入适当的分数。` / `写出下列…` 等变体 —— 它们在 `_diag_ghost_rows.mjs`
//    里被单独识别为「幽灵行」（公共题干/引导语被存成了一道题），这里必须同步收进来。
const LEADING_ONLY = /^[（(]?\s*\d*\s*[）)]?\s*(列式计算|计算|解方程|解不等式|化简|求值|解答|证明|作图|填空|选择|判断|口算|直接写出得数|用竖式计算|脱式计算|简算|解决问题|看图列式|运用适当方法计算|用分数表示|用.{0,8}表示.{0,20}|将下列.{0,20}表示成.{0,20}|在.{0,20}(空格|横线|括号|数轴|图中).{0,24}(填入|填写|填上).{0,24}|写出下列|求下列|解下列|计算下列)[。.：:，,、\s]*$/
// 题号占位行（「第 36 题」「(36)」）—— 同样是 OCR 把题号行当成了题目
const QNO_ONLY = /^[（(]?\s*第?\s*\d+\s*[）)]?\s*题?[。.：:，,、\s]*$/
// --gap <ms>  每题之间的间隔（默认 300ms）。测**免费/限流敏感**的通道（如 SenseNova:kimi-k3）
//   时必须 ≥6000ms 且 `--conc 1`：并发 + 密集请求会打爆 tpm/rpm，产生大量「假失败」，
//   现象是 `engine-empty:*`（429），**不能归因到模型能力**（2026-09-24 实测踩过）。
const GAP = Number(argOf('--gap') || 300)
// --commit <plan.json>   从 dry-run 产出的明细文件落库，**不再调用任何 AI**
//   （两阶段：先 --out 出清单 → 人工过一遍 → --commit 落库，避免重复烧额度）
const COMMIT = argOf('--commit') || null
// --once  跳过「同题两次独立运行」的防幻觉比对（快一倍，但更易采信幻觉，仅调试用）
const ONCE = process.argv.includes('--once')
// --list-only  只打印过滤后的候选清单并退出，**不调用任何 AI**（用于核对 --ids / 幽灵行过滤的效果）
const LIST_ONLY = process.argv.includes('--list-only')

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
     ${ANY_Q ? '' : `AND geometry_image_url IS NOT NULL AND btrim(geometry_image_url) <> ''`}
     AND (answer IS NULL OR btrim(answer) = '')
     AND updated_at > NOW() - $1 * INTERVAL '1 day'
   ORDER BY updated_at DESC
   LIMIT $2`,
  [DAYS, LIMIT]
)).rows

const wantSet = new Set((IDS || '').split(',').map(s => s.trim()).filter(Boolean))
// 前缀匹配：允许从日志/清单复制 8 位短 id（完整 uuid 也照常命中）
if (wantSet.size) rows = rows.filter(r => [...wantSet].some(w => r.id === w || r.id.startsWith(w)))

const banSet = new Set((EXCLUDE || '').split(',').map(s => s.trim()).filter(Boolean))
if (banSet.size) rows = rows.filter(r => !banSet.has(r.id))

// ── 默认排除「幽灵行」：公共题干 / 引导语被单独存成了一道题 ──
//   为什么（2026-09-24）：全库扫出 14 条这类行（`_diag_ghost_rows.mjs`）。它们的 `answer`
//   **本就该为空**（真正的题目在别的行里）⇒ 重跑只会白烧额度、并得到「待人工补充」。
//   其中还有几条连子项都没有（`145aa098` 等），重跑**必然失败**。
//   `--keep-ghost` 关闭此过滤（仅调试用）。
//
//   ⚠️ 只用形态判据**不够**：实测漏网 6 条 ——
//     · 「设x是实数。在下列各式后的横线上，填写使各式有意义的x应满足的条件：」被原 `QUESTIONISH`
//       里的「填」字放行（它确实含"填"，但是引导语）
//     · `d5458d8a`「如图，已知：四边形ABCD为菱形…连接BE。」不以冒号结尾，形态判据抓不到
//   故补上**最强信号**：若同 task 内**别的行**把本行 content 当作自己的 `parent_stem`，
//   本行就是公共题干行。（必须排除本行自身：`d5458d8a` 的 parent_stem 与 content 几乎逐字相同。）
const KEEP_GHOST = process.argv.includes('--keep-ghost')
// 与 `_diag_ghost_rows.mjs` 同源的归一化（含零宽字符清理，理由见 `_repair-ghost-rows.mjs`）
const norm = (s) => String(s ?? '').replace(/\s+/g, '')
  .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
  .replace(/[，。、；：！？（）【】《》""''·．,.;:!?()\[\]<>"'_＿]/g, '').toLowerCase()
if (!KEEP_GHOST) {
  const { rows: refs } = await pool.query(
    `SELECT task_id, parent_stem, array_agg(id::text) AS ids FROM questions
     WHERE deleted_at IS NULL AND parent_stem IS NOT NULL AND btrim(parent_stem) <> ''
     GROUP BY task_id, parent_stem`)
  const refIndex = new Map()
  for (const x of refs) refIndex.set(`${x.task_id}|${norm(x.parent_stem)}`, x.ids)

  const before = rows.length
  rows = rows.filter(r => {
    const c = String(r.content || '').replace(/\s+/g, ' ').trim()
    if (!c) return true
    if (LEADING_ONLY.test(c) || QNO_ONLY.test(c)) return false
    // 冒号结尾的短句 = 引导语（不再看 QUESTIONISH：它会把「…填写使各式有意义的x…：」放行）
    if (/[：:]\s*$/.test(c) && c.length <= 60) return false
    // 本行 content 被同 task 别的行引用为 parent_stem ⇒ 本行是公共题干行
    const ids = refIndex.get(`${r.task_id}|${norm(c)}`)
    if (ids && ids.some(x => x !== r.id)) return false
    return true
  })
  if (rows.length !== before) console.log(`[ghost-filter] 排除「幽灵行」${before - rows.length} 条（--keep-ghost 可关闭）`)
}

if (PARENT_FIXABLE) {
  const before = rows.length
  rows = rows.filter(r => {
    const p = String(r.parent_stem || '').trim()
    if (!p) return false
    if (LEADING_ONLY.test(p)) return false
    // parent 与 content 逐字相同 → 说明「公共题干」位其实放的是子题干，没有额外条件
    if (p === String(r.content || '').trim()) return false
    return true
  })
  console.log(`[--parent-fixable] 筛出 ${rows.length} 条（原 ${before} 条）`)
}

// ── --commit 模式：从 dry-run 明细落库，**零 AI 调用** ──
if (COMMIT) {
  const plan = JSON.parse(fs.readFileSync(COMMIT, 'utf8'))
  const okRows = plan.filter(r => r.status === 'ok' && !banSet.has(r.id))
  console.log(`[rerun-blank-figure] --commit ${COMMIT}：待落库 ${okRows.length} 条（排除名单 ${banSet.size} 条）`)
  let applied = 0, skipped = 0
  for (const r of okRows) {
    const res = await pool.query(
      `UPDATE questions SET answer = $1, answer_exception = FALSE, answer_exception_reason = NULL,
         updated_at = NOW()
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

console.log(`[rerun-blank-figure] 候选 ${rows.length} 题 | 通道 ${CHAIN ? '生产链(含降级)' : `${VENDOR}:${MODEL}`} | timeout=${TIMEOUT}ms conc=${CONC} | ${APPLY ? '⚠️ APPLY 落库' : 'dry-run'}`)

// --list-only：只出清单，零 AI 调用（核对过滤效果用）
if (LIST_ONLY) {
  console.log(`\n[--list-only] 候选 ${rows.length} 条：`)
  for (const r of rows) {
    console.log(`  ${String(r.id).slice(0, 8)} q#${r.question_number} p${r.page_number} [${r.question_type}] par=${r.parent_stem ? 'Y' : '.'} fig=${r.geometry_image_url ? 'Y' : '.'} ${JSON.stringify(String(r.content || '').replace(/\s+/g, ' ').slice(0, 64))}`)
  }
  await pool.end()
  process.exit(0)
}

const solveOne = async (q) => {
  const input = buildEngineInput(q)
  const base = { id: q.id, qno: q.question_number, type: q.question_type, input: input.slice(0, 160) }
  if (!input.trim()) return { ...base, status: 'skip', why: 'no_stem' }

  const t0 = Date.now()
  let parsed = null
  let provider = null
  // ⚠️ 引擎原始 content 必须提到 try 外：超时/无通道路径下要在下面判断「是空内容还是坏 JSON」，
  //    原先写 `r?.content`（r 是 try 块内的 const）→ 一旦走到这里就 ReferenceError 崩掉整个批跑
  //    （2026-09-24 实测：第 2 题 90s 超时后脚本直接崩，前 1 题的结论也没落盘）。
  let engineContent = ''
  try {
    const r = await callAnswerEngineCompletion({
      systemContent: buildAnswerGenerationPrompt(),
      userContent: `请计算以下题目的标准答案：\n\n${input}`,
      temperature: 0.2,
      maxTokens: 4096,
      // --chain：不点名通道、不锁严格模式 → 走完整生产链（含降级）
      ...(CHAIN ? {} : { vendorOverride: VENDOR, model: MODEL, strictPrimary: true, fallback: false }),
      timeoutMs: TIMEOUT,
    })
    provider = r.provider
    engineContent = r.content
    try { parsed = JSON.parse(stripFence(r.content)) } catch { parsed = null }
  } catch (e) {
    return { ...base, status: 'skip', why: `${e.name}:${String(e.message).slice(0, 80)}`, ms: Date.now() - t0 }
  }
  // ⚠️ 区分「引擎没给内容」与「给了内容但不是 JSON」：
  //    严格模式下引擎失败（429/超时/无通道）**不抛异常**，而是返回
  //    `{content:'', provider:'primary-unavailable'|'no-channel-available'}`。
  //    若一律报 `json_parse_failed`，会把「被 429 打爆」误读成「模型 JSON 不健康」
  //    —— 2026-09-24 差点据此得出「kimi-k3 不可用」的错误结论（实际是并发打爆 rpm）。
  if (!parsed) {
    const emptyContent = !String(engineContent || '').trim()
    return {
      ...base, status: 'skip', ms: Date.now() - t0,
      why: emptyContent ? `engine-empty:${provider || 'unknown'}` : 'json_parse_failed',
    }
  }

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
    // ⛔ 防幻觉二次比对（2026-09-24 补上，与 solve-with-figure 同口径）：
    //    实测「在真依赖图的题上给足时间会诱导编答案」——同题两次运行一次答「待人工补充」、
    //    一次给具体值。单次采样过闸并不能排除幻觉，必须两次独立运行且答案实质同解才采纳。
    //    比对用 isSameAnswerSemantic（数学式归一 + 叙述型答案包含关系），
    //    否则「run1 给完整证明 / run2 只给结论」这类同解异写会被误丢（2026-09-24 实测 2 条）。
    if (r.status === 'ok' && !ONCE) {
      const r2 = await solveOne(q)
      if (r2.status !== 'ok' || !isSameAnswerSemantic(r.answer, r2.answer)) {
        r.why = r2.status !== 'ok' ? `run2:${r2.why}` : `两次不一致(${r.answer} vs ${r2.answer})`
        r.status = 'skip'
      }
    }
    results.push(r)
    const tag = r.status === 'ok' ? 'OK  ' : 'SKIP'
    // ⚠️ 必须带 id：日志是唯一能事后落库/追溯的来源（--out 文件在 Git Bash 下会把
    //    `/d/...` 转义成 `D:\d\...` 而写失败，2026-09-24 实测踩过，58 条结论因此差点全丢）。
    console.log(`[${String(results.length).padStart(2)}/${rows.length}] ${tag} ${String(r.ms ?? 0).padStart(6)}ms ${String(r.id).slice(0, 8)} q#${r.qno ?? '?'} ${r.status === 'ok' ? JSON.stringify(r.answer.slice(0, 60)) : '<' + r.why + '>'}`)
    await new Promise(res => setTimeout(res, GAP))
  }
}))

const okRows = results.filter(r => r.status === 'ok')
let applied = 0
if (APPLY) {
  for (const r of okRows) {
    await pool.query(
      `UPDATE questions SET answer = $1, answer_exception = FALSE, answer_exception_reason = NULL,
         updated_at = NOW() WHERE id = $2 AND (answer IS NULL OR btrim(answer) = '')`,
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
