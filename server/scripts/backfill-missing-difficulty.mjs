/**
 * 定向回填「难度未判定」（difficulty IS NULL）的题
 *
 * 背景（2026-09-18）：
 *   周末班课件出现「未判定」难度档。根因是**定时难度回填的 SQL 硬性要求
 *   `q.is_complete = TRUE`**（server/index.js BACKFILL_WHERE 首行），而 is_complete
 *   为 false 的题（多为「选择题选项未抓到 / 选项是图片」被完整性闸判缺选项）永远
 *   轮不到回填 → difficulty 恒为 NULL。
 *
 * 本脚本**只按 difficulty 一个维度**回填，不受 is_complete 限制：
 *   - 只写 difficulty 字段；**不动 ai_tags / tags_source / options / answer / is_complete**。
 *   - 只处理 `content` 非空的题（空正文无信息可判，保持 NULL）。
 *
 * 通道选择（2026-09-18 实测）：默认走 callTextCompletion 降级链，但该链在本地会
 *   空耗 20-40s（魔搭备份 429 → Gemini 国内超时 20s → SenseNova 429 → Bailian 空返回
 *   → 才轮到 Huihuiyun ✅1.4s）。用 `--vendor Huihuiyun` 可**直连**该厂商，单条 ~1.4s。
 *
 * 用法：
 *   cd server && node scripts/backfill-missing-difficulty.mjs                        # dry-run（走降级链，慢）
 *   cd server && node scripts/backfill-missing-difficulty.mjs --vendor Huihuiyun --limit 3   # 试跑 3 条（直连）
 *   cd server && node scripts/backfill-missing-difficulty.mjs --vendor Huihuiyun --apply     # 写库（全量）
 *
 * ⚠️ 并发硬限 3（对齐 backfill-choice-options.mjs）：防打爆模型配额被静默轮换弱模型。
 * ⚠️ --apply 前会把「将被修改的 id + 原 difficulty」快照到
 *    scripts/logs/difficulty-backfill-<时间戳>.json，便于回滚。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { Pool } from 'pg'
import axios from 'axios'
import { generateTag } from '../backfillTags.js'
import { BACKUP_CONFIG, buildTaggingPrompt } from '../config/ai.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, '../.env') })

const args = process.argv.slice(2)
const pick = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const APPLY = args.includes('--apply')
const LIMIT = Number(pick('--limit', '0')) || 0
const CONCURRENCY = Math.min(3, Number(pick('--concurrency', '3')) || 3)
const VENDOR_NAME = pick('--vendor', '')
const RATE_DELAY = 150

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 })
const ax = axios.create({ proxy: false, httpsAgent: false, httpAgent: false, timeout: 30000 })

const toOptStr = (raw) => {
  if (!raw) return ''
  let a = raw
  if (typeof a === 'string') { try { a = JSON.parse(a) } catch { return String(raw) } }
  return Array.isArray(a) ? a.join('；') : ''
}

function normalizeDifficulty(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return null
  if (n < 1) return 1
  if (n > 5) return 5
  return n
}

function parseJsonLoose(content) {
  if (!content) return null
  let s = String(content).trim()
  const fence = s.match(/```(?:json)?\n?([\s\S]*?)\n?```/)
  if (fence) s = fence[1]
  try { return JSON.parse(s) } catch {}
  try {
    const repaired = s.replace(/'/g, '"').replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3').replace(/,\s*([}\]])/g, '$1')
    return JSON.parse(repaired)
  } catch {}
  const m = s.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return null
}

// 直连指定厂商拿难度（绕过慢的降级链）
async function difficultyViaVendor(vendor, fullContent, subject) {
  const prompt = buildTaggingPrompt(subject)
  const body = {
    model: vendor.textModel,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `请分析以下题目，提取知识点标签：\n\n${fullContent}` },
    ],
    temperature: 0.2,
    max_tokens: 500,
    ...(vendor.extraBody || {}),
  }
  const r = await ax.post(vendor.endpoint, body, {
    headers: { Authorization: `Bearer ${process.env[vendor.envKey] || ''}`, 'Content-Type': 'application/json' },
  })
  const content = r.data?.choices?.[0]?.message?.content
  const obj = parseJsonLoose(content)
  return normalizeDifficulty(obj?.difficulty)
}

// 走默认降级链（慢）
async function difficultyViaChain(fullContent, subject) {
  const r = await generateTag(fullContent, subject)
  return r.difficulty
}

let total = 0, updated = 0, skipped = 0, failed = 0

try {
  let vendor = null
  if (VENDOR_NAME) {
    vendor = BACKUP_CONFIG.VENDORS.find(v => v.name.toLowerCase() === VENDOR_NAME.toLowerCase())
    if (!vendor) {
      console.error(`✗ 未找到厂商「${VENDOR_NAME}」。可用：${BACKUP_CONFIG.VENDORS.map(v => v.name).join(', ')}`)
      process.exit(1)
    }
    console.log(`通道：直连 ${vendor.name}（${vendor.textModel} @ ${vendor.endpoint}）`)
  } else {
    console.log('通道：callTextCompletion 默认降级链（本地较慢，建议 --vendor Huihuiyun）')
  }

  const limitSql = LIMIT > 0 ? `LIMIT ${LIMIT}` : ''
  const { rows } = await pool.query(
    `SELECT id, content, parent_stem, options, subject, question_type, is_complete, tags_source
     FROM questions
     WHERE difficulty IS NULL AND deleted_at IS NULL
       AND COALESCE(TRIM(content), '') <> ''
     ORDER BY created_at DESC ${limitSql}`)
  total = rows.length
  console.log(`\n待回填难度（difficulty IS NULL 且有正文）：${total} 条  [${APPLY ? 'APPLY' : 'DRY-RUN'}]  并发=${CONCURRENCY}\n`)
  if (total === 0) { await pool.end(); process.exit(0) }

  const snapshot = []
  let done = 0

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY)
    await Promise.allSettled(batch.map(async (q) => {
      const fullContent = [q.parent_stem, q.content, toOptStr(q.options)].filter(Boolean).join('\n')
      let d = null
      try {
        d = vendor ? await difficultyViaVendor(vendor, fullContent, q.subject || null)
                   : await difficultyViaChain(fullContent, q.subject || null)
      } catch (e) {
        // 单条失败重试一次
        try { d = vendor ? await difficultyViaVendor(vendor, fullContent, q.subject || null)
                         : await difficultyViaChain(fullContent, q.subject || null) } catch { d = null }
      }
      done++
      const shortId = String(q.id).slice(0, 8)
      if (d == null) {
        skipped++
        console.log(`  ⏭️  [${done}/${total}] ${shortId}: 未取到难度 (${q.question_type || '-'})`)
        return
      }
      if (!APPLY) {
        console.log(`  · [${done}/${total}] ${shortId}: → 难度 ${d}  (${q.question_type || '-'})`)
        return
      }
      snapshot.push({ id: q.id, prev_difficulty: q.difficulty ?? null, new_difficulty: d })
      try {
        await pool.query(`UPDATE questions SET difficulty = $1, updated_at = NOW() WHERE id = $2`, [d, q.id])
        updated++
        console.log(`  ✅ [${done}/${total}] ${shortId}: 难度 ${d}`)
      } catch (e) {
        failed++
        console.error(`  ❌ [${done}/${total}] ${shortId}: 写库失败 ${e.message}`)
      }
    }))
    if (i + CONCURRENCY < rows.length) await new Promise(r => setTimeout(r, RATE_DELAY))
  }

  if (APPLY && snapshot.length) {
    const logDir = join(__dirname, 'logs')
    mkdirSync(logDir, { recursive: true })
    const out = join(logDir, `difficulty-backfill-${Date.now()}.json`)
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), vendor: VENDOR_NAME || 'chain', count: snapshot.length, rows: snapshot }, null, 2))
    console.log(`\n📦 快照已写入: ${out}`)
  }

  console.log('\n' + '='.repeat(56))
  console.log(`  总计 ${total} | 更新 ${APPLY ? updated : '(dry-run)'} | 跳过(无难度) ${skipped} | 失败 ${failed}`)
  console.log('='.repeat(56))
} catch (e) {
  console.error('执行失败:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
