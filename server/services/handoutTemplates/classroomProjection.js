// ============================================================
// 投屏备课讲义模板（classroomProjection）
//
// 定位：极简投屏，老师课堂投屏使用。
// 结构（一知识点 = 三页）：
//   1. 知识点精讲页 — 纵向结构，定义/重点/难点/易错/口诀
//   2. 错题精讲页 — 对比卡片 + 分步作答过程
//   3. 题型全览页 — 题型+例题+解题过程+技巧
//
// 关键设计：
//   - 纯白背景，无多余装饰
//   - 大字体、高对比度，适配投影仪
//   - 知识点讲细，字号区分重难点
//   - 错题包含完整分步作答过程
// ============================================================

import { generateKnowledgeExplanation, generateQuestionTypeSummary } from '../handoutService.js'

export default {
  id: 'classroom_projection',
  label: '投屏备课讲义',
  description: '极简投屏：纯白背景、纵向结构、知识点精讲+错题分步作答+题型全览',
  supportsSubject: 'all',

  /**
   * @param {Object} ctx
   * @param {string} ctx.kpName
   * @param {string} ctx.subject
   * @param {Array}  ctx.sampleQuestions
   * @param {string} [ctx.explanation]
   * @returns {Promise<{pages: Array<{name, blocks}>}>}
   */
  buildSections: async ({ kpName, subject = '数学', sampleQuestions = [], explanation = null }) => {
    const pages = []

    // ─── Page 1: 知识点精讲（纵向结构） ───
    const text = explanation || await generateKnowledgeExplanation(kpName, subject)
    const kpBlocks = parseKpSections(text, kpName, subject)
    pages.push({
      name: `${kpName} · 知识点精讲`,
      blocks: [
        { type: 'time-hint', content: estimateTeachingTime(kpName, sampleQuestions) },
        { type: 'kp-section', content: kpName },
        ...kpBlocks,
      ],
    })

    if (sampleQuestions.length === 0) {
      return { pages }
    }

    // ─── Page 2: 错题精讲 ───
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
      { type: 'section', content: '📋 本周典型错题' },
    ]

    let qIdx = 0
    for (const [qType, qs] of typeGroups) {
      exBlocks.push({
        type: 'type-section',
        content: `${qType}（${qs.length} 道${qs.some(q => q.isBlank) ? `，含空题 ${qs.filter(q => q.isBlank).length}` : ''}）`,
        questionType: qType,
        count: qs.length,
      })
      for (const q of qs) {
        qIdx += 1
        // 题干
        exBlocks.push({
          type: 'question',
          content: `第 ${qIdx} 题 · ${q.content || '(题干缺失)'}`,
          options: q.options,
          imageUrls: q.imageUrls || [],
          questionType: qType,
          questionId: q.questionId,
        })
        // 对比卡片：学生作答 vs 正确答案（简洁左右对比）
        exBlocks.push({
          type: 'compare-card',
          content: {
            studentAnswer: q.isBlank ? '（空题，未作答）' : (q.studentAnswer || '—'),
            correctAnswer: q.correctAnswer || '—',
            isBlank: q.isBlank,
            studentName: q.studentName || '学生',
          },
        })
        // 错因简析
        if (q.errorType) {
          exBlocks.push({
            type: 'error-cause',
            content: `错因：${q.errorType}${q.errorReason ? `——${q.errorReason}` : ''}`,
          })
        }
        // 分步作答过程
        exBlocks.push({
          type: 'solution-steps',
          content: buildSolutionSteps(q, kpName),
        })
      }
    }
    pages.push({
      name: `${kpName} · 错题精讲`,
      blocks: exBlocks,
    })

    // ─── Page 3: 题型全览 ───
    const typeSummaryList = await generateQuestionTypeSummary(kpName, subject, sampleQuestions)
    const typeBlocks = [{ type: 'section', content: '🎯 本知识点考试题型全览' }]
    if (Array.isArray(typeSummaryList)) {
      typeSummaryList.forEach((t, i) => {
        typeBlocks.push({
          type: 'type-section',
          content: `${i + 1}. ${t.type || '未命名题型'}`,
        })
        if (t.example) {
          typeBlocks.push({
            type: 'type-example',
            content: t.example,
          })
        }
        if (t.solutionSteps && Array.isArray(t.solutionSteps)) {
          typeBlocks.push({
            type: 'solution-steps',
            content: t.solutionSteps,
          })
        }
        if (t.tip) {
          typeBlocks.push({
            type: 'type-tip',
            content: t.tip,
          })
        }
      })
    }
    pages.push({
      name: `${kpName} · 题型全览`,
      blocks: typeBlocks,
    })

    return { pages }
  },
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 将 AI 讲解 Markdown 文本解析为纵向 block 数组。
 * AI 输出格式：## 核心定义 / ## 重点内容 / ## 难点突破 / ## 易错警示 / ## 记忆口诀
 * 解析后映射到：kp-definition / kp-key-points / kp-difficult-points / kp-mistakes / kp-mnemonic
 */
function parseKpSections(text, kpName, subject) {
  const blocks = []

  if (!text) {
    blocks.push({ type: 'kp-definition', content: `${kpName}是${subject}学科中的重要知识点。` })
    blocks.push({ type: 'kp-key-points', content: ['请参考教材相关章节'], label: '重点' })
    blocks.push({ type: 'kp-difficult-points', content: ['暂无数据'], label: '难点' })
    blocks.push({ type: 'kp-mistakes', content: ['暂无错题数据'] })
    blocks.push({ type: 'kp-mnemonic', content: '理解定义，多做练习' })
    return blocks
  }

  // 按 ## 标题分割
  const sections = text.split(/\n(?=## )/)
  for (const sec of sections) {
    const lines = sec.trim().split('\n')
    const header = lines[0].replace(/^##\s*/, '').trim()
    const body = lines.slice(1).join('\n').trim()

    if (header.includes('定义') || header.includes('核心')) {
      const clean = body.replace(/^[*-]\s*/gm, '').replace(/\n+/g, ' ').trim()
      blocks.push({ type: 'kp-definition', content: clean.slice(0, 300) || `${kpName}是${subject}学科中的重要知识点。` })
    } else if (header.includes('重点') || header.includes('关键')) {
      const items = extractListItems(body)
      blocks.push({ type: 'kp-key-points', content: items.length > 0 ? items.slice(0, 6) : [body.slice(0, 120)], label: '重点' })
    } else if (header.includes('难点')) {
      const items = extractListItems(body)
      blocks.push({ type: 'kp-difficult-points', content: items.length > 0 ? items.slice(0, 5) : [body.slice(0, 120)], label: '难点' })
    } else if (header.includes('易错') || header.includes('错误') || header.includes('警示')) {
      const items = extractListItems(body)
      blocks.push({ type: 'kp-mistakes', content: items.length > 0 ? items.slice(0, 5) : [body.slice(0, 120)] })
    } else if (header.includes('口诀') || header.includes('记忆') || header.includes('技巧')) {
      const clean = body.replace(/^[>*-]\s*/gm, '').replace(/\n+/g, ' ').trim()
      blocks.push({ type: 'kp-mnemonic', content: clean.slice(0, 200) || '理解定义，多做练习，注意细节' })
    } else if (header.includes('考法') || header.includes('考点')) {
      // 兼容旧格式：考法/考点内容合并到重点
      const items = extractListItems(body)
      const existing = blocks.find(b => b.type === 'kp-key-points')
      if (existing) {
        existing.content = [...existing.content, ...items].slice(0, 8)
      }
    }
  }

  // 兜底：确保每个 block 类型都存在
  if (!blocks.find(b => b.type === 'kp-definition')) {
    blocks.unshift({ type: 'kp-definition', content: `${kpName}是${subject}学科中的重要知识点。` })
  }
  if (!blocks.find(b => b.type === 'kp-key-points')) {
    blocks.push({ type: 'kp-key-points', content: ['请参考教材相关章节'], label: '重点' })
  }
  if (!blocks.find(b => b.type === 'kp-difficult-points')) {
    blocks.push({ type: 'kp-difficult-points', content: ['暂无数据'], label: '难点' })
  }
  if (!blocks.find(b => b.type === 'kp-mistakes')) {
    blocks.push({ type: 'kp-mistakes', content: ['暂无错题数据'] })
  }
  if (!blocks.find(b => b.type === 'kp-mnemonic')) {
    blocks.push({ type: 'kp-mnemonic', content: '理解定义，多做练习，注意细节' })
  }

  return blocks
}

function extractListItems(text) {
  if (!text) return []
  return text
    .split('\n')
    .map(line => line.replace(/^[*-]\s*/, '').replace(/^\d+[.、]\s*/, '').trim())
    .filter(s => s.length > 0)
}

function estimateTeachingTime(kpName, sampleQuestions) {
  const base = sampleQuestions.length > 0 ? 8 : 5
  const extra = Math.min(sampleQuestions.length, 5)
  const minutes = Math.min(base + extra, 20)
  return `⏱ 建议讲解 ${minutes} 分钟（知识点 ${base} 分钟 + 错题分析 ${extra} 分钟）`
}

function groupByType(questions) {
  const groups = new Map()
  for (const q of questions) {
    const t = normalizeType(q.questionType)
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t).push(q)
  }
  for (const [, qs] of groups) {
    qs.sort((a, b) => {
      if (a.isBlank && !b.isBlank) return -1
      if (!a.isBlank && b.isBlank) return 1
      return 0
    })
  }
  return new Map(
    Array.from(groups.entries()).sort((a, b) => {
      const aBlank = a[1].filter(q => q.isBlank).length
      const bBlank = b[1].filter(q => q.isBlank).length
      if (aBlank !== bBlank) return bBlank - aBlank
      return b[1].length - a[1].length
    })
  )
}

function normalizeType(t) {
  if (!t || t === 'unknown' || t === 'other' || t === '未分类') return '未分类题型'
  return t
}

/**
 * 生成分步作答过程。
 * 每道错题生成编号步骤列表，每步有说明文字和公式字段。
 * @returns {Array<{step: number, text: string, formula: string}>}
 */
function buildSolutionSteps(q, kpName) {
  const steps = []
  let n = 0

  steps.push({ step: ++n, text: '审题：明确已知条件和求解目标', formula: '' })

  if (q.isBlank) {
    steps.push({ step: ++n, text: `回顾「${kpName}」相关概念与公式，确认适用条件`, formula: '' })
    steps.push({ step: ++n, text: '将已知条件代入公式，逐步推导', formula: q.correctAnswer ? `$\\text{答案} = ${q.correctAnswer}$` : '' })
  } else {
    if (q.errorType) {
      steps.push({ step: ++n, text: `注意避坑：${q.errorType}${q.errorReason ? `（${q.errorReason}）` : ''}`, formula: '' })
    }
    steps.push({ step: ++n, text: '列式：根据题意和公式写出正确表达式', formula: '' })
    steps.push({ step: ++n, text: '计算求解，得出最终结果', formula: q.correctAnswer ? `$\\text{正确答案} = ${q.correctAnswer}$` : '' })
  }

  steps.push({ step: ++n, text: '验证：检查结果是否合理，回顾关键步骤', formula: '' })

  return steps
}