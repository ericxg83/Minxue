// ============================================================
// 默认讲义模板（数学 / 通用）
//
// 拼装顺序：知识讲解 → 典型例题（带学生答案+错因）→ 变式练习
// 适用学科：数学 / 物理 / 化学 / 语文 / all
// ============================================================

import { generateKnowledgeExplanation } from '../handoutService.js'
import { getVariantsForQuestion } from '../variantService.js'

export default {
  id: 'default',
  label: '默认讲义',
  description: '按知识点分组：知识讲解 → 典型例题 → 变式练习（数学/通用）',
  supportsSubject: 'all',

  /**
   * @param {Object} ctx
   * @param {string} ctx.kpName - 知识点名
   * @param {string} ctx.subject - 学科
   * @param {Array}  ctx.sampleQuestions - 错题样本
   * @param {string} [ctx.explanation] - 预生成讲解（可省）
   * @returns {Promise<Array>} blocks
   */
  buildSections: async ({ kpName, subject = '数学', sampleQuestions = [], explanation = null }) => {
    const blocks = []

    // 1. 知识讲解
    const text = explanation || await generateKnowledgeExplanation(kpName, subject)
    if (text) {
      blocks.push({ type: 'explanation', content: text })
    }

    // 2. 典型例题
    if (sampleQuestions.length > 0) {
      blocks.push({ type: 'section', content: '典型例题' })
      sampleQuestions.forEach((q, idx) => {
        blocks.push({
          type: 'question',
          content: `例题 ${idx + 1}. ${q.content || '(题干缺失)'}`,
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

    // 3. 变式练习
    if (sampleQuestions.length > 0) {
      const firstQId = sampleQuestions[0].questionId
      if (firstQId) {
        const variants = await getVariantsForQuestion(firstQId)
        if (variants.length > 0) {
          blocks.push({ type: 'section', content: '变式练习' })
          blocks.push({ type: 'text', content: '以下变式题与例题考点相同，建议学生独立完成后再对照答案。' })
          variants.forEach((v, idx) => {
            blocks.push({
              type: 'variant',
              content: `变式 ${idx + 1}（${v.strategy === 'change_number' ? '改数字' : v.strategy === 'change_condition' ? '改条件' : v.strategy === 'inverse' ? '逆命题' : '情境迁移'}）. ${v.content}`,
              options: v.options,
              answer: v.answer,
              analysis: v.analysis,
              questionType: v.question_type || null,
            })
          })
        }
      }
    }

    return blocks
  },
}
