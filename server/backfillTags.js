/**
 * Backfill script: regenerate AI knowledge tags for all existing questions
 * that have NULL, empty, or ["未分类"] tags.
 *
 * Usage: node server/backfillTags.js
 * Requires NEON_DATABASE_URL in .env (already configured).
 *
 * Safety: processes in small batches (3 concurrent), with rate limiting,
 * model rotation, and progress logging. Can be safely re-run.
 */

import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, '.env') })

import axios from 'axios'
import { query, TABLES } from './config/neon.js'
import {
  AI_CONFIG,
  getAIHeaders,
  buildTaggingPrompt,
  getCurrentTextModel,
  rotateTextModel,
  callTextCompletion
} from './config/ai.js'

// ── Config ──
const CONCURRENCY = 3       // concurrent AI calls
const RATE_LIMIT_DELAY = 200 // ms between batches to avoid 429
const MAX_RETRIES = 2

// ── Progress tracking ──
let total = 0
let updated = 0
let skipped = 0
let failed = 0
let modelRotations = 0

function normalizeDifficulty(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return null
  if (n < 1) return 1
  if (n > 5) return 5
  return n
}

/**
 * Generate tags + difficulty for a single question.
 * Uses callTextCompletion so it inherits the primary→backup API fallback.
 * Exported so the scheduled backfill (server/index.js) can用 LLM 修正
 * 上传热路径产出的本地占位标签/难度（difficulty 默认 3）。
 */
export async function generateTag(questionContent, subject = null, retryCount = 0) {
  if (!questionContent || !questionContent.trim()) {
    return { success: true, tags: ['未分类'], difficulty: null }
  }

  const prompt = buildTaggingPrompt(subject)

  try {
    const { content } = await callTextCompletion({
      systemContent: prompt,
      userContent: `请分析以下题目，提取知识点标签：\n\n${questionContent}`,
      temperature: 0.2,
      maxTokens: 500
    })
    if (!content) throw new Error('AI 返回内容为空')

    let jsonStr = content
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      content.match(/```\n?([\s\S]*?)\n?```/)
    if (jsonMatch) jsonStr = jsonMatch[1]

    let result
    try {
      result = JSON.parse(jsonStr)
    } catch (parseError) {
      // Try repair
      const repaired = jsonStr
        .replace(/'/g, '"')
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
        .replace(/,\s*([}\]])/g, '$1')
      try {
        result = JSON.parse(repaired)
      } catch {
        throw new Error(`JSON 解析失败: ${parseError.message}`)
      }
    }

    const rawTags = result.tags || []
    // Deduplicate
    const uniqueTags = [...new Set(rawTags.map(t => t.trim()).filter(Boolean))]
    return { success: true, tags: uniqueTags, difficulty: normalizeDifficulty(result.difficulty) }
  } catch (error) {
    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'

    if (isNetworkError && retryCount < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000))
      return generateTag(questionContent, subject, retryCount + 1)
    }

    // 主备 API 都失败 → 保持字段为空，交给后续回填重试（不写「未分类」）
    return { success: false, tags: null, difficulty: null }
  }
}

/**
 * Deduplicate tags: keep the most specific version of near-duplicates.
 */
export function deduplicateTags(tags) {
  if (!tags || tags.length <= 1) return tags || []
  const result = []
  for (const tag of tags) {
    const t = tag.trim()
    if (!t) continue
    // Skip if a more specific tag already covers this
    const isRedundant = result.some(existing =>
      existing !== t && (existing.includes(t) || t.includes(existing))
    )
    if (!isRedundant) {
      result.push(t)
    }
  }
  return result
}

async function main() {
  console.log('='.repeat(60))
  console.log('  知识点标签回填脚本')
  console.log('  查找所有标签为 NULL/空/["未分类"] 的题目...')
  console.log('='.repeat(60))

  // 1. Find questions missing tags OR difficulty
  const { rows: questions } = await query(
    `SELECT q.id, q.content, q.options, q.subject, q.ai_tags, q.difficulty, q.question_type
     FROM ${TABLES.QUESTIONS} q
     WHERE q.is_complete = TRUE
       AND (
         q.ai_tags IS NULL
         OR q.ai_tags = ''
         OR q.ai_tags = '[]'
         OR q.ai_tags::text = '["未分类"]'
         OR q.difficulty IS NULL
       )
     ORDER BY q.created_at DESC
     LIMIT 500`,
    []
  )

  total = questions.length
  if (total === 0) {
    console.log('✅ 没有待回填的题目')
    process.exit(0)
  }

  console.log(`📊 找到 ${total} 道需要回填标签/难度的题目\n`)

  // 2. Process in batches
  for (let i = 0; i < questions.length; i += CONCURRENCY) {
    const batch = questions.slice(i, i + CONCURRENCY)

    const promises = batch.map(async (q) => {
      const content = q.content || ''
      const options = (q.options || []).join('；')
      const fullContent = options ? `${content}\n选项：${options}` : content
      const subject = q.subject || null

      const shortId = q.id.substring(0, 8)
      const tagResult = await generateTag(fullContent, subject)

      const hasTags = tagResult.tags && tagResult.tags.length > 0 && tagResult.tags[0] !== '未分类'
      const hasDifficulty = tagResult.difficulty !== null && tagResult.difficulty !== undefined

      if (!hasTags && !hasDifficulty) {
        skipped++
        console.log(`  ⏭️  [${i + batch.indexOf(q) + 1}/${total}] ${shortId}: 无法识别标签/难度 (${subject || '无学科'})`)
        return
      }

      // 动态拼装 SET：只更新本次成功识别的字段，避免用 NULL 覆盖已有值
      const sets = []
      const params = []
      let p = 1
      if (hasTags) {
        const uniqueTags = deduplicateTags(tagResult.tags)
        sets.push(`ai_tags = $${p++}::jsonb`, `tags_source = 'ai'`)
        params.push(JSON.stringify(uniqueTags))
      }
      if (hasDifficulty) {
        sets.push(`difficulty = $${p++}`)
        params.push(tagResult.difficulty)
      }
      sets.push('updated_at = NOW()')
      params.push(q.id)

      try {
        await query(
          `UPDATE ${TABLES.QUESTIONS} SET ${sets.join(', ')} WHERE id = $${p}`,
          params
        )
        updated++
        const tagStr = hasTags ? deduplicateTags(tagResult.tags).join(', ') : '(保留原标签)'
        console.log(`  ✅ [${i + batch.indexOf(q) + 1}/${total}] ${shortId}: ${tagStr} | 难度=${hasDifficulty ? tagResult.difficulty : '-'} (${subject || '无学科'})`)
      } catch (err) {
        failed++
        console.error(`  ❌ [${i + batch.indexOf(q) + 1}/${total}] ${shortId}: DB更新失败 ${err.message}`)
      }
    })

    await Promise.allSettled(promises)

    // Rate limiting delay between batches
    if (i + CONCURRENCY < questions.length) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY))
    }
  }

  // 3. Summary
  console.log('\n' + '='.repeat(60))
  console.log('  回填完成！')
  console.log(`  📊 总计: ${total} 道`)
  console.log(`  ✅ 更新: ${updated} 道`)
  console.log(`  ⏭️  跳过(无法识别): ${skipped} 道`)
  console.log(`  ❌ 失败: ${failed} 道`)
  console.log(`  🔄 模型轮换: ${modelRotations} 次`)
  console.log('='.repeat(60))

  process.exit(0)
}

// 仅当作为独立脚本直接运行时才自动跑批；被 import（如 server/index.js 定时回填）时不执行。
const _isMain = process.argv[1] && (process.argv[1] === __filename || process.argv[1].endsWith('backfillTags.js'))
if (_isMain) {
  main().catch(err => {
    console.error('脚本执行失败:', err)
    process.exit(1)
  })
}