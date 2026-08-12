import { callTextCompletion } from '../config/ai.js'
import { getQuestionKnowledge } from './knowledgeService.js'
import { getTemplate, pickTemplateBySubject, listTemplates } from './handoutTemplates/index.js'

// ============================================================
// 讲义引擎服务（handoutService）
//
// 职责：
//   1. AI 生成知识点讲解文本（供讲义"知识讲解"部分使用）
//   2. 按"模板"组装讲义内容：知识讲解 → 典型例题（错题取样）→ 变式练习
//   3. 供前端 Web 预览页和 Word 导出共用
//
// 模板系统（P8）：buildHandout({ template: 'default' | 'exam_review' | 'wrong_review' | 'english_default', ... }）
// 模板由 handoutTemplates/ 提供，详情见模板目录。
//
// 讲解缓存（P3/P8 性能）：相同 (kpName, subject) 的 AI 讲解在同一进程内复用，
// 避免 12 个知识点串行调 AI 拖慢 from-diagnosis（30s+ 经常超时）。
// 缓存以 LRU 形式控制大小，进程重启后失效。
// ============================================================

// 讲解缓存：key=`${subject}::${kpName}`，value=讲解文本；LRU 上限 256 条
const _explanationCache = new Map()
const EXPLANATION_CACHE_MAX = 256

/**
 * AI 生成知识点的讲解文本。
 * @param {string} kpName 知识点名称（如"相似三角形"）
 * @param {string} subject 学科
 * @returns {Promise<string>} 讲解 Markdown 文本
 */
export async function generateKnowledgeExplanation(kpName, subject = '数学') {
  if (!kpName) return ''

  // ── 缓存命中：跳过 AI 调用 ──
  const cacheKey = `${subject}::${kpName}`
  if (_explanationCache.has(cacheKey)) {
    return _explanationCache.get(cacheKey)
  }

  const prompt = {
    systemContent: `你是一位经验丰富的 K12 ${subject}老师。请用通俗易懂的语言，为"${kpName}"这个知识点写一段 200-300 字的精讲。

要求：
1. 先说明这个知识点的核心定义/概念。
2. 然后指出学生最容易出错的地方。
3. 最后给出一个简单实用的记忆技巧或解题口诀。
4. 内容要适合初中生理解，不要过于学术化。
5. 使用 Markdown 格式输出。`,
    userContent: `请为知识点「${kpName}」撰写一段精讲（${subject}学科）。`,
  }

  let text
  try {
    const result = await callTextCompletion({
      systemContent: prompt.systemContent,
      userContent: prompt.userContent,
      temperature: 0.5,
      maxTokens: 800,
    })
    text = (result.content || '').trim()
  } catch (err) {
    console.warn(`  ⚠️ [Handout] 知识点讲解生成失败 ${kpName}:`, err.message)
    text = `## ${kpName}\n\n*（知识点讲解暂不可用，请参考教材相关内容）*`
  }

  // ── 写入缓存（LRU：超出上限时删最旧） ──
  if (_explanationCache.size >= EXPLANATION_CACHE_MAX) {
    const firstKey = _explanationCache.keys().next().value
    if (firstKey) _explanationCache.delete(firstKey)
  }
  _explanationCache.set(cacheKey, text)
  return text
}

/**
 * 列出所有可用讲义模板（供前端下拉用）
 * @param {string} [subjectFilter]
 */
export function listHandoutTemplates(subjectFilter = null) {
  return listTemplates(subjectFilter)
}

/**
 * 为单个知识点组装讲义内容块。
 * P0 之后讲义定位为"老师备课用"，模板内部已完成"页内按题型分组"，
 * 本函数只负责调模板生成 blocks（不再生成变式题）。
 * @param {Object} params
 * @param {string} params.kpName 知识点名称
 * @param {string} params.subject 学科
 * @param {Array} params.sampleQuestions 典型错题 [{content, options, imageUrls, studentAnswer, correctAnswer, isBlank, errorType, errorReason, studentName, questionType}]
 * @param {string} params.explanation 可选，若已提前生成则传入
 * @param {string} [params.template] 模板 id；缺省走学科兜底
 * @returns {Promise<Array<{type, content}>>} 讲义区块列表
 */
export async function buildKnowledgeSection({ kpName, subject = '数学', sampleQuestions = [], explanation = null, template = null }) {
  // 选模板：显式传入 > 学科兜底 > lecture_prep
  const tpl = getTemplate(template) || pickTemplateBySubject(subject) || getTemplate('lecture_prep')
  if (!tpl) {
    // 极端兜底：模板系统坏了返回空数组
    console.warn(`[Handout] 未找到任何讲义模板 (template=${template}, subject=${subject})`)
    return []
  }
  return await tpl.buildSections({ kpName, subject, sampleQuestions, explanation })
}

/**
 * 组装完整讲义数据（供 Web 预览和 Word 导出共用）。
 * @param {Object} params
 * @param {string} params.title 讲义标题
 * @param {string} params.subject 学科
 * @param {string} params.periodText 时间范围文本
 * @param {Array<{kpName, subject, sampleQuestions, explanation}>} params.knowledgeSections 知识点列表
 * @param {string} [params.template] 模板 id（缺省按学科兜底）
 * @returns {Object} 讲义数据结构
 */
export async function buildHandout({ title, subject = '数学', periodText = '', knowledgeSections = [], template = null }) {
  const pages = []

  // 选模板（封面也会用模板 label）
  const tpl = getTemplate(template) || pickTemplateBySubject(subject) || getTemplate('lecture_prep')
  const templateLabel = tpl ? tpl.label : '备课讲义'

  // 封面
  pages.push({
    name: 'cover',
    blocks: [
      { type: 'cover-title', content: title },
      { type: 'cover-subtitle', content: `学科：${subject}` },
      { type: 'cover-info', content: `时间范围：${periodText || '全部'}` },
      { type: 'cover-info', content: `讲义模板：${templateLabel}` },
      { type: 'cover-date', content: `生成日期：${new Date().toLocaleDateString('zh-CN')}` },
    ],
  })

  // 目录页
  const tocItems = knowledgeSections.map((ks, idx) => ({
    index: idx + 1,
    name: ks.kpName,
  }))
  pages.push({
    name: 'toc',
    blocks: [
      { type: 'section', content: '目录' },
      ...tocItems.map(item => ({
        type: 'toc-item',
        content: `${item.index}. ${item.name}`,
      })),
    ],
  })

  // 每个知识点一页：分批并发生成 AI 讲解（避免触发上游限流）。
  // 全并发 12 个常被摩搭/Qwen 限速,反而比串行还慢;每批 3 个 + LRU 跨请求缓存可
  // 把首跑从 84s 降到 ~30s,二跑走缓存降到 <10s。
  const BATCH_SIZE = 3
  const kpResults = []
  for (let i = 0; i < knowledgeSections.length; i += BATCH_SIZE) {
    const batch = knowledgeSections.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (ks, batchIdx) => {
        const idx = i + batchIdx
        const kpBlocks = await buildKnowledgeSection({
          kpName: ks.kpName,
          subject: ks.subject || subject,
          sampleQuestions: ks.sampleQuestions || [],
          explanation: ks.explanation || null,
          template,
        })
        return { idx, kpName: ks.kpName, kpBlocks }
      })
    )
    kpResults.push(...batchResults)
  }
  kpResults.sort((a, b) => a.idx - b.idx)
  for (const r of kpResults) {
    pages.push({
      name: r.kpName,
      blocks: [
        { type: 'page-title', content: r.kpName },
        ...r.kpBlocks,
      ],
    })
  }

  return {
    title,
    subject,
    periodText,
    template: tpl ? tpl.id : 'default',
    templateLabel,
    pages,
    generatedAt: new Date().toISOString(),
  }
}