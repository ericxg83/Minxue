/**
 * 读图解题：对「参考答案为空 + 有配图」的题，让视觉模型**看着图**解出标准答案（2026-09-24）
 *
 * ── 用户明确要求 ──
 * 「缺图那就去找图，图到了你肯定要让 AI 自己读图解题。」
 * 背景：答案引擎主链路是**纯文字**（只喂 parent_stem + content + options），
 * 图表题/几何题的答案常常就画在图上 ⇒ 纯文字永远答「待人工补充」。
 * 本脚本补上这条链路：把题图 + 文字题干一起喂给视觉模型。
 *
 * ── ⛔ 防幻觉是设计核心（不是可选项）──
 * 实测教训（`_配图题答案可解性-实测报告-20260924.md`）：在「真依赖图」的题上给足时间会诱导模型编答案
 * （同一道题两次运行一次答「待人工补充」、一次给具体值；另有题输出「四个选项全选」）。
 * 因此本脚本：
 *   1. **同题两次独立运行**，归一化后答案必须**完全一致**才采纳（不一致 → 丢弃，转人工）；
 *   2. 过四道生产同款闸：validateAIAnswer → 形态归一 → isNarrativeAnswer → validateArithmeticAnswer；
 *   3. 模型自述「待人工补充」一律不落库（宁可留空，绝不猜）。
 *   ⚠️ 判幻觉的可靠方法是「同题两次独立运行比对」，不是「看答案像不像」。
 *
 * ── 安全约束 ──
 *   · 默认 dry-run，`--apply` 才写库
 *   · 只处理 answer 为空（NULL/空串）的题 —— 绝不覆盖已有答案
 *   · 写库只改 `answer` + 复位 `answer_exception` / `answer_exception_reason`，
 *     **不动 analysis / 判定 / 错题本 / 掌握度**
 *   · 图片下载走 `utils/noProxyHttp.js`（禁代理是硬约定）
 *
 * 用法:
 *   node server/scripts/solve-with-figure.mjs                      # dry-run
 *   node server/scripts/solve-with-figure.mjs --limit 5            # 限量
 *   node server/scripts/solve-with-figure.mjs --ids a1b2,c3d4      # 定向
 *   node server/scripts/solve-with-figure.mjs --once               # 跳过二次比对（快，但更易采信幻觉，仅调试用）
 *   node server/scripts/solve-with-figure.mjs --apply              # 落库
 */
import '../loadEnv.js'
import pg from 'pg'
import fs from 'node:fs'
import sharp from 'sharp'
import { callVisionCompletion, buildAnswerGenerationPrompt, ANSWER_PAGE_VENDOR_CHAIN } from '../config/ai.js'
import { downloadImageBufferNoProxy } from '../utils/noProxyHttp.js'
import { formatOptionsForPrompt } from '../utils/optionText.js'
import { extractFinalAnswerFromAnalysis, isNarrativeAnswer } from '../utils/aiParseSelfCheck.js'
import { validateArithmeticAnswer } from '../utils/arithmeticAnswerValidator.js'
import { extractChoiceLetters, stripAnswerScaffolding } from '../services/judgeService.js'
import { isSameMathAnswer } from '../utils/mathExprNormalize.js'

// AI 调用必须关代理（否则被网关拦成 400，看起来像模型不存在）
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}

const APPLY = process.argv.includes('--apply')
const ONCE = process.argv.includes('--once')
const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }
const LIMIT = Number(argOf('--limit') || 100000)
const TIMEOUT = Number(argOf('--timeout') || 120000)
const CONC = Number(argOf('--conc') || 2)
const DAYS = Number(argOf('--days') || 3650)
const IDS = (argOf('--ids') || '').split(',').map(s => s.trim()).filter(Boolean)
const OUT = argOf('--out') || null

/**
 * 读图版解题 prompt：在通用解题 prompt 基础上，追加「配图使用纪律」。
 * 关键：把「看不清就说看不清」写成硬要求，堵住模型为凑完整答案而编造图中数值的倾向。
 */
const FIGURE_SOLVE_PROMPT = buildAnswerGenerationPrompt() + `

【本次额外提供题目配图】
本次请求附带了这道题的**配图**（几何图 / 函数图象 / 统计图 / 数轴 / 示意图等）。
必须遵守以下纪律：
1. 图中的标注（点与字母、边长、角度、刻度、图注、单位）是题目条件的组成部分，必须读准再作答。
2. **只依据图里看得清的信息作答**。图中模糊、遮挡、裁切、看不清的部分，一律当作"没有这个信息"。
3. 如果配图缺少解题必需的信息（图被截断、关键标注看不清、无法确定所问对象），
   answer 必须填 "待人工补充"，并在 analysis 里明确指出"图里缺什么"。
4. ⛔ 严禁为了让答案看起来完整而编造图中不存在的数值或条件。
   留空转人工永远优于给出一个没看图就猜出来的答案。`

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
})

let rows = (await pool.query(
  `SELECT id, task_id, question_number, sub_no, question_type, parent_stem, content, options,
          geometry_image_url, clean_geometry_image_url
   FROM questions
   WHERE deleted_at IS NULL
     AND (answer IS NULL OR btrim(answer) = '')
     AND (geometry_image_url IS NOT NULL AND btrim(geometry_image_url) <> '')
     AND updated_at > NOW() - $1 * INTERVAL '1 day'
   ORDER BY updated_at DESC
   LIMIT $2`,
  [DAYS, LIMIT]
)).rows

if (IDS.length) {
  const want = new Set(IDS)
  rows = rows.filter(r => [...want].some(p => r.id.startsWith(p)))
}

console.log(`\n[solve-with-figure] 候选 ${rows.length} 题 | 视觉链 ${ANSWER_PAGE_VENDOR_CHAIN.map(c => `${c.vendor}:${c.model}`).join(' → ')} | timeout=${TIMEOUT}ms conc=${CONC} | 二次比对=${ONCE ? '关（--once）' : '开'} | ${APPLY ? 'APPLY' : 'dry-run'}`)

const stripFence = (s) => String(s || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
const isObjective = (t) => ['choice', 'fill', 'judge'].includes(String(t || '').toLowerCase())
const isChoice = (t) => String(t || '').toLowerCase() === 'choice'

const buildInput = (r) => {
  const content = [r.parent_stem, r.content].filter(s => s && String(s).trim()).join('\n')
  const options = Array.isArray(r.options) ? r.options : []
  return options.length > 0 ? `${content}\n选项：${formatOptionsForPrompt(options)}` : content
}

/**
 * 「两次运行是否一致」的比对 —— 用 `utils/mathExprNormalize.js`（含 LaTeX↔Unicode 归一）。
 * ⚠️ 必须归一后再比：实测第 1 题两次输出 `2 \times (\frac{5}{3})^n` 与 `2·(5/3)ⁿ`，
 *    是同一答案的两种写法，粗比对会把它当幻觉丢掉。
 *    同类差异还有加 `S=` 前缀、加「约-1.9」近似值（见 `_存量重跑候选清单-20260924.md`）。
 */
const sameAnswer = (a, b) => isSameMathAnswer(a, b)

/** 下载配图 → 压缩成适合视觉模型的 base64 dataURL（禁代理） */
const loadFigureDataURL = async (r) => {
  const url = (r.clean_geometry_image_url && String(r.clean_geometry_image_url).trim())
    || (r.geometry_image_url && String(r.geometry_image_url).trim())
  if (!url) return null
  const buf = await downloadImageBufferNoProxy(url)
  if (!buf || !buf.length) return null
  // 长边压到 1600：够看清标注，又不至于把请求撑爆
  const out = await sharp(buf).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 }).toBuffer()
  return `data:image/jpeg;base64,${out.toString('base64')}`
}

/** 单次读图求解 → { answer, analysis } 或 null */
const solveOnce = async (r, input, dataURL) => {
  const out = await callVisionCompletion({
    imageDataURL: dataURL,
    systemPrompt: FIGURE_SOLVE_PROMPT,
    userText: `请解答下面这道题（配图见本消息所附图片）：\n\n${input}`,
    temperature: 0.2,
    maxTokens: 4096,
    // ⚠️ callVisionCompletion **没有 timeoutMs 参数**（传了会被静默忽略）——
    //    视觉调用超时由 BACKUP_VISION_TIMEOUT_MS（默认 180s）统一控制。
    //    脚本的 --timeout 只用于日志展示，不生效。
    vendorChain: ANSWER_PAGE_VENDOR_CHAIN,
  })
  const text = typeof out === 'string' ? out : (out?.content || out?.text || '')
  const m = String(text).match(/\{[\s\S]*\}/)
  if (!m) return null
  let parsed
  try { parsed = JSON.parse(stripFence(m[0])) } catch { return null }
  return { answer: String(parsed.answer || '').trim(), analysis: String(parsed.analysis || '').trim() }
}

/** 四道生产同款闸；返回 { ok, answer, why } */
const runGates = (r, raw) => {
  const analysis = raw.analysis || ''
  let answer = String(raw.answer || '').trim()

  // 闸1：引擎自述不会 / 主观题 / 空白 → 绝不落库
  const v1 = validateAIAnswer(answer, analysis)
  if (!v1.isValid) {
    const rescued = extractFinalAnswerFromAnalysis(analysis)
    if (!rescued) return { ok: false, why: `validate:${v1.reason}` }
    answer = rescued
  }
  // 闸2：形态归一（与生产同口径）
  answer = isChoice(r.question_type)
    ? (extractChoiceLetters(answer) || stripAnswerScaffolding(answer))
    : stripAnswerScaffolding(answer)
  answer = String(answer || '').trim()
  if (!answer) return { ok: false, why: 'empty_after_normalize' }

  // 闸3：叙述残句
  if (isNarrativeAnswer(answer)) return { ok: false, why: 'narrative' }

  // 闸4：客观题数值答案过验算
  const content = [r.parent_stem, r.content].filter(s => s && String(s).trim()).join('\n')
  if (isObjective(r.question_type) && /[0-9]/.test(answer)) {
    try {
      const v = validateArithmeticAnswer(content, answer)
      if (v && v.applicable && !v.isValid) return { ok: false, why: `arithmetic:${v.reason || ''}`.slice(0, 60) }
    } catch { /* 验算出错保守放行（与 worker 同口径） */ }
  }
  return { ok: true, answer }
}

/** 逐字复刻 worker.js 的 validateAIAnswer（刻意不 import worker.js：会连带建 Redis 连接） */
function validateAIAnswer(answer, analysis) {
  const a = String(answer || '').trim()
  if (!a) return { isValid: false, reason: '答案为空' }
  if (a === '-' || a === '—' || a === '–') return { isValid: false, reason: '答案为空' }
  const PLACEHOLDER = /^(待人工补充|待补充|无法确定|无法唯一确定|无法作答|无|暂无|此为主观题.*|见解析.*)$/
  if (PLACEHOLDER.test(a)) return { isValid: false, reason: 'AI标记需要人工补充' }
  if (/待人工补充|无法唯一确定/.test(a) && a.length < 20) return { isValid: false, reason: 'AI标记需要人工补充' }
  if (a.length > 300) return { isValid: false, reason: '答案过长' }
  if (!analysis || !String(analysis).trim()) return { isValid: false, reason: '缺少解析' }
  return { isValid: true }
}

const results = []
let idx = 0
const t0 = Date.now()

const worker = async () => {
  while (idx < rows.length) {
    const r = rows[idx++]
    const n = idx
    const label = `q#${r.question_number}${r.sub_no ? '(' + r.sub_no + ')' : ''}`
    const started = Date.now()
    try {
      const dataURL = await loadFigureDataURL(r)
      if (!dataURL) {
        console.log(`[${n}/${rows.length}] SKIP ${label} <无图可读>`)
        results.push({ id: r.id, status: 'skip', why: 'no-image' })
        continue
      }
      const input = buildInput(r)
      const run1 = await solveOnce(r, input, dataURL)
      if (!run1) {
        console.log(`[${n}/${rows.length}] SKIP ${label} <模型无 JSON 输出>`)
        results.push({ id: r.id, status: 'skip', why: 'no-json' })
        continue
      }
      const g1 = runGates(r, run1)
      if (!g1.ok) {
        console.log(`[${n}/${rows.length}] SKIP ${label} <${g1.why}>`)
        results.push({ id: r.id, status: 'skip', why: g1.why })
        continue
      }

      // ⛔ 防幻觉核心：第二次独立运行，答案必须一致
      if (!ONCE) {
        const run2 = await solveOnce(r, input, dataURL)
        const g2 = run2 ? runGates(r, run2) : { ok: false, why: 'run2-failed' }
        const consistent = g2.ok && sameAnswer(g1.answer, g2.answer)
        if (!consistent) {
          const why = !g2.ok ? `run2:${g2.why}` : `两次不一致(${g1.answer} vs ${g2.answer})`
          console.log(`[${n}/${rows.length}] SKIP ${label} <${why}>`)
          results.push({ id: r.id, status: 'skip', why })
          continue
        }
      }

      const ms = Date.now() - started
      console.log(`[${n}/${rows.length}] OK   ${ms}ms ${label} => ${JSON.stringify(g1.answer)}`)
      results.push({ id: r.id, status: 'ok', answer: g1.answer, ms })

      if (APPLY) {
        await pool.query(
          `UPDATE questions SET answer = $1, answer_exception = FALSE, answer_exception_reason = NULL,
             updated_at = NOW() WHERE id = $2`,
          [g1.answer, r.id]
        )
      }
    } catch (e) {
      console.log(`[${n}/${rows.length}] SKIP ${label} <${e.name}:${String(e.message).slice(0, 60)}>`)
      results.push({ id: r.id, status: 'skip', why: `${e.name}:${String(e.message).slice(0, 60)}` })
    }
  }
}

await Promise.all(Array.from({ length: Math.max(1, CONC) }, worker))
await pool.end()

const ok = results.filter(x => x.status === 'ok')
const skip = results.filter(x => x.status === 'skip')
console.log(`\n==== 读图解题统计（${APPLY ? 'APPLY 已落库' : 'dry-run'}）====`)
console.log(`候选 ${rows.length} ｜ 采纳 ${ok.length} ｜ 丢弃 ${skip.length} ｜ 耗时 ${Math.round((Date.now() - t0) / 1000)}s`)
const dist = {}
for (const s of skip) dist[s.why] = (dist[s.why] || 0) + 1
console.log('丢弃原因分布:', JSON.stringify(dist, null, 2))
if (ok.length) {
  console.log('\n采纳清单:')
  for (const o of ok) console.log(`  ${o.id.slice(0, 8)} => ${JSON.stringify(o.answer)} (${o.ms}ms)`)
}
if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, results }, null, 2), 'utf8')
  console.log(`\n明细已落盘: ${OUT}`)
}
