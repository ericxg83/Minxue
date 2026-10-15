/**
 * 解析回填（2026-10-14）
 *
 * 修的是什么：
 *   server/_regrade_workbook_to_ai_0922.mjs（一次性历史脚本，被 .gitignore 的 server/_* 排除，
 *   根因修复已落在该文件本机副本）的 callEngine 只 return 引擎结果的 answer，
 *   把引擎同时返回的 analysis 整个丢掉 ⇒ newAnalysis 恒为 null ⇒ 脚本把
 *   'AI重批生成 <日期>' 当占位写进 question_cache.analysis 与 questions.analysis。
 *   于是解析入口要么亮着假按钮（点开是句废话，210 条），要么根本不显示（606 条里的一部分）。
 *   本脚本负责**修历史存量**，也是今后「解析缺失批量补齐」的可复用工具。
 *
 * 两步（--apply 才写库）：
 *   ① 清 question_cache.analysis 的占位串污染（212 条 / 212 指纹）。
 *      缓存是跨题跨卷共享的，占位串留着会持续串味；清空后同指纹下次求解会拿到真解析。
 *      只清 analysis，answer 一律不动（WHERE 保证 answer 有效的行才动）。
 *   ② 对 analysis 实质为空的题（606 道，其中 590 道已有 answer）调引擎补解析。
 *
 * ⚠️ 只补 analysis，**绝不覆盖已有 answer**（AGENTS 铁律：未经确认不改判分链路）：
 *   题目已有答案且是老师复核过的，重跑不得改。引擎返回的 answer 仅做**交叉校验**：
 *   与库内不一致则跳过该题并告警，交人工判断，不自动改。
 *
 * 用法：
 *   node scripts/backfill-analysis.mjs                    # dry-run，出对照清单
 *   node scripts/backfill-analysis.mjs --apply            # 写库（先自动导出备份）
 *   node scripts/backfill-analysis.mjs --apply --limit=50  # 小批试跑
 *   node scripts/backfill-analysis.mjs --skip-cache-clean # 只补解析不清缓存
 *   BENCH_CONC=3  控制并发（默认 3，避免打爆引擎限流）
 *
 * 退出码：0 正常；1 有引擎失败但已处理完（部分成功）；2 参数/环境错误
 */
import dotenv from 'dotenv'
dotenv.config({ path: 'D:/Minxue_App_V3/server/.env' })
import axios from 'axios'
import pg from 'pg'
import fs from 'fs'
import { buildAnswerGenerationPrompt } from '../config/ai.js'
import { generateTextFingerprint } from '../utils/questionFingerprint.js'
import { formatOptionsForPrompt } from '../utils/optionText.js'

const argv = process.argv
const APPLY = argv.includes('--apply')
const SKIP_CACHE_CLEAN = argv.includes('--skip-cache-clean')
const LIMIT = parseInt((argv.find(a => a.startsWith('--limit=')) || '').split('=')[1], 10) || 0
const CONC = parseInt(process.env.BENCH_CONC, 10) || 3
const MODEL = process.env.RERUN_MODEL || 'qwen3.8-flash'
const PARSER_VERSION = 'v1'

// 占位串口径必须与 src/utils/reviewDecision.js 的 ANALYSIS_PLACEHOLDER_RE 一致
const PLACEHOLDER_RE = /^AI重批生成\s*\d{4}-\d{2}-\d{2}$/

const base = (process.env.BAILIAN_BASE_URL || '').replace(/\/+$/, '')
const key = process.env.BAILIAN_API_KEY
if (!base || !key) { console.error('缺少 BAILIAN_BASE_URL / BAILIAN_API_KEY'); process.exit(2) }
const prompt = buildAnswerGenerationPrompt()
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

console.log('══ 解析回填 ══')
console.log(`模式: ${APPLY ? 'APPLY（会写库）' : 'DRY-RUN（不写库）'}   模型: Bailian:${MODEL}   并发: ${CONC}`)
console.log('')

// ── ① 清 question_cache 占位串 ──────────────────────────────
const stubRows = (await pool.query(
  `SELECT question_fingerprint, parser_version, answer
     FROM question_cache
    WHERE btrim(coalesce(analysis,'')) LIKE 'AI重批生成%'`)).rows
const clearable = stubRows.filter(r =>
  r.answer && String(r.answer).trim() && !['待人工补充', '此为主观题，无唯一标准答案'].includes(String(r.answer).trim()))
console.log(`① question_cache 占位串: ${stubRows.length} 行，其中 answer 有效可清 ${clearable.length} 行`)
if (!SKIP_CACHE_CLEAN && APPLY) {
  const { rowCount } = await pool.query(
    `UPDATE question_cache SET analysis = NULL, updated_at = NOW()
      WHERE btrim(coalesce(analysis,'')) LIKE 'AI重批生成%'
        AND answer IS NOT NULL AND btrim(answer) <> ''
        AND answer NOT IN ('待人工补充','此为主观题，无唯一标准答案')`)
  console.log(`   已清空 ${rowCount} 行（只动 analysis，answer 未改）`)
} else if (!SKIP_CACHE_CLEAN) {
  console.log('   DRY-RUN：未执行')
}

// ── ② 待回填题目 ────────────────────────────────────────────
const rows = (await pool.query(
  `SELECT id, task_id, question_number, sub_no, question_type, subject,
          content, parent_stem, options, answer, analysis, answer_source, student_answer, is_correct, review_status
     FROM questions
    WHERE deleted_at IS NULL
      AND btrim(regexp_replace(coalesce(analysis,''), '^AI重批生成\\s*\\d{4}-\\d{2}-\\d{2}\\s*$', '')) = ''
      AND content IS NOT NULL AND btrim(content) <> ''
    ORDER BY task_id, question_number`)).rows
const targets = LIMIT ? rows.slice(0, LIMIT) : rows
console.log('')
console.log(`② 待回填题目: ${rows.length} 道${LIMIT ? `（--limit 截取前 ${targets.length} 道）` : ''}`)

// 备份
if (APPLY) {
  const p = `D:/Minxue_App_V3/server/_backfill_analysis_backup_${new Date().toISOString().slice(0, 10)}.json`
  fs.writeFileSync(p, JSON.stringify({ generatedAt: new Date().toISOString(), questions: targets }, null, 1), 'utf8')
  console.log(`已备份 → ${p}`)
}

// ── 引擎 ────────────────────────────────────────────────────
let calls = 0
function parseEngineResult(raw) {
  const t = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  if (!t) return { answer: null, analysis: null }
  let answer = null, analysis = null
  try {
    const j = JSON.parse(t)
    if (j && typeof j.answer === 'string' && j.answer.trim()) answer = j.answer.trim()
    if (j && typeof j.analysis === 'string' && j.analysis.trim()) analysis = j.analysis.trim()
  } catch { /* 容错 */ }
  if (!answer) {
    const m = t.match(/"answer"\s*:\s*"([^"]*)"/)
    if (m && m[1].trim()) answer = m[1].trim()
  }
  if (!analysis) {
    const m = t.match(/"analysis"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (m && m[1].trim()) {
      try { analysis = JSON.parse(`"${m[1]}"`).trim() } catch { analysis = m[1].trim() }
    }
  }
  return { answer, analysis }
}

async function callEngine(input) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await axios.post(`${base}/chat/completions`, {
        model: MODEL,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `请计算以下题目的标准答案：\n\n${input}` },
        ],
        temperature: 0.2, max_tokens: 4096, stream: false,
      }, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 300000, proxy: false })
      calls += 1
      return parseEngineResult(r.data?.choices?.[0]?.message?.content)
    } catch (e) {
      const st = e.response?.status
      const isTimeout = e.code === 'ECONNABORTED' || /timeout of \d+ms exceeded/i.test(String(e.message || ''))
      if ((st === 429 || (st >= 500 && st < 600) || isTimeout) && attempt < 3) {
        await new Promise(r => setTimeout(r, 62000))
        continue
      }
      throw e
    }
  }
}

const buildInput = (q) => {
  const stem = [q.parent_stem, q.content].filter(s => s && String(s.trim())).join('\n')
  const options = Array.isArray(q.options) ? q.options : []
  const optText = options.length ? formatOptionsForPrompt(options) : ''
  return optText ? `${stem}\n选项：${optText}` : stem
}

// 同指纹共享求解，避免同题重复调引擎
const inflight = new Map()
async function solveShared(fp, fn) {
  if (!fp) return fn()
  if (inflight.has(fp)) return inflight.get(fp)
  const p = fn().finally(() => inflight.delete(fp))
  inflight.set(fp, p)
  return p
}

// 答案比对：归一化后比对，不一致只告警不覆盖（答案归老师/判分链路所有）
const norm = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[，。、,.;；]$/,'').toLowerCase()

// ── 逐题回填（固定 CONC 个 worker 轮转消费队列，不用链式 tail ——
//   链式写法每题都要等前一题结束，并发度实际退化成 1，长题会把整批拖到超时）──
const stat = { filled: 0, noAnalysis: 0, declined: 0, answerMismatch: 0, engineFail: 0 }
const detail = []

async function runOne(q) {
  const rec = { no: `${q.task_id.slice(0, 8)}#${q.question_number}`, id: q.id, oldAnswer: q.answer }
  try {
    const fp = generateTextFingerprint(
      [q.parent_stem, q.content].filter(s => s && String(s).trim()).join('\n'),
      Array.isArray(q.options) ? q.options : [], q.question_type)
    const r = await solveShared(fp, () => callEngine(buildInput(q)))
    if (r.answer && /^(待人工补充|待补充|人工补充|无法确定|无法唯一确定|不确定|无法判断|不能确定|无法给出|无法作答)$/.test(r.answer.trim())) {
      rec.verdict = 'ENGINE_DECLINED'; stat.declined++; detail.push(rec); return
    }
    if (!r.analysis || PLACEHOLDER_RE.test(r.analysis.trim())) {
      rec.verdict = 'NO_ANALYSIS'; stat.noAnalysis++; detail.push(rec); return
    }
    // 只在引擎没给 answer 时才没有交叉校验能力，仍照填解析（解析本身不参与判分）
    if (r.answer && q.answer && norm(r.answer) !== norm(q.answer)) {
      rec.verdict = 'ANSWER_MISMATCH'; rec.engineAnswer = r.answer
      stat.answerMismatch++; detail.push(rec)
      console.log(`  ⚠ ${rec.no} 答案不一致：库="${String(q.answer).slice(0, 30)}" 引擎="${String(r.answer).slice(0, 30)}" → 跳过，交人工`)
      return
    }
    rec.verdict = 'FILLED'; rec.newAnalysis = r.analysis.slice(0, 200)
    stat.filled++
    if (APPLY) {
      await pool.query(
        `UPDATE questions SET analysis = $1, updated_at = NOW() WHERE id = $2 AND btrim(coalesce(analysis,'')) = ''`,
        [r.analysis, q.id])
    }
    detail.push(rec)
  } catch (e) {
    rec.verdict = 'ENGINE_FAIL'; rec.err = String(e.message || e).slice(0, 120)
    stat.engineFail++; detail.push(rec)
  }
}

// 固定 CONC 个 worker 消费共享队列（runOne 已声明，此处才引用，避免 TDZ）
const queue = [...targets]
const workers = [...Array(Math.min(CONC, Math.max(queue.length, 1)))].map(async () => {
  while (queue.length) {
    const q = queue.shift()
    if (!q) break
    await runOne(q)
  }
})

await Promise.allSettled(workers)
await Promise.allSettled(workers)
console.log('')
console.log('── 结果 ──')
console.log(`已补解析: ${stat.filled}   引擎无解析: ${stat.noAnalysis}   引擎退让: ${stat.declined}   答案不一致跳过: ${stat.answerMismatch}   引擎失败: ${stat.engineFail}`)
console.log(`引擎调用: ${calls} 次`)
if (!APPLY) console.log('\nDRY-RUN 结束，未写库。确认无误后加 --apply 重跑。')
else console.log('\nAPPLY 完成。')

const out = 'D:/Minxue_App_V3/server/_backfill_analysis_result.json'
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, stat, detail }, null, 1), 'utf8')
console.log(`明细 → ${out}`)
await pool.end()
process.exit(stat.engineFail > 0 ? 1 : 0)
