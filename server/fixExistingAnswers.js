/**
 * 一次性修复脚本：为已有 answer = '-' 或空值的题目重新生成 AI 参考答案
 *
 * 使用方式: node server/fixExistingAnswers.js
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '.env') })

import { query } from './config/neon.js'
import { updateQuestionAnswer, markAnswerException } from './services/neonService.js'
import {
  generateAnswerForQuestion,
  extractAnswerFromAnalysis,
  validateAIAnswer
} from './worker.js'

async function fixExistingAnswers() {
  console.log('='.repeat(60))
  console.log('🔍 查找需要修复的题目 (answer = \'-\' / NULL / 空 / 待人工补充)...')
  console.log('='.repeat(60))

  const { rows } = await query(`
    SELECT id, content, options, answer, analysis, question_type, subject, student_id
    FROM questions
    WHERE answer = '-' OR answer IS NULL OR answer = '' OR answer = '待人工补充' OR answer = '此为主观题，无唯一标准答案'
    ORDER BY created_at DESC
  `)

  console.log(`\n📊 找到 ${rows.length} 道需要修复的题目\n`)

  if (rows.length === 0) {
    console.log('✅ 没有需要修复的题目')
    return
  }

  let successCount = 0
  let failCount = 0

  for (let i = 0; i < rows.length; i++) {
    const q = rows[i]
    const index = i + 1

    // options 在 DB 中是 JSON 字符串，需要解析
    let options = []
    if (q.options) {
      try {
        options = typeof q.options === 'string' ? JSON.parse(q.options) : q.options
      } catch {
        options = []
      }
    }

    const content = q.content || ''
    const fullContent = options.length > 0
      ? `${content}\n选项：${options.join('；')}`
      : content

    if (!content.trim()) {
      console.log(`  [${index}/${rows.length}] ⏭️  ${q.id.substring(0, 8)}: 跳过（题目内容为空）`)
      failCount++
      continue
    }

    process.stdout.write(`  [${index}/${rows.length}] 🔄 ${q.id.substring(0, 8)}: ${content.substring(0, 40)}... `)

    try {
      const result = await generateAnswerForQuestion(fullContent)

      // 1) 优先使用 validateAIAnswer 通过的答案
      const validation = validateAIAnswer(result.answer, result.analysis)

      if (validation.isValid) {
        const finalAnswer = extractAnswerFromAnalysis(result.answer, result.analysis, options)
        await updateQuestionAnswer(q.id, finalAnswer, result.analysis, true)
        successCount++
        console.log(`✅ ${finalAnswer}`)
      } else if (result.analysis && result.analysis.trim()) {
        // 2) AI 答案无效但分析文本存在，尝试从分析中提取
        const extracted = extractAnswerFromAnalysis(result.answer, result.analysis, options)
        if (extracted && extracted !== '-' && extracted !== result.answer) {
          await updateQuestionAnswer(q.id, extracted, result.analysis, true)
          successCount++
          console.log(`✅ 从分析提取 → ${extracted}`)
        } else {
          // 3) 提取失败，至少保存分析文本
          try {
            await query(
              `UPDATE questions SET analysis = $1, updated_at = NOW() WHERE id = $2`,
              [result.analysis, q.id]
            )
          } catch (_) {}
          await markAnswerException(q.id, validation.reason)
          failCount++
          console.log(`⚠️ 无法生成答案 (${validation.reason})，已保存分析文本`)
        }
      } else {
        // 4) 完全无法生成
        await markAnswerException(q.id, validation.reason)
        failCount++
        console.log(`❌ ${validation.reason}`)
      }
    } catch (err) {
      failCount++
      console.log(`❌ 错误: ${err.message}`)
    }

    // 每次 API 调用后延迟，避免触发限流
    if (i < rows.length - 1) {
      await new Promise(r => setTimeout(r, 800))
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log(`📊 修复完成:`)
  console.log(`   总计: ${rows.length} 道`)
  console.log(`   ✅ 成功: ${successCount} 道`)
  console.log(`   ❌ 失败: ${failCount} 道`)
  console.log('='.repeat(60))
}

fixExistingAnswers().catch(err => {
  console.error('\n💥 脚本执行失败:', err.message)
  process.exit(1)
})
