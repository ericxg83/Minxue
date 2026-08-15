// ============================================================
// 英语备课讲义模板（englishLecturePrep）
//
// 与 lecturePrep 的差异：
//   1. 知识讲解默认英文（除非 kpName 是中文语法名词）
//   2. 错题按 question_type 分组（完形/语法填空/阅读/写作/翻译/短文改错）
//   3. 写作题：保留题目 + 学生原文 + 范文 + 错因
//   4. 翻译题：题目 + 学生译文 + 参考译文
//   5. 短文改错：题目 + 学生改正 + 标准改正
//   6. 不生成变式题
//   7. 不生成"错题重练"
// ============================================================

import { callTextCompletion } from '../../config/ai.js'
import { detectEnglishQuestionType, classifyEnglishErrorType, ENGLISH_QUESTION_TYPE_LABELS } from '../englishAnalyzer.js'
import { generateQuestionTypeSummary } from '../handoutService.js'

export default {
  id: 'english_lecture_prep',
  label: '英语备课讲义',
  description: '按英语题型分组：完形/语法/阅读/写作/翻译/改错 + 讲解引导（英语学科专用）',
  supportsSubject: ['英语'],

  buildSections: async ({ kpName, subject = '英语', sampleQuestions = [], explanation = null }) => {
    const pages = []

    // ─── Page 1: 知识点速览（AI 讲解） ───
    const text = explanation || await generateEnglishExplanation(kpName)
    pages.push({
      name: `${kpName} · 知识点`,
      blocks: [
        { type: 'kp-overview', content: text || `*（${kpName} 讲解暂不可用）*`, lang: 'en' },
      ],
    })

    const hasWrongQuestions = sampleQuestions.length > 0

    // ─── Page 2: 例题（按英语题型分组）—— 仅当有错题时生成 ───
    if (hasWrongQuestions) {
      pages.push({
        name: `${kpName} · 例题（本周错题）`,
        blocks: buildEnglishExampleBlocks(sampleQuestions),
      })
    }

    // ─── Page 3: 题型归纳 —— 始终生成 ───
    const typeSummaryList = await generateQuestionTypeSummary(kpName, subject, sampleQuestions)
    const typeBlocks = [
      { type: 'section', content: hasWrongQuestions ? '本知识点"换着样考"的题型' : '本知识点常考题型' },
    ]
    if (!hasWrongQuestions) {
      typeBlocks.push({
        type: 'edu-note',
        content: '本周暂无该知识点的错题记录，以下题型基于中考/升学考试大纲整理，供课堂讲解参考。',
      })
    }
    if (Array.isArray(typeSummaryList) && typeSummaryList.length > 0) {
      typeBlocks.push({ type: 'type-summary', content: typeSummaryList })
    } else {
      typeBlocks.push({
        type: 'edu-note',
        content: '题型归纳生成中，请稍后重试。',
      })
    }
    pages.push({
      name: `${kpName} · 题型归纳`,
      blocks: typeBlocks,
    })

    return { pages }
  },
}

/**
 * 把"按英语题型分组的错题展示"封装成可复用的 blocks 数组。
 * 写在前置函数里，让 buildSections 主体只关心 page 编排。
 */
function buildEnglishExampleBlocks(sampleQuestions) {
  const blocks = []
  const blankCount = sampleQuestions.filter(q => q.isBlank).length
  const wrongCount = sampleQuestions.length - blankCount
  const typeGroups = groupByQuestionType(sampleQuestions)
  blocks.push({
    type: 'kp-stats',
    content: {
      total: sampleQuestions.length,
      blankCount,
      wrongCount,
      typeCount: typeGroups.size,
      types: Array.from(typeGroups.keys()),
    },
  })
  blocks.push({ type: 'section', content: '本周典型错题' })

  let qIdx = 0
  for (const [qType, qs] of typeGroups) {
    // 归一化显示：'other' / 'unknown' / '' 统一显示"其他"（不要让原始 key 漏出到 UI）
    const typeLabel = (qType === 'other' || qType === 'unknown' || !qType)
      ? '其他'
      : (ENGLISH_QUESTION_TYPE_LABELS[qType] || qType)
    blocks.push({
      type: 'type-section',
      content: `题型：${typeLabel}（${qs.length} 道）`,
      questionType: typeLabel,
      count: qs.length,
    })

    // 写作题：特殊展示
    if (qType === 'writing') {
      for (const q of qs) {
        qIdx += 1
        blocks.push({
          type: 'question',
          content: `错题 ${qIdx}. ${q.content || '(题目缺失)'}`,
          options: q.options,
          imageUrls: q.imageUrls || [],
          questionType: typeLabel,
          questionId: q.questionId,
        })
        if (q.studentAnswer) {
          blocks.push({ type: 'text', content: `✍️ 学生原文：\n${q.studentAnswer}` })
        }
        if (q.correctAnswer) {
          blocks.push({ type: 'text', content: `✅ 参考范文：\n${q.correctAnswer}` })
        }
        const err = classifyEnglishErrorType(q.errorType, q.errorReason)
        if (err) {
          blocks.push({ type: 'analysis', content: `错因：${err.label}${q.errorReason ? `（${q.errorReason}）` : ''}` })
        } else if (q.errorType) {
          blocks.push({ type: 'analysis', content: `错因：${q.errorType}${q.errorReason ? `（${q.errorReason}）` : ''}` })
        }
        blocks.push({ type: 'lecture-guidance', content: buildLectureGuidance(q) })
      }
      continue
    }

    // 翻译题
    if (qType === 'translation') {
      for (const q of qs) {
        qIdx += 1
        blocks.push({
          type: 'question',
          content: `错题 ${qIdx}. ${q.content || '(题目缺失)'}`,
          options: q.options,
          imageUrls: q.imageUrls || [],
          questionType: typeLabel,
          questionId: q.questionId,
        })
        if (q.studentAnswer) {
          blocks.push({ type: 'text', content: `📝 学生译文：\n${q.studentAnswer}` })
        }
        if (q.correctAnswer) {
          blocks.push({ type: 'text', content: `✅ 参考译文：\n${q.correctAnswer}` })
        }
        const err = classifyEnglishErrorType(q.errorType, q.errorReason)
        if (err) {
          blocks.push({ type: 'analysis', content: `错因：${err.label}` })
        }
        blocks.push({ type: 'lecture-guidance', content: buildLectureGuidance(q) })
      }
      continue
    }

    // 短文改错
    if (qType === 'error_correction') {
      for (const q of qs) {
        qIdx += 1
        blocks.push({
          type: 'question',
          content: `错题 ${qIdx}. ${q.content || '(题目缺失)'}`,
          options: q.options,
          imageUrls: q.imageUrls || [],
          questionType: typeLabel,
          questionId: q.questionId,
        })
        if (q.studentAnswer) {
          blocks.push({ type: 'text', content: `📝 学生改正：\n${q.studentAnswer}` })
        }
        if (q.correctAnswer) {
          blocks.push({ type: 'text', content: `✅ 标准改正：\n${q.correctAnswer}` })
        }
        blocks.push({ type: 'lecture-guidance', content: buildLectureGuidance(q) })
      }
      continue
    }

    // 完形/语法填空/阅读/选择/句型转换：标准三段式
    for (const q of qs) {
      qIdx += 1
      blocks.push({
        type: 'question',
        content: `错题 ${qIdx}. ${q.content || '(题干缺失)'}`,
        options: q.options,
        imageUrls: q.imageUrls || [],
        questionType: typeLabel,
        questionId: q.questionId,
      })
      blocks.push({
        type: 'answer',
        content: `【${q.studentName || '学生'}】作答：${q.isBlank ? '（空题）' : (q.studentAnswer || '—')}`,
        correctAnswer: q.correctAnswer || '—',
        isCorrect: q.isBlank ? false : (q.studentAnswer === q.correctAnswer),
      })
      const err = classifyEnglishErrorType(q.errorType, q.errorReason)
      if (err) {
        blocks.push({ type: 'analysis', content: `错因：${err.label}${q.errorReason ? `：${q.errorReason}` : ''}` })
      } else if (q.errorType) {
        blocks.push({ type: 'analysis', content: `错因：${q.errorType}${q.errorReason ? `：${q.errorReason}` : ''}` })
      }
      blocks.push({ type: 'lecture-guidance', content: buildLectureGuidance(q) })
    }
  }
  return blocks
}

function groupByQuestionType(questions) {
  const groups = new Map()
  for (const q of questions) {
    const content = q.content || ''
    const opts = q.options || []
    // 优先用 question_type 字段；缺省则实时识别
    let type = q.questionType
    if (!type) {
      type = detectEnglishQuestionType(content, opts).type
    }
    if (!type || type === 'unknown' || type === 'other') type = 'other' // 'other' 也归入 fallback group
    if (!groups.has(type)) groups.set(type, [])
    groups.get(type).push(q)
  }
  // 排序：完形 → 语法填空 → 阅读 → 写作 → 翻译 → 短文改错 → 句型转换 → 选择 → 其他
  const ORDER = ['cloze', 'grammar_blank', 'reading', 'writing', 'translation', 'error_correction', 'sentence_pattern', 'choice', 'fill_blank', 'other']
  return new Map(
    Array.from(groups.entries()).sort((a, b) => {
      const ai = ORDER.indexOf(a[0])
      const bi = ORDER.indexOf(b[0])
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  )
}

function buildLectureGuidance(q) {
  const lines = []
  lines.push('**Teaching Guidance**')
  lines.push('')

  if (q.isBlank) {
    lines.push('**Diagnosis**: Student left this blank — possible knowledge gap or lack of confidence.')
    lines.push('')
    lines.push('**Step-by-step**:')
    lines.push('1. **Warm-up**: Review the key vocabulary or grammar point needed for this question.')
    lines.push('2. **Check understanding**: Ask 1-2 simplified questions to identify where the student is stuck.')
    lines.push('   Example: "What is this question asking you to do?"')
    lines.push('3. **Scaffold**: Guide the student through the question step by step, confirming understanding at each stage.')
    lines.push('4. **Verify**: Have the student explain the answer in their own words.')
  } else {
    if (q.errorType) {
      lines.push(`**Error diagnosis**: ${q.errorType}${q.errorReason ? ` — ${q.errorReason}` : ''}`)
    } else {
      lines.push('**Error diagnosis**: Review the gap between student answer and correct answer.')
    }
    lines.push('')
    lines.push('**Step-by-step**:')
    lines.push('1. **Correct the thinking**: Don\'t give the answer directly. Ask the student to review their own reasoning.')
    lines.push('   Example: "What grammar rule do you think this question is testing?"')
    lines.push('2. **Demonstrate**: Show the complete correct answer, explaining each step.')
    lines.push('3. **Compare**: Help the student identify exactly where their approach differed from the correct one.')
    lines.push('4. **Reinforce**: Have the student redo a similar question independently to confirm mastery.')
  }
  return lines.join('\n')
}

// 英语知识点讲解（默认英文，kpName 已是英语术语时直接使用）
// 同样走 LRU 缓存
const _enExplanationCache = new Map()
const EN_EXPLANATION_CACHE_MAX = 256

/**
 * 检测英文 AI 讲解是否回显了 prompt 指令文本
 */
function isEnglishPromptEcho(text) {
  if (!text) return true
  const lower = text.toLowerCase()
  const echoPatterns = [
    'you are a middle-school english teacher',
    'write a 200-300 word explanation',
    'core definition',
    'the most common mistake',
    'short memory trick',
    'keep it concise and exam-oriented',
    'explain:',
  ]
  const matchCount = echoPatterns.filter(p => lower.includes(p.toLowerCase())).length
  return matchCount >= 2
}

/**
 * 英语知识点兜底模板
 */
function buildEnglishFallbackExplanation(kpName) {
  return `## ${kpName}

### Definition
${kpName} is an important English grammar/vocabulary point that students need to master for exams.

### Common Mistakes
- Students often confuse ${kpName} with similar grammatical structures
- Incorrect word order or tense agreement when using ${kpName}
- Over-generalizing the rules of ${kpName} to contexts where they don't apply

### Memory Tip
> Practice with real exam questions to internalize the pattern of ${kpName}. Create your own example sentences to reinforce understanding.

### Key Points
- Understand when and where to use ${kpName}
- Pay attention to common collocations and fixed expressions
- Review error patterns from past exams`
}

async function generateEnglishExplanation(kpName) {
  if (!kpName) return ''
  const cacheKey = `en::${kpName}::v2`
  if (_enExplanationCache.has(cacheKey)) {
    return _enExplanationCache.get(cacheKey)
  }

  let text = ''
  const MAX_ATTEMPTS = 2

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const isRetry = attempt > 0
      const r = await callTextCompletion({
        systemContent: isRetry
          ? ''
          : 'You are an English teacher. Output the explanation directly in Markdown. No greetings or closings.',
        userContent: isRetry
          ? `Explain the English grammar/vocabulary point "${kpName}" in 200-300 words. Cover: definition, common mistakes, and a memory tip. Use Markdown. Output directly.`
          : `Explain "${kpName}" for Chinese middle-school students. Use Markdown with ## headings. Cover definition, common mistakes, and a memory tip. Be concise.`,
        temperature: 0.5,
        maxTokens: 700,
      })
      const raw = (r.content || '').trim()
      if (!isEnglishPromptEcho(raw)) {
        text = raw
        break
      }
      console.warn(`[englishLecturePrep] 检测到 AI 回显 prompt（第 ${attempt + 1} 次），尝试重试...`)
    } catch (e) {
      console.warn(`[englishLecturePrep] 讲解生成失败 ${kpName} (第 ${attempt + 1} 次):`, e.message)
    }
  }

  if (!text || isEnglishPromptEcho(text)) {
    console.warn(`[englishLecturePrep] ${kpName} AI 讲解全部失败，使用兜底模板`)
    text = buildEnglishFallbackExplanation(kpName)
  }

  if (_enExplanationCache.size >= EN_EXPLANATION_CACHE_MAX) {
    const firstKey = _enExplanationCache.keys().next().value
    if (firstKey) _enExplanationCache.delete(firstKey)
  }
  _enExplanationCache.set(cacheKey, text)
  return text
}
