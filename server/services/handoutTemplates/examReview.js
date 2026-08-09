// ============================================================
// 考前冲刺讲义模板
//
// 拼装顺序：考点速览 → 高频错题 → 冲刺练习（变式）→ 应试技巧
// 适用学科：数学 / 物理 / 化学 / all（适合考试前 1-2 天用）
// ============================================================

import { callTextCompletion } from '../../config/ai.js'
import { getVariantsForQuestion } from '../variantService.js'

export default {
  id: 'exam_review',
  label: '考前冲刺',
  description: '考点速览 → 高频错题 → 冲刺练习 → 应试技巧（考试前 1-2 天复习用）',
  supportsSubject: 'all',

  buildSections: async ({ kpName, subject = '数学', sampleQuestions = [], explanation = null }) => {
    const blocks = []

    // 1. 考点速览
    const overview = await generateExamOverview(kpName, subject, explanation)
    if (overview) {
      blocks.push({ type: 'explanation', content: overview })
    }

    // 2. 高频错题（按样本原始顺序，不做"例题"等额外措辞）
    if (sampleQuestions.length > 0) {
      blocks.push({ type: 'section', content: '高频错题' })
      blocks.push({ type: 'text', content: '考试中本类题目频繁出现，建议重点复习。' })
      sampleQuestions.forEach((q, idx) => {
        blocks.push({
          type: 'question',
          content: `${idx + 1}. ${q.content || '(题干缺失)'}`,
          options: q.options,
        })
        blocks.push({
          type: 'answer',
          content: `【${q.studentName || '学生'}】作答：${q.isBlank ? '（空题）' : (q.studentAnswer || '—')}`,
          correctAnswer: q.correctAnswer || '—',
          isCorrect: q.isBlank ? false : (q.studentAnswer === q.correctAnswer),
        })
        if (!q.isBlank && q.errorType) {
          blocks.push({
            type: 'analysis',
            content: `错因：${q.errorType}${q.errorReason ? `：${q.errorReason}` : ''}`,
          })
        }
      })
    }

    // 3. 冲刺练习（变式题）
    if (sampleQuestions.length > 0) {
      const firstQId = sampleQuestions[0].questionId
      if (firstQId) {
        const variants = await getVariantsForQuestion(firstQId)
        if (variants.length > 0) {
          blocks.push({ type: 'section', content: '冲刺练习' })
          blocks.push({ type: 'text', content: '限时 20 分钟内完成，做完再对答案，重点看错题变式的解题思路。' })
          variants.forEach((v, idx) => {
            blocks.push({
              type: 'variant',
              content: `冲刺 ${idx + 1}. ${v.content}`,
              options: v.options,
              answer: v.answer,
              analysis: v.analysis,
              questionType: v.question_type || null,
            })
          })
        }
      }
    }

    // 4. 应试技巧
    blocks.push({ type: 'section', content: '应试技巧' })
    blocks.push({
      type: 'text',
      content:
        '① 先看问题再读题，圈出关键词；\n' +
        '② 简单题先做，难题标记跳过，回头再啃；\n' +
        '③ 答完后检查单位、符号、答案是否符合题意；\n' +
        '④ 遇到不会的题，先把会写的公式/步骤写上，能拿步骤分。',
    })

    return blocks
  },
}

// AI 生成考点速览（更紧凑的"考试点列举"风格，而不是详细讲解）
async function generateExamOverview(kpName, subject, fallback) {
  if (!kpName) return fallback || ''
  if (fallback) return fallback
  const prompt = {
    systemContent: `你是 K12 ${subject} 老师。请为「${kpName}」写一段"考点速览"（150-200 字），用于考试前快速复习。
要求：
1. 用 Markdown 列表形式（1-3 条）。
2. 每条一句话点出该考点的核心公式/判别条件/易错点。
3. 不要展开长篇大论，重在"考前速记"。
4. 末尾给一句"考试时先想：……"作为临场提醒。`,
    userContent: `考点：${kpName}（${subject}）`,
  }
  try {
    const r = await callTextCompletion({
      systemContent: prompt.systemContent,
      userContent: prompt.userContent,
      temperature: 0.4,
      maxTokens: 600,
    })
    return (r.content || '').trim()
  } catch (e) {
    console.warn(`[examReview] 考点速览生成失败 ${kpName}:`, e.message)
    return `## ${kpName}\n\n*（考点速览暂不可用）*`
  }
}
