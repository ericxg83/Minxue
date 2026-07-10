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

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '.env') })

import axios from 'axios'
import { query, TABLES } from './config/neon.js'
import {
  AI_CONFIG,
  getAIHeaders,
  buildTaggingPrompt,
  getCurrentTextModel,
  rotateTextModel
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

/**
 * Generate tags for a single question (replicates worker.js logic
 * but uses the improved buildTaggingPrompt with subject context).
 */
async function generateTag(questionContent, subject = null, retryCount = 0) {
  if (!questionContent || !questionContent.trim()) {
    return { success: true, tags: ['未分类'] }
  }

  const prompt = buildTaggingPrompt(subject)

  const requestBody = {
    model: getCurrentTextModel(),
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `请分析以下题目，提取知识点标签：\n\n${questionContent}` }
    ],
    temperature: 0.2,
    max_tokens: 500
  }

  try {
    const response = await axios.post(AI_CONFIG.ENDPOINT, requestBody, {
      headers: getAIHeaders(),
      timeout: 30000
    })

    const content = response.data.choices[0]?.message?.content
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
    return { success: true, tags: uniqueTags }
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message || '未知错误'
    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const isQuota = error.response?.status === 429

    if (isQuota) {
      const nextModel = rotateTextModel()
      modelRotations++
      if (nextModel) {
        console.log(`  ⚠️ 模型配额耗尽，已切换到 ${nextModel}，跳过当前题目`)
      } else {
        console.error(`  ❌ 所有文本模型配额已耗尽`)
      }
      return { success: true, tags: ['未分类'] }
    }

    if (isNetworkError && retryCount < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000))
      return generateTag(questionContent, subject, retryCount + 1)
    }

    return { success: true, tags: ['未分类'] }
  }
}

/**
 * Deduplicate tags: keep the most specific version of near-duplicates.
 */
function deduplicateTags(tags) {
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

  // 1. Find questions with bad tags
  const { rows: questions } = await query(
    `SELECT q.id, q.content, q.options, q.subject, q.ai_tags, q.question_type
     FROM ${TABLES.QUESTIONS} q
     WHERE q.is_complete = TRUE
       AND (
         q.ai_tags IS NULL
         OR q.ai_tags = ''
         OR q.ai_tags = '[]'
         OR q.ai_tags::text = '["未分类"]'
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

  console.log(`📊 找到 ${total} 道需要回填标签的题目\n`)

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

      if (!tagResult.tags || tagResult.tags.length === 0 || tagResult.tags[0] === '未分类') {
        skipped++
        console.log(`  ⏭️  [${i + batch.indexOf(q) + 1}/${total}] ${shortId}: 无法识别标签 (${subject || '无学科'})`)
        return
      }

      const uniqueTags = deduplicateTags(tagResult.tags)

      try {
        await query(
          `UPDATE ${TABLES.QUESTIONS}
           SET ai_tags = $1::jsonb, tags_source = 'ai', updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(uniqueTags), q.id]
        )
        updated++
        console.log(`  ✅ [${i + batch.indexOf(q) + 1}/${total}] ${shortId}: ${uniqueTags.join(', ')} (${subject || '无学科'})`)
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

main().catch(err => {
  console.error('脚本执行失败:', err)
  process.exit(1)
})