/**
 * 高风险存疑题目批量强力重算脚本（2026-11-04）
 *
 * 背景：
 *   全库审计发现大量「参考答案与 AI 解析不一致、且学生按 AI 答案作答被判错」的高风险假错题。
 *   为了避免无脑批量翻案造成反向污染，本脚本专门针对指定的高风险题目 ID 列表，
 *   调用系统现有的 AI 重解析引擎（走严格强模型通道链 `RECOMPUTE_CHAIN`），
 *   重新计算标准答案，并自动过 `judgeAnswer` + `finalizeRejudgeResult` 走既有改判结算链路。
 *
 * 流程：
 *   1. 对每个目标题目：读出当前题目数据并完整备份到 server/_backup/recompute_<id>_<ts>.json
 *   2. 调后台同款重解析逻辑（模拟 POST /api/questions/:id/recompute-answer 核心），
 *      使用主通道强模型（qwen3.8-flash 严格模式）重算标准答案。
 *   3. 检查重算得出的新答案是否有效：
 *      - 若成功拿到新答案：更新 questions.answer、同步 question_cache、
 *        调用 judgeAnswer + finalizeRejudgeResult 结算（若学生答案与新答案匹配则自动翻案为对，
 *        从错题本移出；若仍不对则更新参考答案但不强行判对）。
 *      - 若重算失败或 AI 拒绝：保留原样并打印告警。
 *
 * 用法：
 *   node server/scripts/batch-recompute-highrisk-20261104.mjs                    # dry-run
 *   node server/scripts/batch-recompute-highrisk-20261104.mjs --apply             # 真实执行
 *   node server/scripts/batch-recompute-highrisk-20261104.mjs --id=<qid_prefix>   # 单题测试
 */
import '../loadEnv.js'
import fs from 'node:fs'
import { getPool } from '../config/neon.js'
import { judgeAnswer } from '../services/judgeService.js'
import { finalizeRejudgeResult } from '../services/gradingFinalizer.js'

const APPLY = process.argv.includes('--apply')
const ONLY_ID = (process.argv.find(a => a.startsWith('--id=')) || '').slice(5).trim()

// 待重算的高风险存疑题目 ID 前缀列表（例如前面审计出的 4 道图错位/无图或部分疑似行）
// 也可以直接传入全量 11 道待终裁的候选
const TARGET_PREFIXES = ONLY_ID ? [ONLY_ID] : [
  'c2b18f8e', // 几何图错位 / 待人工
  'b49c07bb', // 几何图错位 / 待人工
  '7a5693cd', // 无裁片图函数图像题
  'facb9da8'  // 无裁片图函数图像题
]

const pool = getPool()
const q = async (sql, params = []) => (await pool.query(sql, params)).rows

const snapshot = async (prefix) => {
  const rows = await q('SELECT * FROM questions WHERE id::text LIKE $1 AND deleted_at IS NULL', [prefix + '%'])
  return rows[0] || null
}

const run = async () => {
  console.log(`[BatchRecompute] 开始处理，模式: ${APPLY ? 'APPLY (真实写库)' : 'DRY-RUN (仅模拟)'}`)
  for (const pref of TARGET_PREFIXES) {
    const row = await snapshot(pref)
    if (!row) {
      console.log(`[skip] 前缀 ${pref} 未找到对应题目`)
      continue
    }
    const qid = row.id
    console.log(`\n--------------------------------------------------`)
    console.log(`[proc] 命中题目 ${qid} (no=${row.question_number}, type=${row.question_type})`)
    console.log(`       当前 answer=${row.answer} | ai_answer=${row.ai_answer} | student_answer=${row.student_answer} | is_correct=${row.is_correct}`)
    console.log(`       题干: ${String(row.content || '').replace(/\s+/g, ' ').slice(0, 100)}`)

    // 1. 备份快照
    const before = {
      question: row,
      wrong_questions: await q('SELECT * FROM wrong_questions WHERE question_id = $1', [qid]),
      question_knowledge: await q('SELECT * FROM question_knowledge WHERE question_id = $1', [qid])
    }
    const dir = new URL('../_backup/', import.meta.url)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(new URL(`recompute_${qid}_${Date.now()}.json`, dir), JSON.stringify(before, null, 2), 'utf8')

    if (!APPLY) {
      console.log(`       [dry-run] 已备份快照到 server/_backup/，跳过实际 AI 调用`)
      continue
    }

    // 2. 调用内部重解析逻辑（模拟 /api/questions/:id/recompute-answer）
    // 为了复用现有服务器端引擎能力，可以直接发起本地 HTTP 或复用后台函数。
    // 这里直接通过 localhost:4000 内部调用（确保 server 正在跑），或者直接走封装函数。
    try {
      const resp = await fetch(`http://127.0.0.1:4000/api/questions/${qid}/recompute-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      })
      const data = await resp.json()
      if (!resp.ok || !data.ok) {
        console.log(`[fail] 重解析接口返回错误: ${JSON.stringify(data)}`)
        continue
      }
      console.log(`[ok  ] 重解析成功！新答案: ${data.answer} (引擎: ${data.engine})`)

      // 3. 重新获取更新后的题目行，走既有判题与结算链路
      const fresh = await snapshot(pref)
      const judged = judgeAnswer(fresh.student_answer, fresh.answer, fresh.question_type || 'answer')
      console.log(`       判题器复核结果: isCorrect=${judged.isCorrect}`)

      const settlement = await finalizeRejudgeResult({
        question: fresh,
        isCorrect: judged.isCorrect ?? fresh.is_correct,
        oldIsCorrect: row.is_correct,
        source: 'pc_rejudge',
        manualOverride: true
      })
      console.log(`       结算完成: ${JSON.stringify(settlement)}`)
    } catch (err) {
      console.error(`[error] 题目 ${qid} 处理异常:`, err.message)
    }
  }

  await pool.end()
  console.log(`\n[BatchRecompute] 全部处理完毕`)
}

run().catch(async (e) => {
  console.error('[fatal]', e)
  try { await pool.end() } catch {}
  process.exitCode = 1
})
