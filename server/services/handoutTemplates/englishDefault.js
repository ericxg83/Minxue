// ============================================================
// 英语讲义模板
//
// 与 default 模板的关键差异：
//   1. 知识讲解默认英文（除非 kpName 是中文语法名词）；
//   2. 题目按 question_type 分组（cloze / grammar_blank / reading / writing 等），
//      同一题型连续展示，便于学生集中训练；
//   3. 阅读理解题：保留原文 + 题目 + 答案三段式；
//   4. 写作题：题目 + 学生原文 + 模板/范文 + 错误分析；
//   5. 错因使用英语错因词典（时态 / 语态 / 从句 / 主谓一致 / 搭配 ...）；
//   6. 变式题保留 question_type，前端可按题型渲染。
// ============================================================

import { callTextCompletion } from '../../config/ai.js'
import { getVariantsForQuestion } from '../variantService.js'
import { detectEnglishQuestionType, classifyEnglishErrorType, ENGLISH_QUESTION_TYPE_LABELS } from '../englishAnalyzer.js'

export default {
  id: 'english_default',
  label: '英语讲义',
  description: '按英语题型分组：完形/语法填空/阅读/写作 + 变式改写（适合英语学科）',
  supportsSubject: ['英语'],

  buildSections: async ({ kpName, subject = '英语', sampleQuestions = [], explanation = null }) => {
    const blocks = []

    // 1. 知识讲解（英文优先）
    const text = explanation || await generateEnglishExplanation(kpName, kpName)
    if (text) {
      blocks.push({ type: 'explanation', content: text, lang: 'en' })
    }

    if (sampleQuestions.length === 0) {
      return blocks
    }

    // 2. 按 question_type 分组
    const groups = groupByQuestionType(sampleQuestions)

    for (const [type, qs] of groups) {
      const typeLabel = ENGLISH_QUESTION_TYPE_LABELS[type] || type
      blocks.push({ type: 'section', content: `${typeLabel}（${qs.length}）` })

      // 写作题：保留题目 + 学生原文 + 模板
      if (type === 'writing') {
        qs.forEach((q, idx) => {
          blocks.push({
            type: 'question',
            content: `${idx + 1}. ${q.content || '(题目缺失)'}`,
            options: q.options,
          })
          if (q.studentAnswer) {
            blocks.push({
              type: 'text',
              content: `✍️ 学生原文：\n${q.studentAnswer}`,
            })
          }
          if (q.correctAnswer) {
            blocks.push({
              type: 'text',
              content: `✅ 参考范文：\n${q.correctAnswer}`,
            })
          }
          const err = classifyEnglishErrorType(q.errorType, q.errorReason)
          if (err) {
            blocks.push({ type: 'analysis', content: `错因：${err.label}${q.errorReason ? `（${q.errorReason}）` : ''}` })
          } else if (q.errorType) {
            blocks.push({ type: 'analysis', content: `错因：${q.errorType}${q.errorReason ? `（${q.errorReason}）` : ''}` })
          }
        })
        continue
      }

      // 翻译题：题目 + 学生译文 + 参考译文
      if (type === 'translation') {
        qs.forEach((q, idx) => {
          blocks.push({
            type: 'question',
            content: `${idx + 1}. ${q.content || '(题目缺失)'}`,
            options: q.options,
          })
          if (q.studentAnswer) {
            blocks.push({
              type: 'text',
              content: `📝 学生译文：\n${q.studentAnswer}`,
            })
          }
          if (q.correctAnswer) {
            blocks.push({
              type: 'text',
              content: `✅ 参考译文：\n${q.correctAnswer}`,
            })
          }
          const err = classifyEnglishErrorType(q.errorType, q.errorReason)
          if (err) {
            blocks.push({ type: 'analysis', content: `错因：${err.label}` })
          }
        })
        continue
      }

      // 短文改错：题目 + 学生改正
      if (type === 'error_correction') {
        qs.forEach((q, idx) => {
          blocks.push({
            type: 'question',
            content: `${idx + 1}. ${q.content || '(题目缺失)'}`,
            options: q.options,
          })
          if (q.studentAnswer) {
            blocks.push({
              type: 'text',
              content: `📝 学生改正：\n${q.studentAnswer}`,
            })
          }
          if (q.correctAnswer) {
            blocks.push({
              type: 'text',
              content: `✅ 标准改正：\n${q.correctAnswer}`,
            })
          }
        })
        continue
      }

      // 完形/语法填空/选择/句型转换：标准 题目+答案+错因 三段式
      qs.forEach((q, idx) => {
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
        const err = classifyEnglishErrorType(q.errorType, q.errorReason)
        if (err) {
          blocks.push({ type: 'analysis', content: `错因：${err.label}${q.errorReason ? `：${q.errorReason}` : ''}` })
        } else if (q.errorType) {
          blocks.push({ type: 'analysis', content: `错因：${q.errorType}${q.errorReason ? `：${q.errorReason}` : ''}` })
        }
      })
    }

    // 3. 变式练习
    const firstQId = sampleQuestions[0].questionId
    if (firstQId) {
      const variants = await getVariantsForQuestion(firstQId)
      if (variants.length > 0) {
        blocks.push({ type: 'section', content: '变式改写 / 强化训练' })
        blocks.push({ type: 'text', content: '以下变式题与上述题目同考点，建议独立完成。' })
        variants.forEach((v, idx) => {
          const vType = v.question_type && ENGLISH_QUESTION_TYPE_LABELS[v.question_type]
            ? ENGLISH_QUESTION_TYPE_LABELS[v.question_type]
            : '变式'
          blocks.push({
            type: 'variant',
            content: `【${vType}】变式 ${idx + 1}. ${v.content}`,
            options: v.options,
            answer: v.answer,
            analysis: v.analysis,
            questionType: v.question_type || null,
          })
        })
      }
    }

    return blocks
  },
}

function groupByQuestionType(questions) {
  const groups = new Map()
  for (const q of questions) {
    const content = q.content || ''
    const opts = q.options || []
    // 优先用 question_type 字段；缺省则实时识别
    let type = q.question_type
    if (!type) {
      type = detectEnglishQuestionType(content, opts).type
    }
    if (!type || type === 'unknown') type = 'other'
    if (!groups.has(type)) groups.set(type, [])
    groups.get(type).push(q)
  }
  // 排序：完形 → 语法填空 → 阅读 → 写作 → 选择 → 其他
  const ORDER = ['cloze', 'grammar_blank', 'reading', 'translation', 'writing', 'error_correction', 'sentence_pattern', 'choice', 'fill_blank', 'other']
  return new Map(
    Array.from(groups.entries()).sort((a, b) => {
      const ai = ORDER.indexOf(a[0])
      const bi = ORDER.indexOf(b[0])
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  )
}

// 英语知识点讲解（默认英文，kpName 已是英语术语时直接使用）
// 同样走 LRU 缓存,避免 12 个知识点串行调 AI 拖慢 from-diagnosis
const _enExplanationCache = new Map()
const EN_EXPLANATION_CACHE_MAX = 256

async function generateEnglishExplanation(kpName, hint) {
  if (!kpName) return ''
  const cacheKey = `en::${kpName}`
  if (_enExplanationCache.has(cacheKey)) {
    return _enExplanationCache.get(cacheKey)
  }

  const prompt = {
    systemContent: `You are a middle-school English teacher in China. Write a 200-300 word explanation of the grammar/vocabulary point "${kpName}" for Chinese middle-school students.

Use Markdown. Cover:
1. Core definition (one sentence in English + Chinese translation).
2. The most common mistake students make (one sentence).
3. A short memory trick or sentence pattern.
Keep it concise and exam-oriented.`,
    userContent: `Explain: ${kpName}`,
  }
  let text
  try {
    const r = await callTextCompletion({
      systemContent: prompt.systemContent,
      userContent: prompt.userContent,
      temperature: 0.5,
      maxTokens: 700,
    })
    text = (r.content || '').trim()
  } catch (e) {
    console.warn(`[englishDefault] 讲解生成失败 ${kpName}:`, e.message)
    text = `## ${kpName}\n\n*（讲解暂不可用）*`
  }

  // LRU 写入
  if (_enExplanationCache.size >= EN_EXPLANATION_CACHE_MAX) {
    const firstKey = _enExplanationCache.keys().next().value
    if (firstKey) _enExplanationCache.delete(firstKey)
  }
  _enExplanationCache.set(cacheKey, text)
  return text
}
