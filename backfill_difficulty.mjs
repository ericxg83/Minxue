import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import dotenv from 'dotenv'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, 'server/.env') })
import { query } from './server/config/neon.js'
import { generateTagsForQuestion } from './server/worker.js'

const APPLY = process.argv.includes('--apply')

const normalizeOptions = (raw) => {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return []
    try { const p = JSON.parse(s); return Array.isArray(p) ? p : (p && typeof p === 'object' ? Object.values(p) : [String(p)]) }
    catch { return [s] }
  }
  if (typeof raw === 'object') return Object.values(raw)
  return [String(raw)]
}

/** 等待指定毫秒 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const run = async () => {
  console.log(APPLY ? '=== APPLY 模式 ===' : '=== DRY-RUN 模式 ===')

  const { rows: questions } = await query(
    `SELECT id, content, options, subject, question_type
     FROM questions
     WHERE difficulty IS NULL
       AND content IS NOT NULL AND length(trim(content)) >= 5
     ORDER BY created_at DESC`
  )
  console.log(`缺难度且有题面的题目：${questions.length} 道\n`)

  if (!APPLY) {
    for (const q of questions.slice(0, 12))
      console.log(`  ${String(q.id).slice(0, 8)} type=${q.question_type} | ${String(q.content).slice(0, 50)}`)
    if (questions.length > 12) console.log(`  ...（其余 ${questions.length - 12} 道）`)
    console.log('\nDRY-RUN 结束。确认后运行： node backfill_difficulty.mjs --apply')
    process.exit(0)
  }

  let updated = 0, failed = 0
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const opts = normalizeOptions(q.options).join('；')
    const full = opts ? `${q.content}\n选项：${opts}` : q.content
    const shortId = String(q.id).slice(0, 8)

    // 每道题之间延迟 4s + 随机 jitter，避免 ModelScope 429 限流
    if (i > 0) await sleep(4000 + Math.random() * 1000)

    try {
      const r = await generateTagsForQuestion(full, q.subject || null)
      const d = r?.difficulty
      if (d !== null && d !== undefined) {
        await query(`UPDATE questions SET difficulty = $1, updated_at = NOW() WHERE id = $2`, [d, q.id])
        updated++
        console.log(`  ✅ [${i + 1}/${questions.length}] ${shortId} → 难度=${d}`)
      } else {
        failed++
        console.log(`  ⚠️ [${i + 1}/${questions.length}] ${shortId} → AI 未返回难度，跳过`)
      }
    } catch (e) {
      failed++
      console.log(`  ❌ [${i + 1}/${questions.length}] ${shortId} → 失败: ${e.message}`)
    }
  }
  console.log(`\n完成：更新 ${updated} 道，失败/跳过 ${failed} 道`)
  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })