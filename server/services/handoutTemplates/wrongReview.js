// ============================================================
// 错题复习讲义模板
//
// 拼装顺序：错题重练（同一题再做一遍）→ 错因归类 → 同类题变式 → 复习建议
// 适用学科：全学科（重点是"我哪里错了、为什么错、下次怎么避免"）
// ============================================================

import { getVariantsForQuestion } from '../variantService.js'
import { classifyEnglishErrorType } from '../englishAnalyzer.js'

export default {
  id: 'wrong_review',
  label: '错题复习',
  description: '错题重练 → 错因归类 → 同类变式 → 复习建议（重点解决"为什么错"）',
  supportsSubject: 'all',

  buildSections: async ({ kpName, subject = '数学', sampleQuestions = [], explanation = null }) => {
    const blocks = []

    // 1. 错题重练：把每道错题原样重出，不带答案，留空让学生重做
    if (sampleQuestions.length > 0) {
      blocks.push({ type: 'section', content: '错题重练' })
      blocks.push({ type: 'text', content: '请先不看答案，独立完成以下错题。完成后对照答案和错因分析。' })
      sampleQuestions.forEach((q, idx) => {
        blocks.push({
          type: 'question',
          content: `${idx + 1}. ${q.content || '(题干缺失)'}`,
          options: q.options,
        })
        // 隐藏参考答案（让学生先做）
        blocks.push({
          type: 'analysis',
          content: `💡 参考答案：${q.correctAnswer || '—'}`,
        })
      })
    }

    // 2. 错因归类（按 errorType / errorReason 汇总，英语走英语错因词典）
    if (sampleQuestions.length > 0) {
      blocks.push({ type: 'section', content: '错因归类' })
      const errorMap = aggregateErrorReasons(sampleQuestions, subject)
      if (errorMap.length === 0) {
        blocks.push({ type: 'text', content: '暂无明确错因记录，建议先做一遍"错题重练"后回填错因。' })
      } else {
        errorMap.forEach((e, idx) => {
          blocks.push({
            type: 'text',
            content: `(${idx + 1}) ${e.label}：${e.count} 道题\n  典型样例：${e.example}`,
          })
        })
      }
    }

    // 3. 同类题变式
    if (sampleQuestions.length > 0) {
      const firstQId = sampleQuestions[0].questionId
      if (firstQId) {
        const variants = await getVariantsForQuestion(firstQId)
        if (variants.length > 0) {
          blocks.push({ type: 'section', content: '同类题变式' })
          blocks.push({ type: 'text', content: '与原错题同考点，做完对照答案检验自己是否真正掌握。' })
          variants.forEach((v, idx) => {
            blocks.push({
              type: 'variant',
              content: `变式 ${idx + 1}. ${v.content}`,
              options: v.options,
              answer: v.answer,
              analysis: v.analysis,
              questionType: v.question_type || null,
            })
          })
        }
      }
    }

    // 4. 复习建议
    blocks.push({ type: 'section', content: '复习建议' })
    blocks.push({
      type: 'text',
      content:
        '① 先做"错题重练"，不看书不看答案，做错或卡壳的题用红笔标记；\n' +
        '② 对照"错因归类"中自己的高频错因，在笔记本上写下"下次遇到此类题的 3 步检查"；\n' +
        '③ 把"同类题变式"当作自测，3 道全对说明已经掌握；\n' +
        '④ 一周后再次复习本页，重做错题。',
    })

    return blocks
  },
}

function aggregateErrorReasons(samples, subject) {
  const map = new Map()
  for (const q of samples) {
    let label = q.errorType
    if (subject === '英语') {
      const eng = classifyEnglishErrorType(q.errorType, q.errorReason)
      if (eng) label = eng.label
    }
    if (!label) continue
    if (!map.has(label)) {
      map.set(label, { label, count: 0, example: '' })
    }
    const e = map.get(label)
    e.count += 1
    if (!e.example && q.content) {
      e.example = `${String(q.content).slice(0, 30)}${q.content.length > 30 ? '...' : ''}`
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}
