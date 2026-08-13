// ============================================================
// 备课讲义主模板（lecturePrep）
//
// 定位：老师备课用讲义，不是发给学生的练习卷。
// 结构（一页 = 一个知识点）：
//   1. 知识点速览（AI 科普讲解）
//   2. 错题概况（统计 + 题型分布）
//   3. 本周典型错题（按题型分组，每题带讲解引导）
//   4. 相关知识点（占位）
//   5. 📝 我的笔记（P2 激活编辑）
//
// 关键设计：
//   - 不再生成"变式题"——错题会了就行
//   - 不再生成"错题重练"——讲义只服务老师
//   - 按知识点为主（诊断的根），页内按题型分组（同一知识点下的不同考法）
// ============================================================

import { generateKnowledgeExplanation, generateQuestionTypeSummary } from '../handoutService.js'

export default {
  id: 'lecture_prep',
  label: '备课讲义',
  description: '按知识点组织：错题按题型分组 + 讲解引导 + 老师笔记（核心模板）',
  supportsSubject: 'all',

  /**
   * @param {Object} ctx
   * @param {string} ctx.kpName - 知识点名
   * @param {string} ctx.subject - 学科
   * @param {Array}  ctx.sampleQuestions - 错题样本（已按 question_type 排好序）
   *        每条: { questionId, content, options, imageUrls, studentAnswer, correctAnswer,
   *                isBlank, errorType, errorReason, studentName, questionType }
   * @param {string} [ctx.explanation] - 预生成讲解
   * @returns {Promise<{pages: Array<{name, blocks}>}>} 三页结构：知识点 → 例题 → 题型归纳
   */
  buildSections: async ({ kpName, subject = '数学', sampleQuestions = [], explanation = null }) => {
    const pages = []

    // ─── Page 1: 知识点速览（AI 详讲 500-800 字 → 1-2 页） ───
    const text = explanation || await generateKnowledgeExplanation(kpName, subject)
    pages.push({
      name: `${kpName} · 知识点`,
      blocks: [
        { type: 'kp-overview', content: text || `*（${kpName} 讲解暂不可用）*` },
      ],
    })

    if (sampleQuestions.length === 0) {
      return { pages }
    }

    // ─── Page 2: 例题（本周典型错题，按题型分组） ───
    const blankCount = sampleQuestions.filter(q => q.isBlank).length
    const wrongCount = sampleQuestions.length - blankCount
    const typeGroups = groupByType(sampleQuestions)
    const typeSummary = Array.from(typeGroups.entries()).map(([t, qs]) => ({
      type: t,
      count: qs.length,
    }))

    const exBlocks = [
      {
        type: 'kp-stats',
        content: { total: sampleQuestions.length, blankCount, wrongCount, typeCount: typeGroups.size, types: typeSummary },
      },
      { type: 'section', content: '本周典型错题' },
    ]
    let qIdx = 0
    for (const [qType, qs] of typeGroups) {
      exBlocks.push({
        type: 'type-section',
        content: `题型：${qType}（${qs.length} 道${qs.some(q => q.isBlank) ? `，含空题 ${qs.filter(q => q.isBlank).length}` : ''}）`,
        questionType: qType,
        count: qs.length,
      })
      for (const q of qs) {
        qIdx += 1
        exBlocks.push({
          type: 'question',
          content: `错题 ${qIdx}. ${q.content || '(题干缺失)'}`,
          options: q.options,
          imageUrls: q.imageUrls || [],
          questionType: qType,
          questionId: q.questionId,
        })
        exBlocks.push({
          type: 'answer',
          content: `【${q.studentName || '学生'}】作答：${q.isBlank ? '（空题，未作答）' : (q.studentAnswer || '—')}`,
          correctAnswer: q.correctAnswer || '—',
          isCorrect: q.isBlank ? false : (q.studentAnswer === q.correctAnswer),
        })
        if (q.errorType) {
          exBlocks.push({
            type: 'analysis',
            content: `错因：${q.errorType}${q.errorReason ? `：${q.errorReason}` : ''}`,
          })
        }
        exBlocks.push({
          type: 'lecture-guidance',
          content: buildLectureGuidance(q),
        })
      }
    }
    pages.push({
      name: `${kpName} · 例题（本周错题）`,
      blocks: exBlocks,
    })

    // ─── Page 3: 题型归纳（AI 归纳"换着样考的题型"） ───
    const typeSummaryList = await generateQuestionTypeSummary(kpName, subject, sampleQuestions)
    pages.push({
      name: `${kpName} · 题型归纳`,
      blocks: [
        { type: 'section', content: '本知识点"换着样考"的题型' },
        { type: 'type-summary', content: typeSummaryList || [] },
        { type: 'note', content: '' },
      ],
    })

    return { pages }
  },
}

/**
 * 按题型分组 + 组内排序（空题优先 → 错题按错因典型度）
 * @param {Array} questions
 * @returns {Map<string, Array>} key=题型名，value=错题列表
 */
function groupByType(questions) {
  const groups = new Map()
  for (const q of questions) {
    const t = normalizeType(q.questionType)
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t).push(q)
  }
  // 组内排序：空题在前，其余按 updatedAt 倒序（假设后端已排好，这里再保险）
  for (const [, qs] of groups) {
    qs.sort((a, b) => {
      if (a.isBlank && !b.isBlank) return -1
      if (!a.isBlank && b.isBlank) return 1
      return 0
    })
  }
  // 组间排序：空题多的题型在前（最高优先级）
  return new Map(
    Array.from(groups.entries()).sort((a, b) => {
      const aBlank = a[1].filter(q => q.isBlank).length
      const bBlank = b[1].filter(q => q.isBlank).length
      if (aBlank !== bBlank) return bBlank - aBlank
      return b[1].length - a[1].length
    })
  )
}

/**
 * 归一化题型名。空/unknown/other 统一显示为"未分类题型"
 */
function normalizeType(t) {
  if (!t || t === 'unknown' || t === 'other' || t === '未分类') return '未分类题型'
  return t
}

/**
 * 简单讲解引导（P4 由提词器增强）
 * 输入错题，输出一句"先讲什么、再讲什么"的引导语。
 */
function buildLectureGuidance(q) {
  const parts = []
  parts.push(`💡 讲解引导：`)
  if (q.isBlank) {
    parts.push(`空题（未作答），先从基础概念铺垫，`)
    parts.push(`问 1-2 个相关小问题确认学生卡点，`)
    parts.push(`再回到原题逐步拆解。`)
  } else {
    if (q.errorType) {
      parts.push(`错因"${q.errorType}"——`)
    }
    parts.push(`先纠正思路（不要急着给答案），`)
    parts.push(`再演示完整解题步骤，`)
    parts.push(`最后让 1 个学生复述。`)
  }
  return parts.join('')
}
