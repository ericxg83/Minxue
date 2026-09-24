/**
 * 存量缺答案补解（2026-09-23，复核减负主战场）v2
 *
 * ── 它解决什么 ──
 * 近 14 天 32 份被拦卷里 102 道未判出题，84 道是「缺参考答案」：
 *   44 道不引图（纯题干可重解） + 24 道缺答案缺图 + 16 道图已补上。
 * 缺答案 = 批改当时答案引擎空手而归 → answer 为空 → AI 判不了 → is_correct=null
 *         → 整卷停在「待复核」= L2 拦卷。
 * 用户指示：「没有答案的话，先生成答案，然后再去复核」。
 * L1-c（worker 内：引擎空手 → 纯题干重解）只对**新批改**生效，历史存量从未回溯。
 * 本脚本就是存量回溯：对缺答案题重新生成参考答案 → 写入 answer/analysis →
 * judgeAnswer 重判 → finalizeRejudgeResult 结算（status/错题本/掌握度/审计全同步）。
 *
 * ── v2 关键修复（2026-09-23 dry-run 实测 3/3 全错的教训）──
 * v1 只做了最基础检查，实测 3 道引擎答案**全部错误**（学生明明答对，引擎乱猜）：
 *   例 #17 计算题：学生 -4 ✅，引擎 "1" ❌；#19 引图题：学生 -√2+2 / 2 ✅，引擎 "2√2"/"2-√2" ❌
 * 若把错的参考答案写入再用它判学生，会把**本来就答对的题判成错题**——比不补更糟。
 * ⇒ v2 把 worker.js 主链路的**全套质量闸**搬进来，验算不过**一律拒绝写入，保持转人工**：
 *
 *   ① extractAnswerFromAnalysis → normalizeGeneratedAnswer（清洗）
 *   ② validateAIAnswer（空/占位/残缺）
 *   ③ isNarrativeAnswer + tryRescueReferenceAnswer（叙述型残句救回）
 *   ④ validateArithmeticAnswer（**数值验算**：计算题引擎可能算错，验算不过即拒）
 *   ⑤ verifyComparisonAnswer（比较大小确定性验算）
 *   ⑥ detectAnswerCopiedFromStudent（重解结果仍抄学生 → 拒收）
 *
 * 宁可漏救（留在人工），绝不写错答案误伤学生。
 *
 * ── 输入口径（与 L1-c 完全同源，见 server/utils/aiParseSelfCheck.js）──
 *   buildTextOnlyResolveInput(question, options) = parent_stem + content + 选项，
 *   显式剔除 student_answer / answer / analysis —— 绝不把学生笔迹喂进去。
 *   ⚠️ 引图题（缺图）会缺图形条件，验算闸会拦下大部分错误答案；拦不住就保持 L2。
 *
 * ── 安全约束 ──
 *   · 默认 dry-run；--apply 才写库
 *   · **只补空**：answer 非空的一律跳过
 *   · 重判结果与旧结论一致也走 finalizeRejudgeResult 幂等结算
 *   · 每道题写库前后打日志，回滚快照落 logs/
 *
 * 用法:
 *   node server/scripts/backfillMissingAnswers.mjs                     # 近14天 dry-run
 *   node server/scripts/backfillMissingAnswers.mjs --days 7            # 指定天数
 *   node server/scripts/backfillMissingAnswers.mjs --task <id前缀>      # 只某个任务
 *   node server/scripts/backfillMissingAnswers.mjs --ids <f>           # 从文件读 id 列表
 *   node server/scripts/backfillMissingAnswers.mjs --limit 20          # 限量试跑
 *   node server/scripts/backfillMissingAnswers.mjs --apply             # 落库
 */
import 'dotenv/config'
import fs from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
// 本脚本在 server/scripts/ 下，dotenv/config 默认找 scripts/.env —— 显式指到 server/.env
dotenv.config({ path: resolve(ROOT, '.env') })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}

const APPLY = process.argv.includes('--apply')
const argOf = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}
const TASK = argOf('--task')
const DAYS = Number(argOf('--days') || 14)
const LIMIT = Number(argOf('--limit') || 5000)
const IDS_FILE = argOf('--ids')

// 模型选择（2026-09-23 三模型对比定稿）：
//   主 = kimi-k3（免费、质量顶、纯文本求解 100% JSON 健康）；兜底 = qwen3.8-flash（付费）。
//   现役答案引擎默认 deepseek-flash 不参与本脚本 —— 实测它"不适合答案库"（33% 正确率）。
const MODEL = argOf('--model') || 'kimi-k3'
const FALLBACK_MODEL = argOf('--fallback-model') || 'qwen3.8-flash'
// 安全闸（2026-09-23 dry-run 发现）：缺答案题里「学生已作答」的，
// 参考答案一旦写错会把学生对题判成错（实测 ±4/98cm/0 三例）。默认只处理
// 学生未作答（写入参考答案无误伤对象）。--with-answer 才放开已作答题（须人工核验）。
const WITH_ANSWERS = process.argv.includes('--with-answers')

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
})

// ── 复用（L1-c 同源 + worker 主链路全套质量闸）──
const { buildTextOnlyResolveInput, detectAnswerCopiedFromStudent, isNarrativeAnswer } = await import('../utils/aiParseSelfCheck.js')
const { extractAnswerFromAnalysis, normalizeGeneratedAnswer, validateAIAnswer } = await import('../worker.js')
const { judgeAnswer } = await import('../services/judgeService.js')
const { finalizeRejudgeResult, REJUDGE_CONFIDENCE } = await import('../services/gradingFinalizer.js')
const { validateArithmeticAnswer } = await import('../utils/arithmeticAnswerValidator.js')
const { verifyComparisonAnswer } = await import('../utils/comparisonAnswerVerifier.js')
const { callAnswerEngineCompletion, buildAnswerGenerationPrompt } = await import('../config/ai.js')

// ── 质量优先求解链（2026-09-23 三模型对比定版）──
// 主链路：callAnswerEngineCompletion(model override, fallback:false) —— 只打指定模型不降级
// 备链路：qwen3.8-flash 走 Bailian 直连（callAnswerEngineCompletion 只认主供应商 SenseNova，
//         model override 换不了供应商 → 404，见 _diag_model_battle_0923 教训）
// 两路都失败才返回 null → 保持转人工，绝不硬塞。
async function solveWithQualityChain(textOnly, prompt) {
  // ① 主模型（SenseNova 系，kimi-k3 / deepseek-flash 均可命中）
  try {
    const result = await callAnswerEngineCompletion({
      systemContent: prompt,
      userContent: `请计算以下题目的标准答案：\n\n${textOnly}`,
      temperature: 0.2,
      maxTokens: 4096,
      model: MODEL,         // 显式模型，覆盖 ANSWER_ENGINE.MODEL
      fallback: false,      // 纯净单模型，禁止降级链（那些弱模型反而误伤）
    })
    if (result?.content && String(result.content).trim()) {
      return { content: result.content, provider: result.provider || MODEL }
    }
  } catch (e) {
    console.warn(`    [solve] ${MODEL} 主链路失败: ${e.message.slice(0, 80)}`)
  }
  // ② 兜底：Bailian qwen3.8-flash 直连（若配置了 KEY 才走）
  const bailKey = process.env.BAILIAN_API_KEY
  if (FALLBACK_MODEL === 'qwen3.8-flash' && bailKey) {
    try {
      const endpoint = process.env.BAILIAN_BASE_URL
        ? `${process.env.BAILIAN_BASE_URL.replace(/\/+$/, '')}/chat/completions`
        : 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
      const resp = await (await import('axios')).default.post(
        endpoint,
        {
          model: FALLBACK_MODEL,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `请计算以下题目的标准答案：\n\n${textOnly}` },
          ],
          temperature: 0.2,
          max_tokens: 4096,
        },
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bailKey}` }, timeout: 120000, proxy: false }
      )
      const msg = resp.data?.choices?.[0]?.message
      if (msg?.content) return { content: msg.content, provider: `Bailian:${FALLBACK_MODEL}` }
    } catch (e2) {
      console.warn(` [solve] Bailian 兜底失败: ${e2.message.slice(0, 80)}`)
    }
  }
  return null
}

// ── 目标集 ──
let where = `
  q.deleted_at IS NULL AND t.deleted_at IS NULL
  AND t.status <> 'reviewed'
  AND t.created_at > now() - (${DAYS}::int || ' days')::interval
  AND (q.answer IS NULL OR btrim(q.answer) = '')
`
// 安全闸：默认只补「学生未作答」的题（无学生答案可被误伤）。
// student_answer 为 NULL / 空串 / '未作答' 都算未作答。--with-answers 放开已作答题。
if (!WITH_ANSWERS) {
  where += ` AND (q.student_answer IS NULL OR btrim(q.student_answer) = '' OR q.student_answer = '未作答')`
}
const params = []
if (TASK) { params.push(TASK + '%'); where += ` AND q.task_id::text LIKE $${params.length}` }
if (IDS_FILE) {
  const raw = JSON.parse(await fs.readFile(resolve(process.cwd(), IDS_FILE), 'utf8'))
  params.push(raw.filter(Boolean))
  where += ` AND q.id = ANY($${params.length}::uuid[])`
}

const rows = (await pool.query(`
  SELECT q.id, q.student_id, q.task_id, substring(q.task_id::text,1,8) tid, q.question_number,
         q.parent_stem, q.content, q.options, q.question_type, q.student_answer,
         q.answer, q.analysis, q.is_correct, q.confidence, q.review_status, q.answer_source,
         q.answer_exception_reason, q.subject,
         (q.geometry_image_url IS NOT NULL AND btrim(q.geometry_image_url)<>'') 有配图
  FROM questions q JOIN tasks t ON t.id = q.task_id
  WHERE ${where}
  ORDER BY q.task_id, q.created_at
  LIMIT ${LIMIT}
`, params)).rows

console.log(`${APPLY ? '🛠  APPLY' : '🔍 DRY-RUN'} — 缺答案候选 ${rows.length} 题（近 ${DAYS} 天${TASK ? `, task=${TASK}*` : ''}，模型 ${MODEL}${FALLBACK_MODEL ? ` → ${FALLBACK_MODEL}` : ''}）`)
console.log('')

// ── 主循环 ──
let solved = 0, rejected = 0, stillEmpty = 0, noStem = 0
const rejectedLog = []
const applyLog = []
for (const q of rows) {
  const tag = `${q.tid} 第${String(q.question_number).padStart(3)}题`
  const textOnly = buildTextOnlyResolveInput(q, Array.isArray(q.options) ? q.options : null)
  if (!textOnly) { console.log(`  ${tag}: 题干为空，无从重解`); noStem++; continue }

  const prompt = buildAnswerGenerationPrompt()
  const engineRaw = await solveWithQualityChain(textOnly, prompt)
  if (!engineRaw) {
    console.log(`  ${tag}: 🔁 ${MODEL} 与 ${FALLBACK_MODEL} 均失败/空 → 保持转人工`)
    stillEmpty++
    continue
  }

  // 解析 JSON（与 worker generateAnswerForQuestion 相同口径）
  let result
  try {
    const jsonStr = String(engineRaw.content).replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    const parsed = JSON.parse(jsonStr)
    result = { answer: parsed.answer ?? '', analysis: parsed.analysis ?? '', engine: engineRaw.provider }
  } catch (e) {
    console.log(`  ${tag}: ❌ 引擎返回非 JSON（保持转人工）: ${String(engineRaw.content).slice(0, 60)}`)
    rejectedLog.push({ id: q.id, tag, why: 'not_json' }); rejected++
    continue
  }
  if (!result?.answer || !String(result.answer).trim()) {
    console.log(`  ${tag}: 引擎仍空手而归 → 保持转人工`)
    stillEmpty++
    continue
  }

  // ── 质量闸（worker.js 主链路同口径，v2 核心）──
  const gate = await passQualityGates(q, textOnly, result)
  if (!gate.ok) {
    console.log(`  ${tag}: ❌ 质量闸拒绝（${gate.why}）→ 保持转人工`)
    rejectedLog.push({ id: q.id, tag, why: gate.why }); rejected++
    continue
  }

  solved++
  applyLog.push({ id: q.id, tag, oldIsCorrect: q.is_correct, newAnswer: gate.answer })
  console.log(`  ${tag}: ✅ 过闸答案 ${q.answer || '(空)'} → ${gate.answer}`)

  if (!APPLY) continue

  // ── 写库：先补答案，再重判结算 ──
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: upd } = await client.query(
      `UPDATE questions SET answer = $2, analysis = COALESCE(analysis, $3),
              answer_source = COALESCE(answer_source, 'official_verified'),
              answer_exception_reason = NULL, updated_at = NOW()
       WHERE id = $1 AND (answer IS NULL OR btrim(answer) = '')
       RETURNING id`,
      [q.id, gate.answer, gate.analysis || null]
    )
    if (upd.length === 0) {
      await client.query('ROLLBACK')
      console.log(`  ${tag}: 答案已被并发写入，跳过重判`)
      continue
    }

    const refreshed = { ...q, answer: gate.answer, analysis: gate.analysis || null }
    const { isCorrect, unrecognized } = judgeAnswer(refreshed.student_answer, refreshed.answer, refreshed.question_type)
    if (isCorrect !== null) {
      await finalizeRejudgeResult({
        question: refreshed,
        isCorrect,
        oldIsCorrect: q.is_correct,
        source: 'backfill_answer',
        confidence: REJUDGE_CONFIDENCE
      })
      console.log(`  ${tag}: 重判 is_correct=${q.is_correct} → ${isCorrect}${unrecognized ? '（未识别）' : ''}`)
    } else {
      console.log(`  ${tag}: 重判仍未识别（${unrecognized ? 'unrecognized' : 'null'}）→ 保持待办`)
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(`  ${tag}: 写库失败(${e.message})，整题回滚`)
    rejectedLog.push({ id: q.id, tag, why: 'write_error:' + e.message }); rejected++
  } finally {
    client.release()
  }
}

// ── 汇总 ──
console.log(`\n=== 汇总 ===`)
console.log(`  候选        ${rows.length}`)
console.log(`  过闸可写     ${solved}`)
console.log(`  引擎空手     ${stillEmpty}`)
console.log(`  质量闸拒绝   ${rejected}`)
console.log(`  题干为空     ${noStem}`)
if (rejectedLog.length > 0) {
  console.log('\n  拒绝清单（why 分布）:')
  const dist = {}
  for (const r of rejectedLog) dist[r.why] = (dist[r.why] || 0) + 1
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`)
}
if (!APPLY) console.log('\n  （dry-run：未写库。确认后加 --apply）')

// 回滚快照（APPLY 才写）
if (APPLY && applyLog.length > 0) {
  const logDir = resolve(__dirname, 'logs')
  await fs.mkdir(logDir, { recursive: true })
  const backupPath = resolve(logDir, `backfill-missing-answers-${Date.now()}.json`)
  await fs.writeFile(backupPath, JSON.stringify(applyLog, null, 1), 'utf8')
  console.log(`💾 回滚快照: ${backupPath}`)
}

await pool.end()
process.exit(0)

// ── 质量闸：worker.js 主链路同口径（v2 核心，宁可漏救不可错写）──
async function passQualityGates(q, textOnly, result) {
  // ① 引擎空手
  if (!result.answer || !String(result.answer).trim()) return { ok: false, why: 'engine_empty' }
  const placeholder = ['待人工补充', '此为主观题，无唯一标准答案', '-']
  if (placeholder.includes(String(result.answer).trim())) return { ok: false, why: 'placeholder' }

  // ② validateAIAnswer
  const validation = validateAIAnswer(result.answer, result.analysis)
  if (!validation.isValid) return { ok: false, why: 'validate_ai:' + validation.reason }

  // ③ 清洗：从分析文本提取最终答案 + 归一化
  let finalAnswer = extractAnswerFromAnalysis(result.answer, result.analysis, Array.isArray(q.options) ? q.options : null)
  finalAnswer = normalizeGeneratedAnswer(q, finalAnswer)
  if (!finalAnswer || !String(finalAnswer).trim()) return { ok: false, why: 'normalize_empty' }

  // ④ 叙述型残句：能救回就救，救不回就拒（与 worker rejectNarrativeAnswer 同判）
  if (isNarrativeAnswer(finalAnswer)) {
    const rescued = tryRescueReferenceAnswer(finalAnswer, result.analysis, q)
    if (rescued) finalAnswer = rescued
    else return { ok: false, why: 'narrative_cannot_rescue' }
  }

  // ⑤ 算术验算（防引擎算错，如 #17 学生-4 引擎给1）
  const arithmeticValidation = validateArithmeticAnswer(textOnly, finalAnswer)
  if (!arithmeticValidation.isValid) {
    return { ok: false, why: 'arithmetic:' + String(arithmeticValidation.reason || arithmeticValidation.message || '计算题验算不过') }
  }

  // ⑥ 比较大小确定性验算（2026-09-21 √7>3 事故）
  const cmpValidation = verifyComparisonAnswer(textOnly, finalAnswer)
  if (cmpValidation && !cmpValidation.ok) {
    return { ok: false, why: 'comparison:' + String(cmpValidation.message || cmpValidation.reason || '比较大小验算不过') }
  }

  // ⑦ 抄学生闸：重解结果仍与学生答案逐字全等 → 拒收
  if (detectAnswerCopiedFromStudent(finalAnswer, q.student_answer)) {
    return { ok: false, why: 'still_copied' }
  }

  return { ok: true, answer: finalAnswer, analysis: result.analysis || null }
}

// 与 worker.js tryRescueReferenceAnswer 同口径的极简版：从解析文本里抠出干净答案
function tryRescueReferenceAnswer(value, analysis, q) {
  if (!analysis || !String(analysis).trim()) return null
  try {
    const extracted = extractAnswerFromAnalysis(null, analysis, Array.isArray(q.options) ? q.options : null)
    if (!extracted) return null
    const norm = normalizeGeneratedAnswer(q, extracted)
    return (norm && String(norm).trim() && norm !== '-') ? norm : null
  } catch {
    return null
  }
}