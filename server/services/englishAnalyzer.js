import { classifyQuestionLocally } from '../utils/localTagger.js'

// ============================================================
// 英语学科分析器（englishAnalyzer）
//
// 职责：在 localTagger 之上做英语专属的"题型识别 + 考点细化"。
// 题型识别（questionType）是英语讲义/变式题生成的依据，比通用 question_type
// （单选/多选/判断/填空/解答）多了一类英语特有题型：完形/语法填空/阅读/书面表达/翻译/改写。
//
// 调用方：
//   - variantService：按 englishQuestionType 决定生成哪种变式
//   - handoutService：英语讲义模板按 englishQuestionType 选不同排版
//   - knowledgeService.normalizeQuestionTags：补全英语 ai_tags（与 SUBJECT_KNOWLEDGE 对齐）
// ============================================================

/**
 * 英语题型分类（与"通用题型"并存，单独识别英语特有的题型）。
 * 优先级：完形 → 语法填空 → 短文改错 → 翻译 → 写作 → 阅读 → 选择 → 填空
 * 同一题可能命中多种，但只返回一种（按优先级取第一个匹配）。
 */
const ENGLISH_QUESTION_TYPE_PATTERNS = [
  { type: 'cloze', label: '完形填空', patterns: [
    /完形填空/,
    /\bcloze\b/i,
    /从下面.{0,8}中选出.{0,8}填入/i,
    /best\s+choice/i,
  ]},
  { type: 'grammar_blank', label: '语法填空', patterns: [
    /语法填空/,
    /用所给.{0,4}的适当形式填空/,
    /短文填空/,
    /语篇填空/,
  ]},
  { type: 'error_correction', label: '短文改错', patterns: [
    /短文改错/,
    /proofreading/i,
    /error\s*correction/i,
    /下列.{0,4}中有一处.*错误/,
    /找出.*错误.*并改正/,
  ]},
  { type: 'translation', label: '翻译', patterns: [
    /翻译.{0,8}下列/,
    /英译汉/,
    /汉译英/,
    /中译英/,
    /translate/i,
    /根据.{0,4}汉语.{0,4}英语/,
  ]},
  { type: 'writing', label: '书面表达', patterns: [
    /书面表达/,
    /^作文/,
    /假如你是.{0,30},?请写/,
    /write\s+a\s+(?:letter|passage|composition|short\s+essay)/i,
    /according\s+to\s+the\s+following\s+(?:information|picture|chart)/i,
  ]},
  { type: 'reading', label: '阅读理解', patterns: [
    /阅读理解/,
    /阅读下列.{0,8}(?:短文|材料|文章)/,
    /according\s+to\s+the\s+passage/i,
    /read\s+the\s+following\s+passage/i,
    /七选五/,
    /句子还原/,
  ]},
  { type: 'sentence_pattern', label: '句型', patterns: [
    /按要求完成下列句子/,
    /句型转换/,
    /同义句转换/,
    /rewrite.{0,8}following\s+sentences/i,
  ]},
  { type: 'choice', label: '选择题', patterns: [
    /—\s*[A-D][\.\)]/,
    /下列.{0,12}中.{0,12}(?:正确|错误|符合|是|不是)/,
    /which\s+of\s+the\s+following/i,
  ]},
]

/**
 * 识别英语题型
 * @param {string} content 题干
 * @param {string|null} options 选项拼接（用于选择题识别）
 * @returns {{type: string, label: string}}
 */
export function detectEnglishQuestionType(content, options = null) {
  const text = String(content || '')
  const optText = Array.isArray(options) ? options.join('；') : (options || '')
  const haystack = `${text}\n${optText}`

  for (const { type, label, patterns } of ENGLISH_QUESTION_TYPE_PATTERNS) {
    if (patterns.some(p => p.test(haystack))) {
      return { type, label }
    }
  }
  return { type: 'unknown', label: '其他' }
}

// ── 错误分析细化（英语专用错因归类） ──
const ENGLISH_ERROR_TAXONOMY = [
  { key: 'tense', label: '时态错误', patterns: [
    /时态/,
    /tense/i,
    /一般.{0,4}时/,
    /完成时/,
    /进行时/,
    /过去式/,
  ]},
  { key: 'subject_verb_agreement', label: '主谓不一致', patterns: [
    /主谓一致/,
    /第三人称单数/,
    /subject.?verb\s+agreement/i,
  ]},
  { key: 'voice', label: '语态错误', patterns: [
    /被动/,
    /passive/i,
  ]},
  { key: 'clause', label: '从句错误', patterns: [
    /从句/,
    /定语从句/,
    /宾语从句/,
    /状语从句/,
    /关系代词/,
    /关系副词/,
    /clause/i,
  ]},
  { key: 'non_finite', label: '非谓语错误', patterns: [
    /非谓语/,
    /不定式|动名词|分词/,
    /to\s+do|doing|done/,
  ]},
  { key: 'article', label: '冠词错误', patterns: [
    /冠词/,
    /\ba\/an\b/,
    /\bthe\b/,
  ]},
  { key: 'preposition', label: '介词错误', patterns: [
    /介词/,
    /preposition/i,
  ]},
  { key: 'collocation', label: '搭配错误', patterns: [
    /搭配/,
    /固定搭配/,
    /短语/,
    /collocation/i,
    /phrasal\s+verb/i,
  ]},
  { key: 'spelling', label: '拼写错误', patterns: [
    /拼写/,
    /spelling/i,
    /错别字/,
  ]},
  { key: 'word_form', label: '词形错误', patterns: [
    /词形/,
    /比较级|最高级/,
    /复数/,
  ]},
  { key: 'punctuation', label: '标点错误', patterns: [
    /标点/,
    /punctuation/i,
    /大小写/,
  ]},
  { key: 'logic', label: '语义/逻辑错误', patterns: [
    /不通顺/,
    /逻辑/,
    /句意/,
  ]},
]

/**
 * 把 AI / 本地归类产出的模糊错因归一化到英语错因词典。
 * 若命中多项按优先级返回第一项。
 * @param {string} errorType 原始错因字符串
 * @param {string} errorReason 原始错因描述
 * @returns {{key: string, label: string} | null}
 */
export function classifyEnglishErrorType(errorType, errorReason) {
  const haystack = `${errorType || ''}\n${errorReason || ''}`
  for (const e of ENGLISH_ERROR_TAXONOMY) {
    if (e.patterns.some(p => p.test(haystack))) {
      return { key: e.key, label: e.label }
    }
  }
  return null
}

/**
 * 英语专用 ai_tags 提取（轻量包装 localTagger，提供题型的额外标签）。
 * 题型本身也是一个 ai_tag 维度，便于讲义/变式路由。
 *
 * @param {string} content 题干
 * @param {string|null} subject 学科
 * @param {string[]|null} options 选项
 * @returns {{tags: string[], difficulty: number, englishType: {type, label}}}
 */
export function classifyEnglishLocally(content, subject = '英语', options = null) {
  const fullContent = Array.isArray(options) && options.length > 0
    ? `${content || ''}\n选项：${options.join('；')}`
    : (content || '')
  const local = classifyQuestionLocally(fullContent, subject)
  const englishType = detectEnglishQuestionType(content, options)

  // 若 local 没拿到任何英语标签，补上题型标签
  const tags = [...local.tags]
  if (englishType.label !== '其他' && !tags.includes(englishType.label)) {
    tags.unshift(englishType.label)
  }

  // 时态/语法题补一个题型标签（即便 SUBJECT_KNOWLEDGE 已命中更细的时态）
  // 兜底：若 tags 完全是空，强行给一个题型标签
  if (tags.length === 0 || (tags.length === 1 && tags[0] === '未分类')) {
    return { tags: [englishType.label], difficulty: 3, englishType }
  }

  return { tags, difficulty: local.difficulty, englishType }
}

export const ENGLISH_QUESTION_TYPE_LABELS = ENGLISH_QUESTION_TYPE_PATTERNS.reduce((acc, x) => {
  acc[x.type] = x.label
  return acc
}, {})
